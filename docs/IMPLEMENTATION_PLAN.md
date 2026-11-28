# JH Wine Forest — 최종 구현 계획 및 완료 명세 (Final v2.0)

> **동기화된 마스터 작업지시서:**
> - **1부 (아키텍처 & UI/UX):** [SPEC_1_UI_ARCH.md](./SPEC_1_UI_ARCH.md)
> - **2부 (데이터·동기화·마이그레이션·실행계획):** [SPEC_2_DATA_EXEC.md](./SPEC_2_DATA_EXEC.md)
> - **구현 상태:** **1차 MVP (Milestone 1~6) + Phase 2 전체 (2-1 음용 적기 · 2-2 별점/시음노트 · 2-3A 앱 내 라벨/시음 사진 · 2-3B 라벨 일괄 검색·컨펌 도구) 100% 구현·검증 완료**

---

## 1. 최종 확정된 아키텍처 & UI/UX 스펙 요약

### 1.1 산지 3단계 계층 (`국가 → 지역 → 세부지역`)
- **스키마 (`WineMaster`):** `country` (1단계: 국가) → `region` (2단계: 지역) → `subRegion?` (3단계: 마을·밭·프리미어크뤼·그랑크뤼, 상위에서 끝나는 등급은 생략).
- **검색·필터 동작:**
  - `부르고뉴`를 선택/검색하면 하위의 `에세죠`, `클로 드 부조`, `본 로마네`, `볼네`, `샤블리`, `마콩` 등 모든 마을/밭/그랑크뤼가 자동으로 함께 노출.
  - `보르도` 선택 시 `마고`, `뽀이약`, `생줄리앙`, `생테스테프`, `페삭 레오냥`, `소떼른`, `바르삭` 등 모두 노출.
  - `Vin de France`(`프랑스/프랑스`), `Bordeaux AOC`(`프랑스/보르도`) 등 상위에서 끝나는 와인은 `subRegion`을 비워둠.
- **통계 대시보드 (`StatsPage`):** `산지별 보유 Top 10` 차트에서 **`국가` | `지역` | `세부지역`** 3단계 전환 및 클릭 시 목록 드릴다운 지원.

### 1.2 브랜드 컬러 & 화이트 와인(`W`) 시맨틱 보정
- **화이트 와인(`W`):** 채도를 낮춘 흰색에 가까운 연노랑 적용
  - Light: `--wine-w: #F3EED4`, 보더 `--wine-w-border: #D5CBA2`, 텍스트 `--wine-w-fg: #3B3520`
  - Dark: `--wine-w: #EFEAD0`, 보더 `--wine-w-border: #C9C097`, 텍스트 `--wine-w-fg: #262214`
- 배지(`WineColorBadge`), 필터 칩(`FilterBar`), 입고 세그먼트(`QuickAddModal`), 보틀 썸네일(`WineThumbnail`), 셀러 점유 바(`ShelfCard`), 도넛 범례(`ColorDonutChart`) 전 영역에 일관 적용.

### 1.3 물리적 셀러 배치도 (`CellarMapPage`)
- **용어 분리:** 목록 필터에서 혼동되던 `구역`을 **`보관 위치`**로 변경해 와인 생산지(`국가/지역/세부지역`)와 완전히 구분.
- **배치 순서 고정:** 항상 **`삼성` → `LG` → `냉장고 신선` → `거실`** 순으로 정렬.
- **수직 적층 랙 뷰:** 실제 셀러 그대로 **바닥(`1-1`)에서 위(`1-2` → … → `1-7`, `2단 2-1` → `2-7`, `3단 3-1` → `3-2`)**로 쌓아 올리는 캐비닛 레이아웃과 단 구분선 적용.

---

## 2. 리스크 보강 및 Trade-off 최종 확정 반영표

| 구분 | 확정 결정 및 구현 위치 |
| :--- | :--- |
| **R2 (팝업 차단 방지)** | 토큰 만료 시 로컬에 안전 저장 후 상단 1클릭 재인증 버튼(동기 클릭 핸들러)에서 GIS `requestAccessToken()` 호출 (`src/components/layout/AppShell.tsx`, `src/services/auth/googleAuth.ts`) |
| **R3 (오프라인 변경 보호)** | IndexedDB에 `hasUnsyncedChanges` 영속화, 미동기화 상태일 때 자동 Pull 덮어쓰기 차단 (`src/services/storage/localCache.ts`, `src/store/useWineStore.ts`) |
| **R4 (자가 충돌 & 백업)** | `SyncEngine` Write Mutex 직렬화 + `StorageAdapter.getFileModifiedTime(fileId)` 단건 사전 충돌 검증 후 주간 자동 백업 선행 업로드, `lastBackupAt` 포함 메인 1회 저장 (`src/services/storage/syncEngine.ts`, `types.ts`) |
| **R6 (마스터 병합 키)** | `(name, vintage, bottleSizeMl, color)` 4중 키로 동명 레드/화이트 오병합 차단 (`src/services/domain/wineHelpers.ts`) |
| **M1~M3 (안전장치)** | 선반 삭제 시 `IN_STOCK`만 차단 + 과거 이력 댕글링 FK 정리, 프라이버시 모드 시 `fxNote`·`memo` 원문·가격대 분포 차트 전체 마스킹, 백업 복원 직전 `pre_restore` 대피 백업, 토큰 만료 시 백업 목록 재인증 안내 |
| **M4~M5 (UX·정합성)** | `QuickAddModal` 오픈 중 `db` 갱신 시 폼 초기화 버그 방지(`useRef`) + `250ml` 프리셋·용량 직접 입력, `WineDetailSheet` 과거 이력 `<MemoText />` 및 경량 `[↩️ 복원]`, 마지막 병 삭제 시 0병 고아 `WineMaster` 자동 정리, 마스터 수정 시 4중 키 중복 확인 후 병합 |
| **T1 (누적 지출 기준)** | 관리 기준일(`trackingSinceDate`) 이후 전체 누적 지출 기준 유지 (보유+소비+선물 합산) |
| **T2 (모바일 성능)** | `HistoryPage` 최근 50건씩 점진적 표시 + `[더보기]` / `[전체 보기]` (`src/pages/HistoryPage.tsx`) |
| **T3 (다중 가격 표기)** | 모바일 카드 `평균 ₩XX,XXX`, 데스크톱 카드 `평균 ₩XX,XXX` + `최저~최고` 범위 병기 (`src/components/wines/WineGroupCard.tsx`) |
| **T4 (빈티지 오입력 방지)** | 자동완성 선택 시 기존 빈티지 채움 + 골드 하이라이트 및 자동 포커스/선택 (`src/components/wines/QuickAddModal.tsx`) |
| **T5 (로컬→Drive 전환)** | Drive에 기존 파일 존재 시 `[원격 불러오기]` / `[로컬로 덮어쓰기(대피 백업 후)]` / `[취소]` 모달 (`src/pages/SettingsPage.tsx`) |
| **T6 (라이브러리·백업)** | Recharts v2.x (`^2.15.3`) 안정 버전 유지 + 백업 영구 보관 |
| **D1~D5 (초기 엑셀 이관)** | 초기 1회 이관 완료(`판매`/`기부`→`GIFTED`, `분실`→`CONSUMED`, 3단계 산지 매핑, Zod 검증 통과) 후 Public 저장소 프라이버시 보호를 위해 일회성 엑셀 이관 스크립트는 로컬 개인 백업 폴더로 이관 및 Git 저장소·이력에서 영구 제거 완료 (기존 DB 호환을 위해 `legacyRowNumber?` 스키마 필드는 유지) |
| **다기기 동기화 원칙** | 로그인한 Google 계정의 개인 Drive(`JH_Wine_Forest/wine_db.json`)에 독립 저장되므로, PC·스마트폰 등 여러 기기 동기화 시 동일 Google 계정 로그인 필수 (모바일은 Safari/Chrome 사용 권장) |

---

## 3. 마일스톤 완료 현황 및 검증 결과

- **Milestone 1~4 (웹앱 풀스택 SPA/PWA):** 완료 (`src/` 전체 + `public/` 아이콘 + Tailwind/CSS 변수)
- **Milestone 5 (초기 엑셀 마이그레이션 — 완료 및 스크립트 아카이브):** 초기 1회 `wine_db.json` 변환·Zod 검증·Drive Import 완료 후, Public 저장소 프라이버시 강화를 위해 일회성 엑셀 이관 스크립트는 로컬 개인 백업 폴더로 복사 보관하고 Git 저장소·이력에서 영구 제거 완료
- **Milestone 6 (CI/CD · 테스트 · 실배포):** `.github/workflows/deploy.yml`(`build`/`deploy` 2개 Job 분리, `actions/upload-pages-artifact@v4`, `actions/deploy-pages@v4`), `README.md`, `npm run typecheck` (0 errors), `npm run test` (**9 suites / 69 tests pass**, `authAdapter.test.ts` · `auditFixes.test.tsx` · `shareLink.test.tsx` 포함), `npm run build` (0 warnings, PWA `dist/sw.js` 생성), `npm run build:mobile` (Capacitor `./` 번들 · Web GIS 제거 · SW 미생성), GitHub Pages 프로덕션 배포 및 PC·스마트폰 Google Drive 동기화 검증 완료
- **Phase 2 (2-1 · 2-2 · 2-3A · 2-3B 전체 완료):**
  - **2-1 적정 음용 시기:** `drinkingWindowStart`/`End` 입력·편집(`start <= end` 검증), Wine Spectator·Wine Advocate 지역·빈티지 차트 기반 신규 입력 자동 추천(`drinkingWindowEstimator.ts` — 부르고뉴 빌라쥬/그랑크뤼 정밀 분리 · `꼬르똥`/`샤또뇌프` 한글 표기 통일 · `RO`/`SP` 조기 분기) 및 기존 미입력 와인 1클릭 일괄 자동 채우기, 4단계 상태 배지, 목록 1탭 `지금 적기` 필터, 통계 대시보드 음용 적기 드릴다운 카드
  - **2-2 별점 · 시음노트 · 동반자:** 5.0 만점 0.5단위 별점(`StarRating` — `schemaVersion: 1` 하위호환을 위해 Zod `0..100` 유지, 5점 초과 레거시 점수는 `92점` 표기), `QuickConsumeModal` 접이식 상세 시음 기록, `HistoryPage` 평점 필터·평점순 정렬, `WineDetailSheet` 평균 별점, 프라이버시 모드 2-A 정책(`tastingNote`·`companions` 유지 / `memo` 마스킹)
  - **2-3A 라벨 & 시음 사진 파이프라인:** `imageProcessor.ts`(500px/1024px WebP 자동 압축), `photoPicker.ts`(웹/Capacitor 단일 진입점), Drive `photos/` + IndexedDB `photoCache` v2 오프라인 캐시, `authRevision` 재인증 후 미캐싱 사진 자동 재로딩, `<WineThumbnail />` 실이미지, 라벨 등록/교체/삭제(빈티지 무관 `(와인명, 색상)` 공통 적용 및 신규 빈티지 상속), 시음 사진 최대 3장 첨부 및 `PhotoLightbox` 확대 뷰어
  - **2-3B 기존 와인 라벨 일괄 검색·컨펌 도구:** `scripts/label_review_tool.py`(빈티지 통합 `(와인명, 색상)` 그룹화 · XSS 방어 DOM 바인딩 · IndexedDB 대용량 자동 저장 및 용량 초과 경고 · `--local-dir` 500px WebP 압축 강제 · 짧은 파일명 오매칭 가드) + 웹앱 설정 화면 `[승인된 라벨 일괄 적용]`(3버튼 `<BottomSheet>` 중복 처리 모달 · 부분 라벨 그룹 1라벨 동기화 · 401/429 즉시 중단 및 부분 커밋)
- **무서버 읽기 전용 와인 리스트 공유 ([SPEC_SHARE_LINK.md](./SPEC_SHARE_LINK.md)) 완료 ✅:**
  - `src/services/share/shareCodec.ts`(컴팩트 v1 사전·튜플 직렬화, `deflate-raw` `z.`/`u.` Base64URL, 512KB Zip-bomb 스트리밍 상한·Zod 검증, 프라이버시 체크박스 해제 항목 데이터 레벨 원천 제거, 소프트 만료, Capacitor→공개 GitHub Pages URL 치환, 메신저용 텍스트 목록 포맷터)
  - `src/services/native/nativeBridge.ts`(`copyTextToClipboard` · `canUseNativeShareSheet` · `shareTextOrUrl`), `ShareListModal.tsx`(프라이버시 4종 기본 OFF · 실시간 URL 길이 게이지 · 복사/OS 공유/텍스트 복사/미리보기), `InventoryPage.tsx`(`리스트 공유` 진입점)
  - `App.tsx`(`HashRouter` 최상위 승격 + `/share` 무인증 선분기) 및 `SharedListPage.tsx`(비로그인 즉시 열람, 독립 검색/색상/적기/정렬/로컬 금액 가리기, 만료/오류 안전 화면), `tests/shareLink.test.tsx` 10개 테스트 전원 통과
- **다중 와인 보틀 누끼 분할 & 1-B OCR 매칭 도구 Phase 1 ([SPEC_BOTTLE_CUTOUT.md](./SPEC_BOTTLE_CUTOUT.md)) 완료 ✅:**
  - `scripts/bottle_cutout_tool.py`(사전 선별 `--prefilter`/`--prefilter-only`[YOLO 앞줄 병 탐지·라플라시안 선명도·dHash 연사 중복 제거·2~8병 모임샷 우선 정렬·`prefilter_cache.json`], 배치 슬라이싱 `--batch-size`/`--batch-index`, `--skip-existing-labels`, `--auto-match-only`, `--serve-only`, `--unlabeled-first`, COCO ONNX `class_id == 39` 앞줄 필터+크기순 15병 + 알파 상단 넥 밸리 폴백 다병 좌→우 분할, 투명 RGBA 입력 시 `rembg` 자동 스킵, 병별 인접 엣지 억제·유리 반사 홀 메우기·불량 실루엣 `>= 1.6` & 0줄 OCR 자동 폐기·1px 페더링, `350×500` 투명 WebP 하단 정렬, 1-B 하이브리드 OCR 및 고유 와인명 검증 포함 불어·한글 음차 `wine_db.json` 퍼지 매칭, 10장 체크포인트 저장·와인별 베스트 1장 자동 선정/중복 제거, `127.0.0.1` 4-탭 리뷰 서버[/api/boxes 즉시 저장 · 0개 박스 `/api/recut` · 탭 2 일괄 확정 `/api/bulk-approve` · 전체 DB 악센트/산지 검색 · 탭 3 중복 대표 고르기 `/api/select-representative` & 그룹 제외 `/api/exclude-group` · 탭 4 라벨 없는 와인 역방향 매칭(`build_cutout_pool`/`plan_unmatched_backfill_targets` 확장형 풀 · Top-6 추천 · 전체 누끼 갤러리 · 드롭/`Cmd+V` 500px WebP 업로드 · 1단계 수동누끼 왕복 · `*_unlabeled.json` 분리 내보내기)], `approved_labels.json` v1 내보내기) + `scripts/mac_vision_ocr.swift`(macOS `VNRecognizeTextRequest` 배치 헬퍼) + `scripts/requirements_cutout.txt` + `.gitignore` 차단 규칙 추가
  - `tests/test_bottle_cutout.py` **19개 테스트 전원 통과**(실시간 `mac_vision_ocr.swift` OCR·사전선별·배치 분할·앞줄 필터·불량 실루엣 `>= 1.6` & 0줄 OCR 폐기·고유명 매칭·와인별 베스트 1장 선정·`/api/boxes`·`/api/bulk-approve`·`/api/select-representative`·`/api/exclude-group`·`--serve-only`·`--unlabeled-first`·역방향 추천 풀·`plan_unmatched_backfill_targets`·`/api/unlabeled-plan`·`/api/unlabeled-assign`·`/api/export-unlabeled` 포함), 기존 웹 `npm run test` (**9 suites / 69 tests**) 무회귀 확인

---

## 4. 안정화 수정 반영 이력 & 전체 전수 감사 현황 (2026-11-26 기준)

### 4.1 반영 완료된 안정화 및 전수 감사 패치 (Part A 46건 전량 수정·검증 완료 ✅)
1. **사진 편집/모달 생명주기 & 고아 파일 정리:** `HistoryCard` 편집 취소 시 신규 업로드만 정리하고 기존 사진 삭제는 `[저장]` 확정 및 `synced` 시점에만 반영(편집 재진입 드래프트 초기화·언마운트 정리 포함); `QuickConsumeModal` 미저장 닫기/언마운트 시 업로드 사진 정리 및 `db`/`bottles` 갱신 시 입력 폼 초기화 방지(`latestFifoRef`); `disconnectAndResetLocal` 시 IndexedDB `appState`·`localBackups`·`photoCache`·메모리 ObjectURL 일괄 초기화; `deleteBottle`/`restoreBottleToStock`/`updateWineMaster` 병합 시 미참조 고아 사진 정리 및 마스터 메타데이터(`labelImageFileId`, `drinkingWindowStart/End` 역전 보정, `producer`) 계승.
2. **Tailwind RGB 투명도 토큰 & 모바일 UI/Safe-Area/모달 스택 복구:** `tokens.css`에 Light/Dark `--*-rgb` 채널 추가 및 `tailwind.config.ts` `rgb(var(--...-rgb) / <alpha-value>)` + `status.*` 토큰 전환(기존 미컴파일 138건 + `/8`·`/12` 14건 전량 복구); `WineThumbnail` 고정 크기(`w-[52px] h-[74px]`), `FabButton`/`ToastBar`/`AppShell`/`OnboardingView`/`PhotoLightbox`/`BottomSheet` Safe-Area 및 `lg:` 브레이크포인트 통일; `BottomSheet`/`PhotoLightbox` 공용 모달 스택(`registerModalLayer`) + 참조 카운트 스크롤 잠금; `ConfirmDialog` 신설로 전 화면 `window.confirm` 제거(iOS `WKWebView` 크래시 방지).
3. **동기화·인증·스토리지 무결성 전면 보강:** `useWineStore` `mutationRevision` 기반 lazy snapshot flush(`SyncEngine`)로 동시 `commitMutation` 자가 충돌·중복 `wine_db.json` 생성 차단; `syncNow()` Pull 전후 편집 보호 및 `FileNotFoundError`(404·`trashed`) 자동 재생성 복구; `commitMutation()` 최상단 Zod 선행 검증(실달력 날짜·중복 PK·1:1 `tasting.bottleId` 포함) 및 5개 폼 입력 가드; IndexedDB `dbPromise` `blocking`/`terminated`/`.catch` 자동 복구(`withDbRetry`) 및 `persistLocalCache` 격리; `GoogleDriveAdapter` `ensureWorkspace` single-flight·`createdTime asc`·순차 `loadDb`·백업 `nextPageToken` 페이지네이션·401 토큰 무효화; `WebGisAuthAdapter` `drive.file` 스코프·시퀀스 검증; `NativeGoogleAuthAdapter` `forceRefresh`·`sessionGeneration`·오프라인 세션 보존; `SyncEngine.restoreBackupSafely` 선검증 및 원격 최신본 우선 대피; 모드 전환 시 `local_photo_*` Drive 자동 이관·`localOnlyAdapter.reset()`; `ConflictModal` 내부 `[구글 재인증]` 지원; `photoLoader` 동시 다운로드 5건 제한·401 전파·`cacheEpoch`/`fileVersions` 좀비 삽입 방지·`authRevision` 재로딩.
4. **페이지 스테일 상태·프라이버시·도메인/통계·스크립트 마감:** `WineDetailSheet` `wineId` 전환 리셋, `QuickAddModal` `dwManualOverrideRef` 레이스 차단·타이머 정리·키보드 자동완성, `TrendChart` 금액 모드 프라이버시 전체 오버레이, `ColorDonutChart` 툴팁 대비 보정, `SettingsPage`/`OnboardingView`/`BottleRow`/`CellarMapPage`/`ShelfDetailDrawer`/`InventoryPage`/`ShelfConfigModal`(`reorderLocations` 원자화)/`HistoryPage`/`FilterBar` 스테일 상태·접근성(`role="radio"`·중첩 Enter 차단·`초과 +N`) 개선; `drinkingWindowEstimator.ts`(`Aloxe-Corton`·`\bport\b`·`\bnapa\b`·미국 `SW`·NV `referenceYear`·악센트/변형)·`wineHelpers.ts`(Unicode NFC/공백 정규화·`formatCompactKrw` 경계)·`statsCalculator.ts`(`yearly` 0년 채우기·소비 상태 검증) 보강; `scripts/label_review_tool.py`(`HTTPException`/워커 예외 격리·숨김 카드 `activeWineId` 초기화·`<`/`>`/`&` HTML5 안전 이스케이프·IDB 연결 재사용/직렬화·공유 락 rate-limiter·10초 타임아웃·JPEG 흰 바탕) 전면 보강 *(일회성 엑셀 이관 스크립트는 이관 완료 후 로컬 백업으로 분리 보관 및 저장소·이력에서 영구 제거)*.
5. **iOS 네이티브 & CI 보강:** `Info.plist` `NSPhotoLibraryAddUsageDescription` 추가(필수 권한 3종 완비) 및 `ko`/`en` 로컬라이제이션, `StatusBar.overlaysWebView: true`, `GoogleDriveAuthPlugin.swift` 메인 스레드 직렬화·`CFBundleURLSchemes` 일치 검증·`SCOPE_DENIED` `signOut()` 정리, `SceneDelegate.swift` 콜드스타트/다중 URL 전달, `nativeBridge.ts` `Share.share` 중복 `text` 제거, `vite.config.ts` Capacitor 빌드 Web GIS `<script>` 제거, `.gitignore` `.env.*` 차단, `ios-ipa.yml` `bundle_id`·`REVERSED_ID` 검증 강화.
6. **Android 실기기 & 공통 안정화 패치 10건 (`feat/android-v1`, `v1.0.1 / versionCode 2`):** OAuth 프로덕션 브랜딩용 `public/privacy.html` 배포(`/wine-forest/privacy.html`), Android 15~17 `SystemBars` 상·하단 시스템 바 동시 동기화 및 CSS `--safe-area-inset-*` 폴백, `GoogleDriveAuthPlugin.kt` 영속 이메일(`signOut` 후 `revokeAccess` 보장)·`bridge.saveCall`·오프라인 네트워크 오류 세션 보존, 포그라운드 복귀 조용한 자동 동기화(`syncOnForegroundResume` 30초 쓰로틀) 및 `appRestoredResult` 카메라 복구 안내, 사진 선택 이중 탭 잠금(`WineDetailSheet`/`QuickConsumeModal`/`HistoryCard`), 검증 실패(`'invalid'`) 시 모달·초안·사진 보존, Android `.json` 피커 호환(`accept=".json,application/json,text/plain,*/*"`), `AndroidManifest.xml` `allowBackup="false"`, 네이티브 `"이 기기"` 문구 통일, 신규 회귀 테스트 4건 추가(총 **8개 스위트 / 59개 테스트** 통과).

### 4.2 잔여 백로그 및 유지 확정 트레이드오프
- **전수 감사 Part A (확실한 버그 46건):** **미해결 0건 (100% 반영·검증 완료 ✅)**
- **⚖️ 유지 확정 트레이드오프 (Part B 14건, 의도된 설계 유지):** Drive 클라이언트 낙관적 락, Web GIS 1시간 지연 재인증, Public 저장소 내 Client ID & 비서명 IPA 배포, 단일 `wine_db.json` 전체 저장, `rating` `0..100` v1 하위호환, 사진 즉시 삭제 정책, 세션 `memoryObjectUrls` 풀, Capacitor 2단계 리사이징(OOM 방지), 프라이버시 2-A 정책, 도메인 단순화 규칙, 서버리스 `file://` CORS 제약 등.
