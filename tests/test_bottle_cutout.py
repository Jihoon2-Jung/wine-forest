import base64
import io
import json
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "scripts"))

import bottle_cutout_tool as bct  # noqa: E402


def _make_sample_db() -> dict:
    return {
        "metadata": {
            "schemaVersion": 1,
            "appName": "JH Wine Forest",
            "trackingSinceDate": "2023-02-18",
            "lastModifiedAt": "2026-11-27T00:00:00Z",
            "lastBackupAt": None,
        },
        "locations": [
            {
                "id": "loc_1",
                "zone": "삼성",
                "shelf": "1-1",
                "displayName": "삼성 1-1",
                "maxCapacity": 12,
                "sortOrder": 1,
            }
        ],
        "wines": [
            {
                "id": "w_margaux_2019",
                "name": "Château Margaux",
                "producer": "Château Margaux",
                "country": "프랑스",
                "region": "보르도",
                "subRegion": "마고",
                "color": "R",
                "vintage": "2019",
                "bottleSizeMl": 750,
                "createdAt": "2026-11-27T00:00:00Z",
                "updatedAt": "2026-11-27T00:00:00Z",
            },
            {
                "id": "w_margaux_2020",
                "name": "Château Margaux",
                "producer": "Château Margaux",
                "country": "프랑스",
                "region": "보르도",
                "subRegion": "마고",
                "color": "R",
                "vintage": "2020",
                "bottleSizeMl": 750,
                "createdAt": "2026-11-27T00:00:00Z",
                "updatedAt": "2026-11-27T00:00:00Z",
            },
            {
                "id": "w_krug_mv",
                "name": "Krug Grande Cuvée",
                "producer": "Krug",
                "country": "프랑스",
                "region": "샴페인",
                "color": "SP",
                "vintage": "NV",
                "bottleSizeMl": 750,
                "createdAt": "2026-11-27T00:00:00Z",
                "updatedAt": "2026-11-27T00:00:00Z",
            },
            {
                "id": "w_chablis_ko",
                "name": "도멘 라블레 샤블리",
                "producer": "Domaine Raveneau",
                "country": "프랑스",
                "region": "부르고뉴",
                "subRegion": "샤블리",
                "color": "W",
                "vintage": "2022",
                "bottleSizeMl": 750,
                "createdAt": "2026-11-27T00:00:00Z",
                "updatedAt": "2026-11-27T00:00:00Z",
            },
        ],
        "bottles": [
            {
                "id": "b_1",
                "wineId": "w_margaux_2019",
                "status": "IN_STOCK",
                "locationId": "loc_1",
                "purchaseDate": "2026-01-01",
                "purchaseSource": "직구",
                "purchasePrice": 900000,
                "includeInTrackingSince": True,
                "createdAt": "2026-11-27T00:00:00Z",
                "updatedAt": "2026-11-27T00:00:00Z",
            },
            {
                "id": "b_2",
                "wineId": "w_krug_mv",
                "status": "IN_STOCK",
                "locationId": "loc_1",
                "purchaseDate": "2026-01-01",
                "purchaseSource": "와인샵",
                "purchasePrice": 350000,
                "includeInTrackingSince": True,
                "createdAt": "2026-11-27T00:00:00Z",
                "updatedAt": "2026-11-27T00:00:00Z",
            },
        ],
        "tastings": [],
    }


def _draw_synthetic_lineup(width: int = 900, height: int = 600) -> Image.Image:
    """배경이 밝은 회색이고 3병의 어두운 보틀이 나란히 서 있는 합성 사진 생성."""
    img = Image.new("RGB", (width, height), (240, 240, 238))
    draw = ImageDraw.Draw(img)
    centers_x = [170, 450, 730]
    for cx in centers_x:
        # 병몸 (폭 130, 아래 y=180..540) — 인접하지 않지만 일부 하단 섀도우/겹침 시뮬레이션 가능
        draw.rectangle([cx - 65, 190, cx + 65, 540], fill=(24, 48, 30))
        # 병목 (폭 36, y=70..195)
        draw.rectangle([cx - 18, 70, cx + 18, 195], fill=(32, 32, 34))
        # 라벨 (밝은 크림색 사각형)
        draw.rectangle([cx - 48, 280, cx + 48, 430], fill=(248, 244, 232))
        draw.text((cx - 38, 320), "CHATEAU", fill=(20, 20, 20))
        draw.text((cx - 38, 345), "MARGAUX", fill=(20, 20, 20))
        draw.text((cx - 25, 370), "2019", fill=(20, 20, 20))
    return img


def _mock_remove_bg(img: Image.Image) -> Image.Image:
    """흰/회색 배경을 투명화하고 어두운 보틀 + 라벨만 전경으로 남기는 합성 누끼 함수."""
    rgb = np.asarray(img.convert("RGB"))
    # 배경색 ~(240,240,238)과 차이가 큰 영역 + 내부 크림 라벨도 전경으로 남도록 보틀 x밴드 활용
    diff = np.abs(rgb.astype(np.int16) - np.array([240, 240, 238], dtype=np.int16)).max(axis=2)
    fg = diff > 18
    # 라벨 내부(크림색 diff가 작아도 병 내부 hole)는 binary_fill_holes가 메울 수도 있음
    rgba = np.zeros((rgb.shape[0], rgb.shape[1], 4), dtype=np.uint8)
    rgba[:, :, :3] = rgb
    rgba[:, :, 3] = np.where(fg, 255, 0).astype(np.uint8)
    return Image.fromarray(rgba, mode="RGBA")


class BottleCutoutUnitTests(unittest.TestCase):
    def test_precut_transparent_detection(self) -> None:
        opaque = Image.new("RGB", (200, 300), (220, 220, 220))
        self.assertFalse(bct.is_precut_transparent(opaque))

        rgba_opaque = Image.new("RGBA", (200, 300), (200, 100, 100, 255))
        self.assertFalse(bct.is_precut_transparent(rgba_opaque))

        precut = Image.new("RGBA", (200, 300), (0, 0, 0, 0))
        draw = ImageDraw.Draw(precut)
        draw.rectangle([60, 40, 140, 270], fill=(30, 60, 40, 255))
        self.assertTrue(bct.is_precut_transparent(precut))

    def test_yolo_letterbox_and_decode_filters(self) -> None:
        orig = np.zeros((600, 800, 3), dtype=np.uint8)
        padded, scale, pad_x, pad_y = bct.letterbox_image(orig, 640, 640)
        self.assertEqual(padded.shape, (640, 640, 3))
        self.assertAlmostEqual(scale, 0.8)
        self.assertEqual(pad_x, 0)
        self.assertEqual(pad_y, 80)

        # Synthetic [1, 84, 5] output:
        # 0: valid bottle left (cx=160, cy=320, w=80, h=300) -> orig [100..200, 112..487]
        # 1: overlapping bottle inside #0 (containment >= 80%, lower conf) -> dropped
        # 2: wine glass (class 40, high conf) -> excluded
        # 3: low aspect ratio object (class 39, w=200, h=200) -> excluded (h/w < 1.4)
        # 4: valid bottle right (cx=480, cy=320, w=80, h=320) -> kept & sorted after #0
        preds = np.zeros((1, 84, 5), dtype=np.float32)

        preds[0, :4, 0] = [160, 320, 80, 300]
        preds[0, 4 + 39, 0] = 0.91

        preds[0, :4, 1] = [160, 340, 68, 270]
        preds[0, 4 + 39, 1] = 0.55

        preds[0, :4, 2] = [320, 320, 90, 250]
        preds[0, 4 + 40, 2] = 0.95  # wine glass

        preds[0, :4, 3] = [350, 320, 200, 200]
        preds[0, 4 + 39, 3] = 0.85

        preds[0, :4, 4] = [480, 320, 80, 320]
        preds[0, 4 + 39, 4] = 0.88

        boxes = bct.decode_yolo_bottle_boxes(
            preds,
            orig_w=800,
            orig_h=600,
            scale=scale,
            pad_x=pad_x,
            pad_y=pad_y,
            in_w=640,
            in_h=640,
            conf_threshold=0.28,
        )
        self.assertEqual(len(boxes), 2)
        cx_0 = (boxes[0]["box"][0] + boxes[0]["box"][2]) / 2
        cx_1 = (boxes[1]["box"][0] + boxes[1]["box"][2]) / 2
        self.assertLess(cx_0, cx_1)

    def test_neck_valley_fallback_splits_touching_base_bottles(self) -> None:
        h, w = 500, 900
        alpha = np.zeros((h, w), dtype=np.uint8)
        centers = [160, 450, 740]
        for cx in centers:
            # 병몸은 넓고 서로 맞닿게 설정 (x-margin까지 퍼짐)
            alpha[230:470, cx - 140 : cx + 140] = 255
            # 병목은 상단 y=70..230에서 뚜렷한 밸리를 형성
            alpha[70:235, cx - 22 : cx + 22] = 255

        boxes = bct.split_bottles_by_neck_valley(alpha)
        self.assertEqual(len(boxes), 3)
        cxs = [(b[0] + b[2]) / 2 for b in boxes]
        self.assertTrue(cxs[0] < cxs[1] < cxs[2])

    def test_suppress_neighbor_fill_holes_and_normalize_webp(self) -> None:
        cw, ch = 220, 420
        arr = np.zeros((ch, cw, 4), dtype=np.uint8)
        arr[:, :, :3] = 30
        # 메인 보틀 (중앙 x=45..175, y=30..390)
        arr[30:390, 45:175, 3] = 255
        # 내부 유리 반사 구멍
        arr[120:155, 95:125, 3] = 0
        # 우측 경계에 걸린 인접 병 찌꺼기
        arr[100:380, 200:220, 3] = 255

        rgba = Image.fromarray(arr, mode="RGBA")
        refined = bct.suppress_neighbor_artifacts(rgba, inner_rel_box=[30, 15, 190, 405])
        ref_alpha = np.asarray(refined)[:, :, 3]

        # 1) 우측 인접 병 찌꺼기 제거
        self.assertEqual(int(ref_alpha[200, 210]), 0)
        # 2) 내부 유리 반사 홀 복구
        self.assertEqual(int(ref_alpha[135, 110]), 255)
        # 3) 외곽 1px 페더링 존재 (완전 0/255 외 중간값 경계 생성)
        boundary_vals = ref_alpha[29:33, 110]
        self.assertTrue(np.any((boundary_vals > 0) & (boundary_vals < 255)))

        # Vivino 350x500 정규화 & WebP 인코딩 검증
        canvas = bct.normalize_bottle_canvas(refined)
        self.assertEqual(canvas.size, (350, 500))
        c_alpha = np.asarray(canvas)[:, :, 3]
        ys, xs = np.where(c_alpha > 10)
        self.assertGreater(ys.size, 0)
        # 하단 여백 24px 정렬 확인 (500 - 24 = 476 부근에서 종료)
        self.assertAlmostEqual(int(ys.max()), 500 - 24 - 1, delta=3)
        # 가로 중앙 정렬 확인
        self.assertAlmostEqual((int(xs.min()) + int(xs.max())) / 2, 175, delta=3)

        webp_bytes, data_url = bct.encode_cutout_webp(canvas)
        self.assertTrue(data_url.startswith("data:image/webp;base64,"))
        self.assertLessEqual(len(webp_bytes), 90 * 1024)
        with Image.open(io.BytesIO(webp_bytes)) as decoded:
            self.assertEqual(decoded.size, (350, 500))
            self.assertEqual(decoded.format, "WEBP")

    def test_multilingual_wine_matching_and_hybrid_trigger(self) -> None:
        groups = bct.build_wine_groups(_make_sample_db())

        # 불어 악센트 + 빈티지 일치
        ocr_fr = bct.OcrResult(
            lines=[
                {"text": "CHATEAU MARGAUX", "confidence": 0.94},
                {"text": "2019", "confidence": 0.92},
                {"text": "Grand Vin Rouge", "confidence": 0.89},
            ],
            raw_text="CHATEAU MARGAUX\n2019\nGrand Vin Rouge",
            avg_confidence=0.91,
            engine="mac_vision",
            parsed_vintage="2019",
        )
        cands = bct.match_wine_candidates(ocr_fr, groups, top_k=3)
        self.assertGreaterEqual(len(cands), 1)
        self.assertEqual(cands[0]["name"], "Château Margaux")
        self.assertGreaterEqual(cands[0]["score"], 85.0)
        self.assertIn("w_margaux_2019", cands[0]["wineIds"])
        self.assertIn("w_margaux_2020", cands[0]["wineIds"])

        # 한글 음절 보존 + 프랑스어 도메인 별칭 매칭
        self.assertEqual(bct.strip_non_hangul_accents("도멘 샤블리 Château"), "도멘 샤블리 Chateau")
        ocr_ko = bct.OcrResult(
            lines=[
                {"text": "Domaine Chablis 2022", "confidence": 0.9},
                {"text": "Blanc", "confidence": 0.85},
            ],
            raw_text="Domaine Chablis 2022\nBlanc",
            avg_confidence=0.875,
            engine="mac_vision",
            parsed_vintage="2022",
        )
        cands_ko = bct.match_wine_candidates(ocr_ko, groups, top_k=3)
        self.assertEqual(cands_ko[0]["name"], "도멘 라블레 샤블리")

        # 1-B 하이브리드 OCR 트리거 매트릭스
        self.assertFalse(bct.should_trigger_gemini_fallback(ocr_fr, 90.0, "local"))
        self.assertFalse(bct.should_trigger_gemini_fallback(None, 0.0, "local"))
        self.assertTrue(bct.should_trigger_gemini_fallback(ocr_fr, 95.0, "gemini"))
        self.assertFalse(bct.should_trigger_gemini_fallback(ocr_fr, 85.0, "hybrid"))
        self.assertTrue(bct.should_trigger_gemini_fallback(ocr_fr, 50.0, "hybrid"))
        low_conf = bct.OcrResult(lines=[{"text": "A", "confidence": 0.4}, {"text": "B", "confidence": 0.4}], avg_confidence=0.4)
        self.assertTrue(bct.should_trigger_gemini_fallback(low_conf, 75.0, "hybrid"))

    def test_approved_labels_bundle_schema_contract(self) -> None:
        groups = bct.build_wine_groups(_make_sample_db())
        session = {
            "photos": [
                {
                    "photoId": "p001",
                    "bottles": [
                        {
                            "bottleId": "p001_b1",
                            "decision": "approved",
                            "selectedWineId": "w_margaux_2019",
                            "selectedGroupKey": groups[0]["groupKey"],
                            "applyAllVintages": True,
                            "cutoutDataUrl": "data:image/webp;base64,UklGRg==",
                        },
                        {
                            "bottleId": "p001_b2",
                            "decision": "excluded",
                            "selectedWineId": "w_krug_mv",
                            "cutoutDataUrl": "data:image/webp;base64,UklGRg==",
                        },
                    ],
                }
            ]
        }
        bundle = bct.build_approved_labels_bundle(session, groups)
        self.assertEqual(bundle["schemaVersion"], 1)
        self.assertEqual(len(bundle["items"]), 1)
        item = bundle["items"][0]
        self.assertIn(item["color"], {"R", "W", "SP", "SW", "RO"})
        self.assertTrue(item["dataUrl"].startswith("data:image/webp;base64,"))
        self.assertEqual(sorted(item["wineIds"]), ["w_margaux_2019", "w_margaux_2020"])

        # single vintage only toggle check
        session["photos"][0]["bottles"][0]["applyAllVintages"] = False
        bundle_single = bct.build_approved_labels_bundle(session, groups)
        self.assertEqual(bundle_single["items"][0]["wineIds"], ["w_margaux_2019"])

        # 승인 항목 0개 시 예외
        session["photos"][0]["bottles"][0]["decision"] = "hold"
        with self.assertRaises(ValueError):
            bct.build_approved_labels_bundle(session, groups)

    def test_end_to_end_pipeline_http_server_and_resume(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            photos_dir = tmp / "photos"
            photos_dir.mkdir()
            work_dir = tmp / "work"
            db_path = tmp / "wine_db.json"
            out_path = tmp / "approved_labels.json"

            db_path.write_text(json.dumps(_make_sample_db(), ensure_ascii=False), encoding="utf-8")
            lineup = _draw_synthetic_lineup()
            lineup.save(photos_dir / "lineup_3.jpg", format="JPEG", quality=92)

            def fake_ocr_batch(paths: list[Path]) -> dict[str, bct.OcrResult]:
                res = {}
                for idx, p in enumerate(paths):
                    if idx == 1:
                        text = "Krug Grande Cuvee Brut"
                    else:
                        text = "Chateau Margaux 2019"
                    res[str(p)] = bct.summarize_ocr_lines(
                        [{"text": line, "confidence": 0.93} for line in text.split()],
                        engine="mock_ocr",
                    )
                return res

            pipeline = bct.CutoutPipeline(
                photos_path=photos_dir,
                db_path=db_path,
                work_dir=work_dir,
                detector=bct.BottleDetector(enabled=False),
                segmenter=bct.RembgSegmenter(remove_fn=_mock_remove_bg),
                local_ocr=bct.LocalOcrDispatcher(backend_fn=fake_ocr_batch),
                ocr_mode="local",
            )
            session = pipeline.run_all()
            self.assertEqual(len(session["photos"]), 1)
            bottles = session["photos"][0]["bottles"]
            self.assertEqual(len(bottles), 3)

            # 리뷰 HTTP 서버 기동 (ephemeral port 0)
            server = bct.create_review_server(pipeline, out_path=out_path, port=0)
            port = server.server_address[1]
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base = f"http://127.0.0.1:{port}"
                with urllib.request.urlopen(f"{base}/api/state") as r:
                    st = json.loads(r.read().decode("utf-8"))
                self.assertEqual(len(st["photos"]), 1)
                bid = st["photos"][0]["bottles"][0]["bottleId"]

                with urllib.request.urlopen(f"{base}/api/cutout/{bid}") as r:
                    self.assertEqual(r.headers.get("Content-Type"), "image/webp")
                    self.assertGreater(len(r.read()), 100)

                # 수동 박스 2개로 재분할 테스트
                recut_req = urllib.request.Request(
                    f"{base}/api/recut",
                    data=json.dumps(
                        {
                            "photoId": "p001",
                            "mode": "boxes",
                            "boxes": [[90, 60, 250, 550], [650, 60, 810, 550]],
                        }
                    ).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(recut_req) as r:
                    recut_resp = json.loads(r.read().decode("utf-8"))
                self.assertEqual(len(recut_resp["bottles"]), 2)

                # 결정 저장 및 내보내기
                dec_req = urllib.request.Request(
                    f"{base}/api/decision",
                    data=json.dumps(
                        {
                            "bottleId": "p001_b1",
                            "decision": "approved",
                            "selectedWineId": "w_margaux_2019",
                        }
                    ).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(dec_req) as r:
                    dec_resp = json.loads(r.read().decode("utf-8"))
                self.assertEqual(dec_resp["decision"], "approved")

                exp_req = urllib.request.Request(
                    f"{base}/api/export",
                    data=b"{}",
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(exp_req) as r:
                    exp_resp = json.loads(r.read().decode("utf-8"))
                self.assertGreaterEqual(exp_resp["count"], 1)
                self.assertTrue(out_path.exists())
                exported = json.loads(out_path.read_text(encoding="utf-8"))
                self.assertEqual(exported["schemaVersion"], 1)
            finally:
                server.shutdown()
                server.server_close()

            # --resume 재개 확인
            resumed = bct.CutoutPipeline(
                photos_path=photos_dir,
                db_path=db_path,
                work_dir=work_dir,
                detector=bct.BottleDetector(enabled=False),
                segmenter=bct.RembgSegmenter(remove_fn=_mock_remove_bg),
                local_ocr=bct.LocalOcrDispatcher(backend_fn=fake_ocr_batch),
            )
            resumed.load_session(pipeline.session_path)
            self.assertEqual(len(resumed.session["photos"][0]["bottles"]), 2)

    @unittest.skipUnless(
        sys.platform == "darwin" and shutil.which("swiftc") is not None,
        "macOS Vision + swiftc 환경 전용 실제 OCR 검증",
    )
    def test_live_mac_vision_ocr_helper(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            img_path = tmp / "label_test.png"
            img = Image.new("RGB", (600, 320), (248, 245, 236))
            draw = ImageDraw.Draw(img)
            font_path = "/System/Library/Fonts/Supplemental/Georgia.ttf"
            try:
                font = ImageFont.truetype(font_path, 42)
            except Exception:
                font = ImageFont.load_default()
            draw.text((40, 80), "CHATEAU MARGAUX", fill=(18, 18, 18), font=font)
            draw.text((220, 170), "2019", fill=(18, 18, 18), font=font)
            img.save(img_path, format="PNG")

            engine = bct.MacVisionOcrEngine(
                swift_src=ROOT_DIR / "scripts" / "mac_vision_ocr.swift",
                binary_path=tmp / "mac_vision_ocr",
            )
            res_map = engine.recognize_batch([img_path])
            res = res_map[str(img_path)]
            upper = res.raw_text.upper()
            self.assertIn("MARGAUX", upper)
            self.assertEqual(res.parsed_vintage, "2019")

    def test_sharpness_and_dhash_metrics(self) -> None:
        from PIL import ImageFilter

        sharp = _draw_synthetic_lineup(width=600, height=400)
        blurry = sharp.filter(ImageFilter.GaussianBlur(radius=9.0))
        sharp_score = bct.compute_sharpness_score(sharp)
        blurry_score = bct.compute_sharpness_score(blurry)
        self.assertGreater(sharp_score, 40.0)
        self.assertGreater(sharp_score, blurry_score * 3.0)

        h_sharp = bct.compute_dhash(sharp)
        # 아주 미세한 밝기 변화/약한 블러 연사는 해밍 거리 <= 6 이내
        slightly_perturbed = sharp.filter(ImageFilter.GaussianBlur(radius=0.8))
        h_burst = bct.compute_dhash(slightly_perturbed)
        self.assertLessEqual(bct.hamming_distance(h_sharp, h_burst), 6)

        # 완전히 다른 구도(세로 그라디언트 / 단색 박스)는 거리 큼
        different = Image.new("RGB", (600, 400), (20, 40, 80))
        draw_d = ImageDraw.Draw(different)
        draw_d.rectangle([0, 0, 600, 120], fill=(240, 220, 160))
        draw_d.ellipse([50, 200, 550, 390], fill=(200, 60, 60))
        h_diff = bct.compute_dhash(different)
        self.assertGreater(bct.hamming_distance(h_sharp, h_diff), 10)

    def test_prefilter_drops_blurry_nobottle_duplicates_and_sorts_lineups(self) -> None:
        from PIL import ImageFilter

        class FakeYoloDetector(bct.BottleDetector):
            def __init__(self) -> None:
                super().__init__(enabled=True)
                self.calls = 0

            def detect(self, img: Image.Image) -> list[dict]:
                self.calls += 1
                w, h = img.size
                # 파일 픽셀 색상으로 합성 구분: 녹색/어두운 보틀(1개 vs 3개) vs 음식 노란원(0개)
                arr = np.asarray(img.convert("RGB"))
                # 오른쪽 1/3과 왼쪽 1/3에 모두 어두운 보틀이 있으면 3병 단체샷
                has_left = np.any(arr[:, : w // 3, 1] < 60)
                has_center = np.any(arr[:, w // 3 : (2 * w) // 3, 1] < 60)
                has_right = np.any(arr[:, (2 * w) // 3 :, 1] < 60)
                if has_left and has_center and has_right:
                    return [
                        {"box": [105, 70, 235, 540], "confidence": 0.9, "source": "yolo"},
                        {"box": [385, 70, 515, 540], "confidence": 0.9, "source": "yolo"},
                        {"box": [665, 70, 795, 540], "confidence": 0.9, "source": "yolo"},
                    ]
                if has_center:
                    return [{"box": [240, 70, 360, 440], "confidence": 0.88, "source": "yolo"}]
                return []

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            photos_dir = tmp / "raw_800"
            photos_dir.mkdir()
            work_dir = tmp / "work"
            db_path = tmp / "wine_db.json"
            db_path.write_text(json.dumps(_make_sample_db(), ensure_ascii=False), encoding="utf-8")

            # 1) 선명하지만 병이 없는 음식/접시 사진 (병 0개)
            food = Image.new("RGB", (600, 480), (240, 230, 210))
            draw_f = ImageDraw.Draw(food)
            draw_f.ellipse([150, 120, 450, 360], fill=(220, 170, 90), outline=(140, 100, 70), width=4)
            for gx in range(180, 420, 18):
                draw_f.line([gx, 160, gx, 320], fill=(150, 95, 70), width=2)
            for gy in range(160, 320, 18):
                draw_f.line([180, gy, 420, gy], fill=(245, 220, 170), width=2)
            food.save(photos_dir / "01_food.jpg", format="JPEG")

            # 2) 심하게 흐린 사진
            blurry = Image.new("RGB", (600, 480), (225, 225, 225))
            draw_b = ImageDraw.Draw(blurry)
            draw_b.rectangle([250, 80, 350, 420], fill=(20, 40, 25))
            blurry = blurry.filter(ImageFilter.GaussianBlur(radius=14.0))
            blurry.save(photos_dir / "02_blurry.jpg", format="JPEG")

            # 3) 단독 와인 연사 2장 (a가 약간 흐리고 b가 더 선명함)
            single_sharp = Image.new("RGB", (600, 480), (235, 235, 235))
            draw_s = ImageDraw.Draw(single_sharp)
            draw_s.rectangle([245, 75, 355, 430], fill=(25, 48, 30))
            draw_s.rectangle([260, 200, 340, 320], fill=(250, 245, 230))
            draw_s.text((266, 235), "CHATEAU", fill=(15, 15, 15))
            draw_s.text((266, 260), "MARGAUX", fill=(15, 15, 15))
            single_less_sharp = single_sharp.filter(ImageFilter.GaussianBlur(radius=0.6))
            single_less_sharp.save(photos_dir / "03_single_a.jpg", format="JPEG")
            single_sharp.save(photos_dir / "04_single_b.jpg", format="JPEG")

            # 4) 다병(3병) 단체샷
            lineup = _draw_synthetic_lineup()
            lineup.save(photos_dir / "05_lineup_3.jpg", format="JPEG")

            fake_det = FakeYoloDetector()
            pipeline = bct.CutoutPipeline(
                photos_path=photos_dir,
                db_path=db_path,
                work_dir=work_dir,
                detector=fake_det,
                segmenter=bct.RembgSegmenter(remove_fn=_mock_remove_bg),
                prefilter=True,
                min_sharpness=25.0,
                dedup_distance=6,
                min_bottles=1,
            )

            kept, summary, skipped = pipeline.run_prefilter()
            self.assertEqual(summary["totalScanned"], 5)
            self.assertEqual(summary["kept"], 2)
            self.assertEqual(summary["skippedTotal"], 3)
            self.assertEqual(summary["skippedByReason"]["no_bottle_detected"], 1)
            self.assertEqual(summary["skippedByReason"]["too_blurry"], 1)
            self.assertEqual(summary["skippedByReason"]["duplicate_burst"], 1)
            # 다병 단체샷이 1순위, 더 선명한 연사(04_single_b.jpg)가 2순위여야 함
            self.assertEqual([k["fileName"] for k in kept], ["05_lineup_3.jpg", "04_single_b.jpg"])
            self.assertTrue(pipeline.prefilter_cache_path.exists())

            # 캐시 재사용 시 YOLO 재호출 0회 확인
            prev_calls = fake_det.calls
            kept_cached, summary_cached, _ = pipeline.run_prefilter()
            self.assertEqual(fake_det.calls, prev_calls)
            self.assertEqual([k["fileName"] for k in kept_cached], ["05_lineup_3.jpg", "04_single_b.jpg"])
            self.assertEqual(summary_cached["kept"], 2)

    def test_batch_slicing_and_skip_existing_labels(self) -> None:
        db = _make_sample_db()
        # Château Margaux 그룹에 이미 라벨이 있다고 표시
        db["wines"][0]["labelImageFileId"] = "existing_drive_file_id"

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            photos_dir = tmp / "photos"
            photos_dir.mkdir()
            work_dir = tmp / "work"
            db_path = tmp / "wine_db.json"
            db_path.write_text(json.dumps(db, ensure_ascii=False), encoding="utf-8")

            # 2장의 투명 누끼 사진 생성 (정렬 순서상 01_margaux.png, 02_krug.png)
            for fname in ("01_margaux.png", "02_krug.png"):
                rgba = Image.new("RGBA", (300, 460), (0, 0, 0, 0))
                draw = ImageDraw.Draw(rgba)
                draw.rectangle([90, 40, 210, 430], fill=(24, 52, 34, 255))
                rgba.save(photos_dir / fname, format="PNG")

            def fake_ocr(paths: list[Path]) -> dict[str, bct.OcrResult]:
                out = {}
                for p in paths:
                    if "b1" in p.name:
                        txt = "Chateau Margaux 2019"
                    else:
                        txt = "Krug Grande Cuvee Brut"
                    out[str(p)] = bct.summarize_ocr_lines(
                        [{"text": t, "confidence": 0.94} for t in txt.split()],
                        engine="mock_ocr",
                    )
                return out

            # 배치 1/2 (01_margaux.png만 처리 + skip_existing_labels=True -> 자동 excluded)
            p1 = bct.CutoutPipeline(
                photos_path=photos_dir,
                db_path=db_path,
                work_dir=work_dir / "b1",
                detector=bct.BottleDetector(enabled=False),
                segmenter=bct.RembgSegmenter(remove_fn=_mock_remove_bg),
                local_ocr=bct.LocalOcrDispatcher(backend_fn=fake_ocr),
                skip_existing_labels=True,
                batch_size=1,
                batch_index=1,
            )
            s1 = p1.run_all()
            self.assertEqual(len(s1["photos"]), 1)
            self.assertEqual(s1["photos"][0]["fileName"], "01_margaux.png")
            self.assertEqual(s1["batchInfo"]["batchIndex"], 1)
            self.assertEqual(s1["batchInfo"]["totalBatches"], 2)
            b1 = s1["photos"][0]["bottles"][0]
            self.assertTrue(b1["alreadyHasLabel"])
            self.assertEqual(b1["decision"], "excluded")

    def test_foreground_row_filters_background_shelf_and_keeps_rightmost_bottles(self) -> None:
        # 640x640 input with no padding (800x800 -> scale=0.8)
        orig_w, orig_h = 800, 800
        # 10 small background shelf bottles on left + 7 tall foreground bottles across left..right
        preds = np.zeros((1, 84, 17), dtype=np.float32)
        for i in range(10):
            cx = 40.0 + i * 32.0
            preds[0, :4, i] = [cx, 150.0, 26.0, 110.0]  # orig h=137.5 (< 55% of 425)
            preds[0, 4 + 39, i] = 0.90
        for j in range(7):
            cx = 70.0 + j * 82.0  # includes rightmost cx=562 -> orig_x=702
            preds[0, :4, 10 + j] = [cx, 400.0, 68.0, 340.0]  # orig h=425
            preds[0, 4 + 39, 10 + j] = 0.85

        boxes = bct.decode_yolo_bottle_boxes(
            preds,
            orig_w=orig_w,
            orig_h=orig_h,
            scale=0.8,
            pad_x=0,
            pad_y=0,
            in_w=640,
            in_h=640,
            conf_threshold=0.28,
        )
        self.assertEqual(len(boxes), 7)
        self.assertGreater(boxes[-1]["box"][2], 650)

    def test_junk_cutout_silhouette_gate(self) -> None:
        # 1) 납작한 병뚜껑 조각 (#5 유사): 폭 140, 높이 90 -> 비율 0.64 < 1.55 -> 거부
        cap = Image.new("RGBA", (180, 220), (0, 0, 0, 0))
        ImageDraw.Draw(cap).rectangle([20, 120, 160, 210], fill=(40, 40, 30, 255))
        self.assertFalse(bct.is_valid_bottle_cutout(cap))

        # 2) 작은 먼지 조각 (#6 유사): 10x20 -> 거부
        dust = Image.new("RGBA", (100, 200), (0, 0, 0, 0))
        ImageDraw.Draw(dust).rectangle([40, 80, 50, 100], fill=(40, 40, 30, 255))
        self.assertFalse(bct.is_valid_bottle_cutout(dust))

        # 3) 빈틈이 큰 가는 그림자 곡선 (#10 유사): 폭 100, 높이 240, 채움 < 22% -> 거부
        wispy = Image.new("RGBA", (140, 280), (0, 0, 0, 0))
        ImageDraw.Draw(wispy).line([(25, 20), (120, 60), (40, 260)], fill=(50, 50, 50, 255), width=4)
        self.assertFalse(bct.is_valid_bottle_cutout(wispy))

        # 3-1) 비율 1.50 (< 1.60) -> 거부
        wide = Image.new("RGBA", (180, 220), (0, 0, 0, 0))
        ImageDraw.Draw(wide).rectangle([20, 20, 120, 170], fill=(40, 40, 30, 255))
        self.assertFalse(bct.is_valid_bottle_cutout(wide))

        # 4) 정상 와인 보틀 실루엣 (>= 1.60) -> 통과
        bottle = Image.new("RGBA", (180, 420), (0, 0, 0, 0))
        d = ImageDraw.Draw(bottle)
        d.rectangle([75, 20, 105, 130], fill=(25, 48, 30, 255))
        d.rectangle([45, 130, 135, 390], fill=(25, 48, 30, 255))
        self.assertTrue(bct.is_valid_bottle_cutout(bottle))

    def test_distinctive_token_blocks_generic_chardonnay_false_match(self) -> None:
        db = _make_sample_db()
        db["wines"].append(
            {
                "id": "w_alma_chard",
                "name": "ALMA de CATTLEYA Chardonnay",
                "producer": "Alma de Cattleya",
                "country": "미국",
                "region": "캘리포니아",
                "color": "W",
                "vintage": "2021",
                "bottleSizeMl": 750,
                "createdAt": "2026-11-27T00:00:00Z",
                "updatedAt": "2026-11-27T00:00:00Z",
            }
        )
        groups = bct.build_wine_groups(db)
        faultline_ocr = bct.OcrResult(
            lines=[
                {"text": "SINGLE BLOCK", "confidence": 0.9},
                {"text": "FAULTLINE", "confidence": 0.9},
                {"text": "2021 Chardonnay", "confidence": 0.9},
                {"text": "MORNINGTON PENINSULA", "confidence": 0.88},
            ],
            raw_text="SINGLE BLOCK\nFAULTLINE\n2021 Chardonnay\nMORNINGTON PENINSULA",
            avg_confidence=0.895,
            engine="mac_vision",
            parsed_vintage="2021",
        )
        cands = bct.match_wine_candidates(faultline_ocr, groups, top_k=3)
        for c in cands:
            if c["wineId"] == "w_alma_chard":
                self.assertLessEqual(c["score"], 25.0)

    def test_tab1_boxes_api_persistence_and_zero_box_recut(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            photos_dir = tmp / "photos"
            photos_dir.mkdir()
            work_dir = tmp / "work"
            db_path = tmp / "wine_db.json"
            out_path = tmp / "approved_labels.json"
            db_path.write_text(json.dumps(_make_sample_db(), ensure_ascii=False), encoding="utf-8")
            _draw_synthetic_lineup().save(photos_dir / "lineup_3.jpg", format="JPEG")

            pipeline = bct.CutoutPipeline(
                photos_path=photos_dir,
                db_path=db_path,
                work_dir=work_dir,
                detector=bct.BottleDetector(enabled=False),
                segmenter=bct.RembgSegmenter(remove_fn=_mock_remove_bg),
                local_ocr=bct.LocalOcrDispatcher(backend_fn=lambda paths: {}),
            )
            pipeline.run_all()
            server = bct.create_review_server(pipeline, out_path=out_path, port=0)
            port = server.server_address[1]
            t = threading.Thread(target=server.serve_forever, daemon=True)
            t.start()
            try:
                base = f"http://127.0.0.1:{port}"
                edited_boxes = [[100, 60, 240, 540], [380, 60, 520, 540]]
                req_boxes = urllib.request.Request(
                    f"{base}/api/boxes",
                    data=json.dumps({"photoId": "p001", "boxes": edited_boxes}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req_boxes) as r:
                    resp = json.loads(r.read().decode("utf-8"))
                self.assertEqual(resp["boxes"], edited_boxes)

                # 세션 재로드 후에도 탭 1 박스 수정분 유지 확인
                reloaded = bct.CutoutPipeline(
                    photos_path=photos_dir,
                    db_path=db_path,
                    work_dir=work_dir,
                    detector=bct.BottleDetector(enabled=False),
                    segmenter=bct.RembgSegmenter(remove_fn=_mock_remove_bg),
                    local_ocr=bct.LocalOcrDispatcher(backend_fn=lambda paths: {}),
                )
                reloaded.load_session(pipeline.session_path)
                self.assertEqual(reloaded.session["photos"][0]["boxes"], edited_boxes)

                # 0개 박스로 recut 허용 (에러 없이 비움)
                req_empty = urllib.request.Request(
                    f"{base}/api/recut",
                    data=json.dumps({"photoId": "p001", "mode": "boxes", "boxes": []}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req_empty) as r:
                    empty_resp = json.loads(r.read().decode("utf-8"))
                self.assertEqual(empty_resp["boxes"], [])
                self.assertEqual(empty_resp["bottles"], [])
            finally:
                server.shutdown()
                server.server_close()

    def test_zero_line_ocr_discard_auto_match_only_and_best_per_wine(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            photos_dir = tmp / "photos"
            photos_dir.mkdir()
            work_dir = tmp / "work"
            db_path = tmp / "wine_db.json"
            out_path = tmp / "approved_labels.json"
            db_path.write_text(json.dumps(_make_sample_db(), ensure_ascii=False), encoding="utf-8")

            # 2장의 3병 단체샷 (1번 병: OCR 0줄 -> 폐기, 2번 병: 셀러 미보유 와인 -> auto_match_only 시 폐기, 3번 병: Margaux 2019 -> 유지)
            # 단 02_photo는 3번 병 conf/해상도가 더 높음 -> 베스트 1장으로 선정되어야 함
            _draw_synthetic_lineup().save(photos_dir / "01_photo.jpg", format="JPEG")
            _draw_synthetic_lineup().save(photos_dir / "02_photo.jpg", format="JPEG")

            def fake_ocr(paths: list[Path]) -> dict[str, bct.OcrResult]:
                res = {}
                for p in paths:
                    name = p.name
                    if "_b1" in name:
                        # OCR 0줄 -> 자동 폐기 대상
                        res[str(p)] = bct.OcrResult(lines=[], raw_text="", avg_confidence=0.0, engine="mac_vision")
                    elif "_b2" in name:
                        # 읽혔지만 셀러 DB에 없는 와인
                        res[str(p)] = bct.summarize_ocr_lines(
                            [
                                {"text": "FAULTLINE", "confidence": 0.90},
                                {"text": "MORNINGTON", "confidence": 0.88},
                            ],
                            engine="mac_vision",
                        )
                    else:
                        # 01_photo보다 02_photo의 confidence를 더 높게 설정
                        conf = 0.96 if name.startswith("p002_") else 0.84
                        res[str(p)] = bct.summarize_ocr_lines(
                            [
                                {"text": "CHATEAU MARGAUX", "confidence": conf},
                                {"text": "2019", "confidence": conf},
                            ],
                            engine="mac_vision",
                        )
                return res

            pipeline = bct.CutoutPipeline(
                photos_path=photos_dir,
                db_path=db_path,
                work_dir=work_dir,
                detector=bct.BottleDetector(enabled=False),
                segmenter=bct.RembgSegmenter(remove_fn=_mock_remove_bg),
                local_ocr=bct.LocalOcrDispatcher(backend_fn=fake_ocr),
                auto_match_only=True,
            )
            session = pipeline.run_all()
            self.assertEqual(len(session["photos"]), 2)

            # 각 사진마다 _b1(0줄 OCR)과 _b2(미매칭)는 폐기되어 오직 1병(Margaux)만 남아야 함
            for ph in session["photos"]:
                self.assertEqual(len(ph["bottles"]), 1)
                self.assertEqual(ph["bottles"][0]["selectedWineId"], "w_margaux_2019")

            # 폐기된 _b1 / _b2 임시 WebP 파일도 정리되었는지 확인
            self.assertFalse((work_dir / "cutouts" / "p001_b1.webp").exists())
            self.assertFalse((work_dir / "cutouts" / "p001_b2.webp").exists())

            # 동일 와인(Château Margaux) 2개 중 신뢰도 높은 p002만 approved 유지, p001은 excluded 강등
            b_p1 = session["photos"][0]["bottles"][0]
            b_p2 = session["photos"][1]["bottles"][0]
            self.assertEqual(b_p1["decision"], "excluded")
            self.assertTrue(b_p1.get("duplicateOfBest"))
            self.assertEqual(b_p2["decision"], "approved")

            bundle = pipeline.export_approved_labels(out_path)
            self.assertEqual(len(bundle["items"]), 1)
            self.assertEqual(bundle["items"][0]["wineId"], "w_margaux_2019")

    def test_serve_only_bulk_approve_and_select_representative(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            db_path = tmp / "wine_db.json"
            work_dir = tmp / "work"
            work_dir.mkdir(parents=True)
            session_path = work_dir / "session.json"
            out_path = tmp / "approved_labels.json"
            db_path.write_text(json.dumps(_make_sample_db(), ensure_ascii=False), encoding="utf-8")

            # --serve-only 는 --photos 없이 파싱 가능해야 함
            parsed = bct.parse_args(
                ["--db", str(db_path), "--serve-only", "--resume", str(session_path)]
            )
            self.assertTrue(parsed.serve_only)
            self.assertIsNone(parsed.photos)

            groups = bct.build_wine_groups(json.loads(db_path.read_text(encoding="utf-8")))
            margaux_g = next(g for g in groups if g["wineId"] == "w_margaux_2019")
            krug_g = next(g for g in groups if g["wineId"] == "w_krug_mv")

            data_url_1 = "data:image/webp;base64,UklGRjAAAABXRUJQVlA4ICQAAAAQAQCdASoBAAEAAUAmJZgCdAEO/gHOAAD++O3uAAA="
            data_url_2 = "data:image/webp;base64,UklGRjgAAABXRUJQVlA4ICwAAAAwAQCdASoCAAIAAUAmJZgCdAEO/gHOAAD++O3uAAA="
            session_data = {
                "schemaVersion": 1,
                "photosDir": str(tmp / "missing_photos_ok"),
                "dbPath": str(db_path),
                "ocrMode": "local",
                "photos": [
                    {
                        "photoId": "p001",
                        "fileName": "01.jpg",
                        "sourcePath": str(tmp / "01.jpg"),
                        "width": 300,
                        "height": 500,
                        "splitSource": "yolo",
                        "boxes": [[10, 10, 100, 400]],
                        "bottles": [
                            {
                                "bottleId": "p001_b1",
                                "photoId": "p001",
                                "bottleIndex": 1,
                                "box": [10, 10, 100, 400],
                                "cutoutDataUrl": data_url_1,
                                "cutoutBytes": 1200,
                                "precutSkippedRembg": False,
                                "ocr": {"rawText": "MARGAUX 2019", "avgConfidence": 0.85, "engine": "mac_vision", "parsedVintage": "2019"},
                                "candidates": [{"groupKey": margaux_g["groupKey"], "wineId": margaux_g["wineId"], "score": 88.0}],
                                "selectedWineId": margaux_g["wineId"],
                                "selectedGroupKey": margaux_g["groupKey"],
                                "alreadyHasLabel": False,
                                "duplicateOfBest": True,
                                "applyAllVintages": True,
                                "decision": "excluded",
                            }
                        ],
                    },
                    {
                        "photoId": "p002",
                        "fileName": "02.jpg",
                        "sourcePath": str(tmp / "02.jpg"),
                        "width": 600,
                        "height": 500,
                        "splitSource": "yolo",
                        "boxes": [[10, 10, 100, 400], [200, 10, 300, 400]],
                        "bottles": [
                            {
                                "bottleId": "p002_b1",
                                "photoId": "p002",
                                "bottleIndex": 1,
                                "box": [10, 10, 100, 400],
                                "cutoutDataUrl": data_url_2,
                                "cutoutBytes": 2400,
                                "precutSkippedRembg": False,
                                "ocr": {"rawText": "MARGAUX 2019", "avgConfidence": 0.95, "engine": "mac_vision", "parsedVintage": "2019"},
                                "candidates": [{"groupKey": margaux_g["groupKey"], "wineId": margaux_g["wineId"], "score": 95.0}],
                                "selectedWineId": margaux_g["wineId"],
                                "selectedGroupKey": margaux_g["groupKey"],
                                "alreadyHasLabel": False,
                                "duplicateOfBest": False,
                                "applyAllVintages": True,
                                "decision": "approved",
                            },
                            {
                                "bottleId": "p002_b2",
                                "photoId": "p002",
                                "bottleIndex": 2,
                                "box": [200, 10, 300, 400],
                                "cutoutDataUrl": data_url_1,
                                "cutoutBytes": 1800,
                                "precutSkippedRembg": False,
                                "ocr": {"rawText": "KRUG", "avgConfidence": 0.80, "engine": "mac_vision", "parsedVintage": None},
                                "candidates": [{"groupKey": krug_g["groupKey"], "wineId": krug_g["wineId"], "score": 68.0}],
                                "selectedWineId": krug_g["wineId"],
                                "selectedGroupKey": krug_g["groupKey"],
                                "alreadyHasLabel": False,
                                "duplicateOfBest": False,
                                "applyAllVintages": True,
                                "decision": "pending",
                            },
                        ],
                    },
                ],
            }
            session_path.write_text(json.dumps(session_data, ensure_ascii=False), encoding="utf-8")

            pipeline = bct.CutoutPipeline(
                photos_path=tmp,
                db_path=db_path,
                work_dir=work_dir,
                detector=bct.BottleDetector(enabled=False),
                segmenter=bct.RembgSegmenter(remove_fn=_mock_remove_bg),
                local_ocr=bct.LocalOcrDispatcher(backend_fn=lambda paths: {}),
            )
            pipeline.load_session(session_path)
            server = bct.create_review_server(pipeline, out_path=out_path, port=0)
            port = server.server_address[1]
            t = threading.Thread(target=server.serve_forever, daemon=True)
            t.start()
            try:
                base = f"http://127.0.0.1:{port}"
                with urllib.request.urlopen(f"{base}/api/state") as r:
                    st = json.loads(r.read().decode("utf-8"))
                self.assertIn("region", st["wines"][0])
                self.assertIn("duplicateOfBest", st["photos"][0]["bottles"][0])

                # 1) 일괄 확정: p002_b2(pending)만 확정, 이미 확정/제외된 p001_b1·p002_b1 유지
                req_bulk = urllib.request.Request(
                    f"{base}/api/bulk-approve",
                    data=json.dumps({"bottleIds": ["p001_b1", "p002_b1", "p002_b2"]}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req_bulk) as r:
                    bulk_resp = json.loads(r.read().decode("utf-8"))
                self.assertEqual(bulk_resp["approvedCount"], 1)
                self.assertEqual(bulk_resp["updatedIds"], ["p002_b2"])

                # 2) 중복 대표 변경: Margaux 대표를 p002_b1 -> p001_b1로 변경
                req_rep = urllib.request.Request(
                    f"{base}/api/select-representative",
                    data=json.dumps({"groupKey": margaux_g["groupKey"], "bottleId": "p001_b1"}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req_rep) as r:
                    rep_resp = json.loads(r.read().decode("utf-8"))
                self.assertEqual(rep_resp["chosenBottleId"], "p001_b1")
                self.assertEqual(rep_resp["affectedCount"], 2)

                with urllib.request.urlopen(f"{base}/api/state") as r:
                    st_after = json.loads(r.read().decode("utf-8"))
                b_chosen = st_after["photos"][0]["bottles"][0]
                b_demoted = st_after["photos"][1]["bottles"][0]
                self.assertEqual(b_chosen["decision"], "approved")
                self.assertTrue(b_chosen["representativeConfirmed"])
                self.assertEqual(b_demoted["decision"], "excluded")
                self.assertFalse(b_demoted["representativeConfirmed"])

                # 내보내기 시 p001_b1의 data_url_1이 내보내지고 Krug까지 총 2건 출력됨
                req_exp = urllib.request.Request(
                    f"{base}/api/export",
                    data=b"{}",
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req_exp) as r:
                    exp_resp = json.loads(r.read().decode("utf-8"))
                self.assertEqual(exp_resp["count"], 2)
                exported = json.loads(out_path.read_text(encoding="utf-8"))
                margaux_item = next(it for it in exported["items"] if it["wineId"] == "w_margaux_2019")
                self.assertEqual(margaux_item["dataUrl"], data_url_1)

                # 3) 모두 선택안함 (그룹 제외): Margaux 전체 excluded 처리 -> 재내보내기 시 1건(Krug)만 남음
                req_exg = urllib.request.Request(
                    f"{base}/api/exclude-group",
                    data=json.dumps({"groupKey": margaux_g["groupKey"]}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req_exg) as r:
                    exg_resp = json.loads(r.read().decode("utf-8"))
                self.assertEqual(exg_resp["excludedCount"], 2)
                with urllib.request.urlopen(f"{base}/api/state") as r:
                    st_ex = json.loads(r.read().decode("utf-8"))
                self.assertEqual(st_ex["photos"][0]["bottles"][0]["decision"], "excluded")
                self.assertEqual(st_ex["photos"][1]["bottles"][0]["decision"], "excluded")
                self.assertFalse(st_ex["photos"][0]["bottles"][0]["representativeConfirmed"])

                req_exp2 = urllib.request.Request(
                    f"{base}/api/export",
                    data=b"{}",
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req_exp2) as r:
                    exp2_resp = json.loads(r.read().decode("utf-8"))
                self.assertEqual(exp2_resp["count"], 1)
            finally:
                server.shutdown()
                server.server_close()

    def test_reverse_cutout_pool_recommendations_and_backfill_planner(self) -> None:
        db = _make_sample_db()
        groups = bct.build_wine_groups(db)
        margaux_g = next(g for g in groups if g["wineId"] == "w_margaux_2019")
        krug_g = next(g for g in groups if g["wineId"] == "w_krug_mv")
        chablis_g = next(g for g in groups if g["wineId"] == "w_chablis_ko")

        session = {
            "photos": [
                {
                    "photoId": "p001",
                    "fileName": "lineup_a.jpg",
                    "sourcePath": "/tmp/lineup_a.jpg",
                    "bottles": [
                        {
                            "bottleId": "p001_b1",
                            "bottleIndex": 1,
                            "box": [10, 10, 110, 400],
                            "cutoutBytes": 24000,
                            "decision": "excluded",
                            "selectedGroupKey": "",
                            "ocr": {
                                "rawText": "RAVENEAU\nCHABLIS 1ER CRU\n2022",
                                "avgConfidence": 0.90,
                                "engine": "mac_vision",
                                "parsedVintage": "2022",
                            },
                        },
                        {
                            "bottleId": "p001_b2",
                            "bottleIndex": 2,
                            "box": [300, 10, 400, 400],
                            "cutoutBytes": 18000,
                            "decision": "approved",
                            "selectedGroupKey": krug_g["groupKey"],
                            "ocr": {
                                "rawText": "KRUG GRANDE CUVEE\nBRUT CHAMPAGNE",
                                "avgConfidence": 0.92,
                                "engine": "mac_vision",
                                "parsedVintage": None,
                            },
                        },
                        {
                            "bottleId": "p001_b3",
                            "bottleIndex": 3,
                            "box": [500, 10, 600, 400],
                            "cutoutBytes": 19000,
                            "decision": "excluded",
                            "selectedGroupKey": "",
                            "ocr": {
                                "rawText": "DOMAINE UNKNOWN 2022\nCHARDONNAY",
                                "avgConfidence": 0.85,
                                "engine": "mac_vision",
                                "parsedVintage": "2022",
                            },
                        },
                    ],
                }
            ],
            "poolExtensions": [
                {
                    "bottleId": "ext_b1",
                    "photoId": "p002",
                    "fileName": "backfill_extra.jpg",
                    "bottleIndex": 1,
                    "poolSource": "backfill_low_score",
                    "decision": "approved",
                    "selectedGroupKey": margaux_g["groupKey"],
                    "cutoutBytes": 21000,
                    "ocrRawText": "CHABLIS DOMAINE RAVENEAU",
                }
            ],
        }

        pool = bct.build_cutout_pool(session)
        self.assertEqual(len(pool), 4)
        self.assertEqual(pool[-1]["poolSource"], "backfill_low_score")

        # 일반 단어(DOMAINE)만 겹치는 컷은 완화 점수 상한(<= 35) 적용
        generic_item = next(p for p in pool if p["bottleId"] == "p001_b3")
        self.assertLessEqual(bct.score_reverse_cutout_match(chablis_g, generic_item), 35.0)

        used_map = bct._compute_used_bottle_map(session)
        recs_unused = bct.recommend_cutouts_for_wine(chablis_g, pool, used_bottle_map=used_map, top_k=5, include_used=False)
        self.assertGreaterEqual(len(recs_unused), 1)
        self.assertEqual(recs_unused[0]["bottleId"], "p001_b1")
        self.assertGreater(recs_unused[0]["score"], 50.0)
        # 다른 와인(margaux_g)에 이미 사용된 ext_b1은 include_used=False에서 제외, True에서 포함
        self.assertNotIn("ext_b1", [r["bottleId"] for r in recs_unused])
        recs_with_used = bct.recommend_cutouts_for_wine(chablis_g, pool, used_bottle_map=used_map, top_k=5, include_used=True)
        self.assertIn("ext_b1", [r["bottleId"] for r in recs_with_used])
        # Chablis/Raveneau 컷은 Krug 추천에서 교차 토큰이 없어 제외됨 (오추천 방지)
        recs_krug = bct.recommend_cutouts_for_wine(krug_g, pool, used_bottle_map=used_map, include_used=True)
        self.assertEqual([r["bottleId"] for r in recs_krug], ["p001_b2"])

        # prefilter_cache에 2개 박스가 있었는데 session에는 box=[150, 10, 260, 400]가 빠져있으면 누락 1건 감지
        prefilter_cache = {
            "/tmp/lineup_a.jpg|123|456": {
                "fileName": "lineup_a.jpg",
                "status": "keep",
                "yoloBoxes": [
                    {"box": [12, 10, 110, 400]},   # p001_b1과 IoU >= 0.45 -> 이미 존재
                    {"box": [150, 10, 260, 400]},  # 미매칭 폐기되었던 박스 -> 보충 대상
                ],
            }
        }
        backfill_plan = bct.plan_unmatched_backfill_targets(session, prefilter_cache)
        self.assertEqual(backfill_plan["totalCachedBoxes"], 2)
        self.assertEqual(backfill_plan["existingSessionBoxes"], 1)
        self.assertEqual(backfill_plan["missingBoxCount"], 1)
        self.assertEqual(backfill_plan["targetsByPhoto"][0]["missingBoxes"], [[150, 10, 260, 400]])

    def test_unlabeled_tab4_apis_upload_export_and_cli_flag(self) -> None:
        import urllib.parse

        db = _make_sample_db()
        # Château Margaux는 이미 1차 라벨 등록 완료로 설정, Krug + 도멘 라블레 샤블리는 미등록
        db["wines"][0]["labelImageFileId"] = "existing_drive_id_1"

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            db_path = tmp / "wine_db.json"
            work_dir = tmp / "work"
            work_dir.mkdir(parents=True)
            session_path = work_dir / "session.json"
            out_path = tmp / "approved_labels.json"
            db_path.write_text(json.dumps(db, ensure_ascii=False), encoding="utf-8")

            parsed = bct.parse_args(
                ["--db", str(db_path), "--serve-only", "--unlabeled-first", "--resume", str(session_path)]
            )
            self.assertTrue(parsed.unlabeled_first)

            groups = bct.build_wine_groups(db)
            margaux_g = next(g for g in groups if g["wineId"] == "w_margaux_2019")
            krug_g = next(g for g in groups if g["wineId"] == "w_krug_mv")
            chablis_g = next(g for g in groups if g["wineId"] == "w_chablis_ko")

            data_url_cutout = "data:image/webp;base64,UklGRjAAAABXRUJQVlA4ICQAAAAQAQCdASoBAAEAAUAmJZgCdAEO/gHOAAD++O3uAAA="
            session_data = {
                "schemaVersion": 1,
                "photosDir": str(tmp),
                "dbPath": str(db_path),
                "ocrMode": "local",
                "photos": [
                    {
                        "photoId": "p001",
                        "fileName": "cellar_01.jpg",
                        "sourcePath": str(tmp / "cellar_01.jpg"),
                        "width": 600,
                        "height": 800,
                        "splitSource": "yolo",
                        "boxes": [[20, 20, 180, 600], [220, 20, 380, 600]],
                        "bottles": [
                            {
                                "bottleId": "p001_b1",
                                "photoId": "p001",
                                "bottleIndex": 1,
                                "box": [20, 20, 180, 600],
                                "cutoutDataUrl": data_url_cutout,
                                "cutoutBytes": 1600,
                                "precutSkippedRembg": False,
                                "ocr": {"rawText": "CHATEAU MARGAUX 2019", "avgConfidence": 0.94, "engine": "mac_vision", "parsedVintage": "2019"},
                                "candidates": [{"groupKey": margaux_g["groupKey"], "wineId": margaux_g["wineId"], "score": 92.0}],
                                "selectedWineId": margaux_g["wineId"],
                                "selectedGroupKey": margaux_g["groupKey"],
                                "alreadyHasLabel": False,
                                "applyAllVintages": True,
                                "decision": "approved",
                            },
                            {
                                "bottleId": "p001_b2",
                                "photoId": "p001",
                                "bottleIndex": 2,
                                "box": [220, 20, 380, 600],
                                "cutoutDataUrl": data_url_cutout,
                                "cutoutBytes": 2200,
                                "precutSkippedRembg": False,
                                "ocr": {"rawText": "DOMAINE RAVENEAU CHABLIS 2022", "avgConfidence": 0.91, "engine": "mac_vision", "parsedVintage": "2022"},
                                "candidates": [{"groupKey": chablis_g["groupKey"], "wineId": chablis_g["wineId"], "score": 48.0}],
                                "selectedWineId": chablis_g["wineId"],
                                "selectedGroupKey": chablis_g["groupKey"],
                                "alreadyHasLabel": False,
                                "applyAllVintages": True,
                                "decision": "excluded",
                            },
                        ],
                    }
                ],
            }
            session_path.write_text(json.dumps(session_data, ensure_ascii=False), encoding="utf-8")

            # HTML 템플릿 내 탭 4, 수동 누끼 점프, 와인명 원클릭 복사 포함 검증
            self.assertIn("tabBtnUnlabeled", bct.REVIEW_HTML_TEMPLATE)
            self.assertIn("cutoutGalleryModal", bct.REVIEW_HTML_TEMPLATE)
            self.assertIn("jumpToTab1ManualCutout", bct.REVIEW_HTML_TEMPLATE)
            self.assertIn("copyWineNameOnly", bct.REVIEW_HTML_TEMPLATE)
            self.assertIn("makeCopyableWineNameEl", bct.REVIEW_HTML_TEMPLATE)

            pipeline = bct.CutoutPipeline(
                photos_path=tmp,
                db_path=db_path,
                work_dir=work_dir,
                detector=bct.BottleDetector(enabled=False),
                segmenter=bct.RembgSegmenter(remove_fn=_mock_remove_bg),
                local_ocr=bct.LocalOcrDispatcher(backend_fn=lambda paths: {}),
                unlabeled_first=True,
            )
            pipeline.load_session(session_path)
            # load_session 시 최신 db 기준으로 alreadyHasLabel 재계산 확인
            self.assertTrue(pipeline.session["photos"][0]["bottles"][0]["alreadyHasLabel"])

            server = bct.create_review_server(pipeline, out_path=out_path, port=0)
            port = server.server_address[1]
            t = threading.Thread(target=server.serve_forever, daemon=True)
            t.start()
            try:
                base = f"http://127.0.0.1:{port}"
                with urllib.request.urlopen(f"{base}/api/state") as r:
                    st = json.loads(r.read().decode("utf-8"))
                self.assertEqual(st["defaultTab"], "unlabeled")
                self.assertEqual(st["unlabeledSummary"]["totalUnlabeled"], 2)

                # cutoutPath 파일이 없어도 cutoutDataUrl 폴백으로 /api/cutout/<id> 정상 응답
                with urllib.request.urlopen(f"{base}/api/cutout/p001_b2") as r:
                    self.assertEqual(r.headers.get("Content-Type"), "image/webp")
                    self.assertGreater(len(r.read()), 10)

                # /api/unlabeled-plan 조회: Margaux 제외, Krug + Chablis만 포함
                with urllib.request.urlopen(f"{base}/api/unlabeled-plan") as r:
                    plan = json.loads(r.read().decode("utf-8"))
                wine_names = {w["name"] for w in plan["wines"]}
                self.assertEqual(wine_names, {"Krug Grande Cuvée", "도멘 라블레 샤블리"})
                ch_plan = next(w for w in plan["wines"] if w["groupKey"] == chablis_g["groupKey"])
                self.assertGreaterEqual(len(ch_plan["recommendationsUnused"]), 1)
                self.assertEqual(ch_plan["recommendationsUnused"][0]["bottleId"], "p001_b2")

                # 1) Chablis -> 기존 누끼(p001_b2) 배정
                req_cut = urllib.request.Request(
                    f"{base}/api/unlabeled-assign",
                    data=json.dumps({
                        "groupKey": chablis_g["groupKey"],
                        "source": "cutout",
                        "bottleId": "p001_b2",
                    }).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req_cut) as r:
                    res_cut = json.loads(r.read().decode("utf-8"))
                self.assertEqual(res_cut["assignment"]["bottleId"], "p001_b2")

                # 2) Krug -> 직접 PNG 이미지 업로드/붙여넣기 -> 500px WebP 변환 & 저장
                raw_png = Image.new("RGBA", (800, 1000), (0, 0, 0, 0))
                ImageDraw.Draw(raw_png).rectangle([250, 100, 550, 900], fill=(180, 140, 40, 255))
                png_buf = io.BytesIO()
                raw_png.save(png_buf, format="PNG")
                png_data_url = "data:image/png;base64," + base64.b64encode(png_buf.getvalue()).decode("ascii")

                req_up = urllib.request.Request(
                    f"{base}/api/unlabeled-assign",
                    data=json.dumps({
                        "groupKey": krug_g["groupKey"],
                        "source": "upload",
                        "imageDataUrl": png_data_url,
                        "fileName": "krug_paste.png",
                    }).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req_up) as r:
                    res_up = json.loads(r.read().decode("utf-8"))
                self.assertEqual(res_up["assignment"]["source"], "upload")

                encoded_gk = urllib.parse.quote(krug_g["groupKey"], safe="")
                with urllib.request.urlopen(f"{base}/api/manual-label/{encoded_gk}") as r:
                    self.assertEqual(r.headers.get("Content-Type"), "image/webp")
                    with Image.open(io.BytesIO(r.read())) as man_im:
                        self.assertLessEqual(max(man_im.size), 500)
                        self.assertEqual(man_im.format, "WEBP")

                # 3) 탭 4 배정분만 내보내기 -> Margaux(1차 완료) 미포함, Chablis + Krug 2건만 출력
                req_exp = urllib.request.Request(
                    f"{base}/api/export-unlabeled",
                    data=b"{}",
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req_exp) as r:
                    exp_res = json.loads(r.read().decode("utf-8"))
                self.assertEqual(exp_res["count"], 2)
                unlabeled_out = Path(exp_res["outPath"])
                self.assertTrue(unlabeled_out.exists())
                bundle = json.loads(unlabeled_out.read_text(encoding="utf-8"))
                self.assertEqual(bundle["schemaVersion"], 1)
                self.assertEqual({it["wineId"] for it in bundle["items"]}, {"w_krug_mv", "w_chablis_ko"})

                # 4) 배정 취소 후 재내보내기 -> 1건만 남음
                req_clr = urllib.request.Request(
                    f"{base}/api/unlabeled-assign",
                    data=json.dumps({"groupKey": krug_g["groupKey"], "source": "clear"}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req_clr) as r:
                    clr_res = json.loads(r.read().decode("utf-8"))
                self.assertIsNone(clr_res["assignment"])

                with urllib.request.urlopen(req_exp) as r:
                    exp_res2 = json.loads(r.read().decode("utf-8"))
                self.assertEqual(exp_res2["count"], 1)
            finally:
                server.shutdown()
                server.server_close()


if __name__ == "__main__":
    unittest.main()
