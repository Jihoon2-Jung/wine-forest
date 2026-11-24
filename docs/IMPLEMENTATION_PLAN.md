# JH Wine Forest — 최종 구현 계획 및 완료 명세 (Final v2.0)

> **동기화된 마스터 작업지시서:**
> - **1부 (아키텍처 & UI/UX):** [SPEC_1_UI_ARCH.md](./SPEC_1_UI_ARCH.md)
> - **2부 (데이터·동기화·마이그레이션·실행계획):** [SPEC_2_DATA_EXEC.md](./SPEC_2_DATA_EXEC.md)
> - **구현 상태:** **1차 MVP (Milestone 1~6) + Phase 2 (2-1 음용 적기 · 2-2 별점/시음노트 · 2-3A 앱 내 라벨/시음 사진) 100% 구현·검증 완료**

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
| **R6 (마스터 병합 키)** | `(name, vintage, bottleSizeMl, color)` 4중 키로 동명 레드/화이트 오병합 차단 (`src/services/domain/wineHelpers.ts`, `일회성 로컬 이관 스크립트`) |
| **M1~M3 (안전장치)** | 선반 삭제 시 `IN_STOCK`만 차단 + 과거 이력 댕글링 FK 정리, 프라이버시 모드 시 `fxNote`·`memo` 원문·가격대 분포 차트 전체 마스킹, 백업 복원 직전 `pre_restore` 대피 백업, 토큰 만료 시 백업 목록 재인증 안내 |
| **M4~M5 (UX·정합성)** | `QuickAddModal` 오픈 중 `db` 갱신 시 폼 초기화 버그 방지(`useRef`) + `250ml` 프리셋·용량 직접 입력, `WineDetailSheet` 과거 이력 `<MemoText />` 및 경량 `[↩️ 복원]`, 마지막 병 삭제 시 0병 고아 `WineMaster` 자동 정리, 마스터 수정 시 4중 키 중복 확인 후 병합 |
| **T1 (누적 지출 기준)** | 초기 이관 전체 병을 포함해 `V1` 기준 유지 (`migration_review.md`에 보정 전 원본 0원 일치 + 개별 보정 차액 근거 병기) |
| **T2 (모바일 성능)** | `HistoryPage` 최근 50건씩 점진적 표시 + `[더보기]` / `[전체 보기]` (`src/pages/HistoryPage.tsx`) |
| **T3 (다중 가격 표기)** | 모바일 카드 `평균 ₩XX,XXX`, 데스크톱 카드 `평균 ₩XX,XXX` + `최저~최고` 범위 병기 (`src/components/wines/WineGroupCard.tsx`) |
| **T4 (빈티지 오입력 방지)** | 자동완성 선택 시 기존 빈티지 채움 + 골드 하이라이트 및 자동 포커스/선택 (`src/components/wines/QuickAddModal.tsx`) |
| **T5 (로컬→Drive 전환)** | Drive에 기존 파일 존재 시 `[원격 불러오기]` / `[로컬로 덮어쓰기(대피 백업 후)]` / `[취소]` 모달 (`src/pages/SettingsPage.tsx`) |
| **T6 (라이브러리·백업)** | Recharts v2.x (`^2.15.3`) 안정 버전 유지 + 백업 영구 보관 |
| **D1~D5 (엑셀 이관)** | `판매`/`기부`→`GIFTED`, `분실`→`CONSUMED`, 불확실 날짜 추정, 미확인 위치 미지정 처리, 개별 단가 보정(로컬 보정 파일 분리) 및 산지 오기재 교정 완료 후 일회성 이관 스크립트 로컬 아카이브 |
| **다기기 동기화 원칙** | 로그인한 Google 계정의 개인 Drive(`JH_Wine_Forest/wine_db.json`)에 독립 저장되므로, PC·스마트폰 등 여러 기기 동기화 시 동일 Google 계정 로그인 필수 (모바일은 Safari/Chrome 사용 권장) |

---

## 3. 마일스톤 완료 현황 및 검증 결과

- **Milestone 1~4 (웹앱 풀스택 SPA/PWA):** 완료 (`src/` 전체 + `public/` 아이콘 + Tailwind/CSS 변수)
- **Milestone 5 (엑셀 마이그레이션):** `일회성 로컬 이관 스크립트` 실행 → `wine_db.json` (초기 이관 완료 · 3단계 산지 · 미분류 0건 · 소비일 결측 0건 · 선반 24개) 및 `migration_review.md` 생성, Zod 통과
- **Milestone 6 (CI/CD · 테스트 · 실배포):** `.github/workflows/deploy.yml`(`build`/`deploy` 2개 Job 분리, `actions/upload-pages-artifact@v4`, `actions/deploy-pages@v4`), `README.md`, `npm run typecheck` (0 errors), `npm run test` (6 suites / 25 tests pass), `npm run build` (0 warnings, PWA `dist/sw.js` 생성), GitHub Pages 프로덕션 배포 및 PC·스마트폰 Google Drive 동기화 검증 완료
- **Phase 2 (2-1 · 2-2 · 2-3A 완료):**
  - **2-1 적정 음용 시기:** `drinkingWindowStart`/`End` 입력·편집, 4단계 상태 배지, 목록 1탭 `지금 적기` 필터, 통계 대시보드 음용 적기 드릴다운 카드
  - **2-2 별점 · 시음노트 · 동반자:** 5.0 만점 0.5단위 별점(`StarRating`), `QuickConsumeModal` 접이식 상세 시음 기록, `HistoryPage` 평점 필터·평점순 정렬, `WineDetailSheet` 평균 별점, 프라이버시 모드 2-A 정책(`tastingNote`·`companions` 유지 / `memo` 마스킹)
  - **2-3A 라벨 & 시음 사진 파이프라인:** `imageProcessor.ts`(500px/1024px WebP 자동 압축), Drive `photos/` + IndexedDB `photoCache` v2 오프라인 캐시, `<WineThumbnail />` 실이미지, 라벨 등록/교체/삭제, 시음 사진 최대 3장 첨부 및 `PhotoLightbox` 확대 뷰어 *(2-3B 기존 다수 와인 반자동 라벨 크롤링·컨펌 도구는 추후 진행)*
