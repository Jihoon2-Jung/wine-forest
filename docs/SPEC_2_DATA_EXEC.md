# JH Wine Forest — 개발 작업지시서 2부: 데이터·동기화·마이그레이션·실행 계획 (SPEC_2_DATA_EXEC.md)

> **문서 안내:** 본 문서는 `SPEC_1_UI_ARCH.md`에 이어지는 **2부(데이터 스키마, Google Drive 동기화/백업 아키텍처, 기존 엑셀 마이그레이션 스크립트, 디렉터리·CI/CD, 마일스톤 실행 계획)**입니다.

---

## 4. 데이터 스키마 명세 (`wine_db.json`, Schema v1)

정규화된 4-테이블 구조(`wines`, `locations`, `bottles`, `tastings`)를 단일 JSON 파일에 담아 읽기/쓰기 단순성과 데이터 무결성을 동시에 확보합니다. `src/types/schema.ts`에 아래 타입을 그대로 정의하고, `src/types/validation.ts`에 대응하는 `zod` 스키마를 작성하십시오.

```typescript
export type WineColor = 'R' | 'W' | 'SP' | 'SW' | 'RO';
export type BottleStatus = 'IN_STOCK' | 'CONSUMED' | 'GIFTED';

export interface WineMaster {
  id: string;                      // UUID v4
  name: string;                    // 와인명 (필수)
  producer?: string;               // 생산자 (선택)
  country: string;                 // 1단계: 국가 (예: '프랑스', '이탈리아', '미국', '미분류')
  region: string;                  // 2단계: 지역 (예: '부르고뉴', '보르도', '토스카나', VDF 등은 '프랑스')
  subRegion?: string;              // 3단계: 세부지역 — 마을·밭·프리미어/그랑크뤼 (예: '에세죠', '생줄리앙', '볼게리', 상위에서 끝나면 생략)
  color: WineColor;                // R | W | SP | SW(주정강화 포함) | RO
  vintage: string;                 // '2019' 등 4자리 연도 또는 'NV'
  bottleSizeMl: number;            // 기본값 750 (375, 500, 1500 등)
  // --- Phase 2 예약 필드 (1차에서는 유지·보존만 수행, UI 미노출) ---
  labelImageFileId?: string | null; // Google Drive JH_Wine_Forest/photos/ 내 파일 ID
  drinkingWindowStart?: number | null;
  drinkingWindowEnd?: number | null;
  createdAt: string;               // ISO 8601
  updatedAt: string;               // ISO 8601
}

export interface CellarLocation {
  id: string;                      // 예: 'loc_samsung_1_1' 또는 UUID
  zone: string;                    // 대분류: '삼성' | 'LG' | '냉장고 신선' | '거실' 등
  shelf: string;                   // 세부 선반: '1-1' ~ '2-7', '1-1' ~ '3-2', '기본' 등
  displayName: string;             // 화면 표시명 (예: '삼성 1-1', '냉장고 신선')
  maxCapacity: number;             // 최대 정원 (초과 적재 허용, 초과 시 경고 배지만 표시)
  sortOrder: number;               // 화면 정렬 순서
}

export interface BottleInstance {
  id: string;                      // UUID v4 (1행 = 1병)
  wineId: string;                  // FK -> WineMaster.id
  status: BottleStatus;            // 'IN_STOCK' | 'CONSUMED' | 'GIFTED'
  locationId: string | null;       // FK -> CellarLocation.id (소비/선물 시에도 직전 위치 참고용 보존 가능)
  purchaseDate: string | null;     // 'YYYY-MM-DD' (미상 시 null)
  purchaseDateUncertain?: boolean; // 원본 '?' 등 불확실 날짜 표기
  purchaseSource: string;          // 구매처 (예: '이마트', '와인앤모어', '직구')
  purchasePrice: number;           // 병당 원화 정수 (0 이상)
  fxNote?: string;                 // 직구 외화 메모 (예: '9715엔', '45유로')
  includeInTrackingSince: boolean; // 관리 시작일(2023-02-18) 이후 누적 지출 포함 여부
  memo?: string;                   // 비고
  legacyRowNumber?: number;        // 마이그레이션 원본 엑셀 행 번호 추적용
  createdAt: string;
  updatedAt: string;
}

export interface TastingRecord {
  id: string;                      // UUID v4
  bottleId: string;                // FK -> BottleInstance.id (1:1)
  type: 'CONSUMED' | 'GIFTED';     // 소비 vs 선물/양도 구분
  eventDate: string | null;        // 소비/선물 일자 'YYYY-MM-DD'
  occasion?: string;               // 모임명, 장소, 선물 대상
  memo?: string;                   // 1차 간단 메모
  // --- Phase 2 예약 필드 (1차에서는 유지·보존만 수행, UI 미노출) ---
  companions?: string;
  rating?: number | null;
  tastingNote?: string;
  photoFileIds?: string[];
  createdAt: string;
}

export interface AppMetadata {
  schemaVersion: 1;
  appName: 'JH Wine Forest';
  trackingSinceDate: string;       // 기본값 '2023-02-18'
  lastModifiedAt: string;          // ISO 8601
  lastBackupAt: string | null;     // 주 1회 자동 백업 기준 시각 (ISO 8601)
  deviceLabel?: string;            // 마지막 수정 기기 식별자
}

export interface WineDatabase {
  metadata: AppMetadata;
  wines: WineMaster[];
  locations: CellarLocation[];
  bottles: BottleInstance[];
  tastings: TastingRecord[];
}
```

---

## 5. 인증, 오프라인 캐시, 충돌 방지 & 주 1회 자동 백업 아키텍처

### 5.1 저장소 추상화 (`StorageAdapter`)
`src/services/storage/types.ts`에 인터페이스를 분리하여 Google Drive 구현 세부사항이 UI/Store에 새어나가지 않게 설계합니다(향후 2차 이미지 스토리지 확장 및 단위 테스트 Mock 교체 용이).

```typescript
export interface RemoteFileMeta {
  fileId: string;
  modifiedTime: string;
}

export interface BackupSnapshot {
  fileId: string;
  name: string;
  createdTime: string;
  sizeBytes?: number;
}

export interface StorageAdapter {
  ensureWorkspace(): Promise<{ rootFolderId: string; backupFolderId: string; photoFolderId: string }>;
  findDbFile(): Promise<RemoteFileMeta | null>;
  getFileModifiedTime(fileId: string): Promise<string | null>;
  loadDb(fileId: string): Promise<{ data: WineDatabase; modifiedTime: string }>;
  saveDb(
    fileId: string | null,
    data: WineDatabase,
    expectedModifiedTime: string | null
  ): Promise<{ fileId: string; modifiedTime: string }>; // 충돌 시 ConflictError throw
  createBackup(data: WineDatabase, fileName: string): Promise<BackupSnapshot>;
  listBackups(): Promise<BackupSnapshot[]>;
  loadBackup(fileId: string): Promise<WineDatabase>;
  uploadPhoto(blob: Blob, fileName: string): Promise<{ fileId: string }>;
  downloadPhoto(fileId: string): Promise<Blob>;
  deletePhoto(fileId: string): Promise<void>;
}
```

### 5.2 Google Drive 폴더 구조 (`drive.file` 스코프)
앱 최초 연결 시 사용자 구글 드라이브 루트에 아래 폴더를 자동 생성/탐색합니다.
* `JH_Wine_Forest/`
  * `wine_db.json` (메인 DB)
  * `backups/` (주 1회 자동 및 수동 백업 스냅샷: `wine_db_backup_YYYYMMDD.json`)
  * `photos/` (2차 라벨·시음 사진 저장용 예약 폴더)

### 5.3 지연 인증(Lazy Auth) & 1시간 토큰 만료 UX 흐름
서버 없는 브라우저 GIS OAuth는 Access Token 유효 기간이 1시간이므로, 아래 흐름으로 사용자 마찰을 최소화합니다.
1. **앱 실행 (0.5초 내 즉시 렌더):**
   * `localCache.ts` (IndexedDB)에서 마지막 동기화된 `wine_db.json`, `lastSyncedModifiedTime`, **`hasUnsyncedChanges`**를 즉시 로드하여 목록 화면을 바로 보여줍니다.
   * **절대 앱을 열자마자 강제로 구글 로그인 팝업을 띄우지 마십시오.**
   * 메모리에 유효한 Access Token이 있고 **`hasUnsyncedChanges === false`**일 때만 백그라운드에서 Drive의 `modifiedTime`을 확인해 더 최신본이면 조용히 Pull합니다. (미동기화 로컬 변경이 있으면 자동 덮어쓰기 금지)
   * 토큰이 만료되었으면 상단 `SyncBadge`만 `오프라인 캐시(재인증 필요)`로 표시하고 모든 조회·검색·필터·셀러 확인·통계 기능은 100% 정상 동작합니다.
2. **쓰기 작업 발생 시 (입고·소비·이동·수정):**
   * 모든 쓰기는 `SyncEngine`의 **단일 직렬 Write Mutex**를 거쳐 연속 클릭 시 자가 충돌을 방지합니다.
   * 토큰이 유효하면: 즉시 낙관적 업데이트(UI + IndexedDB 반영) 후 Google Drive에 저장.
   * 토큰이 만료되었으면: 변경사항을 IndexedDB(`hasUnsyncedChanges: true`)에 안전 보관한 뒤, **브라우저 팝업 차단기 우회를 위해 상단 배너/배지의 명시적 1클릭 재인증 버튼(동기 클릭 이벤트)**에서 `requestAccessToken()`을 호출하고 인증 완료 즉시 Drive 저장을 이어서 실행합니다.
3. **로컬 테스트 모드 병행 (`LocalOnlyAdapter`):**
   * `VITE_GOOGLE_CLIENT_ID` 없이도 IndexedDB 기반 `LocalOnlyAdapter`로 저장·백업·복원 전체 기능을 테스트할 수 있습니다.
   * 설정에서 로컬 → Google Drive 전환 시 Drive에 기존 파일이 이미 있으면 `[원격 불러오기]` / `[현재 로컬 데이터로 덮어쓰기(원격 대피 백업 후)]` / `[취소]` 확인 모달을 표시합니다.

### 5.4 낙관적 잠금(Optimistic Locking) 충돌 감지 & 해결
1. `saveDb()` 호출 시 업로드 직전 `GET /drive/v3/files/{fileId}?fields=modifiedTime`로 원격 수정 시각을 조회합니다.
2. 원격 `modifiedTime`이 로컬이 알고 있는 `expectedModifiedTime`과 다르면 업로드를 중단하고 `ConflictError`를 발생시킵니다.
3. UI는 **`ConflictModal`**을 띄워 사용자에게 3가지 안전한 선택지를 제공합니다.
   * **`[최신본 불러오기]`** (권장): 원격 최신 DB로 로컬 교체 (방금 시도한 로컬 변경 취소)
   * **`[내 변경으로 덮어쓰기]`**: 원격 파일을 먼저 `backups/wine_db_conflict_YYYYMMDD_HHmmss.json`으로 자동 대피 백업한 뒤 현재 로컬 데이터로 강제 저장
   * **`[내 데이터 로컬 다운로드]`**: 현재 로컬 상태를 `.json` 파일로 PC/폰에 다운로드

### 5.5 주 1회 자동 백업 & 안전한 복원 (유지비 0원)
* **트리거 조건:** 저장 시 `data.metadata.lastBackupAt`이 `null`이거나 현재 시각과 차이가 **7일($7 \times 24$시간) 이상**이면 자동으로 백업을 실행합니다.
* **단일 저장 동작:** `getFileModifiedTime(fileId)` 단건 메타 조회로 사전 충돌 검증을 통과한 뒤 `JH_Wine_Forest/backups/wine_db_backup_YYYYMMDD.json`을 먼저 업로드하고, 성공 시 `lastBackupAt`을 갱신한 데이터로 메인 `wine_db.json`을 **단 1회 저장**합니다(이중 쓰기 방지, `saveDb()` 직전 2차 충돌 검사로 백업 중 타 기기 변경도 방어).
* **복원 전 대피 백업:** 과거 백업 스냅샷으로 복원하기 직전에도 현재 DB를 `backups/wine_db_pre_restore_YYYYMMDD_HHmmss.json`으로 자동 대피 백업합니다.
* **보존 정책:** 백업 파일은 자동 삭제하지 않고 영구 보관합니다(1년 52개 ≈ 15~50MB, 무료 용량 범위).

---

## 6. 기존 엑셀(`wine_list.xlsx`) 마이그레이션 스크립트 명세

`일회성 로컬 이관 스크립트`와 `scripts/requirements.txt`(`openpyxl`)를 작성합니다. 기준 원본은 **`wine_list.xlsx`**(`개편본`은 사용하지 않음)입니다.

### 6.1 엑셀 시트 파싱 및 컬럼 매핑 (`openpyxl` `data_only=True`)
* **`와인리스트` 시트 주요 컬럼 매핑:**
  * `번호` (`A`) → `legacyRowNumber`
  * `구입일` (`B`) → `purchaseDate` (`YYYY-MM-DD` 정규화; `?` 또는 파싱 불가 시 `null` + `purchaseDateUncertain = true` + 검수 리포트 기록)
  * `구매처` (`C`) → `purchaseSource`
  * `와인명` (`D`) → `WineMaster.name`
  * `지역` (`E`) + `와인명` (`D`) + `비고` (`L`) → **3단계 `country` → `region` → `subRegion?` 자동 추론 엔진**으로 변환 (예: `Vin de France` → `프랑스/프랑스/(없음)`, `Echezeaux` → `프랑스/부르고뉴/에세죠`, `Talbot` → `프랑스/보르도/생줄리앙`)
  * `색` (`F`) → `R | W | SP | SW | RO` 대문자 정규화 (예외값 시 검수 리포트 기록)
  * `빈티지` (`G`) → 4자리 연도 문자열 또는 `NV`
  * `수량` (`H`) → 현재 보유(`IN_STOCK`) 병 수 $N$
  * `구매금액` (`I`) → 병당 원화 정수 `purchasePrice` (비고에 합리적 개별 단가가 명시된 행은 선택적 로컬 보정 파일 `--overrides scripts/migration_overrides.local.json`으로 개별 병 단가 분할 적용; 큰 차이/바우처 메모 행은 원가 유지 + 비고 원문 보존, `*.local.json`은 `.gitignore` 차단)
  * `위치` (`K`) → `locationId` 매핑 (`x`는 소비완료, `xxx??`/공백/분실의심 보유 병은 미지정 `null` 처리)
  * `비고(추가는 앞에쓸것)` (`L`) → `memo` 보관 + **좌측=최신 소비 이벤트 규칙**으로 개별 소비일·모임·선물/판매/기부(`GIFTED`)·분실(`CONSUMED`)·용량(`250ml`/`375ml HB`/`500ml`/`1500ml`)·외화 메모(`fxNote`) 자동 파싱
  * `첫소비일` (`M`) → `YYMMDD` 정규화 (`230600`→`2023-06-01`, `220000`→`2022-01-01`, `230000`→`2023-01-01`, 불확실 날짜 추정 규칙 적용)
  * `소비수량` (`N`) → 소비(`CONSUMED`) 또는 선물·양도(`GIFTED`) 병 수 $M$ (별도 날짜 기록이 없는 병은 `첫소비일`을 중복 허용해 채움)
  * `총금액` (`O`) / `From_230218` (`P`) → 엑셀 헤더 검증 셀 `R1`(보유 총 병수), `T1`(보유 총 금액), `V1`(`=SUM(O:O)` 전체 누적 지출액) 기준에 맞춰 `includeInTrackingSince` 판정 및 교차 검증
* **`셀러위치` 시트 매핑 (일반 표 + PivotTable 자동 대응):**
  * 피벗 테이블 형태의 `셀러위치` 시트(`D`열 최대 정원 + `F`열 `SUMIF`)를 자동 해석해 실제 선반 24개의 정원을 추출하고, 물리적 배치 순서(**`삼성 1-1~2-7 → LG 1-1~3-2 → 냉장고 신선 → 거실`**)로 `sortOrder`를 부여합니다.

### 6.2 행 → 개별 병(`BottleInstance`) 전개 규칙
* **`WineMaster` 중복 병합:** `(trim(와인명).toLowerCase(), vintage, bottleSizeMl, color)` 키로 마스터를 생성·재사용합니다(`color` 포함으로 동명 레드/화이트 오병합 차단).
* **보유 병 생성 ($N$ = `수량`):** $N$개의 `BottleInstance`(`status: 'IN_STOCK'`, `locationId` 매핑)를 생성합니다.
* **소비/선물 병 생성 ($M$ = `소비수량`):** $M$개의 `BottleInstance`와 각 1개의 `TastingRecord`를 생성합니다.
  * `비고`의 쉼표/슬래시 구분 이벤트 중 왼쪽을 최신으로 매핑하고, `선물`/`생선`/`양도`/`판매`/`기부`/`도네`가 포함된 개별 병만 `GIFTED`로 분리합니다(구매처가 `지인선물` 등 선물 받은 와인은 유지).
  * 별도 소비일이 없는 병은 `첫소비일`을 중복 허용하여 채웁니다.

### 6.3 3단계 국가·지역·세부지역 자동 매핑 (`REGION_MAP` + `DETAILED_ORIGIN_RULES`)
* **1단계 국가(`country`) → 2단계 지역(`region`) → 3단계 세부지역(`subRegion`, 선택)** 계층으로 정규화합니다.
* 상위에서 끝나는 등급(`Vin de France` → `프랑스 / 프랑스`, `Bordeaux AOC` → `프랑스 / 보르도`, `Toscana IGT` → `이탈리아 / 토스카나`)은 `subRegion`을 비워둡니다.
* 대지역(`부르고뉴`, `보르도`, `토스카나`, `피에몬테`, `나파`, `모젤` 등)을 검색·필터링하면 하위 모든 마을·밭·프리미어크뤼·그랑크뤼(`에세죠`, `볼네`, `샤블리`, `생줄리앙`, `뽀이약`, `볼게리`, `몬탈치노` 등)가 자동으로 함께 조회됩니다.

### 6.4 스크립트 실행 방법 및 산출물 2종
```bash
python3 local_migration_script \
  --input ~/Documents/wine-backup/wine_list.xlsx \
  --out-json wine_db.json \
  --out-report migration_review.md
# (선택) 로컬 보정 파일이 있는 경우: --overrides ~/Documents/wine-backup/migration_overrides.local.json
```
1. **`wine_db.json`:** 웹앱 `JSON 가져오기`로 즉시 임포트 가능한 스키마 v1 준수 JSON.
2. **`migration_review.md`:** 추후 보정이 필요한 항목만 카테고리별로 정리한 리포트:
   * `[정합성 검증표]` 엑셀 원본 헤더 합계(`총 병수`, `총 금액`, `230218이후총금액`) vs 변환 JSON 집계 비교 (**보정 전 원본 기준 0원 일치 확인** + 개별 단가 분할/수량 보정 오버라이드 적용 시 의도된 차액 근거 병기)
   * `[날짜 미상/확인필요]` `구입일`이 `?`이거나 `구입일확인필요` 메모가 있는 행
   * `[복수 구매처·단가 혼재 의심]` `비고`에 `추가`, `+`, `*`, 다중 구매처(`,`) 등이 있는 행
   * `[미확인 위치]` 보유 수량 > 0이나 `위치`가 `xxx??`, `x`, 공백, 미등록 선반인 행
   * `[미분류 지역]` `country === '미분류'`인 지역 목록
   * `[선물·양도 추정 및 분할 소비]` `GIFTED`로 분류했거나 `소비수량 >= 2`인 행

---

## 7. Phase 2 구현 완료 내역 및 향후 확장 범위

1. **적정 음용 시기 (Phase 2-1 — 구현 완료):**
   * `WineMaster.drinkingWindowStart`, `drinkingWindowEnd` 입력·편집, 4단계 상태 판정(`숙성 중`/`지금 적기`/`마감 임박`/`적기 경과`), 목록 배지·필터, 통계 대시보드 드릴다운 카드 구현.
2. **구조화된 시음노트 & 5.0 별점 (Phase 2-2 — 구현 완료):**
   * `TastingRecord`의 `rating`(5.0 만점, 0.5 단위), `tastingNote`, `companions` 입력·인라인 편집, 평점순 정렬/필터, 상세 시트 평균 별점 구현. (프라이버시 모드 ON 시에도 `tastingNote`·`companions`·`rating`은 표시, 기존 `memo`만 마스킹)
3. **미디어 파이프라인 — 라벨 & 시음 사진 (Phase 2-3A & 2-3B — 구현 완료):**
   * **2-3A (앱 내 촬영/업로드):** 클라이언트 Canvas 자동 압축(`imageProcessor.ts`: 라벨 500px / 시음 1024px WebP, JPEG 폴백), Drive `JH_Wine_Forest/photos/` + `LocalOnlyAdapter` IndexedDB `photoCache`(DB v2) 오프라인 캐시, 스토어 `authRevision` 연동으로 재인증 시 미캐싱 Drive 사진 자동 재로딩, 삭제/복원/병합/초기화 시 미참조 고아 사진 정리, `<WineThumbnail />` 실이미지(`w-[52px] h-[74px]` 고정), 라벨 등록/교체/삭제, 시음 사진(최대 3장) 첨부 및 `PhotoLightbox` 확대 뷰어 구현.
   * **2-3B (기존 와인 라벨 일괄 검색·사용자 컨펌 도구):** `scripts/label_review_tool.py`로 **빈티지 구분 없이 `(와인명, 색상)` 단위로 통합**해 공개 API(Open Food Facts / Wikimedia Commons, 선택: `--local-dir` 3자 미만 파일명 제외 및 500px WebP 압축 강제, `--google-cse-key`/`--google-cse-cx`, `--serpapi-key`) 후보 탐색 + 브라우저 검수 HTML(`label_review.html`: XSS 방어 DOM 바인딩, IndexedDB 대용량 자동 저장 및 용량 초과 경고 배너, 후보 선택, 클립보드 `Cmd+V`, 드래그&드롭, 500px WebP 번들 `approved_labels.json` 내보내기) 생성 → 웹앱 **설정 → `[승인된 라벨 일괄 적용]`** (3버튼 확인 모달 · 부분 라벨 그룹 1라벨 동기화 · 401/429 즉시 중단 및 완료분 커밋)으로 `drive.file` 권한 내 일괄 업로드 및 동일 와인 전체 빈티지 공통 연결.
   * **스키마 & 검증 보강:** `wineMasterSchema`에 `drinkingWindowStart <= drinkingWindowEnd` 교차 검증, `wineDatabaseSchema`에 실달력 날짜 검증(`2025-02-31` 차단)·4개 테이블 중복 Primary Key 차단·`tasting.bottleId` 1:1 유일성 검증 추가 (`tastingRecordSchema.rating`은 `schemaVersion: 1` 하위호환을 위해 `0..100` 유지, UI에서 5점 초과 시 `점` 표기). `commitMutation()`은 상태/IndexedDB 쓰기 전에 Zod 검증을 선행하고 `mutationRevision` 기반 lazy snapshot 직렬화로 동시 쓰기 자가 충돌을 방지합니다.

---

## 8. 리포지토리 디렉터리 구조 (`wine-forest/`) 및 CI/CD

### 8.1 표준 폴더 구조
```text
wine-forest/
├── .github/
│   └── workflows/
│       ├── deploy.yml              # GitHub Pages 자동 빌드·배포 (VITE_GOOGLE_CLIENT_ID Secret 주입)
│       └── ios-ipa.yml             # Capacitor iOS 미서명 .ipa 자동 빌드 (xcode-27 러너)
├── ios/                            # Capacitor 8 iOS 네이티브 프로젝트 (SPM + GoogleDriveAuthPlugin.swift)
├── public/
│   ├── icons/                      # PWA 아이콘 (192x192, 512x512, apple-touch-icon)
│   └── favicon.svg                 # JH Wine Forest 심볼 (포레스트 + 와인글라스 미니멀 SVG)
├── scripts/
│   ├── local_migration_script            # wine_list.xlsx -> wine_db.json + migration_review.md
│   ├── label_review_tool.py        # Phase 2-3B 기존 와인 라벨 일괄 검색 · 사용자 컨펌 HTML 생성기
│   └── requirements.txt            # openpyxl
├── src/
│   ├── components/
│   │   ├── common/                 # PriceText(FxNoteText·MemoText 포함), WineColorBadge, WineThumbnail, StarRating, PhotoLightbox, BottomSheet(공용 모달 스택), ConfirmDialog, ConflictModal, SyncBadge, ToastBar
│   │   ├── layout/                 # AppShell, TopHeader, BottomNav, DesktopSidebar, FabButton
│   │   ├── wines/                  # WineGroupCard, WineDetailSheet, BottleRow, FilterBar, QuickAddModal, QuickConsumeModal
│   │   ├── cellar/                 # ShelfCard, ShelfDetailDrawer, MoveBottlePicker, ShelfConfigModal (배치도는 CellarMapPage 통합)
│   │   ├── history/                # HistoryCard (월별 타임라인·평점 정렬·더보기는 HistoryPage 통합)
│   │   └── stats/                  # KpiGrid, ColorDonutChart, RegionBarChart, TrendChart, PriceDistChart
│   ├── pages/
│   │   ├── InventoryPage.tsx       # 탭 1 (기본 홈)
│   │   ├── CellarMapPage.tsx       # 탭 2 (물리적 수직 셀러 캐비닛 배치도)
│   │   ├── HistoryPage.tsx         # 탭 3 (월별 타임라인 + 평점순 정렬 + 최근 50건 점진적 로딩)
│   │   ├── StatsPage.tsx           # 탭 4 (React.lazy 분리 + 음용 적기 현황 카드)
│   │   ├── SettingsPage.tsx        # 설정/백업/임포트/로컬↔Drive 모드 전환
│   │   └── OnboardingView.tsx      # 최초 실행 (Google Drive / 로컬 테스트 / JSON Import)
│   ├── plugins/
│   │   └── googleDriveAuth.ts      # Capacitor 네이티브 GoogleDriveAuth 플러그인 TS 브릿지
│   ├── services/
│   │   ├── auth/                   # googleAuth 파사드, webGisAuthAdapter, nativeGoogleAuthAdapter, types
│   │   ├── native/nativeBridge.ts  # iOS/Android 상태바 연동 & 네이티브 JSON 공유 시트 브릿지
│   │   ├── domain/
│   │   │   ├── wineHelpers.ts      # 4중 키 매칭, 3단계 산지 포맷, 음용 적기 판정, FIFO/빈티지 정렬
│   │   │   └── drinkingWindowEstimator.ts # 지역·등급·색상·빈티지 작황 기반 음용 적기 자동 추천 엔진
│   │   ├── media/
│   │   │   ├── imageProcessor.ts   # 브라우저 Canvas 리사이징 & WebP/JPEG 압축
│   │   │   ├── photoPicker.ts      # 단일 이미지 선택/촬영 진입점 (추후 @capacitor/camera 연결 포인트)
│   │   │   └── photoLoader.ts      # IndexedDB/Drive 사진 캐시 해석기 + usePhotoUrl 훅
│   │   ├── storage/
│   │   │   ├── types.ts            # StorageAdapter 인터페이스 (DB + 백업 + 사진 CRUD)
│   │   │   ├── googleDriveAdapter.ts # Drive API v3 CRUD, 낙관적 잠금, 백업, photos/ 업로드
│   │   │   ├── localOnlyAdapter.ts # IndexedDB 기반 로컬 테스트 어댑터 (사진 Blob 포함)
│   │   │   ├── syncEngine.ts       # Write Mutex 직렬화, 주간 자동 백업, pre_restore 복원
│   │   │   ├── defaultTemplates.ts # 기본 선반 템플릿 & 데모 데이터
│   │   │   └── localCache.ts       # IndexedDB v2 캐시 (appState, localBackups, photoCache)
│   │   └── analytics/statsCalculator.ts # 순수 함수 통계 엔진 (230218 합산·3단계 산지·음용 적기 포함)
│   ├── store/
│   │   └── useWineStore.ts         # Zustand 전역 스토어 + 고아 마스터 정리/중복 병합/사진 업로드
│   ├── styles/
│   │   └── tokens.css              # Light/Dark CSS 변수 + Wine Color 시맨틱 토큰
│   ├── types/
│   │   ├── gis.d.ts                # Google Identity Services 전역 타입 선언
│   │   ├── schema.ts               # WineDatabase TypeScript 타입
│   │   └── validation.ts           # Zod 런타임 검증 스키마
│   ├── App.tsx                     # HashRouter + 테마 초기화 + GIS 스크립트 로더
│   ├── index.css                   # Tailwind 진입점 + tokens.css 임포트
│   ├── main.tsx
│   └── vite-env.d.ts               # Vite 클라이언트/환경변수 타입 선언
├── tests/
│   ├── setup.ts                    # Testing Library & ResizeObserver 테스트 환경 설정
│   ├── privacyMode.test.tsx        # 가격·외화·메모·차트 프라이버시 마스킹 검증
│   ├── statsCalculator.test.ts     # 230218 통계, 3단계 산지, 평균가, 소비/선물 분리 검증
│   ├── schemaValidation.test.ts    # Zod 스키마 및 FK 무결성 검증
│   ├── syncConflict.test.ts        # Mock StorageAdapter 기반 충돌 감지·단건 메타 조회·주 1회 백업·안전 복원 검증
│   ├── wineStore.test.ts           # 4중 키 병합·고아 마스터 정리·선반 이름/삭제·deviceLabel·소비/복원 검증
│   ├── phase2.test.tsx             # Phase 2 음용 적기·별점/시음노트·이미지 리사이징·라벨 일괄 적용·안정화 회귀 검증
│   ├── authAdapter.test.ts         # 웹 GIS 호환·네이티브 무음 복원·401 재시도·동시 갱신 dedupe 검증
│   └── auditFixes.test.tsx         # 전수 감사 회귀 검증(스키마·도메인·통계·동시성·복원·모달스택·프라이버시·스테일상태)
├── docs/
│   ├── SPEC_1_UI_ARCH.md           # 웹 작업지시서 1부
│   ├── SPEC_2_DATA_EXEC.md         # 웹 작업지시서 2부
│   ├── IMPLEMENTATION_PLAN.md      # 최종 구현 계획·완료 명세·안정화/감사 현황
│   ├── MOBILE_IMPLEMENTATION_PLAN.md # 모바일(iOS/Android) 마스터 계획
│   ├── SPEC_MOBILE_IOS.md          # Mac·iOS 개발 작업지시서
│   └── GUIDE_WIN_ANDROID.md        # Windows Android 빌드 실전 가이드
├── capacitor.config.ts             # Capacitor 8 모바일 앱 설정
├── AGENTS.md                       # 워크스페이스 에이전트 규칙 (코드 수정 시 docs/ 자동 동기화)
├── .env.example                    # VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
├── .gitignore
├── index.html                      # GIS client script + Pretendard font + PWA meta
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── vite.config.ts                  # base: '/wine-forest/' + VitePWA 설정
```

### 8.2 핵심 설정 요구사항
* **`vite.config.ts`:**
  * `base: '/wine-forest/'`
  * `VitePWA`: `registerType: 'autoUpdate'`, `manifest.name: 'JH Wine Forest'`, `manifest.short_name: 'Wine Forest'`, `manifest.theme_color: '#1B4332'`, `manifest.background_color: '#0D1411'`, `manifest.display: 'standalone'`.
* **`.github/workflows/deploy.yml`:**
  * `main` 브랜치 push 및 수동 실행(`workflow_dispatch`) 시 트리거.
  * **`build` / `deploy` 2개 Job 분리 (`deploy`가 `needs: build` 의존 — 단일 Job 내 아티팩트 인덱싱 레이스 방지):**
    * `build`: `npm ci` → `npm run typecheck` → `npm run test` → `npm run build` (`env: VITE_GOOGLE_CLIENT_ID: ${{ secrets.VITE_GOOGLE_CLIENT_ID }}`) → `actions/configure-pages@v5` → `actions/upload-pages-artifact@v4` (`path: ./dist`)
    * `deploy`: `actions/deploy-pages@v4` (`environment: github-pages`)
  * 권한: `contents: read`, `pages: write`, `id-token: write`.

---

## 9. 에이전트 단계별 실행 계획 (Milestone Execution Plan)

Antigravity(Gemini Neon)는 아래 **6개 마일스톤**을 순서대로 완료하고, 각 단계의 자가 검증을 통과한 뒤 다음 단계로 진행하십시오.

### Milestone 1: 프로젝트 스캐폴딩, 디자인 토큰, 타입 & 검증 계층
* Vite + React + TypeScript + Tailwind + PWA 초기화, `.gitignore`(개인 데이터·엑셀·JSON·`.env.local` 차단), `.env.example` 구성.
* `src/styles/tokens.css`, `src/types/schema.ts`, `src/types/validation.ts` 작성.
* `public/favicon.svg` 및 PWA 아이콘 생성 (`JH Wine Forest` 미니멀 포레스트·와인글라스 심볼).
* **검증:** `npx tsc --noEmit` 에러 0건.

### Milestone 2: 로컬 캐시, Google Drive 어댑터, 인증 & 충돌/백업 파이프라인
* `googleAuth.ts`(GIS `drive.file` 스코프, Lazy Auth 큐잉), `localCache.ts`(IndexedDB), `googleDriveAdapter.ts`(`JH_Wine_Forest` 폴더/파일 생성, `modifiedTime` 체크, 7일 자동 백업) 구현.
* `useWineStore.ts`에 오프라인 캐시 즉시 로드 + 쓰기 시 Lazy Auth + 충돌 모달 상태 연결.
* **검증:** `tests/syncConflict.test.ts` 및 `tests/schemaValidation.test.ts` 작성 및 `npm run test` 통과.

### Milestone 3: 글로벌 쉘, 벤치마크 기반 목록 화면 & 초고속 입출고 모달
* `AppShell`(모바일 바텀탭 + 데스크톱 사이드바 + 상단 헤더: `👁️` 프라이버시 토글, `☀️/🌙` 테마 토글, 동기화 상태 배지) 구현.
* `InventoryPage`: Vivino/CellarTracker 벤치마크 `WineGroupCard` + 3단계 국가·지역·세부지역 필터 + 색상 칩 + 개별 병 펼치기/상세 시트.
* `QuickAddModal`(기존 와인 자동완성 + $N$병 일괄 입고) 및 `QuickConsumeModal`(소비/선물 1탭 처리).
* `OnboardingView`(로컬 JSON Import / 빈 셀러 시작) 구현.
* **검증:** 개발 서버에서 모바일(`390×844`) 및 데스크톱(`1440×900`) 레이아웃, 라이트/다크 전환, 프라이버시 마스킹 동작 확인.

### Milestone 4: 셀러 배치도, 소비/선물 이력, 통계 대시보드 & 설정 화면
* `CellarMapPage`: InVintory 스타일 멀티 컬러 점유 바, 정원 초과 경고(`-N`), 선반 드로어, 1탭 위치 이동 피커, 선반 설정 CRUD.
* `HistoryPage`: 소비/선물 분리 타임라인 + `[↩️ 보유 복원]` 기능.
* `StatsPage` + `statsCalculator.ts`: 보유 현황, **`23.02.18 이후 누적 지출`**, 소비/선물 분리 KPI, Recharts 4종 차트(클릭 시 목록 필터 드릴다운).
* `SettingsPage`: 동기화, 수동 백업/복원 목록, JSON 내보내기/가져오기, 기준일 설정.
* **검증:** `tests/statsCalculator.test.ts` 작성(보유/소비/선물/230218 합산/평균가/프라이버시 검증) 및 통과.

### Milestone 5: 기존 엑셀 마이그레이션 스크립트 (`일회성 로컬 이관 스크립트`)
* `openpyxl` 기반 `일회성 로컬 이관 스크립트` 및 `scripts/requirements.txt` 작성.
* `와인리스트` + `셀러위치` 파싱, 3단계 국가·지역·세부지역 매핑 사전, `수량`/`소비수량` 개별 병 전개, `From_230218` 매칭, `migration_review.md` 자동 생성 및 1원 단위 정합성 검증 출력 구현.
* **검증:** 합성 샘플 엑셀(엣지케이스: `NV`, `?` 날짜, `YYMMDD`, 다수량+부분소비, `HB`, `선물로변신`, `xxx??`, 미분류 지역 포함)로 실행해 생성된 JSON이 웹앱 Zod 스키마를 통과하는지 검증 후 임시 샘플 파일 삭제.

### Milestone 6: 최종 통합 검증, PWA 점검 및 GitHub Actions 구성
* `.github/workflows/deploy.yml` 작성.
* 프로덕션 빌드 및 미리보기(`npm run build && npm run preview`)로 `HashRouter`, PWA 매니페스트/서비스워커, 콘솔 에러 0건 확인.
* `README.md` 작성 (로컬 실행, GitHub Secrets 등록법, `일회성 로컬 이관 스크립트` 실행 및 앱 최초 Import 가이드 포함).

---

## 10. 최종 완료 기준 (Definition of Done — 검증 완료)

- [x] `npm run test` 모든 단위 테스트(스키마, 230218 통계·3단계 산지, 충돌 감지·주 1회 백업, 프라이버시 마스킹, 스토어 도메인 변이, Phase 2·안정화 회귀, 웹/네이티브 인증 어댑터, 전수 감사 및 Android/공통 회귀) 100% 통과 (**8 suites / 59 tests**)
- [x] `useWineStore` 포그라운드 복귀 조용한 자동 동기화(`syncOnForegroundResume` 30초 쓰로틀 + `syncNow({ silent: true })`, 미동기화·충돌 시 Pull 차단) 및 도메인 변이(`addBottles`/`consumeOrGiftBottle`/`updateTastingRecord`) `CommitResult` 반환 검증 완료
- [x] `npm run build` TypeScript/Vite 에러 및 경고 없이 완료, PWA 서비스워커(`dist/sw.js`) 정상 생성
- [x] 모바일(`390×844`)과 데스크톱(`1440×900`) 양쪽에서 라이트/다크 모드 모두 대비·가독성 결함 없음 (화이트 연노랑 `#F3EED4`/`#EFEAD0` 다크 텍스트 대비 포함)
- [x] 프라이버시 토글(`👁️`) ON 시 앱 내 모든 페이지·모달·외화 메모(`<FxNoteText />`)·비고/메모 원문(`<MemoText />`)·차트(가격대 분포 오버레이 포함)에서 금액 정보 100% 마스킹 확인
- [x] Public 저장소(`wine-forest`)에 실제 개인 와인 데이터나 OAuth Client ID 하드코딩 없음 (`.gitignore` 차단 완료)
- [x] `일회성 로컬 이관 스크립트` 실행 시 `wine_db.json`(초기 이관 완료, 3단계 산지, 소비일 결측 0건)과 `migration_review.md`가 정상 생성되고 웹앱 Zod Import 통과