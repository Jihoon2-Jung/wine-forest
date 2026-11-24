#!/usr/bin/env python3
"""
JH Wine Forest — Phase 2-3B 기존 와인 라벨 일괄 검색 · 사용자 컨펌 도구

기능:
1. wine_db.json에서 라벨 사진(labelImageFileId)이 비어 있는 와인(기본: 보유 IN_STOCK 와인)을 추출합니다.
2. 공식 공개 API(Open Food Facts / Wikimedia Commons) 또는 선택 옵션(--local-dir, --google-cse-key, --serpapi-key)으로
   와인별 라벨 후보 이미지를 수집합니다. (안티봇/CAPTCHA 우회 없음)
3. 브라우저에서 열어 바로 검수할 수 있는 단일 HTML 파일(label_review.html)을 생성합니다.
   - 후보 썸네일 클릭 선택, 이미지 URL 붙여넣기, 클립보드(Cmd+V) / 드래그&드롭 직접 붙여넣기 지원
   - 검수 진행 상태는 브라우저 localStorage에 자동 저장되어 중단 후 이어서 작업 가능
   - [승인 라벨 번들 내보내기] 클릭 시 모든 승인 이미지를 브라우저에서 500px WebP로 자동 압축해
     approved_labels.json 파일 1개로 다운로드
4. 다운로드한 approved_labels.json을 JH Wine Forest 웹앱 [설정 → 승인된 라벨 일괄 적용]으로 올리면
   drive.file 최소 권한 정책을 준수하며 Google Drive(JH_Wine_Forest/photos/)에 일괄 업로드·연결됩니다.

보안 주의:
- wine_db.json, label_review.html, approved_labels.json 등 개인 데이터는 반드시
  프로젝트 밖 폴더(예: ~/Documents/wine-backup/)에 보관하고 Public 저장소에 커밋하지 마세요.
"""

from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import mimetypes
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


USER_AGENT = "JHWineForestLabelReview/1.0 (+https://github.com/Jihoon2-Jung/wine-forest)"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def normalize_token(text: str) -> str:
    return re.sub(r"[^a-z0-9가-힣]+", "", text.lower())


def build_search_query(wine: Dict[str, Any]) -> str:
    """빈티지 구분 없이 와인명 기준으로 라벨 검색 쿼리 생성"""
    name = str(wine.get("name", "")).strip()
    return f"{name} wine bottle label"


def http_get_json(url: str, timeout: float = 4.0) -> Optional[Dict[str, Any]]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None


def search_open_food_facts(query_name: str, limit: int = 2) -> List[Dict[str, str]]:
    """Open Food Facts 공개 JSON API에서 와인 이미지 후보 검색"""
    params = urllib.parse.urlencode(
        {
            "search_terms": query_name,
            "search_simple": "1",
            "action": "process",
            "json": "1",
            "page_size": str(max(4, limit * 2)),
            "fields": "product_name,image_front_url,image_url",
        }
    )
    data = http_get_json(f"https://world.openfoodfacts.org/cgi/search.pl?{params}")
    if not data:
        return []
    results: List[Dict[str, str]] = []
    seen = set()
    for prod in data.get("products", []):
        img = prod.get("image_front_url") or prod.get("image_url")
        if not img or img in seen:
            continue
        seen.add(img)
        results.append(
            {
                "url": img,
                "source": "OpenFoodFacts",
                "title": str(prod.get("product_name") or query_name)[:80],
            }
        )
        if len(results) >= limit:
            break
    return results


def search_wikimedia_commons(query_name: str, limit: int = 2) -> List[Dict[str, str]]:
    """Wikimedia Commons 공식 MediaWiki API에서 공개 와인 이미지 후보 검색"""
    params = urllib.parse.urlencode(
        {
            "action": "query",
            "format": "json",
            "generator": "search",
            "gsrsearch": f"{query_name} wine",
            "gsrnamespace": "6",  # File namespace
            "gsrlimit": str(max(4, limit * 2)),
            "prop": "imageinfo",
            "iiprop": "url|mime",
            "iiurlwidth": "500",
        }
    )
    data = http_get_json(f"https://commons.wikimedia.org/w/api.php?{params}")
    if not data:
        return []
    pages = (data.get("query") or {}).get("pages") or {}
    results: List[Dict[str, str]] = []
    for page in pages.values():
        infos = page.get("imageinfo") or []
        if not infos:
            continue
        info = infos[0]
        mime = str(info.get("mime", ""))
        if not mime.startswith("image/") or "svg" in mime:
            continue
        url = info.get("thumburl") or info.get("url")
        if not url:
            continue
        results.append(
            {
                "url": str(url),
                "source": "Wikimedia",
                "title": str(page.get("title", "")).replace("File:", "")[:80],
            }
        )
        if len(results) >= limit:
            break
    return results


def search_google_cse(
    query: str, api_key: str, cx: str, limit: int = 4
) -> List[Dict[str, str]]:
    """Google Custom Search JSON API (공식 API, 사용자 키 제공 시 활성)"""
    params = urllib.parse.urlencode(
        {
            "key": api_key,
            "cx": cx,
            "q": query,
            "searchType": "image",
            "num": str(min(10, max(1, limit))),
            "safe": "active",
        }
    )
    data = http_get_json(f"https://www.googleapis.com/customsearch/v1?{params}")
    if not data:
        return []
    results: List[Dict[str, str]] = []
    for item in data.get("items", []):
        link = item.get("link")
        if not link:
            continue
        results.append(
            {
                "url": str(link),
                "source": "GoogleCSE",
                "title": str(item.get("title", ""))[:80],
            }
        )
        if len(results) >= limit:
            break
    return results


def search_serpapi(query: str, api_key: str, limit: int = 4) -> List[Dict[str, str]]:
    """SerpAPI Google Images (공식 API, 사용자 키 제공 시 활성)"""
    params = urllib.parse.urlencode(
        {
            "engine": "google_images",
            "q": query,
            "api_key": api_key,
            "num": str(min(10, max(1, limit))),
        }
    )
    data = http_get_json(f"https://serpapi.com/search.json?{params}")
    if not data:
        return []
    results: List[Dict[str, str]] = []
    for item in data.get("images_results", []):
        img = item.get("thumbnail") or item.get("original")
        if not img:
            continue
        results.append(
            {
                "url": str(img),
                "source": "SerpAPI",
                "title": str(item.get("title", ""))[:80],
            }
        )
        if len(results) >= limit:
            break
    return results


def index_local_images(local_dir: Optional[Path]) -> List[Tuple[str, Path]]:
    if not local_dir or not local_dir.exists():
        return []
    indexed: List[Tuple[str, Path]] = []
    for p in sorted(local_dir.rglob("*")):
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS:
            indexed.append((normalize_token(p.stem), p))
    return indexed


def match_local_candidates(
    wine: Dict[str, Any], local_index: List[Tuple[str, Path]], limit: int = 3
) -> List[Dict[str, str]]:
    if not local_index:
        return []
    wine_key = normalize_token(str(wine.get("name", "")))
    vintage = str(wine.get("vintage", "")).strip()
    if len(wine_key) < 3:
        return []

    scored: List[Tuple[int, Path]] = []
    for stem_key, path in local_index:
        score = 0
        if wine_key in stem_key or stem_key in wine_key:
            score += 10
        if vintage and vintage.upper() != "NV" and vintage in stem_key:
            score += 4
        if score >= 10:
            scored.append((score, path))

    scored.sort(key=lambda x: x[0], reverse=True)
    results: List[Dict[str, str]] = []
    for _, path in scored[:limit]:
        mime, _ = mimetypes.guess_type(str(path))
        mime = mime or "image/jpeg"
        b64 = base64.b64encode(path.read_bytes()).decode("ascii")
        results.append(
            {
                "url": f"data:{mime};base64,{b64}",
                "source": "LocalFolder",
                "title": path.name,
            }
        )
    return results


def select_target_wines(
    db: Dict[str, Any],
    include_out_of_stock: bool = False,
    include_existing_labels: bool = False,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    빈티지·용량 구분 없이 (와인명, 색상) 단위로 묶어 라벨 검수 카드 1장으로 통합합니다.
    승인 시 동일 (와인명, 색상)의 모든 빈티지에 1개의 라벨 이미지가 공통 적용됩니다.
    """
    in_stock_counts: Dict[str, int] = {}
    for b in db.get("bottles", []):
        if b.get("status") == "IN_STOCK":
            wid = str(b.get("wineId", ""))
            in_stock_counts[wid] = in_stock_counts.get(wid, 0) + 1

    grouped: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for w in db.get("wines", []):
        wid = str(w.get("id", ""))
        name = str(w.get("name", "")).strip()
        color = str(w.get("color", "R")).strip().upper()
        vintage = str(w.get("vintage", "NV")).strip()
        stock_qty = in_stock_counts.get(wid, 0)
        key = (name.lower(), color)

        entry = grouped.get(key)
        if not entry:
            entry = {
                "groupKey": f"{name.lower()}|{color}",
                "wineId": wid,
                "wineIds": [],
                "name": name,
                "color": color,
                "vintages": [],
                "country": str(w.get("country", "")),
                "region": str(w.get("region", "")),
                "subRegion": str(w.get("subRegion") or ""),
                "inStockCount": 0,
                "hasAnyLabel": False,
                "missingAnyLabel": False,
                "searchQuery": build_search_query(w),
            }
            grouped[key] = entry

        entry["wineIds"].append(wid)
        if vintage and vintage not in entry["vintages"]:
            entry["vintages"].append(vintage)
        entry["inStockCount"] += stock_qty
        if w.get("labelImageFileId"):
            entry["hasAnyLabel"] = True
        else:
            entry["missingAnyLabel"] = True

    targets: List[Dict[str, Any]] = []
    for entry in grouped.values():
        if not include_out_of_stock and entry["inStockCount"] <= 0:
            continue
        if not include_existing_labels and not entry["missingAnyLabel"]:
            continue
        entry["vintages"].sort()
        entry["vintage"] = ", ".join(entry["vintages"]) if entry["vintages"] else "NV"
        targets.append(entry)

    targets.sort(key=lambda x: (-x["inStockCount"], x["name"].lower()))
    if limit is not None and limit > 0:
        targets = targets[:limit]
    return targets


HTML_TEMPLATE = """<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>JH Wine Forest — 라벨 검수 · 컨펌 도구</title>
  <style>
    :root {
      --bg: #faf9f6; --surface: #ffffff; --elev: #f2efe9; --border: #e6e2d8;
      --text: #1a211d; --muted: #55615b; --forest: #1b4332; --gold: #b58d24; --danger: #b42318;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif; background: var(--bg); color: var(--text); }
    header {
      position: sticky; top: 0; z-index: 20; background: var(--surface);
      border-bottom: 1px solid var(--border); padding: 14px 20px;
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;
    }
    h1 { margin: 0; font-size: 18px; }
    .sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    button, .btn-link {
      border: 1px solid var(--border); background: var(--elev); color: var(--text);
      padding: 8px 12px; border-radius: 10px; font-size: 12px; font-weight: 700;
      cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 5px;
    }
    button.primary { background: var(--forest); color: #fff; border-color: var(--forest); }
    button.danger { color: var(--danger); border-color: rgba(180,35,24,.35); background: #fff; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .toolbar {
      max-width: 1280px; margin: 14px auto 0; padding: 0 20px;
      display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    }
    .toolbar input[type="search"] {
      flex: 1; min-width: 220px; padding: 9px 12px; border-radius: 10px;
      border: 1px solid var(--border); background: var(--surface); font-size: 13px;
    }
    .grid {
      max-width: 1280px; margin: 14px auto 60px; padding: 0 20px;
      display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 14px;
    }
    .card {
      background: var(--surface); border: 2px solid var(--border); border-radius: 16px;
      padding: 14px; display: flex; flex-direction: column; gap: 10px; transition: border-color .15s;
    }
    .card.approved { border-color: var(--forest); box-shadow: 0 0 0 2px rgba(27,67,50,.12); }
    .card.focused { outline: 2px dashed var(--gold); outline-offset: 2px; }
    .card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .wine-name { font-weight: 800; font-size: 14px; line-height: 1.3; }
    .meta { font-size: 11px; color: var(--muted); margin-top: 3px; }
    .badge { font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 99px; background: var(--elev); }
    .badge.ok { background: rgba(27,67,50,.14); color: var(--forest); }
    .candidates { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .cand {
      border: 2px solid var(--border); border-radius: 10px; overflow: hidden;
      background: var(--elev); cursor: pointer; aspect-ratio: 3/4; position: relative;
      display: flex; align-items: center; justify-content: center; padding: 0;
    }
    .cand.selected { border-color: var(--forest); box-shadow: 0 0 0 2px rgba(27,67,50,.25); }
    .cand img { width: 100%; height: 100%; object-fit: contain; background: #fff; }
    .cand-tag {
      position: absolute; bottom: 2px; left: 2px; right: 2px; font-size: 9px;
      background: rgba(0,0,0,.65); color: #fff; text-align: center; border-radius: 4px; padding: 1px 2px;
    }
    .dropzone {
      border: 1.5px dashed var(--border); border-radius: 12px; padding: 10px;
      background: var(--elev); display: flex; align-items: center; gap: 10px;
      font-size: 11px; color: var(--muted);
    }
    .dropzone.drag { border-color: var(--forest); background: rgba(27,67,50,.08); }
    .preview-box {
      width: 54px; height: 72px; border-radius: 8px; border: 1px solid var(--border);
      background: #fff; overflow: hidden; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
      font-size: 10px; color: var(--muted);
    }
    .preview-box img { width: 100%; height: 100%; object-fit: cover; }
    .url-row { display: flex; gap: 6px; }
    .url-row input {
      flex: 1; padding: 7px 9px; border-radius: 8px; border: 1px solid var(--border);
      font-size: 11px; background: var(--surface);
    }
    .foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 6px; }
    .tip { max-width: 1280px; margin: 12px auto 0; padding: 10px 20px; font-size: 12px; color: var(--muted); }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>🍷 JH Wine Forest — 라벨 일괄 검수 · 컨펌 도구</h1>
      <div class="sub" id="statusText">로딩 중...</div>
    </div>
    <div class="actions">
      <button type="button" id="btnFilterPending">미승인만 보기</button>
      <button type="button" id="btnClearSaved" class="danger">검수 초기화</button>
      <button type="button" id="btnExport" class="primary">📦 승인 라벨 번들 내보내기 (approved_labels.json)</button>
    </div>
  </header>

  <div class="tip">
    💡 <strong>초고속 검수 팁:</strong>
    ① 후보 이미지가 맞으면 클릭해 바로 승인하거나,
    ② <strong>[🔍 구글 이미지]</strong>를 열어 맞는 라벨을 <strong>우클릭 → 이미지 복사</strong>한 뒤 해당 와인 카드를 클릭하고 <strong><code>Cmd+V</code> (Ctrl+V)</strong>로 붙여넣으세요! (드래그&amp;드롭 및 로컬 파일 선택도 지원)
    ③ 완료 후 우측 상단 <strong>[승인 라벨 번들 내보내기]</strong> → 웹앱 <strong>설정(⚙️) → 승인된 라벨 일괄 적용</strong>에 업로드하면 Google Drive에 자동 저장됩니다.
  </div>

  <div class="toolbar">
    <input type="search" id="searchInput" placeholder="와인명, 빈티지, 산지 필터..." />
    <span class="sub" id="exportProgress"></span>
  </div>

  <main class="grid" id="grid"></main>

  <script id="review-data" type="application/json">__PAYLOAD_JSON__</script>
  <script>
    const STORAGE_KEY = 'jh-wine-forest-label-review-v1';
    const items = JSON.parse(document.getElementById('review-data').textContent);
    let selections = {};
    try {
      selections = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch { selections = {}; }

    let activeWineId = null;
    let onlyPending = false;
    let searchQuery = '';

    function saveSelections() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(selections)); } catch {}
      updateHeader();
    }

    function updateHeader() {
      const approvedCount = items.filter((w) => Boolean(selections[w.groupKey || w.wineId])).length;
      document.getElementById('statusText').textContent =
        `빈티지 통합 기준 ${items.length}개 라벨 중 ${approvedCount}개 승인됨 (남은 ${items.length - approvedCount}개)`;
      document.getElementById('btnFilterPending').textContent =
        onlyPending ? '전체 보기' : `미승인만 보기 (${items.length - approvedCount})`;
    }

    function blobToCompressedWebPDataUrl(blob, maxDim = 500, quality = 0.82) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          const longest = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
          const scale = longest > maxDim ? maxDim / longest : 1;
          const w = Math.max(1, Math.round((img.naturalWidth || maxDim) * scale));
          const h = Math.max(1, Math.round((img.naturalHeight || maxDim) * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          let out = canvas.toDataURL('image/webp', quality);
          if (!out.startsWith('data:image/webp')) {
            out = canvas.toDataURL('image/jpeg', quality);
          }
          resolve(out);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('이미지 디코딩 실패'));
        };
        img.src = url;
      });
    }

    async function urlToCompressedDataUrl(src) {
      if (src.startsWith('data:image/')) {
        const resp = await fetch(src);
        const blob = await resp.blob();
        return blobToCompressedWebPDataUrl(blob);
      }
      const resp = await fetch(src, { mode: 'cors' });
      if (!resp.ok) throw new Error('CORS/네트워크 다운로드 실패');
      const blob = await resp.blob();
      return blobToCompressedWebPDataUrl(blob);
    }

    async function setWineSelectionFromBlob(wineId, blob) {
      const dataUrl = await blobToCompressedWebPDataUrl(blob);
      selections[wineId] = { dataUrl, source: 'direct' };
      saveSelections();
      render();
    }

    function setWineSelectionFromUrl(wineId, url, source) {
      selections[wineId] = { url, source };
      saveSelections();
      render();
    }

    function clearWineSelection(wineId) {
      delete selections[wineId];
      saveSelections();
      render();
    }

    // 전역 클립보드 붙여넣기(Cmd+V): 현재 포커스된 카드에 즉시 이미지 적용
    window.addEventListener('paste', async (e) => {
      if (!activeWineId) return;
      const itemsList = e.clipboardData?.items || [];
      for (const it of itemsList) {
        if (it.type.startsWith('image/')) {
          e.preventDefault();
          const blob = it.getAsFile();
          if (blob) {
            await setWineSelectionFromBlob(activeWineId, blob);
          }
          return;
        }
      }
    });

    function render() {
      updateHeader();
      const grid = document.getElementById('grid');
      grid.innerHTML = '';
      const q = searchQuery.trim().toLowerCase();

      const filtered = items.filter((w) => {
        const key = w.groupKey || w.wineId;
        if (onlyPending && selections[key]) return false;
        if (q) {
          const hay = `${w.name} ${w.vintage} ${w.country} ${w.region} ${w.subRegion}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      for (const w of filtered) {
        const key = w.groupKey || w.wineId;
        const sel = selections[key];
        const card = document.createElement('section');
        card.className = `card${sel ? ' approved' : ''}${activeWineId === key ? ' focused' : ''}`;
        card.tabIndex = 0;
        card.addEventListener('click', () => {
          activeWineId = key;
          document.querySelectorAll('.card.focused').forEach((el) => el.classList.remove('focused'));
          card.classList.add('focused');
        });

        const origin = [w.country, w.region, w.subRegion].filter((v, i, arr) => v && arr.indexOf(v) === i).join(' · ');
        const previewSrc = sel ? (sel.dataUrl || sel.url) : '';
        const googleImgUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(w.searchQuery)}`;
        const vintageLabel = w.vintages && w.vintages.length > 1
          ? `빈티지 공통 (${w.vintages.join(', ')})`
          : w.vintage;

        card.innerHTML = `
          <div class="card-head">
            <div>
              <div class="wine-name">${w.name}</div>
              <div class="meta">${w.color} · ${origin} · 보유 ${w.inStockCount}병 · ${vintageLabel}</div>
            </div>
            <span class="badge ${sel ? 'ok' : ''}">${sel ? '✅ 승인됨' : '대기'}</span>
          </div>
          <div class="candidates"></div>
          <div class="dropzone">
            <div class="preview-box">${previewSrc ? `<img src="${previewSrc}" alt="선택된 라벨" />` : '미선택'}</div>
            <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
              <div>카드 클릭 후 <strong>Cmd+V</strong> 붙여넣기 또는 이미지 드래그&amp;드롭</div>
              <div class="url-row">
                <input type="url" placeholder="또는 이미지 URL 붙여넣기 후 Enter" value="${sel?.url || ''}" />
                <button type="button" class="btn-file">파일</button>
              </div>
            </div>
          </div>
          <div class="foot">
            <a class="btn-link" href="${googleImgUrl}" target="_blank" rel="noopener noreferrer">🔍 구글 이미지 검색</a>
            ${sel ? '<button type="button" class="danger btn-clear">승인 취소</button>' : '<span class="sub">후보 선택 또는 붙여넣기</span>'}
          </div>
        `;

        // 후보 썸네일 렌더
        const candWrap = card.querySelector('.candidates');
        if (w.candidates && w.candidates.length > 0) {
          for (const c of w.candidates) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `cand${sel && (sel.url === c.url || sel.dataUrl === c.url) ? ' selected' : ''}`;
            btn.title = `${c.source}: ${c.title || ''}`;
            btn.innerHTML = `<img src="${c.url}" loading="lazy" alt="후보" /><span class="cand-tag">${c.source}</span>`;
            btn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              activeWineId = key;
              if (c.url.startsWith('data:')) {
                selections[key] = { dataUrl: c.url, source: c.source };
                saveSelections();
                render();
              } else {
                setWineSelectionFromUrl(key, c.url, c.source);
              }
            });
            candWrap.appendChild(btn);
          }
        } else {
          candWrap.style.display = 'none';
        }

        // URL 입력
        const urlInput = card.querySelector('input[type="url"]');
        urlInput.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' && urlInput.value.trim()) {
            ev.preventDefault();
            setWineSelectionFromUrl(key, urlInput.value.trim(), 'url');
          }
        });
        urlInput.addEventListener('change', () => {
          if (urlInput.value.trim()) {
            setWineSelectionFromUrl(key, urlInput.value.trim(), 'url');
          }
        });

        // 로컬 파일 선택
        card.querySelector('.btn-file').addEventListener('click', (ev) => {
          ev.stopPropagation();
          const fi = document.createElement('input');
          fi.type = 'file';
          fi.accept = 'image/*';
          fi.onchange = async () => {
            const f = fi.files?.[0];
            if (f) await setWineSelectionFromBlob(key, f);
          };
          fi.click();
        });

        // 드래그&드롭
        const dz = card.querySelector('.dropzone');
        dz.addEventListener('dragover', (ev) => { ev.preventDefault(); dz.classList.add('drag'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
        dz.addEventListener('drop', async (ev) => {
          ev.preventDefault();
          dz.classList.remove('drag');
          const f = ev.dataTransfer?.files?.[0];
          if (f && f.type.startsWith('image/')) {
            await setWineSelectionFromBlob(key, f);
          }
        });

        const clearBtn = card.querySelector('.btn-clear');
        if (clearBtn) {
          clearBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            clearWineSelection(key);
          });
        }

        grid.appendChild(card);
      }
    }

    document.getElementById('searchInput').addEventListener('input', (e) => {
      searchQuery = e.target.value;
      render();
    });

    document.getElementById('btnFilterPending').addEventListener('click', () => {
      onlyPending = !onlyPending;
      render();
    });

    document.getElementById('btnClearSaved').addEventListener('click', () => {
      if (confirm('저장된 라벨 승인 선택 내역을 모두 초기화할까요?')) {
        selections = {};
        saveSelections();
        render();
      }
    });

    document.getElementById('btnExport').addEventListener('click', async () => {
      const approvedEntries = items.filter((w) => Boolean(selections[w.groupKey || w.wineId]));
      if (approvedEntries.length === 0) {
        alert('승인된 라벨이 없습니다. 최소 1개 이상 선택해 주세요.');
        return;
      }
      const btn = document.getElementById('btnExport');
      const prog = document.getElementById('exportProgress');
      btn.disabled = true;

      const exportedItems = [];
      const failedNames = [];

      for (let i = 0; i < approvedEntries.length; i++) {
        const w = approvedEntries[i];
        const sel = selections[w.groupKey || w.wineId];
        prog.textContent = `500px WebP 압축 중... (${i + 1}/${approvedEntries.length})`;
        try {
          const dataUrl = sel.dataUrl
            ? sel.dataUrl
            : await urlToCompressedDataUrl(sel.url);
          const mimeMatch = dataUrl.match(/^data:(image\\/[a-zA-Z0-9.+-]+);base64,/);
          exportedItems.push({
            wineId: w.wineId,
            wineIds: w.wineIds || [w.wineId],
            wineName: w.name,
            color: w.color,
            vintage: w.vintage,
            mimeType: mimeMatch ? mimeMatch[1] : 'image/webp',
            dataUrl,
          });
        } catch {
          failedNames.push(w.name);
        }
      }

      btn.disabled = false;
      prog.textContent = `완료: ${exportedItems.length}건 내보내기${failedNames.length ? ` (CORS 실패 ${failedNames.length}건 — 이미지 복사 후 Cmd+V로 재시도하세요)` : ''}`;

      if (exportedItems.length === 0) {
        alert('외부 사이트 CORS 제한으로 이미지를 변환하지 못했습니다.\\n구글 이미지에서 "이미지 복사" 후 카드에 Cmd+V로 붙여넣어 주세요.');
        return;
      }

      const payload = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        items: exportedItems,
      };
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = `approved_labels_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(dlUrl);

      if (failedNames.length > 0) {
        alert(`성공 ${exportedItems.length}건을 저장했습니다.\\n\\n외부 사이트 CORS 제한으로 누락된 ${failedNames.length}건은 해당 이미지를 복사해 카드에 Cmd+V로 붙여넣은 뒤 다시 내보내 주세요:\\n- ${failedNames.slice(0, 8).join('\\n- ')}`);
      }
    });

    render();
  </script>
</body>
</html>
"""


def generate_review_html(
    input_json: Path,
    out_html: Path,
    local_dir: Optional[Path] = None,
    include_out_of_stock: bool = False,
    include_existing_labels: bool = False,
    skip_remote_search: bool = False,
    google_cse_key: Optional[str] = None,
    google_cse_cx: Optional[str] = None,
    serpapi_key: Optional[str] = None,
    limit: Optional[int] = None,
    delay_sec: float = 0.25,
) -> Dict[str, int]:
    db = json.loads(input_json.read_text(encoding="utf-8"))
    targets = select_target_wines(
        db,
        include_out_of_stock=include_out_of_stock,
        include_existing_labels=include_existing_labels,
        limit=limit,
    )
    local_index = index_local_images(local_dir)
    total = len(targets)
    with_candidates = 0

    def fetch_for_item(item: Dict[str, Any]) -> Tuple[Dict[str, Any], List[Dict[str, str]]]:
        candidates: List[Dict[str, str]] = []
        candidates.extend(match_local_candidates(item, local_index, limit=3))

        if not skip_remote_search:
            if google_cse_key and google_cse_cx:
                candidates.extend(
                    search_google_cse(item["searchQuery"], google_cse_key, google_cse_cx, limit=4)
                )
            elif serpapi_key:
                candidates.extend(search_serpapi(item["searchQuery"], serpapi_key, limit=4))
            else:
                candidates.extend(search_open_food_facts(item["name"], limit=2))
                candidates.extend(search_wikimedia_commons(item["name"], limit=2))

            if delay_sec > 0:
                time.sleep(delay_sec)

        deduped: List[Dict[str, str]] = []
        seen_urls = set()
        for c in candidates:
            u = c.get("url", "")
            if u and u not in seen_urls:
                seen_urls.add(u)
                deduped.append(c)
            if len(deduped) >= 4:
                break
        return item, deduped

    if skip_remote_search or total <= 1:
        for item in targets:
            _, deduped = fetch_for_item(item)
            item["candidates"] = deduped
            if deduped:
                with_candidates += 1
    else:
        print(f"[진행] 총 {total}종 라벨 후보 검색 시작 (병렬 6스레드)...", flush=True)
        done_count = 0
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = [pool.submit(fetch_for_item, item) for item in targets]
            for fut in as_completed(futures):
                item, deduped = fut.result()
                item["candidates"] = deduped
                if deduped:
                    with_candidates += 1
                done_count += 1
                if done_count % 10 == 0 or done_count == total:
                    print(
                        f"  ... {done_count}/{total}종 완료 (후보 발견 {with_candidates}종)",
                        flush=True,
                    )

    # </script> 이스케이프 보호
    safe_json = json.dumps(targets, ensure_ascii=False).replace("</", "<\\/")
    html = HTML_TEMPLATE.replace("__PAYLOAD_JSON__", safe_json)
    out_html.parent.mkdir(parents=True, exist_ok=True)
    out_html.write_text(html, encoding="utf-8")

    return {
        "total_targets": len(targets),
        "with_candidates": with_candidates,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="JH Wine Forest 기존 와인 라벨 일괄 검색 · 사용자 컨펌 HTML 생성기 (Phase 2-3B)"
    )
    parser.add_argument("--input", required=True, help="wine_db.json 경로")
    parser.add_argument(
        "--out-html",
        default="label_review.html",
        help="생성할 검수 HTML 경로 (프로젝트 밖 폴더 권장)",
    )
    parser.add_argument(
        "--local-dir",
        default=None,
        help="미리 모아둔 라벨 사진 폴더 경로 (파일명 기준 자동 매칭)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="품절/소비완료 와인까지 모두 포함 (기본: 현재 보유 IN_STOCK 와인만)",
    )
    parser.add_argument(
        "--include-existing",
        action="store_true",
        help="이미 라벨이 등록된 와인도 다시 검수 대상에 포함",
    )
    parser.add_argument(
        "--no-remote",
        action="store_true",
        help="원격 공개 API 검색을 생략하고 검수 HTML만 즉시 생성 (수동 Cmd+V/드래그 검수용)",
    )
    parser.add_argument(
        "--google-cse-key",
        default=os.environ.get("GOOGLE_CSE_API_KEY"),
        help="(선택) Google Custom Search API Key",
    )
    parser.add_argument(
        "--google-cse-cx",
        default=os.environ.get("GOOGLE_CSE_CX"),
        help="(선택) Google Custom Search Engine ID (cx)",
    )
    parser.add_argument(
        "--serpapi-key",
        default=os.environ.get("SERPAPI_KEY"),
        help="(선택) SerpAPI Key",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="테스트/분할 작업용 최대 와인 수 제한 (예: --limit 30)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.2,
        help="원격 API 요청 간 대기 시간(초, 기본 0.2)",
    )
    args = parser.parse_args()

    summary = generate_review_html(
        input_json=Path(args.input),
        out_html=Path(args.out_html),
        local_dir=Path(args.local_dir) if args.local_dir else None,
        include_out_of_stock=args.all,
        include_existing_labels=args.include_existing,
        skip_remote_search=args.no_remote,
        google_cse_key=args.google_cse_key,
        google_cse_cx=args.google_cse_cx,
        serpapi_key=args.serpapi_key,
        limit=args.limit,
        delay_sec=args.delay,
    )
    print(
        f"[완료] 라벨 검수 대상 {summary['total_targets']}종 "
        f"(자동 후보 발견 {summary['with_candidates']}종)"
    )
    print(f"  - 검수 HTML: {args.out_html}")
    print("  - 브라우저로 열어서 승인 후 [approved_labels.json]을 내보내고,")
    print("    웹앱 [설정 → 승인된 라벨 일괄 적용]으로 업로드하세요.")


if __name__ == "__main__":
    main()
