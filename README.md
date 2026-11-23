# JH Wine Forest

개인용 와인 셀러 재고 · 선반 배치도 · 소비/선물 이력 · 통계 대시보드를 제공하는 설치형 웹앱(PWA)입니다.  
서버 유지비 0원으로 **GitHub Pages**에 호스팅하고, 데이터는 본인 **Google Drive (`drive.file` 최소 권한)**의 단일 JSON(`wine_db.json`)으로 안전하게 동기화합니다.

## 주요 기능 (1차 MVP)
- **와인 목록 & 초고속 검색 (`/`):** `와인명 + 빈티지 + 용량 + 색상` 그룹 카드 뷰, **3단계 `국가 → 지역 → 세부지역(마을·밭·그랑크뤼)`** 계층 필터(`부르고뉴` 검색 시 하위 밭/그랑크뤼 자동 포함), 색상·보관 위치·정렬, 개별 병 드릴다운, 기존 와인 자동완성 및 $N$병 일괄 초고속 입고
- **셀러 배치도 (`/cellar`):** `삼성 → LG → 냉장고 신선 → 거실` 순 물리적 수직 캐비닛(아래 `1-1`부터 위로 적층), InVintory 스타일 멀티 컬러 점유 바, 정원 초과 경고 배지(`-N`), 1탭 위치 이동 피커, 선반 CRUD
- **소비 · 선물 이력 (`/history`):** 소비(`CONSUMED`) / 선물·양도(`GIFTED`) 분리 월별 타임라인, 이력 수정, 오조작 복구(`[↩️ 보유 복원]`)
- **통계 대시보드 (`/stats`):** 현재 보유, **관리 기준일(`2023-02-18`) 이후 누적 지출(`From_230218`)**, 누적 소비/선물 분리 KPI, Recharts 인터랙티브 4종 차트(클릭 시 목록 필터 드릴다운)
- **프라이버시 모드(`👁️`) & 라이트/다크 모드:** 상단 토글 1탭으로 모든 가격·외화 메모·비고/메모 원문·가격대 차트 즉시 마스킹
- **오프라인 캐시 · 충돌 방지 · 주 1회 자동 백업:** IndexedDB 0.5초 즉시 조회, 1시간 토큰 만료 시 1클릭 재인증, 저장 직전 `modifiedTime` 낙관적 잠금, 7일 경과 시 `JH_Wine_Forest/backups/` 자동 스냅샷 백업
- **로컬 테스트 모드 병행:** Google OAuth Client ID 없이도 IndexedDB 기반 `LocalOnlyAdapter`로 데모 데이터 체험 및 전체 기능 검증 가능

---

## 1. 로컬 개발 및 실행

```bash
npm install
cp .env.example .env.local
# (선택) .env.local에 VITE_GOOGLE_CLIENT_ID 입력 — 미입력 시 로컬 테스트 모드로 바로 실행 가능
npm run dev
```

테스트 및 프로덕션 빌드 검증:

```bash
npm run typecheck
npm run test
npm run build
npm run preview
```

---

## 2. Google Cloud OAuth & GitHub Secrets 설정

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 생성하고 **Google Drive API**를 활성화합니다.
2. **OAuth 동의 화면**을 구성(외부/테스트 모드 시 본인 Google 계정을 테스트 사용자로 등록)하고, 범위는 `https://www.googleapis.com/auth/drive.file`만 사용합니다.
3. **사용자 인증 정보 → OAuth 클라이언트 ID (웹 애플리케이션)**를 생성합니다.
   - **승인된 자바스크립트 원본(Authorized JavaScript origins)**에 아래 도메인을 **경로 없이 소문자**로 등록합니다:
     - `http://localhost:5173`
     - `https://<github계정명>.github.io`
   - 순수 정적 SPA이므로 Client Secret은 사용하지 않습니다.
4. GitHub 저장소(`wine-forest`) **Settings → Secrets and variables → Actions**에서 `VITE_GOOGLE_CLIENT_ID` 시크릿을 등록합니다.
5. **Settings → Pages → Source**를 `GitHub Actions`로 설정하고 `main` 브랜치에 push하면 자동 배포됩니다.

> **참고 (Public 저장소 보안):** `VITE_GOOGLE_CLIENT_ID`는 SPA 빌드 결과물에 포함되는 공개 식별자이며, 실제 접근 통제는 Google Cloud Console의 승인된 JS 원본 제한과 OAuth 테스트 사용자/권한 동의로 보호됩니다. 실제 와인 데이터(`*.xlsx`, `wine_db*.json`, `migration_review*.md`, `*.local.json`, `.env.local`)는 `.gitignore`로 커밋이 차단되어 있습니다.
>
> **다기기(PC·스마트폰) 동기화 팁:** 데이터는 로그인한 Google 계정의 개인 Drive(`내 드라이브/JH_Wine_Forest/wine_db.json`)에 독립 저장됩니다. PC와 스마트폰에서 같은 셀러를 보려면 **동일한 Google 계정**으로 로그인해 주세요. (모바일에서 카카오톡·네이버 인앱 브라우저는 Google OAuth 팝업이 차단되므로 **Safari 또는 Chrome**에서 여는 것을 권장합니다.)

---

## 3. 기존 엑셀(`wine_list.xlsx`) 마이그레이션 및 앱 Import

PC에서 Python 변환 스크립트를 실행해 `wine_db.json`과 검수 리포트(`migration_review.md`)를 생성합니다.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements.txt

python3 local_migration_script \
  --input ~/Documents/wine-backup/wine_list.xlsx \
  --out-json wine_db.json \
  --out-report migration_review.md
# (선택) 개별 단가·수량 로컬 보정 파일이 있는 경우: --overrides ~/Documents/wine-backup/migration_overrides.local.json
```

> ⚠️ **Public 저장소 보안 주의:** 원본 `.xlsx`, `wine_db.json`, `migration_review.md`, `*.local.json`은 `.gitignore`에 차단되어 있으나, `git add -f` 같은 강제 커밋 실수를 막기 위해 **원본 엑셀과 결과물은 프로젝트 밖 개인 폴더(예: `~/Documents/wine-backup/`)에 보관**하는 것을 권장합니다.

1. 생성된 `migration_review.md` 상단의 **[정합성 검증표]**(`R1` 보유 총 병수, `T1` 보유 총 금액, `V1` `23.02.18` 이후 전체 누적 지출액 — 보정 전 원본 0원 일치 및 개별 보정 내역)를 확인합니다.
2. 웹앱을 열고 **Google 로그인 → `[📂 기존 wine_db.json 가져오기]`** (또는 설정 화면의 **JSON 파일로 덮어쓰기**)를 눌러 업로드합니다.
   - ⚠️ **주의:** 최소 권한(`drive.file`) 보안 정책상 Google Drive 웹에서 직접 `JH_Wine_Forest/wine_db.json`을 업로드하면 앱이 해당 파일을 인식할 수 없습니다. 반드시 **앱 내부 Import 버튼**을 사용해 주세요.
