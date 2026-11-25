# JH Wine Forest — Workspace Agent Rules

## 1. 코드 수정 시 `docs/` 작업지시서 및 앱 현재 상태 필수 동기화

코드, 스키마, 테스트, 빌드/CI 설정, 네이티브(`ios/`·`android/`) 또는 Python 스크립트를 수정해 앱의 동작·명세·현재 상태가 달라질 때마다 **같은 작업 단위 안에서 관련 `docs/` 문서를 반드시 함께 업데이트**한다. (단순 내부 리팩터링·오타 수정으로 명세·상태 변화가 없는 경우만 예외)

### 변경 영역별 동기화 대상 문서

| 변경 영역 | 반드시 점검·갱신할 문서 |
| :--- | :--- |
| **웹 UI · 컴포넌트 · 스타일 · 프라이버시 UX** (`src/pages/`, `src/components/`, `src/styles/`, `tailwind.config.ts`) | `docs/SPEC_1_UI_ARCH.md`, `docs/IMPLEMENTATION_PLAN.md` |
| **스키마 · 검증 · 동기화 · 스토어 · 미디어 · Python 스크립트 · 테스트 수** (`src/types/`, `src/store/`, `src/services/`, `scripts/`, `tests/`) | `docs/SPEC_2_DATA_EXEC.md`, `docs/IMPLEMENTATION_PLAN.md` |
| **iOS 네이티브 · Capacitor 설정 · 인증 브릿지 · iOS CI** (`ios/`, `capacitor.config.ts`, `vite.config.ts`, `src/plugins/`, `src/services/auth/`, `src/services/native/`, `.github/workflows/ios-ipa.yml`) | `docs/SPEC_MOBILE_IOS.md`, `docs/MOBILE_IMPLEMENTATION_PLAN.md` |
| **Android 빌드/권한/동기화 절차 영향 변경** (`src/services/auth/`, `src/services/native/`, `package.json`, `capacitor.config.ts`) | `docs/GUIDE_WIN_ANDROID.md`, `docs/MOBILE_IMPLEMENTATION_PLAN.md` |

### 갱신 체크리스트 (작업 완료 전 필수 확인)

1. **현재 상태 & 테스트 수 동기화:** 마일스톤 진행 상태, 완료된 수정 이력, `npm run test` 스위트/테스트 건수가 실제 검증 결과와 일치하는지 확인한다.
2. **작업지시서 명세 일치:** 권한 키(`Info.plist` / `AndroidManifest.xml`), 스키마 검증 규칙, UI 동작, 디렉터리 구조가 실제 코드와 어긋나지 않게 갱신한다.
3. **감사 백로그 갱신:** `docs/IMPLEMENTATION_PLAN.md` 또는 `docs/MOBILE_IMPLEMENTATION_PLAN.md`에 기록된 대기 버그를 해결한 경우 대기 목록에서 완료 이력으로 이동한다.
4. **Public 저장소 보안 유지:** `docs/` 및 `AGENTS.md`에는 개인 와인 목록, 실제 OAuth Client ID, 비밀번호, 키스토어 경로 등 민감 정보를 절대 기재하지 않는다.
