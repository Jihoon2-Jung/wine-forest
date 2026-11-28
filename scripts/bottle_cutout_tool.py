#!/usr/bin/env python3
"""
JH Wine Forest — 다중 와인 보틀 누끼 분할 & 하이브리드 1-B OCR 매칭 도구 (Phase 1)

기능:
1. 아이폰 다병 세움 사진(1~15병)을 좌→우 순서로 자동 분할:
   - 1차: 경량 COCO ONNX(yolov8s.onnx, class_id == 39 bottle만 채택, 40 wine glass 제외)
   - 2차 폴백: 전체 이미지 rembg 알파 상단 넥(neck) 프로젝션 밸리 분할
   - 이미 배경이 투명한 RGBA 입력은 rembg를 자동 스킵하고 보틀 캔버스 정규화만 수행
2. 병별 안전 패딩 크롭 후 인접 병 엣지 억제 + 유리 반사 홀 메우기 + 1px 페더링
3. Vivino 스타일 350x500 투명 RGBA WebP 캔버스 하단 정렬 (기존 WineThumbnail 비율 호환)
4. 1-B 하이브리드 OCR (기본 무료 오프라인 macOS Vision / Windows RapidOCR + 선택 Gemini 폴백)
   및 불어·영문·이태리어·한글 음차 wine_db.json 퍼지 매칭
5. 127.0.0.1 로컬 2-탭 리뷰 서버:
   - 탭 1: 사진별 바운딩 박스 수정/추가/삭제 & 즉시 재누끼/재OCR (/api/recut)
   - 탭 2: 와인 컬러 그라디언트 배경 위 누끼 검증 & Top-3/검색 매칭 확정 → approved_labels.json 내보내기
"""

from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass, field
from datetime import datetime, timezone
from difflib import SequenceMatcher
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage
from scipy.signal import find_peaks


# ---------------------------------------------------------------------------
# Constants & Schema Contracts
# ---------------------------------------------------------------------------

CANVAS_WIDTH = 350
CANVAS_HEIGHT = 500
MAX_BOTTLE_W = 300
MAX_BOTTLE_H = 450
BOTTOM_MARGIN = 24

VALID_WINE_COLORS = {"R", "W", "SP", "SW", "RO"}
MAX_BOTTLES_PER_PHOTO = 15
SUPPORTED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}

DEFAULT_YOLO_URLS = [
    "https://huggingface.co/Kalray/yolov8/resolve/main/yolov8s.onnx",
    "https://huggingface.co/unileon-robotics/YOLO8-ONNX/resolve/main/yolov8s.onnx",
]
CACHE_DIR = Path.home() / ".cache" / "jh_wine_forest"
DEFAULT_SWIFT_OCR_SRC = Path(__file__).resolve().parent / "mac_vision_ocr.swift"
USER_AGENT = "JHWineForestBottleCutout/1.0 (+https://github.com/Jihoon2-Jung/wine-forest)"

COCO_BOTTLE_CLASS_ID = 39
COCO_WINE_GLASS_CLASS_ID = 40

STOPWORDS = {
    "wine",
    "vin",
    "vino",
    "wein",
    "the",
    "and",
    "of",
    "de",
    "du",
    "des",
    "la",
    "le",
    "les",
    "et",
    "d",
    "l",
    "a",
    "en",
    "au",
    "aux",
    "appellation",
    "controlee",
    "controles",
    "protegee",
    "mis",
    "en",
    "bouteille",
    "par",
    "product",
    "france",
    "italy",
    "italia",
    "usa",
    "chile",
    "spain",
    "alc",
    "vol",
    "ml",
    "750ml",
    "contains",
    "sulfites",
}

TOKEN_ALIAS_GROUPS: List[Tuple[str, ...]] = [
    ("chateau", "ch", "샤또", "샤토"),
    ("domaine", "dom", "도멘"),
    ("clos", "끌로", "클로"),
    ("saint", "st", "ste", "생", "생트"),
    ("mont", "몽"),
    ("cote", "cotes", "꼬뜨", "코트"),
    ("premier", "1er", "프리미에"),
    ("grand", "grands", "그랑"),
    ("cru", "크뤼"),
    ("reserve", "riserva", "reserva", "리저브", "레제르바"),
    ("cuvee", "퀴베"),
    ("blanc", "blanche", "블랑"),
    ("rouge", "루즈"),
    ("brut", "브륏"),
    ("bordeaux", "보르도"),
    ("bourgogne", "burgundy", "부르고뉴"),
    ("champagne", "샴페인"),
    ("margaux", "마고"),
    ("pauillac", "뽀이약"),
    ("julien", "줄리앙"),
    ("estephe", "테스테프", "에스테프"),
    ("pomerol", "뽀므롤", "포므롤"),
    ("emilion", "에밀리옹"),
    ("sauternes", "소떼른", "소테른"),
    ("chablis", "샤블리"),
    ("gevrey", "쥬브레", "제브레"),
    ("chambertin", "샹베르탱"),
    ("vosne", "본"),
    ("romanee", "로마네"),
    ("echezeaux", "에세죠", "에셰조"),
    ("meursault", "뫼르소"),
    ("puligny", "륄리니", "퓔리니"),
    ("chassagne", "샤샤뉴", "샤사뉴"),
    ("montrachet", "몽라쉐", "몽라셰"),
    ("corton", "꼬르똥", "코르통"),
    ("barolo", "바롤로"),
    ("barbaresco", "바르바레스코"),
    ("brunello", "브루넬로"),
    ("montalcino", "몬탈치노"),
    ("chianti", "끼안티", "키안티"),
    ("bolgheri", "볼게리"),
    ("toscana", "tuscany", "토스카나"),
    ("napa", "나파"),
    ("valley", "밸리"),
    ("cabernet", "까베르네", "카베르네"),
    ("sauvignon", "소비뇽"),
    ("pinot", "피노"),
    ("noir", "누아", "누아르"),
    ("chardonnay", "샤도네이", "샤르도네"),
    ("merlot", "메를로", "멀롯"),
    ("syrah", "shiraz", "시라", "쉬라즈"),
    ("riesling", "리슬링"),
    ("mosel", "모젤"),
    ("rioja", "리오하"),
    ("dom", "domperignon", "perignon", "돔페리뇽"),
    ("krug", "크룩"),
    ("latour", "라뚜르", "라투르"),
    ("lafite", "라피트"),
    ("mouton", "무통"),
    ("haut", "오"),
    ("brion", "브리옹"),
    ("talbot", "탈보"),
    ("lynch", "린치"),
    ("bages", "바쥬", "바주"),
    ("opus", "오퍼스"),
    ("one", "원"),
    ("almaviva", "알마비바"),
    ("sassicaia", "사시까이아", "사시카이아"),
    ("tignanello", "티냐넬로"),
]

ALIAS_TO_CANONICAL: Dict[str, str] = {}
for group in TOKEN_ALIAS_GROUPS:
    canonical = group[0]
    for alias in group:
        ALIAS_TO_CANONICAL[alias] = canonical


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------


@dataclass
class OcrResult:
    lines: List[Dict[str, Any]] = field(default_factory=list)
    raw_text: str = ""
    avg_confidence: float = 0.0
    engine: str = "none"
    parsed_wine_name: str = ""
    parsed_vintage: Optional[str] = None
    parsed_color_hint: Optional[str] = None


# ---------------------------------------------------------------------------
# Image Loading & Pre-Cutout Detection
# ---------------------------------------------------------------------------


def _register_heif_if_available() -> bool:
    try:
        import pillow_heif  # type: ignore

        pillow_heif.register_heif_opener()
        return True
    except Exception:
        return False


def load_image_normalized(path: Path) -> Image.Image:
    """EXIF 회전 보정 및 HEIC/HEIF(pillow-heif 또는 macOS sips 폴백) 지원 로드."""
    ext = path.suffix.lower()
    if ext in {".heic", ".heif"}:
        _register_heif_if_available()
    try:
        with Image.open(path) as im:
            im.load()
            transposed = ImageOps.exif_transpose(im)
            return transposed.copy()
    except Exception as primary_exc:
        if ext in {".heic", ".heif"} and sys.platform == "darwin" and shutil.which("sips"):
            with tempfile.TemporaryDirectory() as tmpdir:
                tmp_png = Path(tmpdir) / "converted.png"
                proc = subprocess.run(
                    ["sips", "-s", "format", "png", str(path), "--out", str(tmp_png)],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if proc.returncode == 0 and tmp_png.exists():
                    with Image.open(tmp_png) as conv:
                        conv.load()
                        transposed = ImageOps.exif_transpose(conv)
                        return transposed.copy()
        raise RuntimeError(f"이미지 로드 실패 ({path.name}): {primary_exc}") from primary_exc


def is_precut_transparent(img: Image.Image, threshold_ratio: float = 0.15) -> bool:
    """이미지가 이미 누끼 처리된 투명 RGBA인지 판별 (>=15% 투명, >=1% 불투명)."""
    if "A" not in img.getbands():
        return False
    alpha = np.asarray(img.convert("RGBA"))[:, :, 3]
    total = alpha.size
    if total == 0:
        return False
    transparent_ratio = float(np.count_nonzero(alpha < 10)) / total
    opaque_ratio = float(np.count_nonzero(alpha >= 128)) / total
    return transparent_ratio >= threshold_ratio and opaque_ratio >= 0.01


# ---------------------------------------------------------------------------
# Layer 1: COCO ONNX Multi-Bottle Detector (class_id == 39)
# ---------------------------------------------------------------------------


def letterbox_image(
    img_rgb: np.ndarray,
    target_h: int = 640,
    target_w: int = 640,
    pad_value: int = 114,
) -> Tuple[np.ndarray, float, int, int]:
    """비율 유지 레터박스 리사이징 및 패딩 오프셋 반환."""
    orig_h, orig_w = img_rgb.shape[:2]
    if orig_h <= 0 or orig_w <= 0:
        raise ValueError("Empty image dimensions")
    scale = min(target_w / orig_w, target_h / orig_h)
    new_w = max(1, int(round(orig_w * scale)))
    new_h = max(1, int(round(orig_h * scale)))
    pil_resized = Image.fromarray(img_rgb).resize((new_w, new_h), Image.Resampling.BILINEAR)
    canvas = np.full((target_h, target_w, 3), pad_value, dtype=np.uint8)
    pad_x = (target_w - new_w) // 2
    pad_y = (target_h - new_h) // 2
    canvas[pad_y : pad_y + new_h, pad_x : pad_x + new_w] = np.asarray(pil_resized)
    return canvas, scale, pad_x, pad_y


def _box_iou(a: Sequence[float], b: Sequence[float]) -> float:
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])
    inter_w = max(0.0, x2 - x1)
    inter_h = max(0.0, y2 - y1)
    inter = inter_w * inter_h
    if inter <= 0.0:
        return 0.0
    area_a = max(0.0, (a[2] - a[0]) * (a[3] - a[1]))
    area_b = max(0.0, (b[2] - b[0]) * (b[3] - b[1]))
    union = area_a + area_b - inter
    return inter / union if union > 0.0 else 0.0


def _containment_ratio(inner: Sequence[float], outer: Sequence[float]) -> float:
    x1 = max(inner[0], outer[0])
    y1 = max(inner[1], outer[1])
    x2 = min(inner[2], outer[2])
    y2 = min(inner[3], outer[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area_inner = max(0.0, (inner[2] - inner[0]) * (inner[3] - inner[1]))
    if area_inner <= 0.0:
        return 0.0
    return inter / area_inner


def nms_and_containment_filter(
    candidates: List[Tuple[List[float], float]],
    iou_threshold: float = 0.45,
    containment_threshold: float = 0.80,
    orig_h: Optional[int] = None,
) -> List[Tuple[List[int], float]]:
    """NMS(IoU > 0.45), 포함 중복 제거, 앞줄 주피사체 필터 및 크기순 최대 15병 선택 후 좌→우 정렬."""
    if not candidates:
        return []
    ordered = sorted(candidates, key=lambda x: x[1], reverse=True)
    kept: List[Tuple[List[float], float]] = []
    for box, conf in ordered:
        duplicate = False
        for kbox, _ in kept:
            if _box_iou(box, kbox) > iou_threshold:
                duplicate = True
                break
            area_b = (box[2] - box[0]) * (box[3] - box[1])
            area_k = (kbox[2] - kbox[0]) * (kbox[3] - kbox[1])
            smaller, larger = (box, kbox) if area_b <= area_k else (kbox, box)
            if _containment_ratio(smaller, larger) >= containment_threshold:
                if area_b <= area_k:
                    duplicate = True
                    break
        if not duplicate:
            kept.append((box, conf))

    # 큰 박스 안에 소형 박스가 80% 이상 포함된 역순(높은 conf의 작은 라벨 박스 vs 큰 병 박스)도 정리
    final_kept: List[Tuple[List[int], float]] = []
    for idx, (box, conf) in enumerate(kept):
        area_b = (box[2] - box[0]) * (box[3] - box[1])
        swallowed = False
        for jdx, (obox, _) in enumerate(kept):
            if idx == jdx:
                continue
            area_o = (obox[2] - obox[0]) * (obox[3] - obox[1])
            if area_o > area_b * 1.15 and _containment_ratio(box, obox) >= containment_threshold:
                swallowed = True
                break
        if not swallowed:
            final_kept.append(([int(round(v)) for v in box], float(conf)))

    # 앞줄 큰 와인병(max_h >= 0.35 * orig_h)이 있을 때 뒷줄 작은 진열장 병(< 55% * max_h) 자동 제거
    if final_kept and orig_h is not None and orig_h > 0:
        max_h = max(b[3] - b[1] for b, _ in final_kept)
        if max_h >= 0.35 * orig_h:
            foreground = [(b, c) for b, c in final_kept if (b[3] - b[1]) >= 0.55 * max_h]
            if foreground:
                final_kept = foreground

    # 15병 상한 전, 좌측 작은 병에 밀려 우측 큰 앞줄 병이 잘리지 않도록 크기(면적) 우선 보존
    if len(final_kept) > MAX_BOTTLES_PER_PHOTO:
        final_kept.sort(key=lambda item: (item[0][2] - item[0][0]) * (item[0][3] - item[0][1]), reverse=True)
        final_kept = final_kept[:MAX_BOTTLES_PER_PHOTO]

    final_kept.sort(key=lambda item: (item[0][0] + item[0][2]) * 0.5)
    return final_kept


def decode_yolo_bottle_boxes(
    raw_output: np.ndarray,
    orig_w: int,
    orig_h: int,
    scale: float,
    pad_x: int,
    pad_y: int,
    in_w: int = 640,
    in_h: int = 640,
    conf_threshold: float = 0.28,
) -> List[Dict[str, Any]]:
    """
    YOLOv8 COCO ONNX 출력([1, 84, N] 또는 [1, N, 84])에서
    class_id == 39 (bottle)만 추출하고 wine glass(40)·비율 이상·중복 박스를 제거합니다.
    """
    arr = np.squeeze(raw_output)
    if arr.ndim != 2:
        return []
    if arr.shape[0] in (84, 85) and (arr.shape[1] not in (84, 85) or arr.shape[1] > arr.shape[0]):
        arr = arr.T  # -> [N, 84]
    if arr.shape[1] < 4 + COCO_WINE_GLASS_CLASS_ID + 1:
        return []

    class_scores = arr[:, 4:]
    best_cls = np.argmax(class_scores, axis=1)
    best_conf = np.max(class_scores, axis=1)

    mask = (best_cls == COCO_BOTTLE_CLASS_ID) & (best_conf >= conf_threshold)
    # 명시적으로 wine glass(40)가 1위인 행은 best_cls == 39 조건으로 배제되지만 이중 방어
    mask &= best_cls != COCO_WINE_GLASS_CLASS_ID

    selected = arr[mask]
    selected_confs = best_conf[mask]
    if selected.shape[0] == 0:
        return []

    candidates: List[Tuple[List[float], float]] = []
    for row, conf in zip(selected, selected_confs):
        cx, cy, bw, bh = float(row[0]), float(row[1]), float(row[2]), float(row[3])
        # 혹시 모델이 0..1 정규화 좌표로 출력한 경우 보정
        if cx <= 1.5 and cy <= 1.5 and bw <= 1.5 and bh <= 1.5 and max(in_w, in_h) > 10:
            cx *= in_w
            bw *= in_w
            cy *= in_h
            bh *= in_h

        x1 = (cx - bw * 0.5 - pad_x) / scale
        y1 = (cy - bh * 0.5 - pad_y) / scale
        x2 = (cx + bw * 0.5 - pad_x) / scale
        y2 = (cy + bh * 0.5 - pad_y) / scale

        x1 = max(0.0, min(float(orig_w), x1))
        y1 = max(0.0, min(float(orig_h), y1))
        x2 = max(0.0, min(float(orig_w), x2))
        y2 = max(0.0, min(float(orig_h), y2))

        box_w = x2 - x1
        box_h = y2 - y1
        if box_w < 12.0 or box_h < 0.18 * orig_h:
            continue
        if (box_h / box_w) < 1.4:
            continue
        candidates.append(([x1, y1, x2, y2], float(conf)))

    filtered = nms_and_containment_filter(
        candidates,
        iou_threshold=0.45,
        containment_threshold=0.80,
        orig_h=orig_h,
    )
    return [
        {"box": box, "confidence": round(conf, 4), "source": "yolo"}
        for box, conf in filtered
    ]


def _download_file_atomic(url: str, dest: Path, timeout: float = 60.0) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(tmp_path, "wb") as out:
        shutil.copyfileobj(resp, out)
    if tmp_path.stat().st_size < 1024 * 100:
        tmp_path.unlink(missing_ok=True)
        raise RuntimeError(f"다운로드된 모델 크기가 비정상적입니다: {url}")
    os.replace(tmp_path, dest)


class BottleDetector:
    """COCO ONNX 기반 와인 보틀 탐지기 (PyTorch 불필요)."""

    def __init__(
        self,
        model_path: Optional[Path] = None,
        enabled: bool = True,
        conf_threshold: float = 0.28,
    ) -> None:
        self.enabled = enabled
        self.conf_threshold = conf_threshold
        self.model_path = model_path or (CACHE_DIR / "models" / "yolov8s.onnx")
        self._session = None
        self._input_name: Optional[str] = None
        self._input_h = 640
        self._input_w = 640

    def _ensure_session(self) -> bool:
        if not self.enabled:
            return False
        if self._session is not None:
            return True
        try:
            import onnxruntime as ort  # type: ignore
        except Exception:
            return False

        if not self.model_path.exists():
            for url in DEFAULT_YOLO_URLS:
                try:
                    print(f"[다운로드] COCO 보틀 탐지 모델 준비 중: {self.model_path.name}", flush=True)
                    _download_file_atomic(url, self.model_path)
                    break
                except Exception as exc:
                    print(f"[경고] YOLO ONNX 다운로드 실패 ({url}): {exc}", flush=True)
        if not self.model_path.exists():
            return False

        try:
            sess = ort.InferenceSession(str(self.model_path), providers=["CPUExecutionProvider"])
            inp = sess.get_inputs()[0]
            self._input_name = inp.name
            shape = inp.shape
            if len(shape) == 4:
                if isinstance(shape[2], int) and shape[2] > 0:
                    self._input_h = int(shape[2])
                if isinstance(shape[3], int) and shape[3] > 0:
                    self._input_w = int(shape[3])
            self._session = sess
            return True
        except Exception as exc:
            print(f"[경고] YOLO ONNX 세션 로드 실패 (밸리 분할 폴백 사용): {exc}", flush=True)
            return False

    def detect(self, img: Image.Image) -> List[Dict[str, Any]]:
        if not self._ensure_session() or self._session is None or not self._input_name:
            return []
        rgb = np.asarray(img.convert("RGB"))
        orig_h, orig_w = rgb.shape[:2]
        padded, scale, pad_x, pad_y = letterbox_image(rgb, self._input_h, self._input_w)
        blob = np.transpose(padded.astype(np.float32) / 255.0, (2, 0, 1))[None, ...]
        outputs = self._session.run(None, {self._input_name: blob})
        if not outputs:
            return []
        return decode_yolo_bottle_boxes(
            outputs[0],
            orig_w=orig_w,
            orig_h=orig_h,
            scale=scale,
            pad_x=pad_x,
            pad_y=pad_y,
            in_w=self._input_w,
            in_h=self._input_h,
            conf_threshold=self.conf_threshold,
        )


# ---------------------------------------------------------------------------
# Layer 2: Neck-Projection Valley Fallback Splitter
# ---------------------------------------------------------------------------


def split_bottles_by_neck_valley(alpha: np.ndarray) -> List[List[int]]:
    """
    전체 이미지 rembg 알파 마스크의 병목 상단 구간(y ∈ [15%, 42%]) 수직 프로젝션 밸리를 이용해
    나란히 선 여러 병의 좌→우 바운딩 박스를 분할합니다.
    """
    if alpha.ndim != 2:
        raise ValueError("Expected 2D alpha array")
    img_h, img_w = alpha.shape
    fg = alpha > 128
    fg_rows = np.where(np.any(fg, axis=1))[0]
    if fg_rows.size == 0:
        return []

    y_min = int(fg_rows[0])
    y_max = int(fg_rows[-1])
    span_h = max(1, y_max - y_min + 1)
    if span_h < 0.18 * img_h:
        return []

    strip_top = max(0, int(round(y_min + 0.15 * span_h)))
    strip_bottom = min(img_h, max(strip_top + 2, int(round(y_min + 0.42 * span_h))))
    strip = fg[strip_top:strip_bottom, :]
    if not np.any(strip):
        strip_top = int(round(0.15 * img_h))
        strip_bottom = max(strip_top + 2, int(round(0.42 * img_h)))
        strip = fg[strip_top:strip_bottom, :]

    col_hist = strip.sum(axis=0).astype(np.float64)
    if float(col_hist.max()) <= 0.0:
        return []

    sigma = max(3.0, img_w * 0.008)
    smooth = ndimage.gaussian_filter1d(col_hist, sigma=sigma)
    global_peak = float(smooth.max())
    if global_peak <= 0.0:
        return []

    min_peak_dist = max(12, img_w // 25)
    peaks, _ = find_peaks(smooth, distance=min_peak_dist, prominence=max(0.5, global_peak * 0.12))

    split_xs: List[int] = [0]
    if len(peaks) >= 2:
        for i in range(len(peaks) - 1):
            p_left = int(peaks[i])
            p_right = int(peaks[i + 1])
            if p_right <= p_left + 1:
                continue
            segment = smooth[p_left : p_right + 1]
            valley_rel = int(np.argmin(segment))
            valley_x = p_left + valley_rel
            valley_val = float(smooth[valley_x])
            ref_peak = min(float(smooth[p_left]), float(smooth[p_right]))
            if valley_val < 0.25 * global_peak or valley_val <= 0.45 * ref_peak:
                split_xs.append(valley_x)
    split_xs.append(img_w)

    boxes: List[List[int]] = []
    for i in range(len(split_xs) - 1):
        xs = split_xs[i]
        xe = split_xs[i + 1]
        if xe - xs < 12:
            continue
        sub = fg[:, xs:xe]
        ys, xs_local = np.where(sub)
        if ys.size == 0:
            continue
        bx1 = xs + int(xs_local.min())
        bx2 = xs + int(xs_local.max()) + 1
        by1 = int(ys.min())
        by2 = int(ys.max()) + 1
        bw = bx2 - bx1
        bh = by2 - by1
        if bw < 12 or bh < 0.18 * img_h:
            continue
        boxes.append([bx1, by1, bx2, by2])

    boxes.sort(key=lambda b: (b[0] + b[2]) * 0.5)
    return boxes[:MAX_BOTTLES_PER_PHOTO]


# ---------------------------------------------------------------------------
# Layer 3: Per-Bottle Crop, Neighbor Suppression & 350x500 WebP Normalization
# ---------------------------------------------------------------------------


def compute_padded_crop_box(
    box: Sequence[int],
    img_w: int,
    img_h: int,
    pad_x_ratio: float = 0.12,
    pad_top_ratio: float = 0.06,
    pad_bottom_ratio: float = 0.05,
) -> Tuple[List[int], List[int]]:
    """라벨·캡슐 잘림 방지를 위한 안전 패딩 크롭 박스 및 크롭 내부 원본 박스 좌표 반환."""
    x1, y1, x2, y2 = [int(v) for v in box]
    bw = max(1, x2 - x1)
    bh = max(1, y2 - y1)
    pad_x = int(round(bw * pad_x_ratio))
    pad_top = int(round(bh * pad_top_ratio))
    pad_bottom = int(round(bh * pad_bottom_ratio))

    cx1 = max(0, x1 - pad_x)
    cy1 = max(0, y1 - pad_top)
    cx2 = min(img_w, x2 + pad_x)
    cy2 = min(img_h, y2 + pad_bottom)

    inner_rel = [x1 - cx1, y1 - cy1, x2 - cx1, y2 - cy1]
    return [cx1, cy1, cx2, cy2], inner_rel


def suppress_neighbor_artifacts(
    rgba: Image.Image,
    inner_rel_box: Optional[Sequence[int]] = None,
) -> Image.Image:
    """
    옆 병 잔여 찌꺼기 제거(중앙 코어 연결 성분 선택 + 좌우 경계 성분 폐기 + 마진 감쇠),
    유리 반사 홀 메우기(binary_fill_holes), 외곽 1px 가우시안 페더링 적용.
    """
    arr = np.asarray(rgba.convert("RGBA")).copy()
    ch, cw = arr.shape[:2]
    if ch == 0 or cw == 0:
        return rgba.convert("RGBA")

    alpha = arr[:, :, 3].astype(np.float32)
    fg = alpha > 128
    if not np.any(fg):
        return rgba.convert("RGBA")

    labeled, num_features = ndimage.label(fg)
    if num_features > 1:
        core_x1, core_x2 = int(round(cw * 0.30)), max(int(round(cw * 0.30)) + 1, int(round(cw * 0.70)))
        core_y1, core_y2 = int(round(ch * 0.25)), max(int(round(ch * 0.25)) + 1, int(round(ch * 0.80)))
        core_slice = labeled[core_y1:core_y2, core_x1:core_x2]
        core_labels, core_counts = np.unique(core_slice[core_slice > 0], return_counts=True)

        total_counts = np.bincount(labeled.ravel())
        if core_labels.size > 0:
            main_label = int(core_labels[int(np.argmax(core_counts))])
        else:
            total_counts[0] = 0
            main_label = int(np.argmax(total_counts))

        main_area = max(1, int(total_counts[main_label]))
        keep_mask = np.zeros_like(fg, dtype=bool)
        for lbl in range(1, num_features + 1):
            if lbl == main_label:
                keep_mask |= labeled == lbl
                continue
            comp = labeled == lbl
            area = int(total_counts[lbl])
            touches_lr_edge = bool(np.any(comp[:, 0]) or np.any(comp[:, cw - 1]))
            if touches_lr_edge:
                continue
            if area >= 0.35 * main_area:
                keep_mask |= comp
    else:
        keep_mask = fg

    # 유리 하이라이트로 생긴 내부 구멍 메우기
    filled_mask = ndimage.binary_fill_holes(keep_mask)

    # 패딩 바깥 영역에 인접 병이 경계까지 닿아 있으면 부드럽게 감쇠
    if inner_rel_box is not None and len(inner_rel_box) == 4:
        ix1, _, ix2, _ = [int(v) for v in inner_rel_box]
        ix1 = max(0, min(cw, ix1))
        ix2 = max(0, min(cw, ix2))
        if ix1 > 2 and np.any(filled_mask[:, : max(1, ix1 // 2)]):
            taper_left = np.linspace(0.0, 1.0, ix1, dtype=np.float32)
            alpha[:, :ix1] *= taper_left[None, :]
        if (cw - ix2) > 2 and np.any(filled_mask[:, min(cw - 1, ix2 + (cw - ix2) // 2) :]):
            taper_right = np.linspace(1.0, 0.0, cw - ix2, dtype=np.float32)
            alpha[:, ix2:] *= taper_right[None, :]

    # 홀이 메워진 내부 영역은 255 보장, 제거된 영역은 0 처리
    holes_only = filled_mask & (~keep_mask)
    refined_alpha = np.where(keep_mask, alpha, 0.0)
    refined_alpha = np.where(holes_only, 255.0, refined_alpha)

    # 외곽 1px boundary에만 가우시안 페더링(sigma=0.7) 적용해 내부/배경 선명도 보존
    eroded = ndimage.binary_erosion(filled_mask, iterations=1)
    dilated = ndimage.binary_dilation(filled_mask, iterations=1)
    boundary = dilated & (~eroded)
    feathered = ndimage.gaussian_filter(refined_alpha, sigma=0.7)
    out_alpha = np.where(boundary, feathered, refined_alpha)
    out_alpha = np.where(eroded, 255.0, out_alpha)
    out_alpha = np.where(~dilated, 0.0, out_alpha)

    arr[:, :, 3] = np.clip(np.round(out_alpha), 0, 255).astype(np.uint8)
    return Image.fromarray(arr, mode="RGBA")


def is_valid_bottle_cutout(rgba: Image.Image) -> bool:
    """누끼 결과 알파 마스크가 정상 와인 보틀 실루엣(세로/가로 >= 1.6, 최소 크기/밀도)인지 검증."""
    arr = np.asarray(rgba.convert("RGBA"))
    alpha = arr[:, :, 3]
    ys, xs = np.where(alpha > 10)
    if ys.size == 0:
        return False
    bw = int(xs.max()) - int(xs.min()) + 1
    bh = int(ys.max()) - int(ys.min()) + 1
    if bw < 16 or bh < 40:
        return False
    if (bh / bw) < 1.60:
        return False
    region = alpha[int(ys.min()) : int(ys.max()) + 1, int(xs.min()) : int(xs.max()) + 1]
    fill_ratio = float(np.count_nonzero(region > 128)) / float(bw * bh)
    return fill_ratio >= 0.22


def normalize_bottle_canvas(rgba: Image.Image) -> Image.Image:
    """
    타이트 알파 바운딩 박스 기준으로 300x450 가용 영역에 비율 유지 리사이즈 후
    350x500 투명 RGBA 캔버스에 좌우 중앙·하단 여백 24px 정렬합니다.
    """
    src = rgba.convert("RGBA")
    arr = np.asarray(src)
    alpha = arr[:, :, 3]
    ys, xs = np.where(alpha > 10)
    canvas = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (0, 0, 0, 0))
    if ys.size == 0:
        return canvas

    x1, x2 = int(xs.min()), int(xs.max()) + 1
    y1, y2 = int(ys.min()), int(ys.max()) + 1
    cropped = src.crop((x1, y1, x2, y2))
    cw, ch = cropped.size
    scale = min(MAX_BOTTLE_W / cw, MAX_BOTTLE_H / ch)
    new_w = max(1, int(round(cw * scale)))
    new_h = max(1, int(round(ch * scale)))
    resized = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)

    dest_x = (CANVAS_WIDTH - new_w) // 2
    dest_y = CANVAS_HEIGHT - BOTTOM_MARGIN - new_h
    if dest_y < 12:
        dest_y = max(0, (CANVAS_HEIGHT - new_h) // 2)
    canvas.paste(resized, (dest_x, dest_y), resized)
    return canvas


def encode_cutout_webp(
    rgba: Image.Image,
    max_bytes: int = 90 * 1024,
) -> Tuple[bytes, str]:
    """350x500 투명 RGBA 이미지를 WebP(<=90KB) + data URL로 인코딩."""
    img = rgba.convert("RGBA")
    raw_bytes = b""
    for q in (88, 82, 75, 68):
        buf = io.BytesIO()
        img.save(buf, format="WEBP", lossless=False, quality=q, method=6)
        raw_bytes = buf.getvalue()
        if len(raw_bytes) <= max_bytes:
            break
    b64 = base64.b64encode(raw_bytes).decode("ascii")
    return raw_bytes, f"data:image/webp;base64,{b64}"


class RembgSegmenter:
    """rembg 배경 제거 래퍼 (테스트 시 callable 주입 가능)."""

    def __init__(
        self,
        model_name: str = "isnet-general-use",
        remove_fn: Optional[Callable[[Image.Image], Image.Image]] = None,
    ) -> None:
        self.model_name = model_name
        self._custom_remove_fn = remove_fn
        self._rembg_remove = None
        self._session = None

    def _ensure_rembg(self) -> None:
        if self._custom_remove_fn is not None or self._rembg_remove is not None:
            return
        try:
            from rembg import new_session, remove  # type: ignore
        except Exception as exc:
            raise RuntimeError(
                "rembg 패키지가 설치되어 있지 않습니다. "
                "먼저 `scripts/.venv_cutout/bin/pip install -r scripts/requirements_cutout.txt`를 실행하세요."
            ) from exc
        self._session = new_session(self.model_name)
        self._rembg_remove = remove

    def remove_background(self, img: Image.Image) -> Image.Image:
        if self._custom_remove_fn is not None:
            return self._custom_remove_fn(img).convert("RGBA")
        self._ensure_rembg()
        assert self._rembg_remove is not None
        out = self._rembg_remove(img.convert("RGB"), session=self._session)
        return out.convert("RGBA")


# ---------------------------------------------------------------------------
# Layer 4: Hybrid 1-B OCR Pipeline
# ---------------------------------------------------------------------------


def extract_label_focus_crop(orig_crop: Image.Image) -> Image.Image:
    """원본 고해상도 병 크롭에서 라벨 영역(y ∈ [28%, 82%], x ∈ [10%, 90%]) 집중 추출."""
    w, h = orig_crop.size
    if w < 10 or h < 10:
        return orig_crop
    x1 = int(round(w * 0.10))
    x2 = max(x1 + 2, int(round(w * 0.90)))
    y1 = int(round(h * 0.28))
    y2 = max(y1 + 2, int(round(h * 0.82)))
    return orig_crop.crop((x1, y1, x2, y2))


def summarize_ocr_lines(lines: List[Dict[str, Any]], engine: str) -> OcrResult:
    cleaned: List[Dict[str, Any]] = []
    for line in lines:
        txt = str(line.get("text", "")).strip()
        if not txt:
            continue
        conf = float(line.get("confidence", 0.0))
        cleaned.append(
            {
                "text": txt,
                "confidence": round(conf, 4),
                "x": float(line.get("x", 0.0)),
                "y": float(line.get("y", 0.0)),
                "w": float(line.get("w", 0.0)),
                "h": float(line.get("h", 0.0)),
            }
        )
    raw_text = "\n".join(item["text"] for item in cleaned)
    avg_conf = (
        sum(item["confidence"] for item in cleaned) / len(cleaned)
        if cleaned
        else 0.0
    )
    return OcrResult(
        lines=cleaned,
        raw_text=raw_text,
        avg_confidence=round(avg_conf, 4),
        engine=engine,
        parsed_vintage=extract_vintage_from_text(raw_text),
    )


class MacVisionOcrEngine:
    """macOS VNRecognizeTextRequest 배치 OCR 엔진 (Swift CLI 자동 컴파일)."""

    def __init__(
        self,
        swift_src: Path = DEFAULT_SWIFT_OCR_SRC,
        binary_path: Optional[Path] = None,
    ) -> None:
        self.swift_src = swift_src
        self.binary_path = binary_path or (CACHE_DIR / "mac_vision_ocr")

    def ensure_binary(self) -> Path:
        if not self.swift_src.exists():
            raise FileNotFoundError(f"Swift OCR 소스를 찾을 수 없습니다: {self.swift_src}")
        needs_build = (
            not self.binary_path.exists()
            or self.swift_src.stat().st_mtime > self.binary_path.stat().st_mtime
        )
        if needs_build:
            swiftc = shutil.which("swiftc")
            if not swiftc:
                raise RuntimeError("swiftc를 찾을 수 없습니다.")
            self.binary_path.parent.mkdir(parents=True, exist_ok=True)
            mod_cache = CACHE_DIR / "swift_mod_cache"
            mod_cache.mkdir(parents=True, exist_ok=True)
            proc = subprocess.run(
                [
                    swiftc,
                    "-O",
                    "-module-cache-path",
                    str(mod_cache),
                    str(self.swift_src),
                    "-o",
                    str(self.binary_path),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            if proc.returncode != 0:
                raise RuntimeError(f"mac_vision_ocr 컴파일 실패: {proc.stderr.strip()}")
        return self.binary_path

    def recognize_batch(self, image_paths: List[Path]) -> Dict[str, OcrResult]:
        if not image_paths:
            return {}
        binary = self.ensure_binary()
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8", delete=False) as tf:
            json.dump([str(p) for p in image_paths], tf, ensure_ascii=False)
            manifest_path = Path(tf.name)
        try:
            proc = subprocess.run(
                [str(binary), "--manifest", str(manifest_path)],
                capture_output=True,
                text=True,
                check=False,
            )
            if proc.returncode != 0:
                raise RuntimeError(f"macOS Vision OCR 실행 실패: {proc.stderr.strip()}")
            parsed = json.loads(proc.stdout or "[]")
            out: Dict[str, OcrResult] = {}
            for item in parsed:
                p = str(item.get("path", ""))
                lines = item.get("lines") or []
                out[p] = summarize_ocr_lines(lines, engine="mac_vision")
            return out
        finally:
            manifest_path.unlink(missing_ok=True)


class RapidOcrEngine:
    """Windows / Linux 오프라인 폴백 OCR 엔진 (rapidocr-onnxruntime)."""

    def __init__(self) -> None:
        self._engine = None

    def _ensure_engine(self):
        if self._engine is None:
            try:
                from rapidocr_onnxruntime import RapidOCR  # type: ignore
            except Exception as exc:
                raise RuntimeError(
                    "rapidocr-onnxruntime이 설치되어 있지 않습니다."
                ) from exc
            self._engine = RapidOCR()
        return self._engine

    def recognize_batch(self, image_paths: List[Path]) -> Dict[str, OcrResult]:
        if not image_paths:
            return {}
        engine = self._ensure_engine()
        out: Dict[str, OcrResult] = {}
        for path in image_paths:
            result, _ = engine(str(path))
            lines: List[Dict[str, Any]] = []
            if result:
                for row in result:
                    # [box, text, conf]
                    if len(row) < 3:
                        continue
                    lines.append({"text": str(row[1]), "confidence": float(row[2])})
            out[str(path)] = summarize_ocr_lines(lines, engine="rapidocr")
        return out


class LocalOcrDispatcher:
    """OS에 맞춰 macOS Vision 또는 RapidOCR 선택 (테스트 시 callable 주입 가능)."""

    def __init__(
        self,
        backend_fn: Optional[Callable[[List[Path]], Dict[str, OcrResult]]] = None,
    ) -> None:
        self._backend_fn = backend_fn
        self._mac = MacVisionOcrEngine() if sys.platform == "darwin" else None
        self._rapid = RapidOcrEngine()

    def recognize_batch(self, image_paths: List[Path]) -> Dict[str, OcrResult]:
        if not image_paths:
            return {}
        if self._backend_fn is not None:
            return self._backend_fn(image_paths)
        if sys.platform == "darwin" and self._mac is not None and shutil.which("swiftc"):
            try:
                return self._mac.recognize_batch(image_paths)
            except Exception as exc:
                print(f"[경고] macOS Vision OCR 실패, RapidOCR 폴백 시도: {exc}", flush=True)
        try:
            return self._rapid.recognize_batch(image_paths)
        except Exception as exc:
            print(f"[경고] 로컬 OCR 사용 불가 (빈 결과 반환): {exc}", flush=True)
            return {str(p): OcrResult(engine="unavailable") for p in image_paths}


class GeminiOcrFallback:
    """선택적 Gemini Flash 라벨 판독기 (API 키는 헤더 x-goog-api-key로만 전달)."""

    def __init__(
        self,
        api_key: Optional[str],
        model: str = "gemini-2.5-flash",
        transport_fn: Optional[Callable[[str, Dict[str, Any], Dict[str, str]], Dict[str, Any]]] = None,
    ) -> None:
        self.api_key = (api_key or "").strip()
        self.model = model.strip() or "gemini-2.5-flash"
        self._transport_fn = transport_fn

    def is_available(self) -> bool:
        return bool(self.api_key)

    def recognize_image(self, image_path: Path) -> Optional[OcrResult]:
        if not self.api_key:
            return None
        with Image.open(image_path) as im:
            rgb = im.convert("RGB")
            rgb.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            rgb.save(buf, format="JPEG", quality=88)
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")

        endpoint = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{urllib.parse.quote(self.model, safe='')}:generateContent"
        )
        prompt = (
            "Read this wine bottle label carefully. Return ONLY valid JSON with keys: "
            '{"rawText": string, "wineName": string, "producer": string, '
            '"vintage": string|null, "colorHint": "R"|"W"|"SP"|"SW"|"RO"|null}.'
        )
        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {"inlineData": {"mimeType": "image/jpeg", "data": b64}},
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json",
            },
        }
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.api_key,
        }

        if self._transport_fn is not None:
            resp_json = self._transport_fn(endpoint, payload, headers)
        else:
            req = urllib.request.Request(
                endpoint,
                data=json.dumps(payload).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=25.0) as resp:
                resp_json = json.loads(resp.read().decode("utf-8", errors="replace"))

        candidates = resp_json.get("candidates") or []
        if not candidates:
            return None
        parts = ((candidates[0].get("content") or {}).get("parts")) or []
        text_chunk = "".join(str(p.get("text", "")) for p in parts).strip()
        if not text_chunk:
            return None
        text_chunk = re.sub(r"^```(?:json)?\s*|\s*```$", "", text_chunk, flags=re.IGNORECASE)
        parsed = json.loads(text_chunk)
        raw_text = str(parsed.get("rawText") or "").strip()
        wine_name = str(parsed.get("wineName") or "").strip()
        producer = str(parsed.get("producer") or "").strip()
        combined = "\n".join([v for v in (wine_name, producer, raw_text) if v])
        vintage_raw = parsed.get("vintage")
        vintage = str(vintage_raw).strip() if vintage_raw else extract_vintage_from_text(combined)
        color_hint = parsed.get("colorHint")
        if color_hint not in VALID_WINE_COLORS:
            color_hint = None

        lines = [{"text": line.strip(), "confidence": 0.92} for line in combined.splitlines() if line.strip()]
        return OcrResult(
            lines=lines,
            raw_text=combined,
            avg_confidence=0.92 if lines else 0.0,
            engine=f"gemini:{self.model}",
            parsed_wine_name=wine_name,
            parsed_vintage=vintage,
            parsed_color_hint=color_hint,
        )


def should_trigger_gemini_fallback(
    ocr_result: Optional[OcrResult],
    top1_score: float,
    ocr_mode: str,
) -> bool:
    """--ocr-mode(local|hybrid|gemini)에 따라 Gemini 보정 호출 여부를 결정합니다."""
    mode = ocr_mode.lower().strip()
    if mode == "local":
        return False
    if mode == "gemini":
        return True
    if mode == "hybrid":
        if ocr_result is None or len(ocr_result.lines) < 2:
            return True
        if ocr_result.avg_confidence < 0.55:
            return True
        if top1_score < 62.0:
            return True
        return False
    raise ValueError(f"지원하지 않는 ocr_mode입니다: {ocr_mode}")


# ---------------------------------------------------------------------------
# Layer 5: Multilingual & Transliteration Wine DB Fuzzy Matcher
# ---------------------------------------------------------------------------


def _is_hangul_char(ch: str) -> bool:
    cp = ord(ch)
    return (0xAC00 <= cp <= 0xD7A3) or (0x1100 <= cp <= 0x11FF) or (0x3130 <= cp <= 0x318F)


def strip_non_hangul_accents(text: str) -> str:
    """한글 음절을 자모로 분해하지 않고 라틴 악센트(é, ô, ü 등)만 안전하게 제거."""
    out: List[str] = []
    for ch in unicodedata.normalize("NFC", text):
        if _is_hangul_char(ch):
            out.append(ch)
        else:
            decomp = unicodedata.normalize("NFD", ch)
            for dc in decomp:
                if unicodedata.category(dc) != "Mn":
                    out.append(dc)
    return unicodedata.normalize("NFC", "".join(out))


def normalize_group_name(text: str) -> str:
    """label_review_tool.py / wineHelpers.ts buildWineLabelGroupKey 호환 그룹명 정규화."""
    return unicodedata.normalize("NFC", re.sub(r"\s+", " ", text.strip())).lower()


def tokenize_wine_text(text: str, expand_aliases: bool = True) -> List[str]:
    cleaned = strip_non_hangul_accents(text).lower()
    cleaned = re.sub(r"[^a-z0-9가-힣]+", " ", cleaned)
    raw_tokens = [tok for tok in cleaned.split() if tok and tok not in STOPWORDS]
    if not expand_aliases:
        return raw_tokens
    expanded: List[str] = []
    for tok in raw_tokens:
        if len(tok) == 1 and not tok.isdigit():
            continue
        canon = ALIAS_TO_CANONICAL.get(tok, tok)
        expanded.append(canon)
    return expanded


def extract_vintage_from_text(text: str) -> Optional[str]:
    years = re.findall(r"(?<!\d)(19[5-9]\d|20[0-3]\d)(?!\d)", text or "")
    if years:
        # 라벨 하단/중앙 빈티지 우선 (가장 최근 연도가 보통 빈티지; 설비연도 1855 등은 후순위)
        modern = [y for y in years if int(y) >= 1980]
        return modern[-1] if modern else years[-1]
    if re.search(r"\bN\.?V\.?\b", text or "", flags=re.IGNORECASE):
        return "NV"
    return None


def infer_color_hint_from_text(text: str) -> Optional[str]:
    norm = " " + " ".join(tokenize_wine_text(text, expand_aliases=False)) + " "
    if any(k in norm for k in (" champagne ", " brut ", " prosecco ", " cava ", " cremant ", " franciacorta ", " sparkling ", " spumante ")):
        return "SP"
    if any(k in norm for k in (" sauternes ", " barsac ", " tokaj ", " icewine ", " eiswein ", " port ", " porto ", " sherry ", " madeira ", " moscato d asti ")):
        return "SW"
    if any(k in norm for k in (" rose ", " rosado ", " rosato ", " 로제 ")):
        return "RO"
    if any(k in norm for k in (" blanc ", " chardonnay ", " sauvignon blanc ", " riesling ", " chablis ", " meursault ", " montrachet ", " pinot grigio ", " pinot gris ", " 화이트 ")):
        return "W"
    if any(k in norm for k in (" rouge ", " cabernet ", " pinot noir ", " merlot ", " syrah ", " shiraz ", " barolo ", " barbaresco ", " brunello ", " margaux ", " pauillac ", " julien ", " bordeaux ", " 레드 ")):
        return "R"
    return None


def build_wine_groups(db: Dict[str, Any]) -> List[Dict[str, Any]]:
    """wine_db.json을 (normalize_group_name(name), color) 그룹으로 통합."""
    in_stock_counts: Dict[str, int] = {}
    for b in db.get("bottles", []):
        if b.get("status") == "IN_STOCK":
            wid = str(b.get("wineId", ""))
            in_stock_counts[wid] = in_stock_counts.get(wid, 0) + 1

    grouped: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for w in db.get("wines", []):
        wid = str(w.get("id", "")).strip()
        name = str(w.get("name", "")).strip()
        if not wid or not name:
            continue
        color = str(w.get("color", "R")).strip().upper()
        if color not in VALID_WINE_COLORS:
            color = "R"
        vintage = str(w.get("vintage", "NV")).strip() or "NV"
        norm_name = normalize_group_name(name)
        key = (norm_name, color)

        entry = grouped.get(key)
        if entry is None:
            entry = {
                "groupKey": f"{norm_name}|{color}",
                "wineId": wid,
                "wineIds": [],
                "vintageByWineId": {},
                "name": name,
                "producer": str(w.get("producer") or "").strip(),
                "color": color,
                "vintages": [],
                "country": str(w.get("country") or ""),
                "region": str(w.get("region") or ""),
                "subRegion": str(w.get("subRegion") or ""),
                "inStockCount": 0,
                "hasExistingLabel": False,
            }
            grouped[key] = entry

        if wid not in entry["wineIds"]:
            entry["wineIds"].append(wid)
        entry["vintageByWineId"][wid] = vintage
        if vintage not in entry["vintages"]:
            entry["vintages"].append(vintage)
        entry["inStockCount"] += in_stock_counts.get(wid, 0)
        if w.get("labelImageFileId"):
            entry["hasExistingLabel"] = True

    result = list(grouped.values())
    for entry in result:
        entry["vintages"].sort()
        entry["vintage"] = ", ".join(entry["vintages"]) if entry["vintages"] else "NV"
        combined_search_src = " ".join(
            [
                entry["name"],
                entry["producer"],
                entry["country"],
                entry["region"],
                entry["subRegion"],
            ]
        )
        entry["_tokens"] = set(tokenize_wine_text(entry["name"] + " " + entry["producer"]))
        entry["_metaTokens"] = set(tokenize_wine_text(combined_search_src))
        entry["_canonStr"] = " ".join(tokenize_wine_text(entry["name"] + " " + entry["producer"]))

    result.sort(key=lambda x: (-x["inStockCount"], x["name"].lower()))
    return result


GENERIC_WINE_TERMS = {
    "chardonnay",
    "pinot",
    "noir",
    "cabernet",
    "sauvignon",
    "merlot",
    "syrah",
    "shiraz",
    "riesling",
    "malbec",
    "grenache",
    "nebbiolo",
    "sangiovese",
    "tempranillo",
    "blanc",
    "rouge",
    "brut",
    "rose",
    "reserve",
    "cuvee",
    "grand",
    "premier",
    "cru",
    "chateau",
    "domaine",
    "clos",
    "saint",
    "mont",
    "cote",
    "bordeaux",
    "bourgogne",
    "champagne",
    "napa",
    "valley",
    "toscana",
    "rioja",
    "mosel",
    "single",
    "block",
    "vineyard",
    "estate",
    "old",
    "vine",
    "vines",
    "dry",
    "extra",
    "selection",
    "vintage",
    "brut",
    "nature",
    "extra",
    "millesime",
}


def _has_distinctive_token_match(
    q_distinct: set[str],
    t_distinct: set[str],
) -> bool:
    if q_distinct & t_distinct:
        return True
    for qt in q_distinct:
        if len(qt) < 4:
            continue
        for tt in t_distinct:
            if len(tt) < 4:
                continue
            if SequenceMatcher(None, qt, tt).ratio() >= 0.80:
                return True
    return False


def score_wine_match(
    ocr_text: str,
    wine_group: Dict[str, Any],
    ocr_vintage: Optional[str] = None,
    ocr_color_hint: Optional[str] = None,
) -> float:
    """OCR 텍스트와 wine_group 간 0~100 매칭 점수 계산 (고유 와인명 일치 검증 + 빈티지/색상 보너스)."""
    q_tokens = tokenize_wine_text(ocr_text)
    if not q_tokens:
        return 0.0
    q_set = set(q_tokens)
    q_str = " ".join(q_tokens)

    t_set = wine_group.get("_tokens") or set(tokenize_wine_text(wine_group.get("name", "")))
    m_set = wine_group.get("_metaTokens") or t_set
    t_str = wine_group.get("_canonStr") or " ".join(sorted(t_set))
    if not t_set:
        return 0.0

    # 토큰 재현율 + 자카드 조합 + 문자열 시퀀스 유사도 (총 75점 만점)
    inter_name = q_set & t_set
    inter_meta = q_set & m_set
    union_name = q_set | t_set
    recall = len(inter_name) / max(1, len(t_set))
    precision_like = len(inter_meta) / max(1, len(q_set))
    jaccard = len(inter_name) / max(1, len(union_name))

    seq_full = SequenceMatcher(None, q_str, t_str).ratio()
    shared_sorted = " ".join(sorted(inter_name))
    seq_shared = (
        SequenceMatcher(None, shared_sorted, t_str).ratio() if shared_sorted else 0.0
    )

    text_ratio = max(
        0.55 * recall + 0.25 * precision_like + 0.20 * jaccard,
        0.65 * seq_shared + 0.35 * seq_full,
        0.5 * recall + 0.5 * seq_full,
    )
    score = 75.0 * min(1.0, text_ratio)

    # 품종/일반 라벨 단어(Chardonnay, Pinot Noir, Brut 등)만 겹치는 가짜 매칭 상한 제한
    distinctive_target = {tok for tok in t_set if tok not in GENERIC_WINE_TERMS and not tok.isdigit()}
    distinctive_query = {tok for tok in q_set if tok not in GENERIC_WINE_TERMS and not tok.isdigit()}
    if distinctive_target and not _has_distinctive_token_match(distinctive_query, distinctive_target):
        return round(min(score, 25.0), 2)

    # 빈티지 일치 보너스(+15) / 불일치 페널티(-10)
    vintage = ocr_vintage or extract_vintage_from_text(ocr_text)
    wine_vintages = set(wine_group.get("vintages") or [])
    if vintage and wine_vintages:
        if vintage in wine_vintages:
            score += 15.0
        elif vintage != "NV" and all(v != "NV" for v in wine_vintages):
            score -= 10.0

    # 색상 힌트 보너스(+10)
    color_hint = ocr_color_hint or infer_color_hint_from_text(ocr_text)
    if color_hint and wine_group.get("color") == color_hint:
        score += 10.0

    return round(max(0.0, min(100.0, score)), 2)


def match_wine_candidates(
    ocr_result: OcrResult,
    wine_groups: List[Dict[str, Any]],
    top_k: int = 3,
) -> List[Dict[str, Any]]:
    search_text = "\n".join(
        part for part in (ocr_result.parsed_wine_name, ocr_result.raw_text) if part
    ).strip()
    if not search_text or not wine_groups:
        return []

    scored: List[Tuple[float, Dict[str, Any]]] = []
    for wg in wine_groups:
        sc = score_wine_match(
            search_text,
            wg,
            ocr_vintage=ocr_result.parsed_vintage,
            ocr_color_hint=ocr_result.parsed_color_hint,
        )
        if sc > 0.0:
            scored.append((sc, wg))

    scored.sort(key=lambda x: (-x[0], -x[1].get("inStockCount", 0), x[1].get("name", "")))
    out: List[Dict[str, Any]] = []
    for sc, wg in scored[:top_k]:
        out.append(
            {
                "groupKey": wg["groupKey"],
                "wineId": wg["wineId"],
                "wineIds": list(wg["wineIds"]),
                "name": wg["name"],
                "color": wg["color"],
                "vintage": wg["vintage"],
                "vintages": list(wg["vintages"]),
                "inStockCount": wg["inStockCount"],
                "hasExistingLabel": bool(wg.get("hasExistingLabel", False)),
                "score": sc,
            }
        )
    return out


# ---------------------------------------------------------------------------
# Layer 6A: Session Pipeline & approved_labels.json Exporter
# ---------------------------------------------------------------------------


def _bottle_quality_rank(bottle: Dict[str, Any]) -> Tuple[float, float, int]:
    cands = bottle.get("candidates") or []
    top_score = float(cands[0].get("score", 0.0)) if cands else 0.0
    ocr = bottle.get("ocr") or {}
    avg_conf = float(ocr.get("avgConfidence", 0.0))
    cutout_bytes = int(bottle.get("cutoutBytes", 0))
    return (top_score, avg_conf, cutout_bytes)


def deduplicate_best_approved_per_wine(session: Dict[str, Any]) -> int:
    """
    동일 와인(selectedGroupKey)에 대해 여러 사진에서 승인(approved)된 보틀이 있으면
    매칭 점수·OCR 신뢰도·해상도(바이트) 기준 최고 1장만 유지하고 나머지는 excluded로 강등합니다.
    """
    by_group: Dict[str, List[Dict[str, Any]]] = {}
    for ph in session.get("photos", []):
        for b in ph.get("bottles", []):
            if b.get("decision") != "approved":
                continue
            gkey = str(b.get("selectedGroupKey") or "").strip()
            if not gkey:
                continue
            by_group.setdefault(gkey, []).append(b)

    demoted = 0
    for bottles in by_group.values():
        if len(bottles) <= 1:
            continue
        bottles.sort(key=_bottle_quality_rank, reverse=True)
        bottles[0]["duplicateOfBest"] = False
        for extra in bottles[1:]:
            extra["decision"] = "excluded"
            extra["duplicateOfBest"] = True
            demoted += 1
    return demoted


def build_approved_labels_bundle(
    session: Dict[str, Any],
    wine_groups: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    확정된 보틀 결정을 src/types/validation.ts (approvedLabelsBundleSchema v1)와
    100% 일치하는 번들 JSON으로 생성합니다 (동일 와인 그룹당 베스트 1건만 내보냄).
    """
    group_by_key = {wg["groupKey"]: wg for wg in wine_groups}
    group_by_wine_id: Dict[str, Dict[str, Any]] = {}
    for wg in wine_groups:
        for wid in wg.get("wineIds", []):
            group_by_wine_id[wid] = wg

    best_by_key: Dict[str, Tuple[Tuple[float, float, int], Dict[str, Any]]] = {}
    for photo in session.get("photos", []):
        for bottle in photo.get("bottles", []):
            if bottle.get("decision") != "approved":
                continue
            target_wine_id = str(bottle.get("selectedWineId") or "").strip()
            target_group_key = str(bottle.get("selectedGroupKey") or "").strip()
            data_url = str(bottle.get("cutoutDataUrl") or "").strip()
            if not (data_url.startswith("data:image/") and ";base64," in data_url):
                continue

            wg = group_by_key.get(target_group_key) or group_by_wine_id.get(target_wine_id)
            if wg is None and not target_wine_id:
                continue

            apply_all_vintages = bool(bottle.get("applyAllVintages", True))
            if wg is not None:
                primary_id = target_wine_id if target_wine_id in wg["wineIds"] else wg["wineId"]
                wine_ids = list(wg["wineIds"]) if apply_all_vintages else [primary_id]
                wine_name = wg["name"]
                color = wg["color"]
                vintage = (
                    wg["vintage"]
                    if apply_all_vintages
                    else wg.get("vintageByWineId", {}).get(primary_id, wg["vintage"])
                )
                dedup_key = wg["groupKey"] if apply_all_vintages else f"id:{primary_id}"
            else:
                primary_id = target_wine_id
                wine_ids = [primary_id]
                wine_name = str(bottle.get("selectedWineName") or "")
                color = str(bottle.get("selectedColor") or "R").upper()
                vintage = str(bottle.get("selectedVintage") or "NV")
                dedup_key = f"id:{primary_id}"

            if not primary_id:
                continue

            item: Dict[str, Any] = {
                "wineId": primary_id,
                "wineIds": wine_ids,
                "wineName": wine_name,
                "vintage": vintage,
                "mimeType": "image/webp",
                "dataUrl": data_url,
            }
            if color in VALID_WINE_COLORS:
                item["color"] = color

            rank = _bottle_quality_rank(bottle)
            prev = best_by_key.get(dedup_key)
            if prev is None or rank > prev[0]:
                best_by_key[dedup_key] = (rank, item)

    items = [pair[1] for pair in best_by_key.values()]
    if not items:
        raise ValueError("승인(approved)된 보틀이 1개 이상 있어야 내보낼 수 있습니다.")

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "items": items,
    }


# ---------------------------------------------------------------------------
# Layer 6A-2: Unlabeled Wine Reverse Matching Pool & Manual Upload Support
# ---------------------------------------------------------------------------


def build_cutout_pool(session: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    현재 session["photos"] 및 예약 확장 슬롯(session["poolExtensions"])의 모든 누끼를
    역방향 매칭용 표준 풀 리스트로 수집합니다. (추후 <50점 보충 누끼 연동 구조)
    """
    pool: List[Dict[str, Any]] = []
    seen_ids: set[str] = set()

    for ph in session.get("photos", []):
        photo_id = str(ph.get("photoId") or "").strip()
        file_name = str(ph.get("fileName") or photo_id)
        has_original = bool(photo_id and ph.get("sourcePath"))
        for b in ph.get("bottles", []):
            bottle_id = str(b.get("bottleId") or "").strip()
            if not bottle_id or bottle_id in seen_ids:
                continue
            seen_ids.add(bottle_id)
            ocr = b.get("ocr") or {}
            pool.append(
                {
                    "poolId": f"session:{bottle_id}",
                    "bottleId": bottle_id,
                    "photoId": photo_id,
                    "fileName": file_name,
                    "bottleIndex": int(b.get("bottleIndex") or 1),
                    "poolSource": str(b.get("poolSource") or "session"),
                    "cutoutBytes": int(b.get("cutoutBytes") or 0),
                    "decision": str(b.get("decision") or "pending"),
                    "selectedGroupKey": str(b.get("selectedGroupKey") or "").strip(),
                    "ocrRawText": str(ocr.get("rawText") or ""),
                    "ocrAvgConfidence": float(ocr.get("avgConfidence") or 0.0),
                    "ocrEngine": str(ocr.get("engine") or "none"),
                    "parsedVintage": ocr.get("parsedVintage"),
                    "hasOriginalPhoto": has_original,
                }
            )

    for ext in session.get("poolExtensions", []):
        if not isinstance(ext, dict):
            continue
        bottle_id = str(ext.get("bottleId") or ext.get("poolId") or "").strip()
        if not bottle_id or bottle_id in seen_ids:
            continue
        seen_ids.add(bottle_id)
        ocr = ext.get("ocr") or {}
        photo_id = str(ext.get("photoId") or "").strip()
        pool.append(
            {
                "poolId": str(ext.get("poolId") or f"ext:{bottle_id}"),
                "bottleId": bottle_id,
                "photoId": photo_id,
                "fileName": str(ext.get("fileName") or bottle_id),
                "bottleIndex": int(ext.get("bottleIndex") or 1),
                "poolSource": str(ext.get("poolSource") or "backfill_low_score"),
                "cutoutBytes": int(ext.get("cutoutBytes") or 0),
                "decision": str(ext.get("decision") or "pending"),
                "selectedGroupKey": str(ext.get("selectedGroupKey") or "").strip(),
                "ocrRawText": str(ext.get("ocrRawText") or ocr.get("rawText") or ""),
                "ocrAvgConfidence": float(ext.get("ocrAvgConfidence") or ocr.get("avgConfidence") or 0.0),
                "ocrEngine": str(ext.get("ocrEngine") or ocr.get("engine") or "none"),
                "parsedVintage": ext.get("parsedVintage") or ocr.get("parsedVintage"),
                "hasOriginalPhoto": bool(ext.get("hasOriginalPhoto", bool(photo_id))),
            }
        )

    return pool


def plan_unmatched_backfill_targets(
    session: Dict[str, Any],
    prefilter_cache: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    prefilter_cache.json의 탐지 박스와 현재 session.json에 등록된 보틀 박스를 비교해,
    추후 50점 미만으로 폐기되었던 보틀만 보충 누끼 생성(--backfill-unmatched)할 대상 목록을 산출합니다.
    """
    cache = prefilter_cache if isinstance(prefilter_cache, dict) else {}
    session_by_source: Dict[str, Dict[str, Any]] = {}
    session_by_name: Dict[str, Dict[str, Any]] = {}
    for ph in session.get("photos", []):
        src = str(ph.get("sourcePath") or "").strip()
        fname = str(ph.get("fileName") or "").strip()
        if src:
            session_by_source[src] = ph
        if fname and fname not in session_by_name:
            session_by_name[fname] = ph

    total_cached_boxes = 0
    existing_session_boxes = 0
    targets_by_photo: List[Dict[str, Any]] = []

    for cache_key, rec in cache.items():
        if not isinstance(rec, dict) or rec.get("status") != "keep":
            continue
        yolo_boxes = rec.get("yoloBoxes") or []
        if not isinstance(yolo_boxes, list) or not yolo_boxes:
            continue

        resolved_path = str(cache_key).split("|", 1)[0]
        fname = str(rec.get("fileName") or Path(resolved_path).name)
        ph = session_by_source.get(resolved_path) or session_by_name.get(fname)
        existing_boxes = [
            [float(v) for v in b.get("box", [])]
            for b in (ph.get("bottles", []) if ph else [])
            if isinstance(b.get("box"), (list, tuple)) and len(b.get("box", [])) == 4
        ]

        missing_boxes: List[List[int]] = []
        for ym in yolo_boxes:
            raw_box = ym.get("box") if isinstance(ym, dict) else ym
            if not isinstance(raw_box, (list, tuple)) or len(raw_box) != 4:
                continue
            cand_box = [float(v) for v in raw_box]
            total_cached_boxes += 1
            matched_existing = any(_box_iou(cand_box, eb) >= 0.45 for eb in existing_boxes)
            if matched_existing:
                existing_session_boxes += 1
            else:
                missing_boxes.append([int(round(v)) for v in cand_box])

        if missing_boxes:
            targets_by_photo.append(
                {
                    "photoId": ph.get("photoId") if ph else None,
                    "fileName": fname,
                    "sourcePath": resolved_path,
                    "missingBoxes": missing_boxes,
                }
            )

    missing_box_count = sum(len(item["missingBoxes"]) for item in targets_by_photo)
    return {
        "totalCachedBoxes": total_cached_boxes,
        "existingSessionBoxes": existing_session_boxes,
        "missingBoxCount": missing_box_count,
        "targetsByPhoto": targets_by_photo,
    }


def _pretokenize_pool_item(item: Dict[str, Any]) -> Dict[str, Any]:
    raw = str(item.get("ocrRawText") or "")
    q_tokens = tokenize_wine_text(raw)
    q_set = set(q_tokens)
    q_distinct = {tok for tok in q_set if tok not in GENERIC_WINE_TERMS and not tok.isdigit()}
    q_prefixes = {tok[:3] for tok in q_set if len(tok) >= 3}
    return {
        "q_tokens": q_tokens,
        "q_set": q_set,
        "q_str": " ".join(q_tokens),
        "q_distinct": q_distinct,
        "q_prefixes": q_prefixes,
        "vintage": item.get("parsedVintage") or extract_vintage_from_text(raw),
        "color_hint": infer_color_hint_from_text(raw),
    }


def score_reverse_cutout_match(
    wine_group: Dict[str, Any],
    pool_item: Dict[str, Any],
    pretokenized_item: Optional[Dict[str, Any]] = None,
) -> float:
    """
    라벨 없는 와인(wine_group) 기준으로 기존 누끼 풀 항목과의 역방향 매칭 점수를 계산합니다.
    기존 score_wine_match 점수와 산지/생산자/부분 유사도 완화 점수를 결합해 50점 미만 후보도 노출합니다.
    """
    ocr_raw = str(pool_item.get("ocrRawText") or "")
    if not ocr_raw.strip():
        return 0.0

    pre = pretokenized_item or _pretokenize_pool_item(pool_item)
    q_tokens: List[str] = pre["q_tokens"]
    if not q_tokens:
        return 0.0

    base_score = score_wine_match(
        ocr_raw,
        wine_group,
        ocr_vintage=pre["vintage"],
    )

    t_set: set[str] = wine_group.get("_tokens") or set(tokenize_wine_text(wine_group.get("name", "")))
    m_set: set[str] = wine_group.get("_metaTokens") or t_set
    if not m_set:
        return base_score

    q_set: set[str] = pre["q_set"]
    q_distinct: set[str] = pre["q_distinct"]
    t_distinct = {tok for tok in t_set if tok not in GENERIC_WINE_TERMS and not tok.isdigit()}
    m_distinct = {tok for tok in m_set if tok not in GENERIC_WINE_TERMS and not tok.isdigit()}

    inter_name = q_set & t_set
    inter_meta = q_set & m_set
    recall_name = len(inter_name) / max(1, len(t_set))
    recall_meta = len(inter_meta) / max(1, len(m_set))

    # 4자 이상 고유 토큰 간 부분 철자 오인식(SequenceMatcher >= 0.72) 완화 매칭
    fuzzy_distinct_hits = 0
    best_tok_sim = 0.0
    for tt in m_distinct:
        if tt in q_distinct:
            fuzzy_distinct_hits += 1
            best_tok_sim = 1.0
            continue
        if len(tt) < 4:
            continue
        for qt in q_distinct:
            if len(qt) < 4:
                continue
            if qt in tt or tt in qt:
                sim = 0.85
            else:
                sim = SequenceMatcher(None, qt, tt).ratio()
            if sim > best_tok_sim:
                best_tok_sim = sim
            if sim >= 0.72:
                fuzzy_distinct_hits += 1
                break

    distinct_denom = max(1, len(m_distinct) if m_distinct else len(t_set))
    distinct_ratio = fuzzy_distinct_hits / distinct_denom

    relaxed = 70.0 * max(
        0.55 * recall_name + 0.25 * recall_meta + 0.20 * distinct_ratio,
        0.65 * distinct_ratio + 0.35 * best_tok_sim if fuzzy_distinct_hits > 0 else 0.0,
    )

    wine_vintages = set(wine_group.get("vintages") or [])
    if pre["vintage"] and wine_vintages and pre["vintage"] in wine_vintages:
        relaxed += 10.0
    if pre["color_hint"] and wine_group.get("color") == pre["color_hint"]:
        relaxed += 8.0

    # 토큰 교집합도 없고 고유 토큰 부분 일치도 없으면 단순 글자 배열 우연 일치이므로 0점 처리
    if not inter_meta and fuzzy_distinct_hits == 0:
        return 0.0

    # 일반 품종/등급어(Chardonnay, Pinot Noir 등)만 겹치는 경우 35점 상한
    if (t_distinct or m_distinct) and fuzzy_distinct_hits == 0 and not (q_distinct & m_distinct):
        relaxed = min(relaxed, 35.0)
        base_score = min(base_score, 35.0)

    relaxed = round(max(0.0, min(100.0, relaxed)), 2)
    return round(max(base_score, relaxed), 2)


def _compute_used_bottle_map(session: Dict[str, Any]) -> Dict[str, Dict[str, str]]:
    """탭 2/3 확정 보틀(확장 풀 포함) 및 탭 4 배정 보틀의 사용처를 bottleId 기준으로 매핑."""
    used: Dict[str, Dict[str, str]] = {}
    for ph in session.get("photos", []):
        for b in ph.get("bottles", []):
            if b.get("decision") == "approved":
                bid = str(b.get("bottleId") or "").strip()
                gkey = str(b.get("selectedGroupKey") or "").strip()
                if bid and gkey:
                    used[bid] = {"source": "tab2", "groupKey": gkey}

    for ext in session.get("poolExtensions", []):
        if isinstance(ext, dict) and ext.get("decision") == "approved":
            bid = str(ext.get("bottleId") or ext.get("poolId") or "").strip()
            gkey = str(ext.get("selectedGroupKey") or "").strip()
            if bid and gkey:
                used[bid] = {"source": str(ext.get("poolSource") or "ext"), "groupKey": gkey}

    assignments = session.get("unlabeledAssignments") or {}
    if isinstance(assignments, dict):
        for gkey, assign in assignments.items():
            if not isinstance(assign, dict):
                continue
            if assign.get("source") == "cutout":
                bid = str(assign.get("bottleId") or "").strip()
                if bid:
                    used[bid] = {"source": "tab4", "groupKey": str(gkey)}
    return used


def recommend_cutouts_for_wine(
    wine_group: Dict[str, Any],
    pool_items: List[Dict[str, Any]],
    used_bottle_map: Optional[Dict[str, Dict[str, str]]] = None,
    top_k: int = 6,
    min_score: float = 10.0,
    include_used: bool = False,
    pretokenized_map: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """단일 라벨 없는 와인에 대해 기존 누끼 풀에서 역방향 Top-K 추천을 반환합니다."""
    if not pool_items:
        return []
    used_map = used_bottle_map or {}
    gkey = str(wine_group.get("groupKey") or "")

    wg_m_tokens: set[str] = wine_group.get("_metaTokens") or set(
        tokenize_wine_text(wine_group.get("name", ""))
    )
    wg_prefixes = {tok[:3] for tok in wg_m_tokens if len(tok) >= 3}
    wg_vintages = set(wine_group.get("vintages") or [])

    scored: List[Tuple[float, int, Dict[str, Any], bool, str]] = []
    for item in pool_items:
        bid = item["bottleId"]
        usage = used_map.get(bid)
        used_by_other = bool(usage and usage.get("groupKey") != gkey)
        if used_by_other and not include_used:
            continue

        pre = pretokenized_map.get(bid) if pretokenized_map else None
        if pre is None:
            pre = _pretokenize_pool_item(item)

        # 빠른 사전 가지치기: 토큰 교집합 / 3글자 prefix 교집합 / 빈티지 일치 중 하나도 없으면 스킵
        if (
            not (wg_m_tokens & pre["q_set"])
            and not (wg_prefixes & pre["q_prefixes"])
            and not (pre["vintage"] and pre["vintage"] in wg_vintages)
        ):
            continue

        sc = score_reverse_cutout_match(wine_group, item, pretokenized_item=pre)
        if sc >= min_score:
            scored.append(
                (
                    sc,
                    int(item.get("cutoutBytes") or 0),
                    item,
                    used_by_other,
                    str(usage.get("groupKey") or "") if usage else "",
                )
            )

    scored.sort(key=lambda x: (-x[0], x[3], -x[1], x[2]["fileName"]))
    out: List[Dict[str, Any]] = []
    for sc, _, item, used_by_other, used_gkey in scored[:top_k]:
        out.append(
            {
                "bottleId": item["bottleId"],
                "photoId": item["photoId"],
                "fileName": item["fileName"],
                "bottleIndex": item["bottleIndex"],
                "score": sc,
                "cutoutBytes": item["cutoutBytes"],
                "ocrRawText": item["ocrRawText"],
                "parsedVintage": item["parsedVintage"],
                "isUsedByOther": used_by_other,
                "usedByGroupKey": used_gkey,
                "hasOriginalPhoto": bool(item.get("hasOriginalPhoto", True)),
            }
        )
    return out


def build_unlabeled_matching_plan(
    session: Dict[str, Any],
    wine_groups: List[Dict[str, Any]],
    prefilter_cache: Optional[Dict[str, Any]] = None,
    top_k: int = 6,
) -> Dict[str, Any]:
    """라벨 없는 와인 목록 + 기존 누끼 풀 + 와인별 역방향 추천 Top-K + 추후 보충 메타 생성."""
    pool_items = build_cutout_pool(session)
    pretokenized_map = {item["bottleId"]: _pretokenize_pool_item(item) for item in pool_items}
    used_map = _compute_used_bottle_map(session)
    backfill_plan = plan_unmatched_backfill_targets(session, prefilter_cache)

    assignments = dict(session.get("unlabeledAssignments") or {})
    unlabeled_groups = [wg for wg in wine_groups if not bool(wg.get("hasExistingLabel", False))]

    wines_payload: List[Dict[str, Any]] = []
    for wg in unlabeled_groups:
        gkey = wg["groupKey"]
        recs_unused = recommend_cutouts_for_wine(
            wg,
            pool_items,
            used_bottle_map=used_map,
            top_k=top_k,
            min_score=10.0,
            include_used=False,
            pretokenized_map=pretokenized_map,
        )
        recs_all = recommend_cutouts_for_wine(
            wg,
            pool_items,
            used_bottle_map=used_map,
            top_k=top_k,
            min_score=10.0,
            include_used=True,
            pretokenized_map=pretokenized_map,
        )
        raw_assign = assignments.get(gkey)
        assign_public: Optional[Dict[str, Any]] = None
        if isinstance(raw_assign, dict):
            assign_public = {
                "source": raw_assign.get("source"),
                "bottleId": raw_assign.get("bottleId"),
                "photoId": raw_assign.get("photoId"),
                "fileName": raw_assign.get("fileName"),
                "applyAllVintages": bool(raw_assign.get("applyAllVintages", True)),
                "updatedAt": raw_assign.get("updatedAt"),
            }

        wines_payload.append(
            {
                "groupKey": gkey,
                "wineId": wg["wineId"],
                "wineIds": list(wg["wineIds"]),
                "name": wg["name"],
                "producer": wg.get("producer", ""),
                "country": wg.get("country", ""),
                "region": wg.get("region", ""),
                "subRegion": wg.get("subRegion", ""),
                "color": wg["color"],
                "vintage": wg["vintage"],
                "inStockCount": wg["inStockCount"],
                "assignment": assign_public,
                "recommendationsUnused": recs_unused,
                "recommendationsAll": recs_all,
            }
        )

    pool_public: List[Dict[str, Any]] = []
    for item in pool_items:
        bid = item["bottleId"]
        usage = used_map.get(bid)
        pool_public.append(
            {
                "bottleId": bid,
                "photoId": item["photoId"],
                "fileName": item["fileName"],
                "bottleIndex": item["bottleIndex"],
                "poolSource": item["poolSource"],
                "cutoutBytes": item["cutoutBytes"],
                "decision": item["decision"],
                "selectedGroupKey": item["selectedGroupKey"],
                "ocrRawText": item["ocrRawText"],
                "parsedVintage": item["parsedVintage"],
                "usedByGroupKey": usage.get("groupKey") if usage else "",
                "usedBySource": usage.get("source") if usage else "",
                "hasOriginalPhoto": bool(item.get("hasOriginalPhoto", True)),
            }
        )

    unused_count = sum(1 for p in pool_public if not p["usedByGroupKey"])
    return {
        "wines": wines_payload,
        "pool": pool_public,
        "poolMeta": {
            "totalCutouts": len(pool_public),
            "unusedCutouts": unused_count,
            "backfillCandidateBoxes": backfill_plan["missingBoxCount"],
            "backfillImplemented": False,
        },
    }


def encode_manual_label_webp(
    image_bytes: bytes,
    max_dim: int = 500,
    max_bytes: int = 180 * 1024,
) -> Tuple[bytes, str]:
    """업로드/붙여넣기 이미지를 최대 500px WebP(투명 알파 보존) + data URL로 압축합니다."""
    if not image_bytes or len(image_bytes) > 20 * 1024 * 1024:
        raise ValueError("유효하지 않거나 20MB를 초과한 이미지입니다.")
    try:
        with Image.open(io.BytesIO(image_bytes)) as im:
            im.load()
            oriented = ImageOps.exif_transpose(im)
            has_alpha = "A" in oriented.getbands()
            work = oriented.convert("RGBA" if has_alpha else "RGB")
            work.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
    except Exception as exc:
        raise ValueError(f"이미지 디코드 실패: {exc}") from exc

    raw_bytes = b""
    for q in (86, 78, 70, 60):
        buf = io.BytesIO()
        work.save(buf, format="WEBP", lossless=False, quality=q, method=6)
        raw_bytes = buf.getvalue()
        if len(raw_bytes) <= max_bytes:
            break
    b64 = base64.b64encode(raw_bytes).decode("ascii")
    return raw_bytes, f"data:image/webp;base64,{b64}"


def build_unlabeled_approved_labels_bundle(
    session: Dict[str, Any],
    wine_groups: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    탭 4(라벨 없는 와인 매칭)에서 배정된 항목만 추려 approvedLabelsBundleSchema v1 JSON을 생성합니다.
    (1차에 이미 적용한 탭 2/3 확정분 중복 제외)
    """
    assignments = session.get("unlabeledAssignments") or {}
    if not isinstance(assignments, dict) or not assignments:
        raise ValueError("탭 4에서 라벨 없는 와인에 배정된 항목이 1개 이상 있어야 내보낼 수 있습니다.")

    group_by_key = {wg["groupKey"]: wg for wg in wine_groups}
    bottle_by_id: Dict[str, Dict[str, Any]] = {}
    for ph in session.get("photos", []):
        for b in ph.get("bottles", []):
            bottle_by_id[str(b.get("bottleId") or "")] = b

    items: List[Dict[str, Any]] = []
    for gkey, assign in assignments.items():
        if not isinstance(assign, dict):
            continue
        wg = group_by_key.get(gkey)
        if wg is None or bool(wg.get("hasExistingLabel", False)):
            continue

        data_url = str(assign.get("dataUrl") or "").strip()
        if assign.get("source") == "cutout":
            bid = str(assign.get("bottleId") or "").strip()
            b = bottle_by_id.get(bid)
            if b and str(b.get("cutoutDataUrl") or "").startswith("data:image/"):
                data_url = str(b["cutoutDataUrl"])

        if not (data_url.startswith("data:image/") and ";base64," in data_url):
            continue

        apply_all_vintages = bool(assign.get("applyAllVintages", True))
        primary_id = wg["wineId"]
        wine_ids = list(wg["wineIds"]) if apply_all_vintages else [primary_id]
        vintage = (
            wg["vintage"]
            if apply_all_vintages
            else wg.get("vintageByWineId", {}).get(primary_id, wg["vintage"])
        )

        item: Dict[str, Any] = {
            "wineId": primary_id,
            "wineIds": wine_ids,
            "wineName": wg["name"],
            "vintage": vintage,
            "mimeType": "image/webp",
            "dataUrl": data_url,
        }
        if wg.get("color") in VALID_WINE_COLORS:
            item["color"] = wg["color"]
        items.append(item)

    if not items:
        raise ValueError("내보낼 수 있는 유효한 라벨 배정 항목이 없습니다.")

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "items": items,
    }


def _collect_photo_paths(photos_dir: Path) -> List[Path]:
    if not photos_dir.exists():
        raise FileNotFoundError(f"사진 폴더를 찾을 수 없습니다: {photos_dir}")
    if photos_dir.is_file():
        return [photos_dir] if photos_dir.suffix.lower() in SUPPORTED_IMAGE_EXTS else []
    files = [
        p
        for p in sorted(photos_dir.rglob("*"))
        if p.is_file() and p.suffix.lower() in SUPPORTED_IMAGE_EXTS and not p.name.startswith("._")
    ]
    return files


def compute_sharpness_score(img: Image.Image) -> float:
    """그레이스케일 640px 썸네일 라플라시안 분산 기반 선명도 점수 (낮을수록 흐림/단색)."""
    gray = img.convert("L")
    gray.thumbnail((640, 640), Image.Resampling.BILINEAR)
    arr = np.asarray(gray, dtype=np.float32)
    if arr.size < 4:
        return 0.0
    lap = ndimage.laplace(arr)
    return round(float(np.var(lap)), 2)


def compute_dhash(img: Image.Image, hash_size: int = 8) -> int:
    """연사/유사 구도 사진 중복 제거용 64-bit Difference Hash (dHash) 계산."""
    small = img.convert("L").resize((hash_size + 1, hash_size), Image.Resampling.BILINEAR)
    arr = np.asarray(small, dtype=np.int16)
    diff = arr[:, 1:] > arr[:, :-1]
    value = 0
    for bit_idx, flag in enumerate(diff.ravel()):
        if flag:
            value |= 1 << bit_idx
    return int(value)


def hamming_distance(h1: int, h2: int) -> int:
    """두 64-bit 해시 간 해밍 거리."""
    return int((int(h1) ^ int(h2)).bit_count())


class CutoutPipeline:
    """다병 분할 + 누끼 + OCR + 매칭 + 세션 저장 파이프라인."""

    def __init__(
        self,
        photos_path: Path,
        db_path: Path,
        work_dir: Path,
        detector: Optional[BottleDetector] = None,
        segmenter: Optional[RembgSegmenter] = None,
        local_ocr: Optional[LocalOcrDispatcher] = None,
        gemini_ocr: Optional[GeminiOcrFallback] = None,
        ocr_mode: str = "local",
        prefilter: bool = False,
        min_sharpness: float = 25.0,
        dedup_distance: int = 6,
        min_bottles: int = 1,
        skip_existing_labels: bool = False,
        auto_match_only: bool = False,
        batch_size: Optional[int] = None,
        batch_index: int = 1,
        unlabeled_first: bool = False,
    ) -> None:
        self.photos_path = photos_path
        self.db_path = db_path
        self.work_dir = work_dir
        self.crops_dir = work_dir / "crops"
        self.cutouts_dir = work_dir / "cutouts"
        self.manual_labels_dir = work_dir / "manual_labels"
        self.session_path = work_dir / "session.json"
        self.prefilter_cache_path = work_dir / "prefilter_cache.json"

        self.detector = detector or BottleDetector()
        self.segmenter = segmenter or RembgSegmenter()
        self.local_ocr = local_ocr or LocalOcrDispatcher()
        self.gemini_ocr = gemini_ocr
        self.ocr_mode = ocr_mode
        self.prefilter = bool(prefilter)
        self.min_sharpness = float(min_sharpness)
        self.dedup_distance = int(dedup_distance)
        self.min_bottles = int(min_bottles)
        self.skip_existing_labels = bool(skip_existing_labels)
        self.auto_match_only = bool(auto_match_only)
        self.batch_size = int(batch_size) if batch_size is not None else None
        self.batch_index = max(1, int(batch_index))
        self.unlabeled_first = bool(unlabeled_first)
        self._lock = threading.RLock()

        db_raw = json.loads(db_path.read_text(encoding="utf-8"))
        self.wine_groups = build_wine_groups(db_raw)
        self.session: Dict[str, Any] = {
            "schemaVersion": 1,
            "photosDir": str(photos_path),
            "dbPath": str(db_path),
            "ocrMode": ocr_mode,
            "prefilterSummary": None,
            "batchInfo": None,
            "skippedPhotos": [],
            "photos": [],
            "unlabeledAssignments": {},
            "poolExtensions": [],
        }
        self._photo_map: Dict[str, Dict[str, Any]] = {}
        self._bottle_map: Dict[str, Dict[str, Any]] = {}

    def _rebuild_indexes(self) -> None:
        self._photo_map = {}
        self._bottle_map = {}
        for ph in self.session.get("photos", []):
            self._photo_map[ph["photoId"]] = ph
            for b in ph.get("bottles", []):
                self._bottle_map[b["bottleId"]] = b

    def save_session(self) -> Path:
        with self._lock:
            self.work_dir.mkdir(parents=True, exist_ok=True)
            tmp = self.session_path.with_suffix(".json.part")
            tmp.write_text(json.dumps(self.session, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(tmp, self.session_path)
            return self.session_path

    def load_session(self, resume_file: Path) -> None:
        with self._lock:
            loaded = json.loads(resume_file.read_text(encoding="utf-8"))
            loaded.setdefault("unlabeledAssignments", {})
            loaded.setdefault("poolExtensions", [])
            self.session = loaded
            self._rebuild_indexes()
            group_by_key = {wg["groupKey"]: wg for wg in self.wine_groups}
            for ph in self.session.get("photos", []):
                for b in ph.get("bottles", []):
                    for c in b.get("candidates", []):
                        wg = group_by_key.get(str(c.get("groupKey") or ""))
                        if wg is not None:
                            c["hasExistingLabel"] = bool(wg.get("hasExistingLabel", False))
                    sel_wg = group_by_key.get(str(b.get("selectedGroupKey") or ""))
                    if sel_wg is not None:
                        b["alreadyHasLabel"] = bool(sel_wg.get("hasExistingLabel", False))

    def _detect_initial_boxes(
        self,
        img: Image.Image,
        mode: str = "auto",
    ) -> Tuple[List[Dict[str, Any]], str]:
        w, h = img.size
        if is_precut_transparent(img):
            alpha = np.asarray(img.convert("RGBA"))[:, :, 3]
            ys, xs = np.where(alpha > 10)
            if ys.size > 0:
                box = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
            else:
                box = [0, 0, w, h]
            return [{"box": box, "confidence": 1.0, "source": "precut"}], "precut"

        if mode in ("auto", "yolo"):
            yolo_boxes = self.detector.detect(img)
            if yolo_boxes:
                return yolo_boxes, "yolo"

        if mode in ("auto", "valley", "yolo"):
            full_rgba = self.segmenter.remove_background(img)
            full_alpha = np.asarray(full_rgba)[:, :, 3]
            valley_boxes = split_bottles_by_neck_valley(full_alpha)
            if valley_boxes:
                return (
                    [{"box": b, "confidence": 0.75, "source": "valley"} for b in valley_boxes],
                    "valley",
                )
            # 마지막 안전망: 전경 전체 1박스
            ys, xs = np.where(full_alpha > 128)
            if ys.size > 0:
                return (
                    [
                        {
                            "box": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
                            "confidence": 0.5,
                            "source": "fallback_full",
                        }
                    ],
                    "fallback_full",
                )
        return [{"box": [0, 0, w, h], "confidence": 0.4, "source": "full_frame"}], "full_frame"

    def _process_photo_boxes(
        self,
        photo_record: Dict[str, Any],
        img: Image.Image,
        boxes_meta: List[Dict[str, Any]],
        split_source: str,
    ) -> None:
        self.crops_dir.mkdir(parents=True, exist_ok=True)
        self.cutouts_dir.mkdir(parents=True, exist_ok=True)

        w, h = img.size
        precut = is_precut_transparent(img) and split_source == "precut"
        ordered = sorted(boxes_meta, key=lambda b: (b["box"][0] + b["box"][2]) * 0.5)
        photo_id = photo_record["photoId"]

        focus_paths: List[Path] = []
        bottle_entries: List[Dict[str, Any]] = []
        crop_paths: List[Path] = []

        for idx, bmeta in enumerate(ordered[:MAX_BOTTLES_PER_PHOTO]):
            x1, y1, x2, y2 = [int(v) for v in bmeta["box"]]
            x1 = max(0, min(w - 1, x1))
            y1 = max(0, min(h - 1, y1))
            x2 = max(x1 + 2, min(w, x2))
            y2 = max(y1 + 2, min(h, y2))

            bottle_id = f"{photo_id}_b{idx + 1}"
            if precut:
                crop_box = [x1, y1, x2, y2]
                orig_crop = img.convert("RGBA").crop(tuple(crop_box))
                refined = orig_crop
            else:
                crop_box, inner_rel = compute_padded_crop_box([x1, y1, x2, y2], w, h)
                orig_crop = img.convert("RGB").crop(tuple(crop_box))
                seg_rgba = self.segmenter.remove_background(orig_crop)
                refined = suppress_neighbor_artifacts(seg_rgba, inner_rel)
                if split_source != "manual" and not is_valid_bottle_cutout(refined):
                    continue

            normalized = normalize_bottle_canvas(refined)
            webp_bytes, data_url = encode_cutout_webp(normalized)

            crop_file = self.crops_dir / f"{bottle_id}.png"
            focus_file = self.crops_dir / f"{bottle_id}_focus.png"
            cutout_file = self.cutouts_dir / f"{bottle_id}.webp"

            orig_crop.convert("RGB").save(crop_file, format="PNG")
            extract_label_focus_crop(orig_crop.convert("RGB")).save(focus_file, format="PNG")
            cutout_file.write_bytes(webp_bytes)

            focus_paths.append(focus_file)
            crop_paths.append(crop_file)
            bottle_entries.append(
                {
                    "bottleId": bottle_id,
                    "photoId": photo_id,
                    "bottleIndex": idx + 1,
                    "box": [x1, y1, x2, y2],
                    "cropBox": crop_box,
                    "cropPath": str(crop_file),
                    "focusPath": str(focus_file),
                    "cutoutPath": str(cutout_file),
                    "cutoutDataUrl": data_url,
                    "cutoutBytes": len(webp_bytes),
                    "precutSkippedRembg": precut,
                    "ocr": {
                        "rawText": "",
                        "avgConfidence": 0.0,
                        "engine": "pending",
                        "parsedVintage": None,
                    },
                    "candidates": [],
                    "selectedWineId": None,
                    "selectedGroupKey": None,
                    "alreadyHasLabel": False,
                    "applyAllVintages": True,
                    "decision": "pending",
                }
            )

        # 배치 로컬 OCR 수행 (라벨 집중 영역 우선, 0줄이면 전체 크롭 폴백)
        ocr_map = self.local_ocr.recognize_batch(focus_paths) if self.ocr_mode != "gemini" else {}
        retry_full_indices: List[int] = []
        for idx, bentry in enumerate(bottle_entries):
            if self.ocr_mode == "gemini":
                continue
            res = ocr_map.get(str(focus_paths[idx]))
            if res is None or not res.lines:
                retry_full_indices.append(idx)

        if retry_full_indices:
            retry_map = self.local_ocr.recognize_batch([crop_paths[i] for i in retry_full_indices])
            for idx in retry_full_indices:
                res_full = retry_map.get(str(crop_paths[idx]))
                if res_full and res_full.lines:
                    ocr_map[str(focus_paths[idx])] = res_full

        kept_entries: List[Dict[str, Any]] = []
        for idx, bentry in enumerate(bottle_entries):
            ocr_res = ocr_map.get(str(focus_paths[idx])) or OcrResult(engine="none")
            candidates = match_wine_candidates(ocr_res, self.wine_groups, top_k=3)
            top1_score = candidates[0]["score"] if candidates else 0.0

            if (
                self.gemini_ocr is not None
                and self.gemini_ocr.is_available()
                and should_trigger_gemini_fallback(ocr_res, top1_score, self.ocr_mode)
            ):
                try:
                    gem_res = self.gemini_ocr.recognize_image(crop_paths[idx])
                    if gem_res and gem_res.raw_text:
                        ocr_res = gem_res
                        candidates = match_wine_candidates(ocr_res, self.wine_groups, top_k=3)
                        top1_score = candidates[0]["score"] if candidates else 0.0
                except Exception as exc:
                    print(f"[경고] Gemini OCR 폴백 오류 ({bentry['bottleId']}): {exc}", flush=True)

            # 비수동 모드: OCR 0줄 불량 컷 자동 폐기 / --auto-match-only 시 미매칭(50점 미만) 컷 자동 폐기
            drop_unreadable = (
                split_source != "manual"
                and not precut
                and ocr_res.engine not in ("none", "unavailable")
                and not ocr_res.raw_text.strip()
            )
            drop_unmatched = (
                split_source != "manual"
                and self.auto_match_only
                and top1_score < 50.0
            )
            if drop_unreadable or drop_unmatched:
                for pkey in ("cropPath", "focusPath", "cutoutPath"):
                    p_str = bentry.get(pkey)
                    if p_str:
                        Path(p_str).unlink(missing_ok=True)
                continue

            bentry["ocr"] = {
                "rawText": ocr_res.raw_text,
                "avgConfidence": ocr_res.avg_confidence,
                "engine": ocr_res.engine,
                "parsedVintage": ocr_res.parsed_vintage,
            }
            bentry["candidates"] = candidates
            bentry["alreadyHasLabel"] = bool(candidates and candidates[0].get("hasExistingLabel", False))
            if candidates:
                bentry["selectedWineId"] = candidates[0]["wineId"]
                bentry["selectedGroupKey"] = candidates[0]["groupKey"]
                if candidates[0]["score"] >= 75.0:
                    if self.skip_existing_labels and bentry["alreadyHasLabel"]:
                        bentry["decision"] = "excluded"
                    else:
                        bentry["decision"] = "approved"
            kept_entries.append(bentry)

        for new_idx, bentry in enumerate(kept_entries, start=1):
            bentry["bottleIndex"] = new_idx

        photo_record["splitSource"] = split_source
        photo_record["boxes"] = [b["box"] for b in kept_entries]
        photo_record["bottles"] = kept_entries

    def _load_prefilter_cache(self) -> Dict[str, Any]:
        if not self.prefilter_cache_path.exists():
            return {}
        try:
            loaded = json.loads(self.prefilter_cache_path.read_text(encoding="utf-8"))
            return loaded if isinstance(loaded, dict) else {}
        except Exception:
            return {}

    def _save_prefilter_cache(self, cache: Dict[str, Any]) -> None:
        self.work_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.prefilter_cache_path.with_suffix(".json.part")
        tmp.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.prefilter_cache_path)

    def run_prefilter(self) -> Tuple[List[Dict[str, Any]], Dict[str, Any], List[Dict[str, Any]]]:
        """
        YOLO 탐지(rembg 미실행)·라플라시안 선명도·dHash 연사 중복 제거로
        와인병 후보 사진만 빠르게 선별하고 다병 사진 우선으로 정렬합니다.
        """
        photo_files = _collect_photo_paths(self.photos_path)
        cache = self._load_prefilter_cache()
        total = len(photo_files)
        raw_entries: List[Dict[str, Any]] = []

        for idx, p in enumerate(photo_files, start=1):
            resolved = str(p.resolve())
            st = p.stat()
            cache_key = f"{resolved}|{st.st_mtime_ns}|{st.st_size}"
            cached = cache.get(cache_key)
            if isinstance(cached, dict):
                entry = dict(cached)
                entry["path"] = p
                entry["resolved"] = resolved
                raw_entries.append(entry)
                continue

            if idx == 1 or idx % 25 == 0 or idx == total:
                print(f"[사전 스캔] ({idx}/{total}) {p.name}", flush=True)

            try:
                img = load_image_normalized(p)
                precut = is_precut_transparent(img)
                sharpness = compute_sharpness_score(img)
                dhash = compute_dhash(img)
                yolo_boxes: Optional[List[Dict[str, Any]]] = None
                bottle_count = 1 if precut else 0
                status = "keep"
                reason: Optional[str] = None

                if not precut:
                    if self.min_sharpness > 0.0 and sharpness < self.min_sharpness:
                        status = "skip"
                        reason = "too_blurry"
                    elif self.detector.enabled:
                        yolo_boxes = self.detector.detect(img)
                        bottle_count = len(yolo_boxes)
                        if bottle_count < self.min_bottles:
                            status = "skip"
                            reason = "no_bottle_detected"
            except Exception:
                status = "skip"
                reason = "unreadable"
                precut = False
                sharpness = 0.0
                dhash = 0
                yolo_boxes = None
                bottle_count = 0

            cache_record = {
                "fileName": p.name,
                "status": status,
                "reason": reason,
                "precut": precut,
                "sharpness": sharpness,
                "dhash": dhash,
                "bottleCount": bottle_count,
                "yoloBoxes": yolo_boxes,
            }
            cache[cache_key] = cache_record
            entry = dict(cache_record)
            entry["path"] = p
            entry["resolved"] = resolved
            raw_entries.append(entry)

        self._save_prefilter_cache(cache)

        # 연사/중복 컷 제거 (더 선명한 사진 1장만 유지)
        skipped_items: List[Dict[str, Any]] = []
        survivors: List[Dict[str, Any]] = []
        for entry in raw_entries:
            if entry["status"] != "keep":
                skipped_items.append(
                    {
                        "fileName": entry["fileName"],
                        "sourcePath": entry["resolved"],
                        "reason": entry["reason"] or "filtered",
                        "sharpness": entry["sharpness"],
                        "bottleCount": entry["bottleCount"],
                    }
                )
            else:
                survivors.append(entry)

        kept_final: List[Dict[str, Any]] = []
        if self.dedup_distance >= 0:
            clusters: List[Dict[str, Any]] = []  # each: {"entry": dict, "dhash": int, "sharpness": float}
            for entry in survivors:
                matched_cluster = None
                for cl in clusters:
                    if hamming_distance(entry["dhash"], cl["dhash"]) <= self.dedup_distance:
                        matched_cluster = cl
                        break
                if matched_cluster is None:
                    clusters.append({"entry": entry, "dhash": entry["dhash"], "sharpness": entry["sharpness"]})
                else:
                    # 더 선명하거나 더 많은 병이 잡힌 사진으로 대표 교체
                    cur_best = matched_cluster["entry"]
                    if (entry["bottleCount"], entry["sharpness"]) > (cur_best["bottleCount"], cur_best["sharpness"]):
                        skipped_items.append(
                            {
                                "fileName": cur_best["fileName"],
                                "sourcePath": cur_best["resolved"],
                                "reason": "duplicate_burst",
                                "sharpness": cur_best["sharpness"],
                                "bottleCount": cur_best["bottleCount"],
                            }
                        )
                        matched_cluster["entry"] = entry
                        matched_cluster["dhash"] = entry["dhash"]
                        matched_cluster["sharpness"] = entry["sharpness"]
                    else:
                        skipped_items.append(
                            {
                                "fileName": entry["fileName"],
                                "sourcePath": entry["resolved"],
                                "reason": "duplicate_burst",
                                "sharpness": entry["sharpness"],
                                "bottleCount": entry["bottleCount"],
                            }
                        )
            kept_final = [cl["entry"] for cl in clusters]
        else:
            kept_final = list(survivors)

        # 시음 모임 라인업(2~8병) 1순위 -> 단독샷(1병) 2순위 -> 샵/진열벽 다량컷(9병+) 3순위 정렬
        def _prefilter_sort_key(e: Dict[str, Any]) -> Tuple[int, int, float, str]:
            cnt = int(e["bottleCount"])
            if 2 <= cnt <= 8:
                tier = 0
            elif cnt == 1:
                tier = 1
            else:
                tier = 2
            return (tier, -cnt, -float(e["sharpness"]), str(e["fileName"]))

        kept_final.sort(key=_prefilter_sort_key)

        reason_counts: Dict[str, int] = {
            "no_bottle_detected": 0,
            "too_blurry": 0,
            "duplicate_burst": 0,
        }
        for item in skipped_items:
            r = str(item.get("reason") or "filtered")
            reason_counts[r] = reason_counts.get(r, 0) + 1

        summary = {
            "totalScanned": total,
            "kept": len(kept_final),
            "skippedTotal": len(skipped_items),
            "skippedByReason": reason_counts,
        }
        return kept_final, summary, skipped_items

    def run_all(self) -> Dict[str, Any]:
        prefilter_summary: Optional[Dict[str, Any]] = None
        skipped_photos: List[Dict[str, Any]] = []

        if self.prefilter:
            selected_items, prefilter_summary, skipped_photos = self.run_prefilter()
            print(
                f"[사전 선별 완료] 전체 {prefilter_summary['totalScanned']}장 중 "
                f"통과 {prefilter_summary['kept']}장 / 제외 {prefilter_summary['skippedTotal']}장 "
                f"(병 미탐지 {prefilter_summary['skippedByReason'].get('no_bottle_detected', 0)}, "
                f"흐림 {prefilter_summary['skippedByReason'].get('too_blurry', 0)}, "
                f"연사 중복 {prefilter_summary['skippedByReason'].get('duplicate_burst', 0)})",
                flush=True,
            )
        else:
            photo_files = _collect_photo_paths(self.photos_path)
            selected_items = [
                {"path": p, "resolved": str(p.resolve()), "yoloBoxes": None}
                for p in photo_files
            ]

        total_candidates = len(selected_items)
        batch_info: Optional[Dict[str, Any]] = None
        if self.batch_size is not None and self.batch_size > 0:
            total_batches = max(1, (total_candidates + self.batch_size - 1) // self.batch_size)
            start = (self.batch_index - 1) * self.batch_size
            end = start + self.batch_size
            selected_items = selected_items[start:end]
            batch_info = {
                "batchIndex": self.batch_index,
                "batchSize": self.batch_size,
                "totalBatches": total_batches,
                "totalCandidates": total_candidates,
                "sliceStart": start + 1 if selected_items else 0,
                "sliceEnd": min(end, total_candidates) if selected_items else 0,
            }
            print(
                f"[배치] {batch_info['batchIndex']}/{total_batches} "
                f"({batch_info['sliceStart']}~{batch_info['sliceEnd']}번 / 전체 후보 {total_candidates}장)",
                flush=True,
            )

        existing_by_path = {ph.get("sourcePath"): ph for ph in self.session.get("photos", [])}

        new_photos: List[Dict[str, Any]] = []
        used_ids: set[str] = set()
        newly_processed = 0

        def _flush_checkpoint(photos_snapshot: List[Dict[str, Any]]) -> None:
            with self._lock:
                self.session["photos"] = photos_snapshot
                self.session["prefilterSummary"] = prefilter_summary
                self.session["batchInfo"] = batch_info
                self.session["skippedPhotos"] = skipped_photos
                self._rebuild_indexes()
            self.save_session()

        try:
            for idx, item in enumerate(selected_items):
                p: Path = item["path"]
                resolved = item["resolved"]
                if resolved in existing_by_path:
                    existing_rec = existing_by_path[resolved]
                    used_ids.add(str(existing_rec.get("photoId")))
                    new_photos.append(existing_rec)
                    continue

                seq = idx + 1
                photo_id = f"p{seq:03d}"
                while photo_id in used_ids:
                    seq += 1
                    photo_id = f"p{seq:03d}"
                used_ids.add(photo_id)

                print(f"[처리] ({len(new_photos) + 1}/{len(selected_items)}) {p.name}", flush=True)
                img = load_image_normalized(p)
                precomputed_yolo = item.get("yoloBoxes")
                if isinstance(precomputed_yolo, list) and len(precomputed_yolo) > 0:
                    boxes_meta, split_source = precomputed_yolo, "yolo"
                else:
                    boxes_meta, split_source = self._detect_initial_boxes(img, mode="auto")
                record: Dict[str, Any] = {
                    "photoId": photo_id,
                    "fileName": p.name,
                    "sourcePath": resolved,
                    "width": img.size[0],
                    "height": img.size[1],
                    "splitSource": split_source,
                    "boxes": [],
                    "bottles": [],
                }
                self._process_photo_boxes(record, img, boxes_meta, split_source)
                new_photos.append(record)
                newly_processed += 1

                if newly_processed % 10 == 0:
                    _flush_checkpoint(new_photos)
                    if self.auto_match_only:
                        matched_cnt = sum(len(ph.get("bottles", [])) for ph in new_photos)
                        print(f"  [체크포인트 저장] {len(new_photos)}/{len(selected_items)}장 완료 · 매칭 보존 {matched_cnt}병", flush=True)
        except KeyboardInterrupt:
            _flush_checkpoint(new_photos)
            print(f"\n[중단 저장] 현재까지 처리된 {len(new_photos)}장 세션을 저장했습니다: {self.session_path}", flush=True)
            raise

        _flush_checkpoint(new_photos)
        demoted = deduplicate_best_approved_per_wine(self.session)
        if demoted > 0:
            print(f"[중복 와인 정리] 동일 와인 중복 승인 {demoted}건을 베스트 1장 기준으로 제외 처리했습니다.", flush=True)
        with self._lock:
            self._rebuild_indexes()
        self.save_session()
        return self.session

    def save_photo_boxes(
        self,
        photo_id: str,
        boxes: List[Sequence[int]],
    ) -> Dict[str, Any]:
        """탭 1에서 수정한 박스 좌표를 재누끼 전이라도 즉시 session.json에 저장합니다."""
        with self._lock:
            photo = self._photo_map.get(photo_id)
            if photo is None:
                raise KeyError(f"사진 ID를 찾을 수 없습니다: {photo_id}")
            w = max(2, int(photo.get("width") or 4000))
            h = max(2, int(photo.get("height") or 4000))
            cleaned: List[List[int]] = []
            for raw_box in boxes[:MAX_BOTTLES_PER_PHOTO]:
                if len(raw_box) != 4:
                    continue
                x1, y1, x2, y2 = [int(round(float(v))) for v in raw_box]
                x1 = max(0, min(w - 2, min(x1, x2)))
                y1 = max(0, min(h - 2, min(y1, y2)))
                x2 = max(x1 + 2, min(w, max(x1, x2)))
                y2 = max(y1 + 2, min(h, max(y1, y2)))
                cleaned.append([x1, y1, x2, y2])
            cleaned.sort(key=lambda b: (b[0] + b[2]) * 0.5)
            photo["boxes"] = cleaned
            photo["splitSource"] = "manual"
        self.save_session()
        return photo

    def recut_photo(
        self,
        photo_id: str,
        mode: str = "boxes",
        boxes: Optional[List[Sequence[int]]] = None,
    ) -> Dict[str, Any]:
        with self._lock:
            photo = self._photo_map.get(photo_id)
            if photo is None:
                raise KeyError(f"사진 ID를 찾을 수 없습니다: {photo_id}")
            img = load_image_normalized(Path(photo["sourcePath"]))
            if mode == "valley":
                boxes_meta, split_source = self._detect_initial_boxes(img, mode="valley")
                self._process_photo_boxes(photo, img, boxes_meta, split_source)
            elif mode == "yolo":
                boxes_meta, split_source = self._detect_initial_boxes(img, mode="yolo")
                self._process_photo_boxes(photo, img, boxes_meta, split_source)
            else:
                if boxes is None:
                    raise ValueError("boxes 모드에는 boxes 배열이 필요합니다.")
                if len(boxes) == 0:
                    photo["boxes"] = []
                    photo["bottles"] = []
                    photo["splitSource"] = "manual"
                else:
                    boxes_meta = [
                        {"box": [int(v) for v in b], "confidence": 1.0, "source": "manual"}
                        for b in boxes
                    ]
                    split_source = "manual"
                    self._process_photo_boxes(photo, img, boxes_meta, split_source)
            self._rebuild_indexes()
            for assign in (self.session.get("unlabeledAssignments") or {}).values():
                if isinstance(assign, dict) and assign.get("source") == "cutout":
                    bid = str(assign.get("bottleId") or "").strip()
                    ref_b = self._bottle_map.get(bid)
                    if ref_b is not None:
                        assign["dataUrl"] = ref_b.get("cutoutDataUrl")
                        assign["cutoutPath"] = ref_b.get("cutoutPath")
        self.save_session()
        return photo

    def update_decision(
        self,
        bottle_id: str,
        decision: Optional[str] = None,
        selected_wine_id: Optional[str] = None,
        selected_group_key: Optional[str] = None,
        apply_all_vintages: Optional[bool] = None,
    ) -> Dict[str, Any]:
        with self._lock:
            bottle = self._bottle_map.get(bottle_id)
            if bottle is None:
                raise KeyError(f"보틀 ID를 찾을 수 없습니다: {bottle_id}")
            if decision is not None:
                if decision not in {"pending", "approved", "hold", "excluded"}:
                    raise ValueError(f"유효하지 않은 decision 값: {decision}")
                bottle["decision"] = decision
            if selected_wine_id is not None:
                bottle["selectedWineId"] = selected_wine_id
            if selected_group_key is not None:
                bottle["selectedGroupKey"] = selected_group_key
            if apply_all_vintages is not None:
                bottle["applyAllVintages"] = bool(apply_all_vintages)
        self.save_session()
        return bottle

    def bulk_approve(self, bottle_ids: List[str]) -> Dict[str, Any]:
        """현재 화면의 미결정 보틀들을 이미 확정/제외된 항목은 건드리지 않고 일괄 확정합니다."""
        updated_ids: List[str] = []
        with self._lock:
            for raw_id in bottle_ids:
                bid = str(raw_id or "").strip()
                bottle = self._bottle_map.get(bid)
                if bottle is None:
                    continue
                if bottle.get("decision") in {"approved", "excluded"}:
                    continue
                if not (bottle.get("selectedWineId") or bottle.get("selectedGroupKey")):
                    continue
                bottle["decision"] = "approved"
                bottle["duplicateOfBest"] = False
                updated_ids.append(bid)
        if updated_ids:
            self.save_session()
        return {"approvedCount": len(updated_ids), "updatedIds": updated_ids}

    def select_representative(self, group_key: str, bottle_id: str) -> Dict[str, Any]:
        """동일 와인 그룹(group_key) 중복 보틀 중 지정한 1병만 대표(approved)로 설정합니다."""
        gkey = str(group_key or "").strip()
        bid = str(bottle_id or "").strip()
        if not gkey or not bid:
            raise ValueError("groupKey와 bottleId가 모두 필요합니다.")
        with self._lock:
            target = self._bottle_map.get(bid)
            if target is None:
                raise KeyError(f"보틀 ID를 찾을 수 없습니다: {bid}")
            target["selectedGroupKey"] = gkey

            siblings: List[Dict[str, Any]] = []
            for ph in self.session.get("photos", []):
                for b in ph.get("bottles", []):
                    if str(b.get("selectedGroupKey") or "").strip() == gkey:
                        siblings.append(b)
                        if b.get("bottleId") == bid:
                            b["decision"] = "approved"
                            b["duplicateOfBest"] = False
                            b["representativeConfirmed"] = True
                        else:
                            b["decision"] = "excluded"
                            b["duplicateOfBest"] = True
                            b["representativeConfirmed"] = False
        self.save_session()
        return {
            "groupKey": gkey,
            "chosenBottleId": bid,
            "affectedCount": len(siblings),
        }

    def exclude_wine_group(self, group_key: str) -> Dict[str, Any]:
        """동일 와인 그룹(group_key)에 속한 모든 중복 보틀을 제외(excluded) 처리합니다."""
        gkey = str(group_key or "").strip()
        if not gkey:
            raise ValueError("groupKey가 필요합니다.")
        excluded_count = 0
        with self._lock:
            for ph in self.session.get("photos", []):
                for b in ph.get("bottles", []):
                    if str(b.get("selectedGroupKey") or "").strip() == gkey:
                        b["decision"] = "excluded"
                        b["duplicateOfBest"] = False
                        b["representativeConfirmed"] = False
                        excluded_count += 1
        if excluded_count > 0:
            self.save_session()
        return {"groupKey": gkey, "excludedCount": excluded_count}

    def export_approved_labels(self, out_path: Path) -> Dict[str, Any]:
        with self._lock:
            bundle = build_approved_labels_bundle(self.session, self.wine_groups)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = out_path.with_suffix(".json.part")
            tmp.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(tmp, out_path)
            return bundle

    def get_unlabeled_plan(self) -> Dict[str, Any]:
        with self._lock:
            cache = self._load_prefilter_cache()
            return build_unlabeled_matching_plan(
                self.session,
                self.wine_groups,
                prefilter_cache=cache,
                top_k=6,
            )

    def assign_unlabeled_wine(
        self,
        group_key: str,
        source: str,
        bottle_id: Optional[str] = None,
        image_data_url: Optional[str] = None,
        file_name: Optional[str] = None,
        apply_all_vintages: Optional[bool] = None,
    ) -> Dict[str, Any]:
        gkey = str(group_key or "").strip()
        src = str(source or "").strip().lower()
        if not gkey:
            raise ValueError("groupKey가 필요합니다.")
        wg = next((g for g in self.wine_groups if g["groupKey"] == gkey), None)
        if wg is None:
            raise KeyError(f"와인 그룹을 찾을 수 없습니다: {gkey}")

        with self._lock:
            assignments = self.session.setdefault("unlabeledAssignments", {})
            now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

            if src == "clear":
                removed = assignments.pop(gkey, None)
                if removed and removed.get("source") == "upload" and removed.get("labelPath"):
                    Path(removed["labelPath"]).unlink(missing_ok=True)
                self.save_session()
                return {"groupKey": gkey, "assignment": None}

            if src == "update":
                existing = assignments.get(gkey)
                if not isinstance(existing, dict):
                    raise KeyError(f"배정 내역이 없습니다: {gkey}")
                if apply_all_vintages is not None:
                    existing["applyAllVintages"] = bool(apply_all_vintages)
                self.save_session()
                return {
                    "groupKey": gkey,
                    "assignment": {
                        "source": existing.get("source"),
                        "bottleId": existing.get("bottleId"),
                        "photoId": existing.get("photoId"),
                        "fileName": existing.get("fileName"),
                        "applyAllVintages": bool(existing.get("applyAllVintages", True)),
                        "updatedAt": existing.get("updatedAt"),
                    },
                }

            if src == "cutout":
                bid = str(bottle_id or "").strip()
                if not bid:
                    raise ValueError("cutout 모드에는 bottleId가 필요합니다.")
                bottle = self._bottle_map.get(bid)
                if bottle is None:
                    raise KeyError(f"보틀 ID를 찾을 수 없습니다: {bid}")
                ph = self._photo_map.get(str(bottle.get("photoId") or ""))
                prev_assign = assignments.get(gkey)
                if prev_assign and prev_assign.get("source") == "upload" and prev_assign.get("labelPath"):
                    Path(prev_assign["labelPath"]).unlink(missing_ok=True)
                record = {
                    "source": "cutout",
                    "bottleId": bid,
                    "photoId": str(bottle.get("photoId") or ""),
                    "fileName": str(ph.get("fileName") if ph else bid),
                    "cutoutPath": str(bottle.get("cutoutPath") or ""),
                    "dataUrl": str(bottle.get("cutoutDataUrl") or ""),
                    "applyAllVintages": True if apply_all_vintages is None else bool(apply_all_vintages),
                    "updatedAt": now_iso,
                }
                assignments[gkey] = record
                self.save_session()
                return {
                    "groupKey": gkey,
                    "assignment": {
                        "source": record["source"],
                        "bottleId": record["bottleId"],
                        "photoId": record["photoId"],
                        "fileName": record["fileName"],
                        "applyAllVintages": record["applyAllVintages"],
                        "updatedAt": record["updatedAt"],
                    },
                }

            if src == "upload":
                raw_data = str(image_data_url or "").strip()
                if not raw_data:
                    raise ValueError("upload 모드에는 imageDataUrl이 필요합니다.")
                if ";base64," in raw_data:
                    b64_part = raw_data.split(";base64,", 1)[1]
                else:
                    b64_part = raw_data
                try:
                    raw_bytes = base64.b64decode(b64_part, validate=False)
                except Exception as exc:
                    raise ValueError(f"Base64 이미지 디코드 실패: {exc}") from exc

                webp_bytes, webp_data_url = encode_manual_label_webp(raw_bytes)
                self.manual_labels_dir.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha1(gkey.encode("utf-8")).hexdigest()[:16]
                label_file = self.manual_labels_dir / f"{digest}.webp"
                label_file.write_bytes(webp_bytes)

                record = {
                    "source": "upload",
                    "bottleId": None,
                    "photoId": None,
                    "fileName": str(file_name or "pasted_label.webp")[:120],
                    "labelPath": str(label_file),
                    "dataUrl": webp_data_url,
                    "applyAllVintages": True if apply_all_vintages is None else bool(apply_all_vintages),
                    "updatedAt": now_iso,
                }
                assignments[gkey] = record
                self.save_session()
                return {
                    "groupKey": gkey,
                    "assignment": {
                        "source": record["source"],
                        "bottleId": None,
                        "photoId": None,
                        "fileName": record["fileName"],
                        "applyAllVintages": record["applyAllVintages"],
                        "updatedAt": record["updatedAt"],
                    },
                }

            raise ValueError(f"지원하지 않는 배정 source 입니다: {source}")

    def export_unlabeled_labels(self, out_path: Path) -> Tuple[Path, Dict[str, Any]]:
        with self._lock:
            bundle = build_unlabeled_approved_labels_bundle(self.session, self.wine_groups)
            if out_path.stem.endswith("_unlabeled"):
                target_path = out_path
            else:
                target_path = out_path.with_name(f"{out_path.stem}_unlabeled{out_path.suffix or '.json'}")
            target_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = target_path.with_suffix(".json.part")
            tmp.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(tmp, target_path)
            return target_path, bundle

    def get_public_state(self) -> Dict[str, Any]:
        with self._lock:
            photos_public: List[Dict[str, Any]] = []
            for ph in self.session.get("photos", []):
                bottles_public = []
                for b in ph.get("bottles", []):
                    bottles_public.append(
                        {
                            "bottleId": b["bottleId"],
                            "photoId": b["photoId"],
                            "bottleIndex": b["bottleIndex"],
                            "box": b["box"],
                            "cutoutDataUrl": b["cutoutDataUrl"],
                            "cutoutBytes": b["cutoutBytes"],
                            "precutSkippedRembg": b["precutSkippedRembg"],
                            "ocr": b["ocr"],
                            "candidates": b["candidates"],
                            "selectedWineId": b["selectedWineId"],
                            "selectedGroupKey": b["selectedGroupKey"],
                            "alreadyHasLabel": bool(b.get("alreadyHasLabel", False)),
                            "duplicateOfBest": bool(b.get("duplicateOfBest", False)),
                            "representativeConfirmed": bool(b.get("representativeConfirmed", False)),
                            "applyAllVintages": b["applyAllVintages"],
                            "decision": b["decision"],
                        }
                    )
                photos_public.append(
                    {
                        "photoId": ph["photoId"],
                        "fileName": ph["fileName"],
                        "width": ph["width"],
                        "height": ph["height"],
                        "splitSource": ph["splitSource"],
                        "boxes": ph["boxes"],
                        "bottles": bottles_public,
                    }
                )
            wines_public = [
                {
                    "groupKey": wg["groupKey"],
                    "wineId": wg["wineId"],
                    "wineIds": wg["wineIds"],
                    "name": wg["name"],
                    "producer": wg["producer"],
                    "country": wg["country"],
                    "region": wg["region"],
                    "subRegion": wg["subRegion"],
                    "color": wg["color"],
                    "vintage": wg["vintage"],
                    "inStockCount": wg["inStockCount"],
                    "hasExistingLabel": bool(wg.get("hasExistingLabel", False)),
                }
                for wg in self.wine_groups
            ]
            unlabeled_groups = [wg for wg in self.wine_groups if not bool(wg.get("hasExistingLabel", False))]
            assignments = self.session.get("unlabeledAssignments") or {}
            unlabeled_assigned = sum(
                1 for wg in unlabeled_groups if wg["groupKey"] in assignments
            )
            return {
                "photos": photos_public,
                "wines": wines_public,
                "ocrMode": self.ocr_mode,
                "prefilterSummary": self.session.get("prefilterSummary"),
                "batchInfo": self.session.get("batchInfo"),
                "defaultTab": "unlabeled" if self.unlabeled_first else None,
                "unlabeledSummary": {
                    "totalUnlabeled": len(unlabeled_groups),
                    "inStockUnlabeled": sum(1 for wg in unlabeled_groups if wg["inStockCount"] > 0),
                    "assignedCount": unlabeled_assigned,
                },
            }


# ---------------------------------------------------------------------------
# Layer 6B: 127.0.0.1 Local 2-Tab Review HTTP Server
# ---------------------------------------------------------------------------


REVIEW_HTML_TEMPLATE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>JH Wine Forest — 다병 보틀 누끼 &amp; OCR 매칭 검수</title>
<style>
  :root {
    --bg: #0f1612;
    --panel: #17211c;
    --panel-2: #1f2d26;
    --border: #2e4037;
    --text: #eef3ef;
    --muted: #9eb0a5;
    --accent: #3f9164;
    --warn: #d4a338;
    --danger: #c95252;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Segoe UI", sans-serif;
    background: var(--bg);
    color: var(--text);
  }
  header {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
    padding: 12px 18px;
    background: rgba(15, 22, 18, 0.94);
    border-bottom: 1px solid var(--border);
    backdrop-filter: blur(8px);
  }
  .brand { font-weight: 700; font-size: 15px; }
  .tabs, .toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  button, select, input {
    font: inherit;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text);
    padding: 7px 12px;
  }
  button { cursor: pointer; font-weight: 600; font-size: 13px; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.warn { background: #6b531c; border-color: var(--warn); }
  button.danger { background: #5a2323; border-color: var(--danger); }
  button.active { outline: 2px solid var(--accent); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  main { padding: 16px 18px 40px; max-width: 1440px; margin: 0 auto; }
  .hidden { display: none !important; }
  .status-banner {
    margin-bottom: 12px;
    padding: 10px 14px;
    border-radius: 10px;
    background: var(--panel);
    border: 1px solid var(--border);
    font-size: 13px;
    color: var(--muted);
  }
  .split-layout {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 16px;
  }
  @media (max-width: 900px) {
    .split-layout { grid-template-columns: 1fr; }
  }
  .sidebar {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 78vh;
    overflow-y: auto;
  }
  .photo-item {
    text-align: left;
    padding: 9px 10px;
    border-radius: 8px;
    background: var(--panel-2);
    border: 1px solid var(--border);
  }
  .photo-item.selected { border-color: var(--accent); background: #21382c; }
  .canvas-panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px;
  }
  .canvas-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
    align-items: center;
  }
  .canvas-wrap {
    position: relative;
    display: inline-block;
    max-width: 100%;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: #090d0b;
  }
  canvas { display: block; max-width: 100%; height: auto; cursor: crosshair; }
  .bottle-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(430px, 1fr));
    gap: 14px;
  }
  @media (max-width: 520px) {
    .bottle-grid { grid-template-columns: 1fr; }
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px;
    display: grid;
    grid-template-columns: 148px 1fr;
    gap: 14px;
  }
  .card.approved { border-color: var(--accent); }
  .card.excluded { opacity: 0.55; }
  .preview-box {
    width: 148px;
    height: 211px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,0.12);
    position: relative;
  }
  .preview-box img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .bg-grad-R { background: radial-gradient(circle at 50% 35%, rgba(168,42,63,0.42), #1b221e 80%); }
  .bg-grad-W { background: radial-gradient(circle at 50% 35%, rgba(239,234,208,0.38), #1b221e 80%); }
  .bg-grad-SP { background: radial-gradient(circle at 50% 35%, rgba(226,184,87,0.42), #1b221e 80%); }
  .bg-grad-SW { background: radial-gradient(circle at 50% 35%, rgba(214,132,56,0.42), #1b221e 80%); }
  .bg-grad-RO { background: radial-gradient(circle at 50% 35%, rgba(221,115,134,0.42), #1b221e 80%); }
  .bg-checker {
    background-image: linear-gradient(45deg, #252b27 25%, transparent 25%),
      linear-gradient(-45deg, #252b27 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #252b27 75%),
      linear-gradient(-45deg, transparent 75%, #252b27 75%);
    background-size: 18px 18px;
    background-position: 0 0, 0 9px, 9px -9px, -9px 0;
  }
  .bg-light { background: #f2f4f1; }
  .meta-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .ocr-box {
    font-size: 12px;
    color: var(--muted);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 8px;
    max-height: 70px;
    overflow-y: auto;
    white-space: pre-wrap;
  }
  .cand-list { display: flex; flex-direction: column; gap: 4px; }
  .cand-btn {
    text-align: left;
    font-size: 12px;
    padding: 6px 8px;
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .cand-btn.chosen { border-color: var(--accent); background: #21382c; }
  .decision-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .small { font-size: 12px; color: var(--muted); }
  .dup-groups { display: flex; flex-direction: column; gap: 16px; }
  .dup-group {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px;
  }
  .dup-group-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
    font-weight: 600;
  }
  .dup-strip {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .dup-card {
    flex: 0 0 176px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .dup-card.chosen {
    border: 2px solid var(--accent);
    background: #1c3428;
  }
  .dup-card .preview-box {
    width: 158px;
    height: 225px;
  }
  .preview-box img { cursor: zoom-in; }
  .lightbox-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(6, 10, 8, 0.84);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    backdrop-filter: blur(4px);
  }
  .lightbox-dialog {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    max-width: min(92vw, 760px);
    max-height: 92vh;
    width: 100%;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .lightbox-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .lightbox-stage {
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.14);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 360px;
    max-height: 70vh;
    overflow: hidden;
    padding: 12px;
  }
  .lightbox-stage img {
    max-width: 100%;
    max-height: 66vh;
    object-fit: contain;
  }
  .lightbox-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .manual-ctx-banner {
    background: #1b3428;
    border: 1px solid var(--accent);
    border-radius: 10px;
    padding: 10px 14px;
    margin-bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .manual-ctx-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .manual-result-strip {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding-top: 4px;
  }
  .manual-result-item {
    flex: 0 0 156px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .manual-result-item .preview-box {
    width: 138px;
    height: 197px;
  }
  .unlabeled-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .unlabeled-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px;
    display: grid;
    grid-template-columns: 184px 1fr;
    gap: 16px;
    transition: border-color 0.15s;
  }
  .unlabeled-card.assigned { border-color: var(--accent); }
  .unlabeled-card.paste-active {
    outline: 2px solid var(--warn);
    outline-offset: 1px;
  }
  @media (max-width: 720px) {
    .unlabeled-card { grid-template-columns: 1fr; }
  }
  .unlabeled-left {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .unlabeled-left .preview-box {
    width: 176px;
    height: 250px;
  }
  .dropzone-box {
    width: 176px;
    height: 210px;
    border: 2px dashed var(--border);
    border-radius: 10px;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 12px;
    gap: 6px;
    cursor: pointer;
    font-size: 12px;
    color: var(--muted);
  }
  .dropzone-box.dragover {
    border-color: var(--accent);
    background: #1b3326;
    color: var(--text);
  }
  .unlabeled-right {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .unlabeled-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 8px;
  }
  .rec-strip {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .rec-card {
    flex: 0 0 166px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rec-card.chosen {
    border: 2px solid var(--accent);
    background: #1c3428;
  }
  .rec-card .preview-box {
    width: 148px;
    height: 211px;
  }
  .gallery-dialog {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    max-width: min(95vw, 1140px);
    max-height: 92vh;
    width: 100%;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(175px, 1fr));
    gap: 12px;
    overflow-y: auto;
    max-height: 64vh;
    padding-right: 4px;
  }
  .gallery-tile {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .gallery-tile.used { opacity: 0.72; }
  .gallery-tile .preview-box {
    width: 100%;
    height: 210px;
  }
  .mini-ocr {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .copyable-wine-name {
    cursor: copy;
    border-bottom: 1px dashed rgba(158, 176, 165, 0.55);
    border-radius: 4px;
    padding: 0 2px;
    transition: background-color 0.15s, color 0.15s, border-color 0.15s;
  }
  .copyable-wine-name:hover {
    color: #9bf0bd;
    border-bottom-color: #9bf0bd;
    background: rgba(63, 145, 100, 0.18);
  }
  .copyable-wine-name.copied {
    color: #ffffff;
    background: var(--accent);
    border-bottom-color: transparent;
  }
  .copy-toast {
    position: fixed;
    bottom: 22px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 220;
    background: #1d4d34;
    color: #ffffff;
    border: 1px solid var(--accent);
    border-radius: 999px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    pointer-events: none;
  }
</style>
</head>
<body>
<header>
  <div class="brand">JH Wine Forest — 다병 누끼 &amp; OCR 매칭 검수</div>
  <div class="tabs">
    <button id="tabBtnSplit" class="active" type="button">탭 1: 사진별 병 분할/재컷팅</button>
    <button id="tabBtnMatch" type="button">탭 2: 누끼 보틀 &amp; 와인 확정</button>
    <button id="tabBtnDups" type="button">탭 3: 중복 와인 대표 고르기 (0종)</button>
    <button id="tabBtnUnlabeled" type="button">탭 4: 라벨 없는 와인 매칭 (0종)</button>
  </div>
  <div class="toolbar">
    <span id="summaryPill" class="small">로딩 중...</span>
    <button id="btnSaveSession" type="button">중간 저장 (session.json)</button>
    <button id="btnExportLabels" class="primary" type="button">approved_labels.json 내보내기</button>
  </div>
</header>
<main>
  <div id="statusBanner" class="status-banner">준비 중...</div>

  <section id="tabSplit" class="split-layout">
    <aside class="sidebar">
      <input id="tab1PhotoSearch" type="text" placeholder="사진 파일명 검색..." />
      <div id="photoList" style="display:flex;flex-direction:column;gap:8px;"></div>
    </aside>
    <div class="canvas-panel">
      <div id="tab1ManualCtxBanner" class="manual-ctx-banner hidden">
        <div class="manual-ctx-head">
          <strong id="tab1ManualCtxTitle">✂️ 수동 누끼 수정 중</strong>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button id="tab1ManualBackBtn" type="button">← 돌아가기</button>
          </div>
        </div>
        <div class="small">박스 이동·크기 조절 또는 [+ 병 박스 추가] 후 <strong>[이 사진 재누끼 및 OCR 다시 실행]</strong>을 누르면 새 누끼를 바로 적용할 수 있습니다.</div>
        <div id="tab1ManualResultStrip" class="manual-result-strip hidden"></div>
      </div>
      <div class="canvas-actions">
        <button id="btnAddBox" type="button">+ 병 박스 추가</button>
        <button id="btnDeleteBox" class="danger" type="button">선택 박스 삭제</button>
        <button id="btnValleySplit" class="warn" type="button">밸리 재분할 실행</button>
        <button id="btnRecutBoxes" class="primary" type="button">이 사진 재누끼 및 OCR 다시 실행</button>
        <span class="small">드래그로 이동 / 우하단 모서리 드래그로 크기 조정</span>
      </div>
      <div class="canvas-wrap">
        <canvas id="splitCanvas"></canvas>
      </div>
    </div>
  </section>

  <section id="tabMatch" class="hidden">
    <div class="canvas-actions">
      <label class="small">미리보기 배경:
        <select id="bgModeSelect">
          <option value="wine">와인 색상 그라디언트 (앱 동일)</option>
          <option value="checker">투명 체커보드</option>
          <option value="light">밝은 배경</option>
        </select>
      </label>
      <label class="small">필터:
        <select id="decisionFilterSelect">
          <option value="matched" selected>매칭 후보만 (50점+ / 확정)</option>
          <option value="matched_pending">50점+ 미확정만</option>
          <option value="approved">확정만</option>
          <option value="pending">미결정/보류만</option>
          <option value="all">전체 보기</option>
          <option value="excluded">제외만</option>
        </select>
      </label>
      <label class="small">
        <input id="bestPerWineChk" type="checkbox" checked /> 와인별 베스트 1장만 보기
      </label>
      <label class="small">
        <input id="hideExistingLabelsChk" type="checkbox" /> 이미 라벨 있는 와인 숨기기
      </label>
      <button id="btnBulkApprove" class="primary" type="button">현재 화면 미결정 일괄 확정</button>
    </div>
    <div id="bottleGrid" class="bottle-grid"></div>
  </section>

  <section id="tabDups" class="hidden">
    <div class="canvas-actions">
      <label class="small">
        <input id="dupApprovedOnlyChk" type="checkbox" checked /> 확정 포함된 중복 와인만 보기
      </label>
      <label class="small">
        <input id="dupHideResolvedChk" type="checkbox" checked /> 대표 확정 완료된 와인 숨기기
      </label>
      <span class="small">대표 1장을 고르면 확인 후 단독 확정되고 이 목록에서 치워집니다</span>
    </div>
    <div id="dupGroups" class="dup-groups"></div>
  </section>

  <section id="tabUnlabeled" class="hidden">
    <div class="canvas-actions">
      <label class="small">
        <input id="unlabeledInStockOnlyChk" type="checkbox" checked /> 보유 중(IN_STOCK)만 보기
      </label>
      <label class="small">
        <input id="unlabeledOnlyPendingChk" type="checkbox" /> 미배정 와인만 보기
      </label>
      <label class="small">
        <input id="unlabeledIncludeUsedChk" type="checkbox" /> 추천에 이미 사용된 누끼 포함
      </label>
      <input id="unlabeledSearchInput" type="text" placeholder="라벨 없는 와인명 / 생산자 / 산지 검색..." style="min-width:240px;" />
      <button id="btnExportUnlabeled" class="primary" type="button">라벨 없는 와인 매칭분만 내보내기 (0종)</button>
      <span id="unlabeledPoolStats" class="small">누끼 풀 불러오는 중...</span>
    </div>
    <div id="unlabeledHintBanner" class="status-banner">카드를 클릭해 선택한 뒤 이미지를 드래그/파일선택/<strong>Cmd+V 붙여넣기</strong>하거나, 추천·전체 누끼에서 고를 수 있습니다.</div>
    <div id="unlabeledWineList" class="unlabeled-list"></div>
  </section>
</main>
<div id="imageLightbox" class="lightbox-backdrop hidden" role="dialog" aria-modal="true">
  <div class="lightbox-dialog">
    <div class="lightbox-head">
      <strong id="lightboxTitle">-</strong>
      <div class="lightbox-actions">
        <button id="lightboxModeCutout" type="button" class="active">누끼 크게 보기</button>
        <button id="lightboxModeCrop" type="button">원본 라벨 크롭 크게 보기</button>
        <button id="lightboxManualCutoutBtn" type="button" class="warn hidden">✂️ 원본 1단계에서 수동 누끼</button>
        <button id="lightboxCloseBtn" type="button">닫기 (ESC)</button>
      </div>
    </div>
    <div id="lightboxStage" class="lightbox-stage bg-grad-R">
      <img id="lightboxImg" alt="확대 보기" />
    </div>
    <div id="lightboxMeta" class="small"></div>
  </div>
</div>
<div id="cutoutGalleryModal" class="lightbox-backdrop hidden" role="dialog" aria-modal="true">
  <div class="gallery-dialog">
    <div class="lightbox-head">
      <strong id="galleryModalTitle">전체 누끼에서 고르기</strong>
      <button id="galleryCloseBtn" type="button">닫기 (ESC)</button>
    </div>
    <div class="canvas-actions" style="margin-bottom:0;">
      <input id="gallerySearchInput" type="text" placeholder="OCR 텍스트 / 사진 파일명 검색..." style="min-width:230px;" />
      <label class="small">
        <input id="galleryUnusedOnlyChk" type="checkbox" checked /> 미사용 누끼만 보기
      </label>
      <label class="small">정렬:
        <select id="gallerySortSelect">
          <option value="score" selected>이 와인 추천순</option>
          <option value="filename">사진 파일명순</option>
          <option value="bytes">용량(해상도)순</option>
        </select>
      </label>
      <span id="galleryCountInfo" class="small">-</span>
    </div>
    <div id="galleryGrid" class="gallery-grid"></div>
    <div class="lightbox-head">
      <div style="display:flex;gap:8px;align-items:center;">
        <button id="galleryPrevBtn" type="button">← 이전</button>
        <span id="galleryPageInfo" class="small">1 / 1</span>
        <button id="galleryNextBtn" type="button">다음 →</button>
      </div>
      <span class="small">썸네일 클릭 시 크게 보기(원본 라벨 크롭 비교 포함) 가능</span>
    </div>
  </div>
</div>
<div id="copyToast" class="copy-toast hidden" role="status" aria-live="polite"></div>
<script>
(() => {
  const state = {
    photos: [],
    wines: [],
    selectedPhotoId: null,
    boxes: [],
    selectedBoxIdx: -1,
    photoImage: null,
    dragMode: null,
    dragStart: null,
    dragMoved: false,
    isRecutting: false,
    bgMode: 'wine',
    decisionFilter: 'matched',
    bestPerWine: true,
    hideExistingLabels: false,
    dupApprovedOnly: true,
    dupHideResolved: true,
    lastVisibleMatchItems: [],
    defaultTab: null,
    tab1PhotoQuery: '',
    manualCutoutCtx: null,
    unlabeledPlan: null,
    unlabeledSummary: null,
    unlabeledInStockOnly: true,
    unlabeledOnlyPending: false,
    unlabeledIncludeUsed: false,
    unlabeledSearchQuery: '',
    unlabeledApplyAllMap: {},
    activeUnlabeledGroupKey: null,
    galleryTargetWine: null,
    gallerySearchQuery: '',
    galleryUnusedOnly: true,
    gallerySort: 'score',
    galleryPage: 1,
  };

  const tabSplit = document.getElementById('tabSplit');
  const tabMatch = document.getElementById('tabMatch');
  const tabDups = document.getElementById('tabDups');
  const tabUnlabeled = document.getElementById('tabUnlabeled');
  const tabBtnSplit = document.getElementById('tabBtnSplit');
  const tabBtnMatch = document.getElementById('tabBtnMatch');
  const tabBtnDups = document.getElementById('tabBtnDups');
  const tabBtnUnlabeled = document.getElementById('tabBtnUnlabeled');
  const statusBanner = document.getElementById('statusBanner');
  const summaryPill = document.getElementById('summaryPill');
  const photoList = document.getElementById('photoList');
  const tab1PhotoSearch = document.getElementById('tab1PhotoSearch');
  const tab1ManualCtxBanner = document.getElementById('tab1ManualCtxBanner');
  const tab1ManualCtxTitle = document.getElementById('tab1ManualCtxTitle');
  const tab1ManualBackBtn = document.getElementById('tab1ManualBackBtn');
  const tab1ManualResultStrip = document.getElementById('tab1ManualResultStrip');
  const canvas = document.getElementById('splitCanvas');
  const ctx = canvas.getContext('2d');
  const bottleGrid = document.getElementById('bottleGrid');
  const dupGroups = document.getElementById('dupGroups');
  const unlabeledWineList = document.getElementById('unlabeledWineList');
  const unlabeledPoolStats = document.getElementById('unlabeledPoolStats');
  const btnExportUnlabeled = document.getElementById('btnExportUnlabeled');
  const copyToast = document.getElementById('copyToast');
  let copyToastTimer = null;

  function setStatus(msg) {
    statusBanner.textContent = msg;
  }

  function showCopyToast(wineName) {
    if (!copyToast) return;
    copyToast.textContent = `📋 와인명 복사됨: ${wineName}`;
    copyToast.classList.remove('hidden');
    if (copyToastTimer) clearTimeout(copyToastTimer);
    copyToastTimer = setTimeout(() => {
      copyToast.classList.add('hidden');
    }, 1600);
  }

  async function copyWineNameOnly(wineName, triggerEl) {
    const clean = String(wineName || '').trim();
    if (!clean) return;
    let copied = false;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(clean);
        copied = true;
      } catch (_err) {
        copied = false;
      }
    }
    if (!copied) {
      const ta = document.createElement('textarea');
      ta.value = clean;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        copied = document.execCommand('copy');
      } catch (_err2) {
        copied = false;
      }
      document.body.removeChild(ta);
    }
    if (triggerEl && triggerEl.classList) {
      triggerEl.classList.add('copied');
      setTimeout(() => triggerEl.classList.remove('copied'), 900);
    }
    showCopyToast(clean);
    setStatus(copied ? `📋 와인명만 복사됨 (Cmd+V 사용 가능): ${clean}` : `와인명: ${clean}`);
  }

  function makeCopyableWineNameEl(wineName, onAfterCopy) {
    const clean = String(wineName || '').trim();
    const span = document.createElement('span');
    span.className = 'copyable-wine-name';
    span.setAttribute('role', 'button');
    span.tabIndex = 0;
    span.title = '클릭하면 빈티지 없이 와인 이름만 복사됩니다';
    span.textContent = clean;
    const handleCopy = (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      copyWineNameOnly(clean, span);
      if (typeof onAfterCopy === 'function') onAfterCopy();
    };
    span.addEventListener('click', handleCopy);
    span.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' || evt.key === ' ') {
        handleCopy(evt);
      }
    });
    return span;
  }

  const lightboxEl = document.getElementById('imageLightbox');
  const lightboxTitle = document.getElementById('lightboxTitle');
  const lightboxStage = document.getElementById('lightboxStage');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxMeta = document.getElementById('lightboxMeta');
  const lightboxModeCutout = document.getElementById('lightboxModeCutout');
  const lightboxModeCrop = document.getElementById('lightboxModeCrop');
  const lightboxManualCutoutBtn = document.getElementById('lightboxManualCutoutBtn');
  let lightboxCtx = null;

  function resolveCutoutSrc(b) {
    if (b && b.cutoutDataUrl) return b.cutoutDataUrl;
    if (b && b.bottleId) return `/api/cutout/${encodeURIComponent(b.bottleId)}`;
    return '';
  }

  function renderLightbox(viewMode) {
    if (!lightboxCtx) return;
    const { ph, b, customTitle, customUrl, manualCtx } = lightboxCtx;
    const isManualUrl = Boolean(customUrl);
    const isCrop = !isManualUrl && viewMode === 'crop';
    lightboxModeCutout.classList.toggle('active', !isCrop);
    lightboxModeCrop.classList.toggle('hidden', isManualUrl);
    lightboxModeCrop.classList.toggle('active', isCrop);

    const canManualJump = !isManualUrl && b && (b.photoId || (ph && ph.photoId));
    lightboxManualCutoutBtn.classList.toggle('hidden', !canManualJump);

    const color = (manualCtx && manualCtx.color) || (b ? findWineColor(b) : 'R');
    let bgClass = 'bg-grad-' + color;
    if (isCrop) bgClass = 'bg-checker';
    else if (state.bgMode === 'checker') bgClass = 'bg-checker';
    else if (state.bgMode === 'light') bgClass = 'bg-light';
    lightboxStage.className = 'lightbox-stage ' + bgClass;

    if (isManualUrl) {
      lightboxImg.onerror = null;
      lightboxImg.src = customUrl;
      lightboxMeta.replaceChildren();
      if (manualCtx && manualCtx.wineName) {
        lightboxMeta.appendChild(document.createTextNode('직접 등록한 라벨 이미지 · 와인명 클릭 복사: '));
        lightboxMeta.appendChild(makeCopyableWineNameEl(manualCtx.wineName));
      } else {
        lightboxMeta.textContent = customTitle || '직접 등록한 라벨 이미지 (500px WebP)';
      }
      return;
    }

    const cutoutSrc = resolveCutoutSrc(b);
    lightboxImg.onerror = () => {
      if (isCrop) {
        lightboxImg.onerror = null;
        lightboxImg.src = cutoutSrc;
        lightboxMeta.textContent = `${ph.fileName} #${b.bottleIndex} · 원본 크롭 파일이 없어 누끼 이미지로 표시합니다.`;
      }
    };
    lightboxImg.src = isCrop
      ? `/api/crop/${encodeURIComponent(b.bottleId)}?t=${Date.now()}`
      : cutoutSrc;

    lightboxMeta.replaceChildren();
    lightboxMeta.appendChild(document.createTextNode(`${ph.fileName} · #${b.bottleIndex} · `));
    const selWine = b.selectedGroupKey
      ? state.wines.find((w) => w.groupKey === b.selectedGroupKey || w.wineId === b.selectedWineId)
      : null;
    if (b.candidates && b.candidates[0]) {
      const top = b.candidates[0];
      lightboxMeta.appendChild(document.createTextNode(`추천 1순위: [${top.color}] `));
      lightboxMeta.appendChild(makeCopyableWineNameEl(top.name));
      lightboxMeta.appendChild(document.createTextNode(` (${top.score}점)`));
    } else if (manualCtx && manualCtx.wineName) {
      lightboxMeta.appendChild(document.createTextNode(`[${manualCtx.color || color}] `));
      lightboxMeta.appendChild(makeCopyableWineNameEl(manualCtx.wineName));
      if (b.score !== undefined) {
        lightboxMeta.appendChild(document.createTextNode(` · 역방향 추천 ${b.score}점`));
      }
    } else if (selWine) {
      lightboxMeta.appendChild(document.createTextNode(`[${selWine.color}] `));
      lightboxMeta.appendChild(makeCopyableWineNameEl(selWine.name));
    } else if (b.score !== undefined) {
      lightboxMeta.appendChild(document.createTextNode(`역방향 추천 점수: ${b.score}점`));
    } else if (b.ocrRawText) {
      lightboxMeta.appendChild(document.createTextNode(`OCR: ${String(b.ocrRawText).slice(0, 80)}`));
    } else {
      lightboxMeta.appendChild(document.createTextNode('추천 후보 없음'));
    }
  }

  function openLightbox(ph, b, manualCtx) {
    lightboxCtx = { ph, b, manualCtx: manualCtx || null };
    lightboxTitle.textContent = `${ph.fileName} — #${b.bottleIndex}`;
    renderLightbox('cutout');
    lightboxEl.classList.remove('hidden');
  }

  function openManualLabelLightbox(title, imgUrl, color, wineName) {
    lightboxCtx = {
      customTitle: title,
      customUrl: imgUrl,
      manualCtx: { color: color || 'R', wineName: wineName || null },
    };
    lightboxTitle.replaceChildren();
    if (wineName) {
      lightboxTitle.appendChild(document.createTextNode(`[${color || 'R'}] `));
      lightboxTitle.appendChild(makeCopyableWineNameEl(wineName));
    } else {
      lightboxTitle.textContent = title;
    }
    renderLightbox('cutout');
    lightboxEl.classList.remove('hidden');
  }

  function closeLightbox() {
    lightboxEl.classList.add('hidden');
    lightboxImg.onerror = null;
    lightboxImg.removeAttribute('src');
    lightboxCtx = null;
  }

  lightboxModeCutout.addEventListener('click', () => renderLightbox('cutout'));
  lightboxModeCrop.addEventListener('click', () => renderLightbox('crop'));
  lightboxManualCutoutBtn.addEventListener('click', () => {
    if (!lightboxCtx || !lightboxCtx.b) return;
    const b = lightboxCtx.b;
    const ph = lightboxCtx.ph || {};
    const mCtx = lightboxCtx.manualCtx || {};
    const targetPhotoId = b.photoId || ph.photoId;
    if (!targetPhotoId) return;
    const retTab = mCtx.returnTab || (!tabUnlabeled.classList.contains('hidden') ? 'unlabeled' : 'match');
    closeLightbox();
    jumpToTab1ManualCutout(targetPhotoId, {
      bottleId: b.bottleId,
      returnTab: retTab,
      returnGroupKey: mCtx.groupKey || null,
      returnWineLabel: mCtx.wineLabel || null,
      returnWineName: mCtx.wineName || null,
      returnWineColor: mCtx.color || null,
    });
  });
  document.getElementById('lightboxCloseBtn').addEventListener('click', closeLightbox);
  lightboxEl.addEventListener('click', (evt) => {
    if (evt.target === lightboxEl) closeLightbox();
  });

  const galleryModalEl = document.getElementById('cutoutGalleryModal');
  const galleryModalTitle = document.getElementById('galleryModalTitle');
  const gallerySearchInput = document.getElementById('gallerySearchInput');
  const galleryUnusedOnlyChk = document.getElementById('galleryUnusedOnlyChk');
  const gallerySortSelect = document.getElementById('gallerySortSelect');
  const galleryCountInfo = document.getElementById('galleryCountInfo');
  const galleryGrid = document.getElementById('galleryGrid');
  const galleryPageInfo = document.getElementById('galleryPageInfo');
  const galleryPrevBtn = document.getElementById('galleryPrevBtn');
  const galleryNextBtn = document.getElementById('galleryNextBtn');

  function closeGalleryModal() {
    galleryModalEl.classList.add('hidden');
    state.galleryTargetWine = null;
  }

  document.getElementById('galleryCloseBtn').addEventListener('click', closeGalleryModal);
  galleryModalEl.addEventListener('click', (evt) => {
    if (evt.target === galleryModalEl) closeGalleryModal();
  });

  window.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') {
      if (!lightboxEl.classList.contains('hidden')) {
        evt.preventDefault();
        closeLightbox();
        return;
      }
      if (!galleryModalEl.classList.contains('hidden')) {
        evt.preventDefault();
        closeGalleryModal();
      }
    }
  });

  function normalizeSearch(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .normalize('NFC')
      .toLowerCase();
  }

  function switchTab(name) {
    tabSplit.classList.toggle('hidden', name !== 'split');
    tabMatch.classList.toggle('hidden', name !== 'match');
    tabDups.classList.toggle('hidden', name !== 'dups');
    tabUnlabeled.classList.toggle('hidden', name !== 'unlabeled');
    tabBtnSplit.classList.toggle('active', name === 'split');
    tabBtnMatch.classList.toggle('active', name === 'match');
    tabBtnDups.classList.toggle('active', name === 'dups');
    tabBtnUnlabeled.classList.toggle('active', name === 'unlabeled');
    if (name === 'split') renderTab1ManualBanner();
    if (name === 'match') renderBottleGrid();
    if (name === 'dups') renderDuplicatePicker();
    if (name === 'unlabeled') {
      if (!state.unlabeledPlan) loadUnlabeledPlan();
      else renderUnlabeledList();
    }
  }

  tabBtnSplit.addEventListener('click', () => switchTab('split'));
  tabBtnMatch.addEventListener('click', () => switchTab('match'));
  tabBtnDups.addEventListener('click', () => switchTab('dups'));
  tabBtnUnlabeled.addEventListener('click', () => switchTab('unlabeled'));

  tab1PhotoSearch.addEventListener('input', () => {
    state.tab1PhotoQuery = tab1PhotoSearch.value;
    renderPhotoSidebar();
  });

  document.getElementById('bgModeSelect').addEventListener('change', (e) => {
    state.bgMode = e.target.value;
    if (!tabMatch.classList.contains('hidden')) renderBottleGrid();
    if (!tabDups.classList.contains('hidden')) renderDuplicatePicker();
    if (!tabUnlabeled.classList.contains('hidden')) renderUnlabeledList();
  });
  document.getElementById('decisionFilterSelect').addEventListener('change', (e) => {
    state.decisionFilter = e.target.value;
    renderBottleGrid();
  });
  document.getElementById('bestPerWineChk').addEventListener('change', (e) => {
    state.bestPerWine = Boolean(e.target.checked);
    renderBottleGrid();
  });
  document.getElementById('hideExistingLabelsChk').addEventListener('change', (e) => {
    state.hideExistingLabels = Boolean(e.target.checked);
    renderBottleGrid();
  });
  document.getElementById('dupApprovedOnlyChk').addEventListener('change', (e) => {
    state.dupApprovedOnly = Boolean(e.target.checked);
    renderDuplicatePicker();
  });
  document.getElementById('dupHideResolvedChk').addEventListener('change', (e) => {
    state.dupHideResolved = Boolean(e.target.checked);
    renderDuplicatePicker();
  });

  async function apiJson(url, options) {
    const res = await fetch(url, options);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '요청 실패');
    return data;
  }

  function computeDuplicateGroups() {
    const byGroup = new Map();
    for (const ph of state.photos) {
      for (const b of ph.bottles) {
        if (!b.selectedGroupKey) continue;
        if (!byGroup.has(b.selectedGroupKey)) byGroup.set(b.selectedGroupKey, []);
        byGroup.get(b.selectedGroupKey).push({ ph, b });
      }
    }
    const groups = [];
    for (const [groupKey, items] of byGroup.entries()) {
      if (items.length < 2) continue;
      const hasApproved = items.some((it) => it.b.decision === 'approved');
      const allExcluded = items.every((it) => it.b.decision === 'excluded');
      const isResolved = allExcluded || items.some((it) => it.b.decision === 'approved' && Boolean(it.b.representativeConfirmed));
      groups.push({ groupKey, items, hasApproved, allExcluded, isResolved });
    }
    groups.sort((a, b) => Number(a.isResolved) - Number(b.isResolved) || Number(b.hasApproved) - Number(a.hasApproved) || b.items.length - a.items.length);
    return groups;
  }

  function updateSummary() {
    let total = 0, approved = 0;
    for (const ph of state.photos) {
      for (const b of ph.bottles) {
        total += 1;
        if (b.decision === 'approved') approved += 1;
      }
    }
    summaryPill.textContent = `사진 ${state.photos.length}장 · 병 ${total}개 · 확정 ${approved}개`;
    const dupList = computeDuplicateGroups();
    const remainingDup = dupList.filter((g) => !g.isResolved).length;
    tabBtnDups.textContent = `탭 3: 중복 와인 대표 고르기 (${remainingDup}종)`;

    if (state.unlabeledPlan && Array.isArray(state.unlabeledPlan.wines)) {
      const assignedCnt = state.unlabeledPlan.wines.filter((w) => Boolean(w.assignment)).length;
      const inStockCnt = state.unlabeledPlan.wines.filter((w) => (w.inStockCount || 0) > 0).length;
      tabBtnUnlabeled.textContent = `탭 4: 라벨 없는 와인 매칭 (${assignedCnt}/${state.unlabeledPlan.wines.length}종 · 보유 ${inStockCnt})`;
      btnExportUnlabeled.textContent = `라벨 없는 와인 매칭분만 내보내기 (${assignedCnt}종)`;
    } else if (state.unlabeledSummary) {
      const us = state.unlabeledSummary;
      tabBtnUnlabeled.textContent = `탭 4: 라벨 없는 와인 매칭 (${us.assignedCount || 0}/${us.totalUnlabeled || 0}종 · 보유 ${us.inStockUnlabeled || 0})`;
      btnExportUnlabeled.textContent = `라벨 없는 와인 매칭분만 내보내기 (${us.assignedCount || 0}종)`;
    }
  }

  function hasPendingBoxEdits(ph) {
    if (!ph) return false;
    const bBoxes = (ph.bottles || []).map((b) => b.box);
    return JSON.stringify(ph.boxes || []) !== JSON.stringify(bBoxes);
  }

  function renderPhotoSidebar() {
    photoList.replaceChildren();
    const q = normalizeSearch(state.tab1PhotoQuery).trim();
    let selectedEl = null;
    for (const ph of state.photos) {
      if (q && !normalizeSearch(ph.fileName).includes(q) && ph.photoId !== state.selectedPhotoId) {
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      const isSel = ph.photoId === state.selectedPhotoId;
      btn.className = 'photo-item' + (isSel ? ' selected' : '');
      const title = document.createElement('div');
      title.textContent = ph.fileName;
      const meta = document.createElement('div');
      meta.className = 'small';
      const dirty = hasPendingBoxEdits(ph) ? ' · 미반영 박스' : '';
      meta.textContent = `${(ph.boxes || []).length}박스 (${ph.bottles.length}누끼) · ${ph.splitSource}${dirty}`;
      btn.appendChild(title);
      btn.appendChild(meta);
      btn.addEventListener('click', () => selectPhoto(ph.photoId));
      photoList.appendChild(btn);
      if (isSel) selectedEl = btn;
    }
    if (selectedEl && typeof selectedEl.scrollIntoView === 'function') {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderTab1ManualBanner() {
    const mCtx = state.manualCutoutCtx;
    if (!mCtx) {
      tab1ManualCtxBanner.classList.add('hidden');
      tab1ManualResultStrip.classList.add('hidden');
      tab1ManualResultStrip.replaceChildren();
      return;
    }
    tab1ManualCtxBanner.classList.remove('hidden');
    tab1ManualCtxTitle.replaceChildren();
    if (mCtx.returnWineName) {
      const prefix = mCtx.returnWineColor ? `✂️ [${mCtx.returnWineColor}] ` : '✂️ ';
      tab1ManualCtxTitle.appendChild(document.createTextNode(prefix));
      tab1ManualCtxTitle.appendChild(makeCopyableWineNameEl(mCtx.returnWineName));
      tab1ManualCtxTitle.appendChild(document.createTextNode(' 수동 누끼 수정 중'));
    } else if (mCtx.returnGroupKey && mCtx.returnWineLabel) {
      tab1ManualCtxTitle.textContent = `✂️ [${mCtx.returnWineLabel}] 수동 누끼 수정 중`;
    } else {
      tab1ManualCtxTitle.textContent = `✂️ 원본 사진 수동 누끼 수정 중 (${mCtx.photoId})`;
    }
    tab1ManualBackBtn.textContent = mCtx.returnTab === 'unlabeled'
      ? '← 탭 4(라벨 없는 와인)로 돌아가기'
      : '← 탭 2로 돌아가기';

    tab1ManualResultStrip.replaceChildren();
    if (mCtx.recutDone) {
      const ph = state.photos.find((p) => p.photoId === state.selectedPhotoId);
      const bottles = (ph && ph.bottles) || [];
      if (bottles.length > 0) {
        tab1ManualResultStrip.classList.remove('hidden');
        for (const b of bottles) {
          const item = document.createElement('div');
          item.className = 'manual-result-item';
          const pBox = document.createElement('div');
          pBox.className = 'preview-box bg-checker';
          const pImg = document.createElement('img');
          pImg.src = `${resolveCutoutSrc(b)}${resolveCutoutSrc(b).startsWith('/api/') ? '?t=' + Date.now() : ''}`;
          pImg.alt = `${ph.fileName} #${b.bottleIndex}`;
          pImg.addEventListener('click', () => openLightbox(ph, b));
          pBox.appendChild(pImg);
          item.appendChild(pBox);

          const info = document.createElement('div');
          info.className = 'small';
          info.textContent = `#${b.bottleIndex} · ${Math.round((b.cutoutBytes || 0) / 1024)}KB`;
          item.appendChild(info);

          if (mCtx.returnGroupKey) {
            const applyBtn = document.createElement('button');
            applyBtn.type = 'button';
            applyBtn.className = 'primary';
            applyBtn.textContent = '이 새 누끼 적용 & 복귀';
            applyBtn.addEventListener('click', async () => {
              try {
                await assignUnlabeled(mCtx.returnGroupKey, {
                  source: 'cutout',
                  bottleId: b.bottleId,
                });
                const retTab = mCtx.returnTab || 'unlabeled';
                state.manualCutoutCtx = null;
                switchTab(retTab);
              } catch (err) {
                setStatus('배정 오류: ' + err.message);
              }
            });
            item.appendChild(applyBtn);
          }
          tab1ManualResultStrip.appendChild(item);
        }
        return;
      }
    }
    tab1ManualResultStrip.classList.add('hidden');
  }

  tab1ManualBackBtn.addEventListener('click', () => {
    const retTab = (state.manualCutoutCtx && state.manualCutoutCtx.returnTab) || 'unlabeled';
    state.manualCutoutCtx = null;
    switchTab(retTab);
  });

  function jumpToTab1ManualCutout(photoId, opts) {
    const o = opts || {};
    let wineName = o.returnWineName || null;
    let wineColor = o.returnWineColor || null;
    if (!wineName && o.returnGroupKey) {
      const wg = state.wines.find((w) => w.groupKey === o.returnGroupKey);
      if (wg) {
        wineName = wg.name;
        wineColor = wineColor || wg.color;
      }
    }
    state.manualCutoutCtx = {
      photoId,
      bottleId: o.bottleId || null,
      returnTab: o.returnTab || 'unlabeled',
      returnGroupKey: o.returnGroupKey || null,
      returnWineLabel: o.returnWineLabel || null,
      returnWineName: wineName,
      returnWineColor: wineColor,
      recutDone: false,
    };
    state.tab1PhotoQuery = '';
    tab1PhotoSearch.value = '';
    switchTab('split');
    selectPhoto(photoId, o.bottleId || null);
    renderTab1ManualBanner();
    setStatus(`1단계 원본 사진(${photoId})으로 이동했습니다. 박스 조정 후 [이 사진 재누끼 및 OCR 다시 실행]을 누르세요.`);
  }

  async function syncBoxesToServer() {
    if (!state.selectedPhotoId) return;
    const ph = state.photos.find((p) => p.photoId === state.selectedPhotoId);
    if (ph) {
      ph.boxes = state.boxes.map((b) => [...b]);
      renderPhotoSidebar();
    }
    try {
      const updated = await apiJson('/api/boxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId: state.selectedPhotoId, boxes: state.boxes }),
      });
      if (ph) {
        ph.boxes = updated.boxes;
        ph.splitSource = updated.splitSource;
        state.boxes = (updated.boxes || []).map((b) => [...b]);
      }
      renderPhotoSidebar();
      drawSplitCanvas();
      setStatus(`박스 변경 저장됨 (${state.boxes.length}개) — 누끼까지 반영하려면 '이 사진 재누끼 및 OCR 다시 실행' 클릭`);
    } catch (err) {
      setStatus('박스 저장 오류: ' + err.message);
    }
  }

  function drawSplitCanvas() {
    const img = state.photoImage;
    if (!img) return;
    const maxW = 920;
    const scale = Math.min(1, maxW / img.width);
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    state.boxes.forEach((box, idx) => {
      const [x1, y1, x2, y2] = box.map((v) => v * scale);
      const isSel = idx === state.selectedBoxIdx;
      ctx.strokeStyle = isSel ? '#f4c430' : '#4ade80';
      ctx.lineWidth = isSel ? 3 : 2;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      ctx.fillStyle = isSel ? '#f4c430' : '#4ade80';
      ctx.fillRect(x1, Math.max(0, y1 - 22), 34, 22);
      ctx.fillStyle = '#09110d';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText('#' + (idx + 1), x1 + 6, Math.max(15, y1 - 6));

      // 우하단 리사이즈 핸들
      ctx.fillStyle = isSel ? '#f4c430' : '#ffffff';
      ctx.fillRect(x2 - 10, y2 - 10, 10, 10);
    });
  }

  function selectPhoto(photoId, focusBottleId) {
    state.selectedPhotoId = photoId;
    const ph = state.photos.find((p) => p.photoId === photoId);
    state.boxes = ph ? ph.boxes.map((b) => [...b]) : [];
    let selIdx = state.boxes.length > 0 ? 0 : -1;
    if (ph && focusBottleId) {
      const matchB = (ph.bottles || []).find((b) => b.bottleId === focusBottleId);
      if (matchB && Array.isArray(matchB.box)) {
        const bKey = JSON.stringify(matchB.box);
        const foundIdx = state.boxes.findIndex((bx) => JSON.stringify(bx) === bKey);
        if (foundIdx >= 0) selIdx = foundIdx;
      }
    }
    state.selectedBoxIdx = selIdx;
    renderPhotoSidebar();
    if (!ph) return;
    const img = new Image();
    img.onload = () => {
      state.photoImage = img;
      drawSplitCanvas();
    };
    img.src = `/api/photo/${encodeURIComponent(ph.photoId)}?t=${Date.now()}`;
  }

  function canvasToImageCoords(evt) {
    const rect = canvas.getBoundingClientRect();
    const img = state.photoImage;
    if (!img) return [0, 0];
    const scaleX = img.width / rect.width;
    const scaleY = img.height / rect.height;
    return [(evt.clientX - rect.left) * scaleX, (evt.clientY - rect.top) * scaleY];
  }

  canvas.addEventListener('mousedown', (evt) => {
    const [ix, iy] = canvasToImageCoords(evt);
    const img = state.photoImage;
    if (!img) return;
    const handleTol = Math.max(18, img.width * 0.02);

    for (let i = state.boxes.length - 1; i >= 0; i -= 1) {
      const [x1, y1, x2, y2] = state.boxes[i];
      if (Math.abs(ix - x2) <= handleTol && Math.abs(iy - y2) <= handleTol) {
        state.selectedBoxIdx = i;
        state.dragMode = 'resize';
        state.dragStart = { ix, iy, orig: [...state.boxes[i]] };
        drawSplitCanvas();
        return;
      }
      if (ix >= x1 && ix <= x2 && iy >= y1 && iy <= y2) {
        state.selectedBoxIdx = i;
        state.dragMode = 'move';
        state.dragStart = { ix, iy, orig: [...state.boxes[i]] };
        drawSplitCanvas();
        return;
      }
    }
  });

  window.addEventListener('mousemove', (evt) => {
    if (!state.dragMode || state.selectedBoxIdx < 0 || !state.photoImage) return;
    const [ix, iy] = canvasToImageCoords(evt);
    const dx = ix - state.dragStart.ix;
    const dy = iy - state.dragStart.iy;
    const [ox1, oy1, ox2, oy2] = state.dragStart.orig;
    const W = state.photoImage.width;
    const H = state.photoImage.height;

    if (state.dragMode === 'move') {
      const bw = ox2 - ox1;
      const bh = oy2 - oy1;
      const nx1 = Math.max(0, Math.min(W - bw, ox1 + dx));
      const ny1 = Math.max(0, Math.min(H - bh, oy1 + dy));
      state.boxes[state.selectedBoxIdx] = [Math.round(nx1), Math.round(ny1), Math.round(nx1 + bw), Math.round(ny1 + bh)];
      state.dragMoved = true;
    } else if (state.dragMode === 'resize') {
      const nx2 = Math.max(ox1 + 24, Math.min(W, ox2 + dx));
      const ny2 = Math.max(oy1 + 40, Math.min(H, oy2 + dy));
      state.boxes[state.selectedBoxIdx] = [ox1, oy1, Math.round(nx2), Math.round(ny2)];
      state.dragMoved = true;
    }
    drawSplitCanvas();
  });

  window.addEventListener('mouseup', () => {
    const moved = state.dragMoved;
    state.dragMode = null;
    state.dragStart = null;
    state.dragMoved = false;
    if (moved) syncBoxesToServer();
  });

  function deleteSelectedBox() {
    if (state.selectedBoxIdx < 0) return;
    state.boxes.splice(state.selectedBoxIdx, 1);
    state.selectedBoxIdx = state.boxes.length > 0 ? Math.min(state.selectedBoxIdx, state.boxes.length - 1) : -1;
    drawSplitCanvas();
    syncBoxesToServer();
  }

  document.getElementById('btnAddBox').addEventListener('click', () => {
    const img = state.photoImage;
    if (!img) return;
    const bw = Math.round(img.width * 0.16);
    const bh = Math.round(img.height * 0.65);
    const x1 = Math.round((img.width - bw) * 0.5);
    const y1 = Math.round((img.height - bh) * 0.5);
    state.boxes.push([x1, y1, x1 + bw, y1 + bh]);
    state.selectedBoxIdx = state.boxes.length - 1;
    drawSplitCanvas();
    syncBoxesToServer();
  });

  document.getElementById('btnDeleteBox').addEventListener('click', deleteSelectedBox);

  window.addEventListener('keydown', (evt) => {
    if (tabSplit.classList.contains('hidden')) return;
    const tag = (evt.target && evt.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (evt.key === 'Delete' || evt.key === 'Backspace') {
      if (state.selectedBoxIdx >= 0) {
        evt.preventDefault();
        deleteSelectedBox();
      }
    }
  });

  async function triggerRecut(mode) {
    if (!state.selectedPhotoId || state.isRecutting) return;
    state.isRecutting = true;
    const btnRecut = document.getElementById('btnRecutBoxes');
    const btnValley = document.getElementById('btnValleySplit');
    btnRecut.disabled = true;
    btnValley.disabled = true;
    setStatus('재분할 · 누끼 · OCR 실행 중...');
    try {
      const body = { photoId: state.selectedPhotoId, mode };
      if (mode === 'boxes') body.boxes = state.boxes;
      const updated = await apiJson('/api/recut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const idx = state.photos.findIndex((p) => p.photoId === updated.photoId);
      if (idx >= 0) state.photos[idx] = updated;
      state.unlabeledPlan = null;
      if (state.manualCutoutCtx && state.manualCutoutCtx.photoId === updated.photoId) {
        state.manualCutoutCtx.recutDone = true;
      }
      selectPhoto(updated.photoId);
      renderTab1ManualBanner();
      updateSummary();
      setStatus(`재컷팅 완료 (${updated.fileName}: ${updated.bottles.length}병)`);
    } catch (err) {
      setStatus('오류: ' + err.message);
    } finally {
      state.isRecutting = false;
      btnRecut.disabled = false;
      btnValley.disabled = false;
    }
  }

  document.getElementById('btnValleySplit').addEventListener('click', () => triggerRecut('valley'));
  document.getElementById('btnRecutBoxes').addEventListener('click', () => triggerRecut('boxes'));

  async function saveDecision(bottle, patch) {
    const updated = await apiJson('/api/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bottleId: bottle.bottleId, ...patch }),
    });
    Object.assign(bottle, updated);
    state.unlabeledPlan = null;
    updateSummary();
    renderBottleGrid();
  }

  function findWineColor(bottle) {
    const sel = state.wines.find((w) => w.groupKey === bottle.selectedGroupKey || w.wineId === bottle.selectedWineId);
    return sel ? sel.color : 'R';
  }

  function renderBottleGrid() {
    bottleGrid.replaceChildren();
    const visibleItems = [];
    for (const ph of state.photos) {
      for (const b of ph.bottles) {
        const topScore = (b.candidates && b.candidates[0]) ? Number(b.candidates[0].score || 0) : 0;
        if (state.decisionFilter === 'matched' && b.decision !== 'approved' && topScore < 50) continue;
        if (state.decisionFilter === 'matched_pending' && (topScore < 50 || b.decision === 'approved' || b.decision === 'excluded')) continue;
        if (state.decisionFilter === 'pending' && (b.decision === 'approved' || b.decision === 'excluded')) continue;
        if (state.decisionFilter === 'approved' && b.decision !== 'approved') continue;
        if (state.decisionFilter === 'excluded' && b.decision !== 'excluded') continue;
        if (state.hideExistingLabels && b.alreadyHasLabel) continue;
        visibleItems.push({ ph, b, topScore });
      }
    }

    let finalItems = visibleItems;
    if (state.bestPerWine && (state.decisionFilter === 'matched' || state.decisionFilter === 'matched_pending' || state.decisionFilter === 'approved')) {
      const bestByWine = new Map();
      const ungrouped = [];
      for (const entry of visibleItems) {
        const gKey = entry.b.selectedGroupKey;
        if (!gKey) {
          ungrouped.push(entry);
          continue;
        }
        const prev = bestByWine.get(gKey);
        const curRank = (entry.b.decision === 'approved' ? 1000 : 0) + entry.topScore + Math.min(20, (entry.b.cutoutBytes || 0) / 4096);
        const prevRank = prev ? ((prev.b.decision === 'approved' ? 1000 : 0) + prev.topScore + Math.min(20, (prev.b.cutoutBytes || 0) / 4096)) : -1;
        if (!prev || curRank > prevRank) {
          bestByWine.set(gKey, entry);
        }
      }
      finalItems = [...bestByWine.values(), ...ungrouped];
    }

    state.lastVisibleMatchItems = finalItems;

    if (finalItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'status-banner';
      empty.textContent = '현재 필터 조건에 해당하는 보틀이 없습니다. 상단 필터를 [전체 보기]로 변경해 확인해 보세요.';
      bottleGrid.appendChild(empty);
      return;
    }

    for (const { ph, b } of finalItems) {

        const card = document.createElement('div');
        card.className = 'card ' + (b.decision || 'pending');

        const preview = document.createElement('div');
        const color = findWineColor(b);
        let bgClass = 'bg-grad-' + color;
        if (state.bgMode === 'checker') bgClass = 'bg-checker';
        if (state.bgMode === 'light') bgClass = 'bg-light';
        preview.className = 'preview-box ' + bgClass;

        const img = document.createElement('img');
        img.src = b.cutoutDataUrl;
        img.alt = `${ph.fileName} #${b.bottleIndex}`;
        img.title = '클릭하여 크게 보기 (누끼 / 원본 라벨 전환)';
        img.addEventListener('click', () => openLightbox(ph, b));
        preview.appendChild(img);

        const col = document.createElement('div');
        col.className = 'meta-col';

        const header = document.createElement('div');
        header.className = 'small';
        const hasLblTag = b.alreadyHasLabel ? ' · [이미 라벨 있음]' : '';
        header.textContent = `${ph.fileName} · #${b.bottleIndex} · ${Math.round(b.cutoutBytes / 1024)}KB · ${b.ocr.engine} (${Math.round((b.ocr.avgConfidence || 0) * 100)}%)${hasLblTag}`;
        col.appendChild(header);

        const selWineMeta = state.wines.find((w) => w.groupKey === b.selectedGroupKey || w.wineId === b.selectedWineId);
        if (selWineMeta) {
          const selLine = document.createElement('div');
          selLine.className = 'small';
          selLine.style.color = 'var(--text)';
          selLine.style.fontWeight = '600';
          selLine.appendChild(document.createTextNode(`선택: [${selWineMeta.color}] `));
          selLine.appendChild(makeCopyableWineNameEl(selWineMeta.name));
          selLine.appendChild(document.createTextNode(` (${selWineMeta.vintage})`));
          col.appendChild(selLine);
        }

        const ocrBox = document.createElement('div');
        ocrBox.className = 'ocr-box';
        ocrBox.textContent = b.ocr.rawText || '(인식된 텍스트 없음)';
        col.appendChild(ocrBox);

        const candList = document.createElement('div');
        candList.className = 'cand-list';
        for (const c of (b.candidates || [])) {
          const cBtn = document.createElement('button');
          cBtn.type = 'button';
          cBtn.className = 'cand-btn' + (b.selectedGroupKey === c.groupKey ? ' chosen' : '');
          const nameSpan = document.createElement('span');
          const lblBadge = c.hasExistingLabel ? ' [라벨 있음]' : '';
          nameSpan.appendChild(document.createTextNode(`[${c.color}] `));
          nameSpan.appendChild(makeCopyableWineNameEl(c.name));
          nameSpan.appendChild(document.createTextNode(` (${c.vintage})${lblBadge}`));
          const scoreSpan = document.createElement('span');
          scoreSpan.textContent = `${c.score}점`;
          cBtn.appendChild(nameSpan);
          cBtn.appendChild(scoreSpan);
          cBtn.addEventListener('click', () => {
            saveDecision(b, {
              selectedWineId: c.wineId,
              selectedGroupKey: c.groupKey,
              decision: 'approved',
            });
          });
          candList.appendChild(cBtn);
        }
        col.appendChild(candList);

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = `전체 ${state.wines.length}종 wine_db 검색 (영문/한글/산지)...`;
        const wineSelect = document.createElement('select');
        const populateSelect = (query) => {
          wineSelect.replaceChildren();
          const blank = document.createElement('option');
          blank.value = '';
          const q = normalizeSearch(query).trim();
          const matchedWines = [];
          for (const w of state.wines) {
            const hay = normalizeSearch(`${w.name} ${w.producer || ''} ${w.vintage} ${w.country || ''} ${w.region || ''} ${w.subRegion || ''}`);
            if (q && !hay.includes(q)) continue;
            matchedWines.push(w);
          }
          blank.textContent = q
            ? `-- 와인 직접 선택 (검색 ${matchedWines.length} / 전체 ${state.wines.length}종) --`
            : `-- 와인 직접 선택 (전체 ${state.wines.length}종) --`;
          wineSelect.appendChild(blank);
          for (const w of matchedWines) {
            const opt = document.createElement('option');
            opt.value = w.groupKey;
            const lblTag = w.hasExistingLabel ? ' [라벨 있음]' : '';
            opt.textContent = `[${w.color}] ${w.name} (${w.vintage})${lblTag}`;
            if (w.groupKey === b.selectedGroupKey) opt.selected = true;
            wineSelect.appendChild(opt);
          }
        };
        populateSelect('');
        searchInput.addEventListener('input', () => populateSelect(searchInput.value));
        wineSelect.addEventListener('change', () => {
          const chosen = state.wines.find((w) => w.groupKey === wineSelect.value);
          if (!chosen) return;
          saveDecision(b, {
            selectedWineId: chosen.wineId,
            selectedGroupKey: chosen.groupKey,
            decision: 'approved',
          });
        });
        col.appendChild(searchInput);
        col.appendChild(wineSelect);

        const chkLabel = document.createElement('label');
        chkLabel.className = 'small';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = b.applyAllVintages !== false;
        chk.addEventListener('change', () => {
          saveDecision(b, { applyAllVintages: chk.checked });
        });
        chkLabel.appendChild(chk);
        chkLabel.appendChild(document.createTextNode(' 동일 와인(다른 빈티지 포함) 일괄 적용'));
        col.appendChild(chkLabel);

        const dRow = document.createElement('div');
        dRow.className = 'decision-row';
        const btnApp = document.createElement('button');
        btnApp.type = 'button';
        btnApp.className = b.decision === 'approved' ? 'primary' : '';
        btnApp.textContent = '확정';
        btnApp.addEventListener('click', () => saveDecision(b, { decision: 'approved' }));

        const btnHold = document.createElement('button');
        btnHold.type = 'button';
        btnHold.className = b.decision === 'hold' ? 'warn' : '';
        btnHold.textContent = '보류';
        btnHold.addEventListener('click', () => saveDecision(b, { decision: 'hold' }));

        const btnExc = document.createElement('button');
        btnExc.type = 'button';
        btnExc.className = b.decision === 'excluded' ? 'danger' : '';
        btnExc.textContent = '제외';
        btnExc.addEventListener('click', () => saveDecision(b, { decision: 'excluded' }));

        const btnTab1 = document.createElement('button');
        btnTab1.type = 'button';
        btnTab1.textContent = '✂️ 1단계 수동누끼';
        btnTab1.addEventListener('click', () => {
          jumpToTab1ManualCutout(ph.photoId, {
            bottleId: b.bottleId,
            returnTab: 'match',
            returnWineName: selWineMeta ? selWineMeta.name : null,
            returnWineColor: selWineMeta ? selWineMeta.color : null,
          });
        });

        dRow.appendChild(btnApp);
        dRow.appendChild(btnHold);
        dRow.appendChild(btnExc);
        dRow.appendChild(btnTab1);
        col.appendChild(dRow);

        card.appendChild(preview);
        card.appendChild(col);
        bottleGrid.appendChild(card);
    }
  }

  function renderDuplicatePicker() {
    dupGroups.replaceChildren();
    const groups = computeDuplicateGroups().filter(
      (g) => (!state.dupApprovedOnly || g.hasApproved) && (!state.dupHideResolved || !g.isResolved)
    );
    if (groups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'status-banner';
      empty.textContent = '남은 중복 와인이 없습니다. 상단 [approved_labels.json 내보내기]를 진행하세요.';
      dupGroups.appendChild(empty);
      return;
    }

    for (const grp of groups) {
      const wineMeta = state.wines.find((w) => w.groupKey === grp.groupKey);
      const wrap = document.createElement('div');
      wrap.className = 'dup-group';

      const head = document.createElement('div');
      head.className = 'dup-group-head';
      const title = document.createElement('span');
      const titleText = wineMeta
        ? `[${wineMeta.color}] ${wineMeta.name} (${wineMeta.vintage})`
        : grp.groupKey;
      if (wineMeta) {
        title.appendChild(document.createTextNode(`[${wineMeta.color}] `));
        title.appendChild(makeCopyableWineNameEl(wineMeta.name));
        title.appendChild(document.createTextNode(` (${wineMeta.vintage}) — 사진 ${grp.items.length}장 비교`));
      } else {
        title.textContent = `${titleText} — 사진 ${grp.items.length}장 비교`;
      }
      const headRight = document.createElement('div');
      headRight.style.display = 'flex';
      headRight.style.gap = '8px';
      headRight.style.alignItems = 'center';
      headRight.style.flexWrap = 'wrap';

      const badge = document.createElement('span');
      badge.className = 'small';
      const approvedCount = grp.items.filter((it) => it.b.decision === 'approved').length;
      if (grp.allExcluded) {
        badge.textContent = '모두 선택안함 (제외됨)';
      } else if (approvedCount >= 2) {
        badge.textContent = `중복 확정 ${approvedCount}장 — 1장을 클릭해 단독 대표로 고정하세요`;
      } else {
        badge.textContent = grp.hasApproved ? '대표 1장 확정됨 (다른 컷 클릭 시 교체)' : '아직 확정 없음 (클릭 시 1장만 대표 확정)';
      }

      const excludeAllBtn = document.createElement('button');
      excludeAllBtn.type = 'button';
      excludeAllBtn.className = 'danger';
      excludeAllBtn.textContent = '모두 선택안함 (중복에서 삭제)';
      excludeAllBtn.addEventListener('click', async () => {
        const ok = window.confirm(
          `${titleText}\n\n이 와인의 사진 ${grp.items.length}장을 전부 선택안함(제외) 처리하고 중복 목록에서 지울까요?`
        );
        if (!ok) return;
        try {
          await apiJson('/api/exclude-group', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupKey: grp.groupKey }),
          });
          for (const item of grp.items) {
            item.b.decision = 'excluded';
            item.b.duplicateOfBest = false;
            item.b.representativeConfirmed = false;
          }
          state.unlabeledPlan = null;
          updateSummary();
          renderDuplicatePicker();
          setStatus(`모두 선택안함 처리 완료 (목록에서 삭제됨): ${titleText}`);
        } catch (err) {
          setStatus('그룹 제외 오류: ' + err.message);
        }
      });

      headRight.appendChild(badge);
      headRight.appendChild(excludeAllBtn);
      head.appendChild(title);
      head.appendChild(headRight);
      wrap.appendChild(head);

      const strip = document.createElement('div');
      strip.className = 'dup-strip';
      for (const { ph, b } of grp.items) {
        const dCard = document.createElement('div');
        const isChosen = b.decision === 'approved';
        dCard.className = 'dup-card' + (isChosen ? ' chosen' : '');

        const pBox = document.createElement('div');
        const color = wineMeta ? wineMeta.color : findWineColor(b);
        let bgClass = 'bg-grad-' + color;
        if (state.bgMode === 'checker') bgClass = 'bg-checker';
        if (state.bgMode === 'light') bgClass = 'bg-light';
        pBox.className = 'preview-box ' + bgClass;
        const pImg = document.createElement('img');
        pImg.src = b.cutoutDataUrl;
        pImg.alt = `${ph.fileName} #${b.bottleIndex}`;
        pImg.title = '클릭하여 크게 보기 (누끼 / 원본 라벨 전환)';
        pImg.addEventListener('click', () => openLightbox(ph, b));
        pBox.appendChild(pImg);
        dCard.appendChild(pBox);

        const info = document.createElement('div');
        info.className = 'small';
        const topSc = (b.candidates && b.candidates[0]) ? `${b.candidates[0].score}점` : '-';
        info.textContent = `${ph.fileName} #${b.bottleIndex} · ${topSc} · ${Math.round((b.cutoutBytes || 0) / 1024)}KB`;
        dCard.appendChild(info);

        const pickBtn = document.createElement('button');
        pickBtn.type = 'button';
        pickBtn.className = isChosen ? 'primary' : '';
        if (isChosen && grp.isResolved && approvedCount === 1) {
          pickBtn.textContent = '★ 단독 대표 확정됨 (재고정 가능)';
          pickBtn.disabled = false;
        } else if (isChosen && approvedCount >= 2) {
          pickBtn.textContent = '이 컷만 단독 대표로 선택';
          pickBtn.disabled = false;
        } else {
          pickBtn.textContent = isChosen ? '이 컷으로 단독 대표 확정' : '이 사진으로 대표 선택';
          pickBtn.disabled = false;
        }
        pickBtn.addEventListener('click', async () => {
          const ok = window.confirm(
            `${titleText}\n\n[${ph.fileName} #${b.bottleIndex}] 컷을 단독 대표로 확정할까요?\n(나머지 ${grp.items.length - 1}개 중복은 자동 제외되고 3단계 목록에서 숨겨집니다.)`
          );
          if (!ok) return;
          try {
            await apiJson('/api/select-representative', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ groupKey: grp.groupKey, bottleId: b.bottleId }),
            });
            for (const item of grp.items) {
              if (item.b.bottleId === b.bottleId) {
                item.b.decision = 'approved';
                item.b.duplicateOfBest = false;
                item.b.representativeConfirmed = true;
              } else {
                item.b.decision = 'excluded';
                item.b.duplicateOfBest = true;
                item.b.representativeConfirmed = false;
              }
            }
            state.unlabeledPlan = null;
            updateSummary();
            renderDuplicatePicker();
            setStatus(`단독 대표 확정 완료 (목록에서 정리됨): ${titleText} ← ${ph.fileName} #${b.bottleIndex}`);
          } catch (err) {
            setStatus('대표 변경 오류: ' + err.message);
          }
        });
        dCard.appendChild(pickBtn);
        strip.appendChild(dCard);
      }
      wrap.appendChild(strip);
      dupGroups.appendChild(wrap);
    }
  }

  document.getElementById('btnBulkApprove').addEventListener('click', async () => {
    const targets = state.lastVisibleMatchItems.filter(
      (it) => it.b.decision !== 'approved' && it.b.decision !== 'excluded' && (it.b.selectedWineId || it.b.selectedGroupKey)
    );
    if (targets.length === 0) {
      setStatus('현재 화면에 일괄 확정할 미결정 보틀이 없습니다.');
      return;
    }
    const ok = window.confirm(
      `현재 화면의 미결정 보틀 ${targets.length}개를 일괄 확정할까요?\n(이미 확정한 항목은 그대로 유지됩니다.)`
    );
    if (!ok) return;
    try {
      const res = await apiJson('/api/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bottleIds: targets.map((it) => it.b.bottleId) }),
      });
      const updatedSet = new Set(res.updatedIds || []);
      for (const ph of state.photos) {
        for (const b of ph.bottles) {
          if (updatedSet.has(b.bottleId)) {
            b.decision = 'approved';
            b.duplicateOfBest = false;
          }
        }
      }
      state.unlabeledPlan = null;
      updateSummary();
      renderBottleGrid();
      setStatus(`일괄 확정 완료: ${res.approvedCount}개 보틀 확정됨 (기존 확정 유지)`);
    } catch (err) {
      setStatus('일괄 확정 오류: ' + err.message);
    }
  });

  document.getElementById('btnSaveSession').addEventListener('click', async () => {
    try {
      if (state.selectedPhotoId) {
        await syncBoxesToServer();
      }
      const res = await apiJson('/api/save', { method: 'POST', body: '{}' });
      setStatus(`세션 저장 완료: ${res.path}`);
    } catch (err) {
      setStatus('저장 오류: ' + err.message);
    }
  });

  document.getElementById('btnExportLabels').addEventListener('click', async () => {
    try {
      const res = await apiJson('/api/export', { method: 'POST', body: '{}' });
      setStatus(`내보내기 완료 (${res.count}개 항목): ${res.outPath}`);
    } catch (err) {
      setStatus('내보내기 오류: ' + err.message);
    }
  });

  async function init() {
    const data = await apiJson('/api/state');
    state.photos = data.photos || [];
    state.wines = data.wines || [];
    state.defaultTab = data.defaultTab || null;
    state.unlabeledSummary = data.unlabeledSummary || null;
    updateSummary();
    if (state.photos.length > 0) {
      selectPhoto(state.photos[0].photoId);
    } else {
      renderPhotoSidebar();
    }
    const parts = [`준비 완료 (OCR 모드: ${data.ocrMode})`];
    if (data.prefilterSummary) {
      const pf = data.prefilterSummary;
      parts.push(`사전선별 ${pf.kept}/${pf.totalScanned}장`);
    }
    if (data.batchInfo) {
      const bi = data.batchInfo;
      parts.push(`배치 ${bi.batchIndex}/${bi.totalBatches} (${bi.sliceStart}~${bi.sliceEnd}번)`);
    }
    if (state.unlabeledSummary) {
      const us = state.unlabeledSummary;
      parts.push(`라벨 없는 와인 ${us.totalUnlabeled}종 (보유 ${us.inStockUnlabeled}종)`);
    }
    setStatus(parts.join(' · '));
    const totalBottles = state.photos.reduce((acc, ph) => acc + (ph.bottles || []).length, 0);
    if (state.defaultTab === 'unlabeled') {
      switchTab('unlabeled');
    } else if (totalBottles > 0) {
      switchTab('match');
    }
  }

  // -------------------------------------------------------------------------
  // Tab 4: Unlabeled Wine Reverse Matching + Gallery + Paste/Drop + Tab1 Jump
  // -------------------------------------------------------------------------

  function getFilteredUnlabeledWines(wines) {
    const q = normalizeSearch(state.unlabeledSearchQuery).trim();
    return (wines || []).filter((w) => {
      if (state.unlabeledInStockOnly && (w.inStockCount || 0) <= 0) return false;
      if (state.unlabeledOnlyPending && w.assignment) return false;
      if (q) {
        const hay = normalizeSearch(`${w.name} ${w.producer || ''} ${w.vintage} ${w.country || ''} ${w.region || ''} ${w.subRegion || ''}`);
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  async function loadUnlabeledPlan(preserveStatus, autoFocusNextPending) {
    if (!preserveStatus) setStatus('라벨 없는 와인 & 기존 누끼 매칭 목록을 계산 중...');
    try {
      const plan = await apiJson('/api/unlabeled-plan');
      state.unlabeledPlan = plan;
      if (autoFocusNextPending) {
        const filteredNow = getFilteredUnlabeledWines(plan.wines || []);
        const nextPending = filteredNow.find((w) => !w.assignment);
        state.activeUnlabeledGroupKey = nextPending ? nextPending.groupKey : null;
      }
      updateSummary();
      renderUnlabeledList();
      if (!galleryModalEl.classList.contains('hidden') && state.galleryTargetWine) {
        const refreshed = (plan.wines || []).find((w) => w.groupKey === state.galleryTargetWine.groupKey);
        if (refreshed) state.galleryTargetWine = refreshed;
        renderGalleryGrid();
      }
      if (!preserveStatus && plan.poolMeta) {
        const pm = plan.poolMeta;
        setStatus(`라벨 없는 와인 ${(plan.wines || []).length}종 · 기존 누끼 풀 ${pm.totalCutouts}장 (미사용 ${pm.unusedCutouts}장)`);
      }
    } catch (err) {
      setStatus('라벨 없는 와인 목록 로드 오류: ' + err.message);
    }
  }

  async function assignUnlabeled(groupKey, payload) {
    const body = { groupKey, ...(payload || {}) };
    if (body.applyAllVintages === undefined && state.unlabeledApplyAllMap[groupKey] !== undefined) {
      body.applyAllVintages = state.unlabeledApplyAllMap[groupKey];
    }
    const res = await apiJson('/api/unlabeled-assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const movedToBottom = Boolean(res.assignment && (body.source === 'cutout' || body.source === 'upload'));
    await loadUnlabeledPlan(true, movedToBottom);
    setStatus(
      res.assignment
        ? `라벨 배정 완료 (목록 아래로 이동됨): ${res.assignment.fileName || '라벨 이미지'}`
        : '라벨 배정이 취소되었습니다.'
    );
    return res;
  }

  function uploadFileToUnlabeled(groupKey, file) {
    if (!file) return;
    if (file.type && !file.type.startsWith('image/')) {
      setStatus('이미지 파일만 등록할 수 있습니다.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setStatus(`이미지 최적화 및 등록 중... (${file.name || 'clipboard'})`);
        await assignUnlabeled(groupKey, {
          source: 'upload',
          imageDataUrl: String(reader.result || ''),
          fileName: file.name || 'pasted_label.png',
        });
      } catch (err) {
        setStatus('이미지 업로드 오류: ' + err.message);
      }
    };
    reader.readAsDataURL(file);
  }

  function makeWineBgClass(color) {
    if (state.bgMode === 'checker') return 'bg-checker';
    if (state.bgMode === 'light') return 'bg-light';
    return 'bg-grad-' + (color || 'R');
  }

  function renderUnlabeledList() {
    unlabeledWineList.replaceChildren();
    const plan = state.unlabeledPlan;
    if (!plan) return;
    const wines = plan.wines || [];
    const pm = plan.poolMeta || { totalCutouts: 0, unusedCutouts: 0, backfillCandidateBoxes: 0 };
    const backfillTxt = pm.backfillCandidateBoxes > 0
      ? ` · 추후 <50점 보충 가능 박스 ${pm.backfillCandidateBoxes}개`
      : '';
    unlabeledPoolStats.textContent = `누끼 풀 총 ${pm.totalCutouts}장 (미사용 ${pm.unusedCutouts}장)${backfillTxt}`;

    const filtered = getFilteredUnlabeledWines(wines);

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'status-banner';
      empty.textContent = '현재 필터 조건에 해당하는 라벨 없는 와인이 없습니다.';
      unlabeledWineList.appendChild(empty);
      return;
    }

    const pendingWines = filtered.filter((w) => !w.assignment);
    const assignedWines = filtered
      .filter((w) => Boolean(w.assignment))
      .sort((a, b) => {
        const ta = String((a.assignment && a.assignment.updatedAt) || '');
        const tb = String((b.assignment && b.assignment.updatedAt) || '');
        return ta.localeCompare(tb);
      });
    const orderedWines = [...pendingWines, ...assignedWines];
    let assignedDividerAdded = false;

    const poolMap = new Map((plan.pool || []).map((p) => [p.bottleId, p]));

    for (const w of orderedWines) {
      if (w.assignment && pendingWines.length > 0 && !assignedDividerAdded) {
        assignedDividerAdded = true;
        const divider = document.createElement('div');
        divider.className = 'status-banner';
        divider.style.marginBottom = '0';
        divider.style.borderColor = 'var(--accent)';
        divider.style.color = 'var(--text)';
        divider.textContent = `✅ 배정 완료 ${assignedWines.length}종 (입력한 순서대로 아래로 이동 · 위쪽 미배정 와인을 이어서 등록하세요)`;
        unlabeledWineList.appendChild(divider);
      }
      const card = document.createElement('div');
      card.className = 'unlabeled-card' + (w.assignment ? ' assigned' : '') + (state.activeUnlabeledGroupKey === w.groupKey ? ' paste-active' : '');
      const activateCard = () => {
        state.activeUnlabeledGroupKey = w.groupKey;
        document.querySelectorAll('.unlabeled-card.paste-active').forEach((el) => el.classList.remove('paste-active'));
        card.classList.add('paste-active');
      };
      card.addEventListener('click', (evt) => {
        if (evt.target.closest('button, input, select, label, .copyable-wine-name')) return;
        activateCard();
      });

      const left = document.createElement('div');
      left.className = 'unlabeled-left';

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.className = 'hidden';
      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files[0]) {
          uploadFileToUnlabeled(w.groupKey, fileInput.files[0]);
          fileInput.value = '';
        }
      });
      left.appendChild(fileInput);

      const assign = w.assignment;
      if (assign) {
        const pBox = document.createElement('div');
        pBox.className = 'preview-box ' + makeWineBgClass(w.color);
        const pImg = document.createElement('img');
        const imgUrl = assign.source === 'cutout' && assign.bottleId
          ? `/api/cutout/${encodeURIComponent(assign.bottleId)}?t=${encodeURIComponent(assign.updatedAt || '')}`
          : `/api/manual-label/${encodeURIComponent(w.groupKey)}?t=${encodeURIComponent(assign.updatedAt || '')}`;
        pImg.src = imgUrl;
        pImg.alt = w.name;
        pImg.title = '클릭하여 크게 보기';
        pImg.addEventListener('click', () => {
          if (assign.source === 'cutout' && assign.bottleId) {
            const pItem = poolMap.get(assign.bottleId) || { bottleId: assign.bottleId, photoId: assign.photoId, fileName: assign.fileName, bottleIndex: 1 };
            openLightbox(
              { photoId: pItem.photoId, fileName: pItem.fileName || assign.fileName || w.name },
              { ...pItem, candidates: [] },
              { color: w.color, returnTab: 'unlabeled', groupKey: w.groupKey, wineLabel: `[${w.color}] ${w.name}`, wineName: w.name }
            );
          } else {
            openManualLabelLightbox(`[${w.color}] ${w.name} (${w.vintage})`, imgUrl, w.color, w.name);
          }
        });
        pBox.appendChild(pImg);
        left.appendChild(pBox);

        const srcBadge = document.createElement('div');
        srcBadge.className = 'small';
        srcBadge.textContent = assign.source === 'cutout'
          ? `✅ 기존 누끼: ${assign.fileName || assign.bottleId}`
          : `✅ 직접 등록: ${assign.fileName || '업로드 이미지'}`;
        left.appendChild(srcBadge);

        const actionRow = document.createElement('div');
        actionRow.style.display = 'flex';
        actionRow.style.gap = '6px';
        actionRow.style.flexWrap = 'wrap';

        const replaceBtn = document.createElement('button');
        replaceBtn.type = 'button';
        replaceBtn.textContent = '파일 교체';
        replaceBtn.addEventListener('click', () => fileInput.click());
        actionRow.appendChild(replaceBtn);

        if (assign.source === 'cutout' && assign.photoId) {
          const tab1Btn = document.createElement('button');
          tab1Btn.type = 'button';
          tab1Btn.textContent = '✂️ 1단계 수동누끼';
          tab1Btn.addEventListener('click', () => {
            jumpToTab1ManualCutout(assign.photoId, {
              bottleId: assign.bottleId,
              returnTab: 'unlabeled',
              returnGroupKey: w.groupKey,
              returnWineLabel: `[${w.color}] ${w.name}`,
            });
          });
          actionRow.appendChild(tab1Btn);
        }

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'danger';
        clearBtn.textContent = '배정 취소';
        clearBtn.addEventListener('click', () => assignUnlabeled(w.groupKey, { source: 'clear' }));
        actionRow.appendChild(clearBtn);
        left.appendChild(actionRow);
      } else {
        const dz = document.createElement('div');
        dz.className = 'dropzone-box';
        const dzTitle = document.createElement('strong');
        dzTitle.textContent = '직접 이미지 등록';
        const dzSub = document.createElement('div');
        dzSub.textContent = '여기로 이미지 드래그 또는 클릭해 선택 / 카드 선택 후 Cmd+V';
        dz.appendChild(dzTitle);
        dz.appendChild(dzSub);
        dz.addEventListener('click', () => fileInput.click());
        dz.addEventListener('dragover', (evt) => {
          evt.preventDefault();
          dz.classList.add('dragover');
        });
        dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
        dz.addEventListener('drop', (evt) => {
          evt.preventDefault();
          dz.classList.remove('dragover');
          const file = evt.dataTransfer && evt.dataTransfer.files && evt.dataTransfer.files[0];
          if (file) uploadFileToUnlabeled(w.groupKey, file);
        });
        left.appendChild(dz);

        const quickBtns = document.createElement('div');
        quickBtns.style.display = 'flex';
        quickBtns.style.gap = '6px';
        quickBtns.style.flexWrap = 'wrap';

        const pickFileBtn = document.createElement('button');
        pickFileBtn.type = 'button';
        pickFileBtn.textContent = '📁 파일 선택';
        pickFileBtn.addEventListener('click', () => fileInput.click());
        quickBtns.appendChild(pickFileBtn);

        const pasteBtn = document.createElement('button');
        pasteBtn.type = 'button';
        pasteBtn.textContent = '📋 붙여넣기';
        pasteBtn.addEventListener('click', async () => {
          state.activeUnlabeledGroupKey = w.groupKey;
          if (navigator.clipboard && navigator.clipboard.read) {
            try {
              const items = await navigator.clipboard.read();
              for (const item of items) {
                const imgType = item.types.find((t) => t.startsWith('image/'));
                if (imgType) {
                  const blob = await item.getType(imgType);
                  uploadFileToUnlabeled(w.groupKey, new File([blob], 'clipboard_label.png', { type: imgType }));
                  return;
                }
              }
              setStatus('클립보드에 이미지가 없습니다. 이미지 복사 후 다시 시도하거나 Cmd+V를 눌러주세요.');
              return;
            } catch (_err) {
              // 브라우저 권한 미허용 시 Cmd+V 안내
            }
          }
          renderUnlabeledList();
          setStatus(`"${w.name}" 카드가 선택되었습니다. 이제 Cmd+V (또는 Ctrl+V)를 눌러 복사한 이미지를 붙여넣으세요.`);
        });
        quickBtns.appendChild(pasteBtn);
        left.appendChild(quickBtns);
      }

      const applyAllVal = assign
        ? assign.applyAllVintages !== false
        : (state.unlabeledApplyAllMap[w.groupKey] !== false);
      const chkLabel = document.createElement('label');
      chkLabel.className = 'small';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = applyAllVal;
      chk.addEventListener('change', async () => {
        state.unlabeledApplyAllMap[w.groupKey] = chk.checked;
        if (w.assignment) {
          try {
            await assignUnlabeled(w.groupKey, { source: 'update', applyAllVintages: chk.checked });
          } catch (err) {
            setStatus('옵션 변경 오류: ' + err.message);
          }
        }
      });
      chkLabel.appendChild(chk);
      chkLabel.appendChild(document.createTextNode(' 다른 빈티지 일괄 적용'));
      left.appendChild(chkLabel);

      const right = document.createElement('div');
      right.className = 'unlabeled-right';

      const head = document.createElement('div');
      head.className = 'unlabeled-head';
      const titleWrap = document.createElement('div');
      const titleEl = document.createElement('div');
      titleEl.style.fontWeight = '700';
      titleEl.style.fontSize = '15px';
      titleEl.appendChild(document.createTextNode(`[${w.color}] `));
      titleEl.appendChild(makeCopyableWineNameEl(w.name, activateCard));
      titleEl.appendChild(document.createTextNode(` (${w.vintage})`));
      const metaEl = document.createElement('div');
      metaEl.className = 'small';
      const originParts = [w.country, w.region, w.subRegion].filter(Boolean).join(' / ');
      const stockTxt = (w.inStockCount || 0) > 0 ? `보유 ${w.inStockCount}병` : '소비완료';
      metaEl.textContent = `${stockTxt}${w.producer ? ' · ' + w.producer : ''}${originParts ? ' · ' + originParts : ''}`;
      titleWrap.appendChild(titleEl);
      titleWrap.appendChild(metaEl);

      const galleryBtn = document.createElement('button');
      galleryBtn.type = 'button';
      galleryBtn.textContent = `전체 누끼에서 고르기 (${pm.totalCutouts}장)`;
      galleryBtn.addEventListener('click', () => openGalleryModal(w));

      head.appendChild(titleWrap);
      head.appendChild(galleryBtn);
      right.appendChild(head);

      const recs = state.unlabeledIncludeUsed
        ? (w.recommendationsAll || [])
        : (w.recommendationsUnused || []);

      if (recs.length === 0) {
        const noRec = document.createElement('div');
        noRec.className = 'status-banner';
        noRec.style.marginBottom = '0';
        noRec.textContent = '자동 추천 누끼 후보가 없습니다. [전체 누끼에서 고르기] 또는 왼쪽에서 이미지를 직접 붙여넣어 주세요.';
        right.appendChild(noRec);
      } else {
        const recStrip = document.createElement('div');
        recStrip.className = 'rec-strip';
        for (const rec of recs) {
          const isChosen = assign && assign.source === 'cutout' && assign.bottleId === rec.bottleId;
          const rCard = document.createElement('div');
          rCard.className = 'rec-card' + (isChosen ? ' chosen' : '');

          const rBox = document.createElement('div');
          rBox.className = 'preview-box ' + makeWineBgClass(w.color);
          const rImg = document.createElement('img');
          rImg.loading = 'lazy';
          rImg.src = `/api/cutout/${encodeURIComponent(rec.bottleId)}`;
          rImg.alt = `${rec.fileName} #${rec.bottleIndex}`;
          rImg.title = '클릭하여 크게 보기 (원본 라벨 크롭 전환 가능)';
          rImg.addEventListener('click', () => {
            openLightbox(
              { photoId: rec.photoId, fileName: rec.fileName },
              { ...rec, candidates: [] },
              { color: w.color, returnTab: 'unlabeled', groupKey: w.groupKey, wineLabel: `[${w.color}] ${w.name}`, wineName: w.name }
            );
          });
          rBox.appendChild(rImg);
          rCard.appendChild(rBox);

          const rMeta = document.createElement('div');
          rMeta.className = 'small';
          const usedTag = rec.isUsedByOther ? ' · [사용중]' : '';
          rMeta.textContent = `${rec.fileName} #${rec.bottleIndex} · ${rec.score}점${usedTag}`;
          rCard.appendChild(rMeta);

          const rOcr = document.createElement('div');
          rOcr.className = 'mini-ocr';
          rOcr.title = rec.ocrRawText || '';
          rOcr.textContent = (rec.ocrRawText || '(OCR 없음)').split('\\n').join(' ');
          rCard.appendChild(rOcr);

          const pickBtn = document.createElement('button');
          pickBtn.type = 'button';
          pickBtn.className = isChosen ? 'primary' : '';
          pickBtn.textContent = isChosen ? '✓ 배정됨' : '이 누끼 확정';
          pickBtn.addEventListener('click', () => {
            assignUnlabeled(w.groupKey, { source: 'cutout', bottleId: rec.bottleId });
          });
          rCard.appendChild(pickBtn);

          if (rec.hasOriginalPhoto && rec.photoId) {
            const manBtn = document.createElement('button');
            manBtn.type = 'button';
            manBtn.textContent = '✂️ 1단계 수동누끼';
            manBtn.addEventListener('click', () => {
              jumpToTab1ManualCutout(rec.photoId, {
                bottleId: rec.bottleId,
                returnTab: 'unlabeled',
                returnGroupKey: w.groupKey,
                returnWineLabel: `[${w.color}] ${w.name}`,
              });
            });
            rCard.appendChild(manBtn);
          }
          recStrip.appendChild(rCard);
        }
        right.appendChild(recStrip);
      }

      card.appendChild(left);
      card.appendChild(right);
      unlabeledWineList.appendChild(card);
    }
  }

  function openGalleryModal(wine) {
    state.galleryTargetWine = wine;
    state.gallerySearchQuery = '';
    state.galleryPage = 1;
    gallerySearchInput.value = '';
    galleryModalTitle.replaceChildren();
    galleryModalTitle.appendChild(document.createTextNode(`전체 누끼에서 고르기 → [${wine.color}] `));
    galleryModalTitle.appendChild(makeCopyableWineNameEl(wine.name));
    galleryModalTitle.appendChild(document.createTextNode(` (${wine.vintage})`));
    galleryModalEl.classList.remove('hidden');
    renderGalleryGrid();
  }

  function scorePoolItemForTarget(wine, poolItem, recScoreMap) {
    if (recScoreMap.has(poolItem.bottleId)) return recScoreMap.get(poolItem.bottleId);
    const hay = normalizeSearch(`${poolItem.ocrRawText || ''} ${poolItem.fileName || ''}`);
    const words = normalizeSearch(`${wine.name} ${wine.producer || ''}`).split(/\\s+/).filter((t) => t.length >= 3);
    let hits = 0;
    for (const tok of words) {
      if (hay.includes(tok)) hits += 1;
    }
    return hits > 0 ? Math.min(45, hits * 12) : 0;
  }

  function renderGalleryGrid() {
    galleryGrid.replaceChildren();
    const plan = state.unlabeledPlan;
    const target = state.galleryTargetWine;
    if (!plan || !target) return;

    const recScoreMap = new Map();
    for (const r of (target.recommendationsAll || [])) {
      recScoreMap.set(r.bottleId, Number(r.score || 0));
    }

    const q = normalizeSearch(state.gallerySearchQuery).trim();
    const items = [];
    for (const p of (plan.pool || [])) {
      const usedByOther = Boolean(p.usedByGroupKey && p.usedByGroupKey !== target.groupKey);
      if (state.galleryUnusedOnly && usedByOther) continue;
      if (q) {
        const hay = normalizeSearch(`${p.fileName} ${p.ocrRawText || ''} ${p.bottleId}`);
        if (!hay.includes(q)) continue;
      }
      const sc = scorePoolItemForTarget(target, p, recScoreMap);
      items.push({ ...p, clientScore: sc, usedByOther });
    }

    if (state.gallerySort === 'score') {
      items.sort((a, b) => (b.clientScore - a.clientScore) || Number(a.usedByOther) - Number(b.usedByOther) || (b.cutoutBytes - a.cutoutBytes));
    } else if (state.gallerySort === 'bytes') {
      items.sort((a, b) => (b.cutoutBytes - a.cutoutBytes) || a.fileName.localeCompare(b.fileName));
    } else {
      items.sort((a, b) => a.fileName.localeCompare(b.fileName) || (a.bottleIndex - b.bottleIndex));
    }

    const pageSize = 48;
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    state.galleryPage = Math.max(1, Math.min(totalPages, state.galleryPage));
    const start = (state.galleryPage - 1) * pageSize;
    const slice = items.slice(start, start + pageSize);

    galleryCountInfo.textContent = `표시 ${items.length}장 / 전체 ${(plan.pool || []).length}장`;
    galleryPageInfo.textContent = `${state.galleryPage} / ${totalPages}`;
    galleryPrevBtn.disabled = state.galleryPage <= 1;
    galleryNextBtn.disabled = state.galleryPage >= totalPages;

    if (slice.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'status-banner';
      empty.textContent = '검색 조건에 맞는 누끼가 없습니다. [미사용 누끼만 보기]를 끄거나 검색어를 지워 보세요.';
      galleryGrid.appendChild(empty);
      return;
    }

    for (const item of slice) {
      const tile = document.createElement('div');
      tile.className = 'gallery-tile' + (item.usedByOther ? ' used' : '');

      const pBox = document.createElement('div');
      pBox.className = 'preview-box ' + makeWineBgClass(target.color);
      const pImg = document.createElement('img');
      pImg.loading = 'lazy';
      pImg.src = `/api/cutout/${encodeURIComponent(item.bottleId)}`;
      pImg.alt = `${item.fileName} #${item.bottleIndex}`;
      pImg.title = '클릭하여 크게 보기';
      pImg.addEventListener('click', () => {
        openLightbox(
          { photoId: item.photoId, fileName: item.fileName },
          { ...item, score: item.clientScore > 0 ? item.clientScore : undefined, candidates: [] },
          { color: target.color, returnTab: 'unlabeled', groupKey: target.groupKey, wineLabel: `[${target.color}] ${target.name}`, wineName: target.name }
        );
      });
      pBox.appendChild(pImg);
      tile.appendChild(pBox);

      const meta = document.createElement('div');
      meta.className = 'small';
      const scTxt = item.clientScore > 0 ? ` · ${item.clientScore}점` : '';
      const usedTxt = item.usedByOther ? ' · [사용중]' : '';
      meta.textContent = `${item.fileName} #${item.bottleIndex}${scTxt}${usedTxt}`;
      tile.appendChild(meta);

      const ocrLine = document.createElement('div');
      ocrLine.className = 'mini-ocr';
      ocrLine.title = item.ocrRawText || '';
      ocrLine.textContent = (item.ocrRawText || '(OCR 없음)').split('\\n').join(' ');
      tile.appendChild(ocrLine);

      const chooseBtn = document.createElement('button');
      chooseBtn.type = 'button';
      chooseBtn.className = 'primary';
      chooseBtn.textContent = '이 누끼 선택';
      chooseBtn.addEventListener('click', async () => {
        const gKey = target.groupKey;
        closeGalleryModal();
        await assignUnlabeled(gKey, { source: 'cutout', bottleId: item.bottleId });
      });
      tile.appendChild(chooseBtn);

      if (item.hasOriginalPhoto && item.photoId) {
        const manBtn = document.createElement('button');
        manBtn.type = 'button';
        manBtn.textContent = '✂️ 1단계 수동누끼';
        manBtn.addEventListener('click', () => {
          const gKey = target.groupKey;
          const wLabel = `[${target.color}] ${target.name}`;
          closeGalleryModal();
          jumpToTab1ManualCutout(item.photoId, {
            bottleId: item.bottleId,
            returnTab: 'unlabeled',
            returnGroupKey: gKey,
            returnWineLabel: wLabel,
          });
        });
        tile.appendChild(manBtn);
      }

      galleryGrid.appendChild(tile);
    }
  }

  document.getElementById('unlabeledInStockOnlyChk').addEventListener('change', (e) => {
    state.unlabeledInStockOnly = Boolean(e.target.checked);
    renderUnlabeledList();
  });
  document.getElementById('unlabeledOnlyPendingChk').addEventListener('change', (e) => {
    state.unlabeledOnlyPending = Boolean(e.target.checked);
    renderUnlabeledList();
  });
  document.getElementById('unlabeledIncludeUsedChk').addEventListener('change', (e) => {
    state.unlabeledIncludeUsed = Boolean(e.target.checked);
    renderUnlabeledList();
  });
  document.getElementById('unlabeledSearchInput').addEventListener('input', (e) => {
    state.unlabeledSearchQuery = e.target.value;
    renderUnlabeledList();
  });

  gallerySearchInput.addEventListener('input', () => {
    state.gallerySearchQuery = gallerySearchInput.value;
    state.galleryPage = 1;
    renderGalleryGrid();
  });
  galleryUnusedOnlyChk.addEventListener('change', () => {
    state.galleryUnusedOnly = Boolean(galleryUnusedOnlyChk.checked);
    state.galleryPage = 1;
    renderGalleryGrid();
  });
  gallerySortSelect.addEventListener('change', () => {
    state.gallerySort = gallerySortSelect.value;
    state.galleryPage = 1;
    renderGalleryGrid();
  });
  galleryPrevBtn.addEventListener('click', () => {
    if (state.galleryPage > 1) {
      state.galleryPage -= 1;
      renderGalleryGrid();
    }
  });
  galleryNextBtn.addEventListener('click', () => {
    state.galleryPage += 1;
    renderGalleryGrid();
  });

  btnExportUnlabeled.addEventListener('click', async () => {
    try {
      const res = await apiJson('/api/export-unlabeled', { method: 'POST', body: '{}' });
      setStatus(`라벨 없는 와인 매칭분 내보내기 완료 (${res.count}종): ${res.outPath}`);
    } catch (err) {
      setStatus('내보내기 오류: ' + err.message);
    }
  });

  window.addEventListener('paste', (evt) => {
    if (tabUnlabeled.classList.contains('hidden')) return;
    if (!galleryModalEl.classList.contains('hidden')) return;
    if (!lightboxEl.classList.contains('hidden')) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const gKey = state.activeUnlabeledGroupKey;
    if (!gKey) return;
    const items = evt.clipboardData && evt.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (file) {
          evt.preventDefault();
          uploadFileToUnlabeled(gKey, file);
        }
        break;
      }
    }
  });

  init().catch((err) => setStatus('초기화 실패: ' + err.message));
})();
</script>
</body>
</html>
"""


def create_review_server(
    pipeline: CutoutPipeline,
    out_path: Path,
    port: int = 8765,
) -> ThreadingHTTPServer:
    """127.0.0.1 루프백 전용 로컬 2-탭 리뷰 HTTP 서버를 생성합니다."""

    class ReviewHandler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            return

        def _send_json(self, status: int, payload: Dict[str, Any]) -> None:
            raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)

        def _send_bytes(self, status: int, content_type: str, data: bytes) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _read_json_body(self) -> Dict[str, Any]:
            length = int(self.headers.get("Content-Length", "0") or 0)
            raw = self.rfile.read(length) if length > 0 else b"{}"
            parsed = json.loads(raw.decode("utf-8") or "{}")
            return parsed if isinstance(parsed, dict) else {}

        def do_GET(self) -> None:  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            if path == "/" or path == "/index.html":
                self._send_bytes(200, "text/html; charset=utf-8", REVIEW_HTML_TEMPLATE.encode("utf-8"))
                return

            if path == "/api/state":
                self._send_json(200, pipeline.get_public_state())
                return

            if path.startswith("/api/photo/"):
                photo_id = urllib.parse.unquote(path[len("/api/photo/") :])
                ph = pipeline._photo_map.get(photo_id)
                if not ph:
                    self._send_json(404, {"error": "photo not found"})
                    return
                try:
                    img = load_image_normalized(Path(ph["sourcePath"]))
                    buf = io.BytesIO()
                    img.convert("RGB").save(buf, format="JPEG", quality=88)
                    self._send_bytes(200, "image/jpeg", buf.getvalue())
                except Exception as exc:
                    self._send_json(500, {"error": str(exc)})
                return

            if path.startswith("/api/cutout/"):
                bottle_id = urllib.parse.unquote(path[len("/api/cutout/") :])
                b = pipeline._bottle_map.get(bottle_id)
                if not b:
                    self._send_json(404, {"error": "cutout not found"})
                    return
                cutout_path_str = str(b.get("cutoutPath") or "").strip()
                if cutout_path_str and Path(cutout_path_str).exists():
                    self._send_bytes(200, "image/webp", Path(cutout_path_str).read_bytes())
                    return
                data_url = str(b.get("cutoutDataUrl") or "").strip()
                if data_url.startswith("data:image/") and ";base64," in data_url:
                    header_part, b64_part = data_url.split(";base64,", 1)
                    mime = header_part[len("data:") :] or "image/webp"
                    self._send_bytes(200, mime, base64.b64decode(b64_part))
                    return
                self._send_json(404, {"error": "cutout not found"})
                return

            if path.startswith("/api/crop/"):
                bottle_id = urllib.parse.unquote(path[len("/api/crop/") :])
                b = pipeline._bottle_map.get(bottle_id)
                crop_path_str = str(b.get("cropPath") or "").strip() if b else ""
                if not b or not crop_path_str or not Path(crop_path_str).exists():
                    self._send_json(404, {"error": "crop not found"})
                    return
                self._send_bytes(200, "image/png", Path(crop_path_str).read_bytes())
                return

            if path.startswith("/api/manual-label/"):
                group_key = urllib.parse.unquote(path[len("/api/manual-label/") :])
                assign = (pipeline.session.get("unlabeledAssignments") or {}).get(group_key)
                if not isinstance(assign, dict):
                    self._send_json(404, {"error": "manual label not found"})
                    return
                label_path_str = str(assign.get("labelPath") or "").strip()
                if label_path_str and Path(label_path_str).exists():
                    self._send_bytes(200, "image/webp", Path(label_path_str).read_bytes())
                    return
                data_url = str(assign.get("dataUrl") or "").strip()
                if data_url.startswith("data:image/") and ";base64," in data_url:
                    header_part, b64_part = data_url.split(";base64,", 1)
                    mime = header_part[len("data:") :] or "image/webp"
                    self._send_bytes(200, mime, base64.b64decode(b64_part))
                    return
                self._send_json(404, {"error": "manual label not found"})
                return

            if path == "/api/unlabeled-plan":
                self._send_json(200, pipeline.get_unlabeled_plan())
                return

            self._send_json(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            try:
                body = self._read_json_body()
            except json.JSONDecodeError:
                self._send_json(400, {"error": "invalid json"})
                return

            try:
                if path == "/api/boxes":
                    photo_id = str(body.get("photoId") or "")
                    boxes = body.get("boxes")
                    if not isinstance(boxes, list):
                        raise ValueError("boxes 배열이 필요합니다.")
                    updated = pipeline.save_photo_boxes(photo_id, boxes=boxes)
                    self._send_json(200, updated)
                    return

                if path == "/api/recut":
                    photo_id = str(body.get("photoId") or "")
                    mode = str(body.get("mode") or "boxes")
                    boxes = body.get("boxes")
                    updated = pipeline.recut_photo(photo_id, mode=mode, boxes=boxes)
                    self._send_json(200, updated)
                    return

                if path == "/api/decision":
                    bottle_id = str(body.get("bottleId") or "")
                    updated = pipeline.update_decision(
                        bottle_id=bottle_id,
                        decision=body.get("decision"),
                        selected_wine_id=body.get("selectedWineId"),
                        selected_group_key=body.get("selectedGroupKey"),
                        apply_all_vintages=body.get("applyAllVintages"),
                    )
                    self._send_json(200, updated)
                    return

                if path == "/api/bulk-approve":
                    bottle_ids = body.get("bottleIds")
                    if not isinstance(bottle_ids, list):
                        raise ValueError("bottleIds 배열이 필요합니다.")
                    result = pipeline.bulk_approve([str(x) for x in bottle_ids])
                    self._send_json(200, result)
                    return

                if path == "/api/select-representative":
                    group_key = str(body.get("groupKey") or "")
                    bottle_id = str(body.get("bottleId") or "")
                    result = pipeline.select_representative(group_key=group_key, bottle_id=bottle_id)
                    self._send_json(200, result)
                    return

                if path == "/api/exclude-group":
                    group_key = str(body.get("groupKey") or "")
                    result = pipeline.exclude_wine_group(group_key=group_key)
                    self._send_json(200, result)
                    return

                if path == "/api/save":
                    saved = pipeline.save_session()
                    self._send_json(200, {"path": str(saved)})
                    return

                if path == "/api/export":
                    bundle = pipeline.export_approved_labels(out_path)
                    self._send_json(
                        200,
                        {"outPath": str(out_path), "count": len(bundle["items"])},
                    )
                    return

                if path == "/api/unlabeled-assign":
                    result = pipeline.assign_unlabeled_wine(
                        group_key=str(body.get("groupKey") or ""),
                        source=str(body.get("source") or ""),
                        bottle_id=body.get("bottleId"),
                        image_data_url=body.get("imageDataUrl"),
                        file_name=body.get("fileName"),
                        apply_all_vintages=body.get("applyAllVintages"),
                    )
                    self._send_json(200, result)
                    return

                if path == "/api/export-unlabeled":
                    target_path, bundle = pipeline.export_unlabeled_labels(out_path)
                    self._send_json(
                        200,
                        {"outPath": str(target_path), "count": len(bundle["items"])},
                    )
                    return

                self._send_json(404, {"error": "not found"})
            except KeyError as exc:
                self._send_json(404, {"error": str(exc)})
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})

    return ThreadingHTTPServer(("127.0.0.1", port), ReviewHandler)


# ---------------------------------------------------------------------------
# CLI Entrypoint
# ---------------------------------------------------------------------------


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="JH Wine Forest — 다중 와인 보틀 누끼 분할 & 하이브리드 OCR 매칭 도구"
    )
    parser.add_argument(
        "--photos",
        default=None,
        help="와인 사진 폴더(또는 단일 사진 파일) 경로 (--serve-only 시 생략 가능)",
    )
    parser.add_argument("--db", required=True, help="wine_db.json 경로")
    parser.add_argument(
        "--out",
        default="./approved_labels.json",
        help="내보낼 approved_labels.json 경로 (기본: ./approved_labels.json)",
    )
    parser.add_argument(
        "--work-dir",
        default="./scripts/cutout_work",
        help="중간 크롭·누끼·session.json 작업 디렉터리 (기본: ./scripts/cutout_work)",
    )
    parser.add_argument(
        "--ocr-mode",
        choices=["local", "hybrid", "gemini"],
        default="local",
        help="OCR 모드: local(무료 오프라인), hybrid(신뢰도/점수 미달 시 Gemini), gemini",
    )
    parser.add_argument(
        "--gemini-key",
        default=os.environ.get("GEMINI_API_KEY", ""),
        help="Gemini API 키 (미지정 시 GEMINI_API_KEY 환경변수 사용)",
    )
    parser.add_argument(
        "--gemini-model",
        default="gemini-2.5-flash",
        help="Gemini 모델명 (기본: gemini-2.5-flash)",
    )
    parser.add_argument(
        "--rembg-model",
        default="isnet-general-use",
        help="rembg 세그멘테이션 모델명 (기본: isnet-general-use)",
    )
    parser.add_argument(
        "--yolo-model",
        default=None,
        help="로컬 yolov8s.onnx 파일 경로 (미지정 시 캐시 자동 다운로드)",
    )
    parser.add_argument(
        "--no-yolo",
        action="store_true",
        help="YOLO ONNX 1차 탐지를 끄고 알파 넥 프로젝션 밸리 분할만 사용",
    )
    parser.add_argument(
        "--prefilter",
        action="store_true",
        help="rembg 전 YOLO·선명도·dHash 연사 중복 스캔으로 와인병 후보 사진만 자동 선별 (단체샷 우선 정렬)",
    )
    parser.add_argument(
        "--prefilter-only",
        action="store_true",
        help="사전 선별 스캔만 빠르게 실행해 통계와 prefilter_cache.json만 저장하고 종료",
    )
    parser.add_argument(
        "--min-sharpness",
        type=float,
        default=25.0,
        help="사전 선별 최소 선명도(라플라시안 분산, 0이면 흐림 필터 비활성, 기본: 25.0)",
    )
    parser.add_argument(
        "--dedup-distance",
        type=int,
        default=6,
        help="사전 선별 연사 중복 dHash 해밍 거리 상한(-1이면 비활성, 기본: 6)",
    )
    parser.add_argument(
        "--min-bottles",
        type=int,
        default=1,
        help="사전 선별 통과에 필요한 최소 탐지 병 수 (기본: 1, 단체샷만 추리려면 2 이상)",
    )
    parser.add_argument(
        "--skip-existing-labels",
        action="store_true",
        help="wine_db.json에 이미 labelImageFileId가 있는 와인은 자동 승인 대신 제외(excluded) 처리",
    )
    parser.add_argument(
        "--auto-match-only",
        action="store_true",
        help="비수동 처리 시 내 wine_db.json과 50점 이상 매칭된 병만 세션에 보관하고 미매칭 컷은 자동 폐기",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=None,
        help="대량 사진을 N장씩 끊어 처리·검수하기 위한 배치 크기 (예: 40)",
    )
    parser.add_argument(
        "--batch-index",
        type=int,
        default=1,
        help="처리할 1-based 배치 번호 (--batch-size와 함께 사용, 기본: 1)",
    )
    parser.add_argument(
        "--resume",
        default=None,
        help="이전 session.json 경로 (재개 실행)",
    )
    parser.add_argument(
        "--serve-only",
        action="store_true",
        help="재누끼/OCR 없이 기존 session.json만 즉시 불러와 로컬 리뷰 서버만 실행",
    )
    parser.add_argument(
        "--unlabeled-first",
        action="store_true",
        help="리뷰 서버 접속 시 [탭 4: 라벨 없는 와인 매칭] 화면으로 바로 진입",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8765,
        help="로컬 리뷰 웹서버 포트 (기본: 8765)",
    )
    parser.add_argument(
        "--no-server",
        action="store_true",
        help="리뷰 서버를 띄우지 않고 배치 처리 및 session.json 생성 후 종료",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="리뷰 서버 실행 시 브라우저 자동 열기 생략",
    )
    args = parser.parse_args(argv)
    if not args.serve_only and not args.photos:
        parser.error("--photos 인자는 필수입니다 (--serve-only 사용 시에만 생략 가능).")
    return args


def main(argv: Optional[List[str]] = None) -> None:
    args = parse_args(argv)
    resume_path: Optional[Path] = Path(args.resume) if args.resume else None
    if args.serve_only:
        if resume_path is None:
            resume_path = Path(args.work_dir) / "session.json"
        if not resume_path.exists():
            print(f"[오류] --serve-only 대상 session.json을 찾을 수 없습니다: {resume_path}", file=sys.stderr)
            sys.exit(1)

    photos_dir_str = args.photos
    if not photos_dir_str and resume_path is not None and resume_path.exists():
        try:
            sess_meta = json.loads(resume_path.read_text(encoding="utf-8"))
            photos_dir_str = str(sess_meta.get("photosDir") or ".")
        except Exception:
            photos_dir_str = "."
    photos_path = Path(photos_dir_str or ".")

    detector = BottleDetector(
        model_path=Path(args.yolo_model) if args.yolo_model else None,
        enabled=not args.no_yolo,
    )
    segmenter = RembgSegmenter(model_name=args.rembg_model)
    gemini_ocr = (
        GeminiOcrFallback(api_key=args.gemini_key, model=args.gemini_model)
        if args.gemini_key
        else None
    )
    pipeline = CutoutPipeline(
        photos_path=photos_path,
        db_path=Path(args.db),
        work_dir=Path(args.work_dir),
        detector=detector,
        segmenter=segmenter,
        gemini_ocr=gemini_ocr,
        ocr_mode=args.ocr_mode,
        prefilter=bool(args.prefilter or args.prefilter_only),
        min_sharpness=args.min_sharpness,
        dedup_distance=args.dedup_distance,
        min_bottles=args.min_bottles,
        skip_existing_labels=bool(args.skip_existing_labels),
        auto_match_only=bool(args.auto_match_only),
        batch_size=args.batch_size,
        batch_index=args.batch_index,
        unlabeled_first=bool(args.unlabeled_first),
    )

    if args.prefilter_only:
        kept_items, summary, skipped_items = pipeline.run_prefilter()
        pipeline.session["prefilterSummary"] = summary
        pipeline.session["skippedPhotos"] = skipped_items
        pipeline.save_session()
        reasons = summary["skippedByReason"]
        print(
            f"\n[사전 선별 리포트]\n"
            f"  - 전체 스캔: {summary['totalScanned']}장\n"
            f"  - 선별 통과: {summary['kept']}장 (다병 단체샷 우선 정렬 완료)\n"
            f"  - 자동 제외: {summary['skippedTotal']}장 "
            f"(병 미탐지 {reasons.get('no_bottle_detected', 0)} / "
            f"흐림 {reasons.get('too_blurry', 0)} / "
            f"연사 중복 {reasons.get('duplicate_burst', 0)})\n"
            f"  - 캐시 저장: {pipeline.prefilter_cache_path}",
            flush=True,
        )
        if kept_items:
            bsize = args.batch_size or 40
            total_b = max(1, (len(kept_items) + bsize - 1) // bsize)
            print(f"  - 추천 배치 실행 ({bsize}장 기준 총 {total_b}배치): --prefilter --batch-size {bsize} --batch-index 1", flush=True)
            for sample in kept_items[:5]:
                print(
                    f"    * {sample['fileName']} (탐지 {sample['bottleCount']}병, 선명도 {sample['sharpness']})",
                    flush=True,
                )
        return

    if resume_path is not None and resume_path.exists():
        print(f"[세션 로드] {resume_path}", flush=True)
        pipeline.load_session(resume_path)

    if not args.serve_only:
        try:
            pipeline.run_all()
        except KeyboardInterrupt:
            print("\n[중단] --resume ./scripts/cutout_work/session.json 으로 이어서 실행할 수 있습니다.", flush=True)
            return

    total_bottles = sum(len(ph.get("bottles", [])) for ph in pipeline.session.get("photos", []))
    print(
        f"[완료] 사진 {len(pipeline.session.get('photos', []))}장 · "
        f"분할 보틀 {total_bottles}개 로드됨 (세션: {pipeline.session_path})",
        flush=True,
    )

    if args.no_server:
        return

    server = create_review_server(pipeline, out_path=Path(args.out), port=args.port)
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    print(f"[리뷰 서버] {url} (종료: Ctrl+C)", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[종료] 리뷰 서버를 닫습니다.", flush=True)
    finally:
        pipeline.save_session()
        server.server_close()


if __name__ == "__main__":
    main()
