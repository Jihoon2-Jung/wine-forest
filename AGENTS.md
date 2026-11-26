# JH Wine Forest — Workspace Agent Rules

## 1. 코드 수정 시 `docs/` 작업지시서 및 앱 현재 상태 필수 동기화

코드, 스키마, 테스트, 빌드/CI 설정, 네이티브(`ios/`·`android/`) 또는 Python 스크립트를 수정해 앱의 동작·명세·현재 상태가 달라질 때마다 **같은 작업 단위 안에서 관련 `docs/` 문서를 반드시 함께 업데이트**한다. (단순 내부 리팩터링·오타 수정으로 명세·상태 변화가 없는 경우만 예외)

### 변경 영역별 동기화 대상 문서

| 변경 영역 | 반드시 점검·갱신할 문서 |
| :--- | :--- |
| **웹 UI · 컴포넌트 · 스타일 · 프라이버시 UX · 공개 정적 페이지** (`src/pages/`, `src/components/`, `src/styles/`, `src/index.css`, `tailwind.config.ts`, `public/privacy.html`) | `docs/SPEC_1_UI_ARCH.md`, `docs/IMPLEMENTATION_PLAN.md` |
| **스키마 · 검증 · 동기화 · 스토어 · 미디어 · Python 스크립트 · 테스트 수** (`src/types/`, `src/store/`, `src/services/`, `scripts/`, `tests/`) | `docs/SPEC_2_DATA_EXEC.md`, `docs/IMPLEMENTATION_PLAN.md` |
| **iOS 네이티브 · Capacitor 설정 · 인증 브릿지 · iOS CI** (`ios/`, `capacitor.config.ts`, `vite.config.ts`, `src/plugins/`, `src/services/auth/`, `src/services/native/`, `.github/workflows/ios-ipa.yml`) | `docs/SPEC_MOBILE_IOS.md`, `docs/MOBILE_IMPLEMENTATION_PLAN.md` |
| **Android 네이티브 · 빌드/권한/서명/동기화 절차 영향 변경** (`android/`, `src/services/auth/`, `src/services/native/`, `package.json`, `capacitor.config.ts`) | `docs/GUIDE_WIN_ANDROID.md`, `docs/SPEC_MOBILE_IOS.md` (§6), `docs/MOBILE_IMPLEMENTATION_PLAN.md` |

### 갱신 체크리스트 (작업 완료 전 필수 확인)

1. **현재 상태 & 테스트 수 동기화:** 마일스톤 진행 상태, 완료된 수정 이력, `npm run test` 스위트/테스트 건수가 `SPEC_2_DATA_EXEC.md`, `IMPLEMENTATION_PLAN.md`, `SPEC_MOBILE_IOS.md`, `MOBILE_IMPLEMENTATION_PLAN.md`, `GUIDE_WIN_ANDROID.md` 전체에서 실제 검증 결과와 일치하는지 확인한다.
2. **작업지시서 명세 일치:** 권한 키(`Info.plist` / `AndroidManifest.xml`), `capacitor.config.ts` 플러그인 옵션(`StatusBar`/`SystemBars`), 스키마 검증 규칙, UI 동작, 디렉터리 구조가 실제 코드와 어긋나지 않게 갱신한다.
3. **감사 백로그 갱신:** `docs/IMPLEMENTATION_PLAN.md` 또는 `docs/MOBILE_IMPLEMENTATION_PLAN.md`에 기록된 대기 버그를 해결한 경우 대기 목록에서 완료 이력으로 이동한다.
4. **Public 저장소 보안 유지:** `docs/` 및 `AGENTS.md`에는 개인 와인 목록, 실제 OAuth Client ID, 비밀번호, 키스토어 파일/로컬 절대 경로, 개인 이메일 등 민감 정보를 절대 기재하지 않는다.

## 2. Mac(iOS) ↔ Windows(Android) 병행 작업 시 Git 운영 규칙

1. **동시 작업 시 브랜치 분리:** Mac에서 iOS 작업을 `main`에서 동시 진행 중인 경우, Windows의 Android·공통 수정사항은 `main`에 직접 푸시하지 않고 별도 브랜치(`feat/android-*`)로 분기해 푸시한 뒤 Mac 푸시 완료 후 통합한다.
2. **줄바꿈·실행권한·비밀파일 차단:** Windows 환경에서는 `core.autocrlf=input`과 `android/gradlew` LF·실행권한(`100755`)을 유지하고, 커밋 전 `git status -uall --short`로 `*.keystore`, `*.jks`, `keystore.properties`, `local.properties`, `.env*`, `*.apk`, `build/`가 포함되지 않았는지 반드시 검증한다.
3. **Public 커밋 작성자 통일:** 커밋 작성자는 기존 저장소 이력과 동일한 가상 이메일 형식을 유지해 개인 Gmail이 공개 Git 로그에 노출되지 않도록 한다.
