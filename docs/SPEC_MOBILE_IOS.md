# JH Wine Forest — 모바일(iOS 중심 + 공통/Android 선행) 개발 작업지시서 (`SPEC_MOBILE_IOS.md`)

> **문서 안내:** 본 문서는 [MOBILE_IMPLEMENTATION_PLAN.md](./MOBILE_IMPLEMENTATION_PLAN.md)의 세부 실행 명세서입니다.
> - **상태:** **M1~M6 완료 + iOS·Android 전수 감사 안정화 패치 및 `main` 통합 완료 (2026-11-26: Part A 46건 + Android/공통 감사 10건 + 무서버 공유 링크 전량 반영 · `9개 스위트 / 69개 테스트` 통과 · iOS `CapApp-SPM` 5개 플러그인 동기화 및 `.ipa` 빌드 + Android `v1.0.1 / versionCode 2` Release APK 실기기 설치 완료)**
> Mac 환경에서 **공통 코드(`src/`) 리팩토링, iOS 네이티브(`ios/`) 구현, Android 선행 스캐폴딩(`android/`) 작성**까지 누락 없이 구현·검증할 수 있도록 상세 지침을 제공합니다.
> Windows PC에서의 Android Keystore 생성 및 빌드는 [GUIDE_WIN_ANDROID.md](./GUIDE_WIN_ANDROID.md)로 이어집니다.

---

## 0. 개요 및 Mac 자원 최적화 작업 원칙

### 0.1 확정 사양
| 항목 | 확정 값 |
| :--- | :--- |
| **App ID (Bundle ID / Package Name)** | `com.jihoon.wineforest` |
| **App Name** | `JH Wine Forest` |
| **프레임워크** | Capacitor 8 (Minimum: **iOS 15.0+**, **Android API 24+**) |
| **네이티브 인증 방식** | 방식 A: Google 공식 SDK 경량 커스텀 로컬 플러그인 (`GoogleDriveAuth`) |
| **OAuth Scope** | `https://www.googleapis.com/auth/drive.file` |
| **Google Cloud 프로젝트** | 기존 웹앱(`VITE_GOOGLE_CLIENT_ID`)과 **동일한 프로젝트** 사용 + 동의 화면 **프로덕션(Production) 게시** |
| **iOS 서명 방식** | 무료 Apple ID (**Personal Team**) USB 실기기 설치 (7일 재서명) |

### 0.2 Mac 자원 효율화 원칙 (Intel `x86_64` · SSD 여유 ~112GB 기준)
1. **CocoaPods 설치 금지:** Ruby/CocoaPods 환경 구축은 디스크와 빌드 시간을 불필요하게 소모합니다. Capacitor 8의 기본 의존성 관리자인 **Swift Package Manager (`CapApp-SPM`)**만 사용합니다 (`npx cap add ios --packagemanager SPM`).
2. **Android Studio / Gradle 에뮬레이터 Mac 미설치:** Android 코드 스캐폴딩(`android/`)과 Kotlin 소스만 Mac에서 작성·커밋하고, 무거운 Android SDK·Gradle 빌드·실기기 테스트는 Windows PC에 위임합니다.
3. **단일 iOS 시뮬레이터 런타임 유지:** Xcode 설치 시 iOS 시뮬레이터 런타임은 최신 안정 버전 **1종만** 다운로드하고(watchOS/tvOS/visionOS 런타임 체크 해제), 주기적으로 `~/Library/Developer/Xcode/DerivedData`만 정리해도 여유 공간을 40GB 이상 안전하게 보존할 수 있습니다.
4. **선행/후행 마일스톤 분리:** Xcode 설치 전에는 **M1~M3(공통 코드·테스트·`ios/`/`android/` 파일 생성 및 Git 푸시)**를 먼저 완료하고, Xcode 설치 완료 후 **M4~M5(SPM 연결·`xcodebuild`·실기기 검증)**를 진행합니다.

---

## 1. 패키지 설치 · Public 저장소 보안 규칙 · Git 설정

### 1.1 설치할 npm 패키지 (Capacitor 8 기준)
```bash
# Runtime & Native Bridges
npm install @capacitor/core @capacitor/app @capacitor/status-bar @capacitor/filesystem @capacitor/share

# CLI & Native Platforms (devDependencies 권장)
npm install -D @capacitor/cli @capacitor/ios @capacitor/android
```
* **선택 도구:** `@capacitor/assets`는 앱 아이콘/스플래시 일괄 생성 시 `npx`로 1회 실행(`npx @capacitor/assets generate --ios --android`)하거나 `devDependencies`로 추가합니다. 기존 [public/icons/icon-512.png](../public/icons/icon-512.png) 또는 고해상도 PNG(`1024×1024`)를 원본으로 사용합니다.
* **버전 정합성:** `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android`는 반드시 **동일 메이저 버전(v8.x)**을 유지해야 `npx cap sync` 시 스키마 불일치가 발생하지 않습니다.

### 1.2 `.gitignore` 보안 추가 규칙 (CRITICAL)
Public 저장소(`wine-forest`) 보호를 위해 기존 [.gitignore](../.gitignore)에 아래 항목을 반드시 추가합니다.

```gitignore
# Mobile Native Secrets & Signing Artifacts (Public Repo Guardrail)
ios/App/Config/Local.xcconfig
*.keystore
*.jks
keystore.properties
*.p12
*.mobileprovision
GoogleService-Info.plist
google-services.json
```
> **참고:** `npx cap add ios` / `npx cap add android` 생성 후에도 루트 `.gitignore`가 하위 플랫폼 빌드 산출물(`ios/DerivedData/`, `android/.gradle/`, `android/app/build/` 등 각 플랫폼 `.gitignore` 포함)을 안전하게 차단하는지 반드시 확인하십시오.

### 1.3 `.gitattributes` (Mac ↔ Windows 줄바꿈 충돌 방지)
프로젝트 루트에 `.gitattributes`를 신규 생성해 Windows에서 Android 스크립트가 깨지는 현상을 방지합니다.

```gitattributes
* text=auto eol=lf

*.sh text eol=lf
gradlew text eol=lf
*.pbxproj text eol=lf
*.plist text eol=lf
*.swift text eol=lf
*.kt text eol=lf
*.gradle text eol=lf
*.xml text eol=lf

*.bat text eol=crlf
*.cmd text eol=crlf

*.png binary
*.jpg binary
*.webp binary
*.ico binary
*.jar binary
```

---

## 2. 듀얼 타겟 빌드(`vite.config.ts`) 및 `capacitor.config.ts`

### 2.1 `vite.config.ts` 듀얼 타겟 분기
기존 [vite.config.ts](../vite.config.ts)의 GitHub Pages 배포(`base: '/wine-forest/'` + `VitePWA`)를 그대로 보존하면서, 모바일 번들 빌드 시에만 상대 경로와 서비스워커 비활성화를 적용합니다.

* **분기 기준:** `mode === 'capacitor'` (또는 `BUILD_TARGET === 'capacitor'`) — `--mode capacitor` 사용으로 Mac/Windows PowerShell 양쪽에서 동일하게 동작
* **적용 규칙:**
  * `base`: `isCapacitorBuild ? './' : '/wine-forest/'`
  * `plugins`: `VitePWA(...)`는 `!isCapacitorBuild`일 때만 포함하며, Capacitor 빌드에서는 `transformIndexHtml`로 불필요한 Web GIS `<script src="https://accounts.google.com/gsi/client">`를 자동 제거합니다.
  * **이유:** WKWebView / Android WebView 내부에서 `capacitor://localhost` 또는 `https://localhost`로 로드될 때 서브경로(`/wine-forest/`)와 Workbox 서비스워커가 등록되면 정적 에셋 404 및 구버전 캐시 고착 문제가 발생합니다.

### 2.2 `capacitor.config.ts` 신규 작성
프로젝트 루트에 `capacitor.config.ts`를 생성합니다.

```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jihoon.wineforest',
  appName: 'JH Wine Forest',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  ios: {
    contentInset: 'never', // 기존 index.html(viewport-fit=cover) + CSS env(safe-area-inset-*) 활용
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
    },
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;
```
> **Safe Area 주의:** 현재 [index.html](../index.html)에 `viewport-fit=cover`가 있고 [index.css](../src/index.css)에 `.pt-safe`, `.pb-safe`가 이미 구현되어 있습니다. 실기기 테스트 시 `TopHeader`와 `BottomNav`가 노치/다이나믹 아일랜드와 겹치지 않는지 확인하고, 필요 시 `TopHeader`와 `BottomNav` 패딩만 미세 조정합니다.

### 2.3 `package.json` 스크립트 추가
```json
{
  "scripts": {
    "build:mobile": "tsc --noEmit && vite build --mode capacitor",
    "cap:sync:ios": "npm run build:mobile && npx cap sync ios",
    "cap:sync:android": "npm run build:mobile && npx cap sync android",
    "cap:open:ios": "npx cap open ios",
    "cap:open:android": "npx cap open android"
  }
}
```

---

## 3. 플랫폼 분기 `AuthAdapter` 및 무음 자동 갱신 아키텍처

### 3.1 커스텀 플러그인 TS 인터페이스 (`src/plugins/googleDriveAuth.ts`)
```typescript
import { registerPlugin } from '@capacitor/core';

export interface NativeAuthSessionResult {
  accessToken: string;
  expiresAt?: number; // Unix epoch ms (iOS GIDSignIn 제공 시)
  email?: string;
}

export interface GoogleDriveAuthPlugin {
  /** 사용자 상호작용 기반 최초 로그인 + drive.file 권한 동의 */
  signIn(): Promise<NativeAuthSessionResult>;
  /** 앱 실행 시 이전 로그인 세션 무음 복원 (미로그인/미동의 시 null 또는 에러 반환) */
  restoreSession(): Promise<NativeAuthSessionResult | null>;
  /** 유효 토큰 반환 또는 백그라운드 무음 갱신 */
  getAccessToken(options?: { forceRefresh?: boolean }): Promise<NativeAuthSessionResult>;
  /** 연결 해제 및 OS/SDK 토큰 캐시 정리 */
  signOut(): Promise<void>;
}

export const GoogleDriveAuth = registerPlugin<GoogleDriveAuthPlugin>('GoogleDriveAuth');
```

### 3.2 `AuthAdapter` 추상화 계층 (`src/services/auth/`)

#### A. `src/services/auth/types.ts`
```typescript
export interface AuthTokenResult {
  accessToken: string;
  expiresAt: number; // Unix epoch ms
  email?: string;
}

export interface AuthAdapter {
  readonly isNative: boolean;
  /** 현재 플랫폼에서 Google 로그인을 시작할 수 있는 환경인지 여부 */
  isConfigured(): boolean;
  /** 메모리에 만료 전 유효 토큰이 즉시 존재하는지 여부 */
  hasValidToken(): boolean;
  /** 동기식 현재 토큰 조회 (만료 시 null) */
  getAccessToken(): string | null;
  getTokenExpiresAt(): number | null;
  getUserEmail(): string | null;
  /**
   * 필요 시 백그라운드 무음 갱신 수행.
   * - 웹(GIS): 유효 토큰이 있으면 즉시 반환, 없으면 AuthRequiredError throw (팝업 차단 방지)
   * - 네이티브: 유효 토큰이 있으면 반환, 없거나 forceRefresh=true면 OS/SDK 무음 갱신 시도
   */
  ensureAccessToken(options?: { forceRefresh?: boolean }): Promise<string>;
  /** 앱 부팅 시 이전 세션 무음 복원 (웹은 no-op null 반환) */
  restoreSession(): Promise<AuthTokenResult | null>;
  /** 사용자 클릭 기반 명시적 로그인 */
  signIn(prompt?: '' | 'consent' | 'select_account'): Promise<AuthTokenResult>;
  /** 로그아웃 / 토큰 폐기 */
  signOut(): Promise<void>;
}
```

#### B. `src/services/auth/webGisAuthAdapter.ts`
* 기존 [googleAuth.ts](../src/services/auth/googleAuth.ts)의 GIS Token Model 구현을 클래스/객체로 그대로 이전합니다.
* `ensureAccessToken()`: `isTokenValid()`이면 `accessToken` 즉시 반환, 아니면 `AuthRequiredError`를 throw하여 기존 웹의 **1클릭 동기 재인증 배너 UX**를 100% 보존합니다.
* `restoreSession()`: 항상 `null` 반환 (브라우저 GIS Token Model은 무음 세션 복원 불가).

#### C. `src/services/auth/nativeGoogleAuthAdapter.ts`
* **만료 추정 및 안전 버퍼:**
  * iOS(`GIDSignIn`)는 `accessToken.expirationDate`를 epoch ms로 정확히 내려줍니다.
  * Android(`AuthorizationClient`)는 `expiresAt`을 내려주지 않을 수 있으므로, 응답에 `expiresAt`이 없으면 `Date.now() + 50 * 60 * 1000` (50분)을 기본 TTL로 사용합니다.
  * `TOKEN_SAFETY_BUFFER_MS = 60_000` (1분 버퍼) 이내면 만료 임박으로 간주하고 갱신합니다.
* **동시 호출 단일화 (Single-Flight Dedupe):**
  * [googleDriveAdapter.ts](../src/services/storage/googleDriveAdapter.ts)가 `Promise.all`로 여러 Drive API를 동시에 호출하거나 401 재시도가 겹칠 때 네이티브 브릿지가 중복 호출되지 않도록 `private inflightRefresh: Promise<string> | null = null` 잠금으로 동일 Promise를 공유합니다.
* **에러 정규화:**
  * 네이티브 플러그인이 `USER_CANCELLED`를 반환하면 사용자 친화적 메시지(`"구글 로그인을 취소했습니다."`)로 변환합니다.
  * 무음 갱신(`restoreSession` / `getAccessToken`)이 `SCOPE_DENIED`나 `SESSION_EXPIRED`로 실패하면 메모리 토큰을 비우고 `AuthRequiredError`를 throw해 UI 재인증 배너가 자연스럽게 뜨도록 합니다.

#### D. `src/services/auth/googleAuth.ts` (파사드)
* `Capacitor.isNativePlatform()` 결과에 따라 `nativeGoogleAuthAdapter` 또는 `webGisAuthAdapter`를 선택해 export 합니다.
* 기존 호출부 호환성을 위해 `GOOGLE_DRIVE_SCOPE`, `getGoogleClientId`, `hasGoogleClientId`, `isTokenValid`, `getAccessToken`, `getTokenExpiresAt`, `clearAccessToken`, `requestAccessToken`을 유지하되, 아래 비동기 API를 추가합니다:
  * `isNativeAuth()`
  * `ensureAccessToken(options?: { forceRefresh?: boolean })`
  * `restoreAuthSession()`
  * `getAuthUserEmail()`

### 3.3 `GoogleDriveAdapter` 비동기 토큰 + 401 자동 1회 재시도
[googleDriveAdapter.ts](../src/services/storage/googleDriveAdapter.ts)의 `fetchDrive()`를 아래와 같이 개선합니다.

1. 기존 동기 `requireToken()` 대신 `const token = await ensureAccessToken();`을 호출합니다.
2. `response.status === 401` 수신 시:
   * **네이티브 플랫폼(`isNativeAuth()`)이고 아직 재시도하지 않은 요청(`retried === false`)이라면:**
     `const refreshedToken = await ensureAccessToken({ forceRefresh: true });`를 호출해 새 토큰으로 **동일 요청을 정확히 1회 재시도**합니다.
   * 재시도 후에도 `401`이거나 웹 플랫폼이라면 기존과 동일하게 `AuthRequiredError`를 throw합니다.

### 3.4 `useWineStore.ts` & UI 인증 흐름 변경 명세
[useWineStore.ts](../src/store/useWineStore.ts) 및 관련 페이지의 수정 포인트는 다음과 같습니다.

1. **신규 상태:** `authUserEmail: string | null` (네이티브 로그인 계정 표시용).
2. **`hydrate()`:**
   * 기존처럼 IndexedDB 캐시를 즉시 로드(`isHydrated: true`)해 0.5초 내 화면을 그립니다.
   * `mode === 'google_drive'`이고 `isNativeAuth()`인 경우, UI를 블로킹하지 않고 백그라운드에서 `await restoreAuthSession()`을 실행합니다.
   * 세션이 복원되면 `googleConnected: true`, `authUserEmail`을 갱신하고:
     * `hasUnsyncedChanges === true`이고 `validDb`가 존재하면 → 대기 중이던 로컬 변경사항을 `commitMutation()`으로 자동 업로드합니다.
     * `hasUnsyncedChanges === false`이면 → `syncNow()`로 Drive 최신본을 조용히 Pull합니다.
3. **`commitMutation()`:**
   * 기존 [L292](../src/store/useWineStore.ts#L292)의 `if (state.storageMode === 'google_drive' && !isTokenValid())` 가드는 **웹 플랫폼(`!isNativeAuth()`)일 때만** 즉시 중단합니다.
   * 네이티브 플랫폼에서는 토큰이 만료되었더라도 `syncEngine.saveWithPolicy()` → `googleDriveAdapter` → `ensureAccessToken()`이 백그라운드에서 무음 갱신 후 저장합니다. 진짜 세션이 폐기되어 `AuthRequiredError`가 발생한 경우에만 `syncStatus: 'auth_required'`로 전환합니다.
4. **`syncNow()` / `importJsonDatabase()` / `fetchBackups()` / `createManualBackup()` / `restoreFromBackup()`:**
   * 동일한 패턴으로 웹에서는 `!isTokenValid()` 가드를 유지하고, 네이티브에서는 `ensureAccessToken()` 시도(실패 시 `AuthRequiredError` 처리)로 매끄럽게 동작하도록 분기합니다.
5. **`disconnectAndResetLocal()`:**
   * `await clearAccessToken()` (내부적으로 네이티브 `signOut()` 호출) 실행 후 `authUserEmail: null` 초기화.
6. **UI 반영:**
   * [OnboardingView.tsx](../src/pages/OnboardingView.tsx): `clientIdReady = hasGoogleClientId()` 가드와 안내 문구에서 네이티브 환경(`isNativeAuth() === true`)이면 항상 Google 로그인 버튼을 활성화합니다.
   * [SettingsPage.tsx](../src/pages/SettingsPage.tsx): `storageMode === 'google_drive'` 카드에 연결된 계정 이메일(`authUserEmail`)과 `"모바일 자동 갱신 활성"` 배지를 표시합니다. 네이티브에서도 토큰 복원 실패 시 기존 재인증 카드가 정상 동작합니다.
7. **`detectDeviceLabel()` 네이티브 앱 구분:**
   * `commitMutation()` 시 기록되는 `metadata.deviceLabel` 생성 함수(`detectDeviceLabel()`) 최상단에 `Capacitor.isNativePlatform()` 분기를 추가해 네이티브 실행 시에는 `Capacitor.getPlatform() === 'ios' ? 'iOS App' : 'Android App'`을 반환하도록 합니다. (웹 브라우저 `iPhone Safari`/`Android Chrome`과 네이티브 앱 수정 이력을 명확히 구분)

---

## 4. 네이티브 UX 브릿지 명세 (`src/services/native/nativeBridge.ts`)

사용자가 1차 모바일 앱에 포함하기로 확정한 3가지 UX 기능을 단일 서비스 모듈에 구현합니다.

### 4.1 OS 상태바 라이트/다크 자동 연동 (`syncStatusBar`)
* **라이브러리:** `@capacitor/status-bar`
* **동작:** `Capacitor.isNativePlatform()`일 때만 실행.
  * `theme === 'dark'`: `StatusBar.setStyle({ style: Style.Dark })` (흰색 텍스트/아이콘), Android 배경색 `#0D1411` (`StatusBar.setBackgroundColor({ color: '#0D1411' })`)
  * `theme === 'light'`: `StatusBar.setStyle({ style: Style.Light })` (검은색 텍스트/아이콘), Android 배경색 `#FAF9F6` (`StatusBar.setBackgroundColor({ color: '#FAF9F6' })`)
* **호출 시점:** `useWineStore.ts`의 `applyThemeToDom(theme)` 내부에서 비동기로 호출(웹에서는 즉시 return, 에러는 `try/catch`로 무시).

### 4.2 JSON 내보내기 네이티브 공유 시트 (`exportJsonWithNativeShare`)
* **라이브러리:** `@capacitor/filesystem`, `@capacitor/share`
* **문제 해결:** 현재 [useWineStore.ts](../src/store/useWineStore.ts#L913-L930)의 `exportLocalJson()`은 `<a download>`를 사용하는데 iOS `WKWebView`에서는 파일 저장이 무시되는 경우가 많습니다.
* **동작 분기:**
  * **웹:** 기존 `Blob` + `<a download>` 유지.
  * **네이티브:**
    1. `Filesystem.writeFile({ path: fileName, data: jsonText, directory: Directory.Cache, encoding: Encoding.UTF8 })`로 캐시 디렉터리에 임시 `.json` 파일 작성.
    2. `const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });`로 파일 URI 획득.
    3. `await Share.share({ title: 'JH Wine Forest 백업 내보내기', url: uri, dialogTitle: 'wine_db.json 내보내기' });` 호출 → iOS 공유 시트(파일 앱에 저장 시 불필요한 `text.txt` 중복 생성을 막기 위해 `text`는 생략하고 `url`만 전달)/Android 공유 시트 오픈.

### 4.3 Android 하드웨어 · 제스처 뒤로가기 처리 (`initAndroidBackButton`)
* **라이브러리:** `@capacitor/app`
* **우선순위 규칙 (`App.addListener('backButton', ...)`):**
  1. **열린 모달/바텀시트 최우선 닫기:**
     * [BottomSheet.tsx](../src/components/common/BottomSheet.tsx)에 모달 닫기 콜백 스택(`pushModalCloser` / `popModalCloser`)을 연결해, 뒤로가기 시 가장 위에 열린 바텀시트/모달(`WineDetailSheet`, `QuickAddModal`, `QuickConsumeModal`, `ShelfConfigModal`, `ShelfDetailDrawer`, `MoveBottlePicker`, `ConflictModal`)을 먼저 닫습니다. (`ConflictModal`은 임의 닫기 불가이므로 콜백 미등록 또는 no-op 유지)
  2. **서브 페이지 → 홈(`/`) 이동:**
     * 열린 모달이 없고 현재 `location.pathname !== '/'`이면 `navigate(-1)`(또는 히스토리가 없으면 `navigate('/', { replace: true })`) 실행.
  3. **홈(`/`)에서의 처리:**
     * 2초 이내 연속 2회 뒤로가기 시 `App.exitApp()`, 1회째에는 토스트 `"한 번 더 누르면 앱이 종료됩니다."` 표시(또는 `canGoBack === false` 시 `App.minimizeApp()`). 연속 2회 종료 + 안내 토스트 패턴이 실사용 UX가 가장 직관적입니다.
* **초기화 위치:** `HashRouter` 컨텍스트 내부인 [AppShell.tsx](../src/components/layout/AppShell.tsx)의 `useEffect`에서 등록하고 언마운트 시 `listener.remove()`.

---

## 5. iOS 네이티브 구현 명세 (`ios/App/App/`)

### 5.1 프로젝트 생성 및 SPM 패키지 연결
1. 프로젝트 루트에서 Capacitor iOS 플랫폼 추가:
   ```bash
   npm run build:mobile
   npx cap add ios --packagemanager SPM
   ```
2. **Swift Package Dependency:** `https://github.com/google/GoogleSignIn-iOS` (최신 8.x/9.x 안정 버전, Product: `GoogleSignIn`)를 `ios/App/App.xcodeproj`의 **App 타겟**에 추가합니다. *(Xcode GUI `File > Add Package Dependencies...` 또는 `project.pbxproj`의 `XCRemoteSwiftPackageReference` 구성)*

### 5.2 Public 저장소 보안 설정 (`Local.xcconfig` & `Info.plist`)
`Info.plist`에 실제 iOS OAuth Client ID를 직접 쓰지 않습니다.

1. **`ios/App/Config/Local.xcconfig.example` (Git 커밋 대상):**
   ```xcconfig
   // 이 파일을 같은 폴더의 Local.xcconfig 로 복사한 뒤 실제 iOS OAuth Client ID를 입력하세요.
   // Local.xcconfig 는 .gitignore 에 의해 Git 커밋이 차단됩니다.
   GOOGLE_IOS_CLIENT_ID = YOUR_IOS_CLIENT_ID.apps.googleusercontent.com
   GOOGLE_IOS_REVERSED_CLIENT_ID = com.googleusercontent.apps.YOUR_IOS_CLIENT_ID
   ```
2. **`ios/App/Config/Local.xcconfig` (Git 차단 대상, 로컬 개발 PC에만 존재):**
   * 실제 Google Cloud Console에서 발급받은 iOS Client ID 입력.
   * **주의:** `xcconfig`에서 `//`는 주석으로 처리되므로 URL 값 등이 들어갈 일은 없으나 순수 ID/Reversed Scheme만 기입합니다.
3. **`project.pbxproj` 연결:**
   * Debug / Release 빌드 설정에 `#include? "Config/Local.xcconfig"`(또는 `XCBuildConfiguration`의 `baseConfigurationReference`)가 연결되어 `$(GOOGLE_IOS_CLIENT_ID)` 치환이 동작하도록 설정합니다.
4. **`ios/App/App/Info.plist` 추가 항목:**
   * `GIDClientID`: `$(GOOGLE_IOS_CLIENT_ID)`
   * `CFBundleURLTypes`:
     ```xml
     <key>CFBundleURLTypes</key>
     <array>
       <dict>
         <key>CFBundleTypeRole</key>
         <string>Editor</string>
         <key>CFBundleURLSchemes</key>
         <array>
           <string>$(GOOGLE_IOS_REVERSED_CLIENT_ID)</string>
         </array>
       </dict>
     </array>
     ```

### 5.3 `GoogleDriveAuthPlugin.swift` 구현 명세
위치: `ios/App/App/GoogleDriveAuthPlugin.swift`

* **선언:** `@objc(GoogleDriveAuthPlugin) public class GoogleDriveAuthPlugin: CAPPlugin, CAPBridgedPlugin`
* **필수 프로토콜 프로퍼티:**
  * `public let identifier = "GoogleDriveAuthPlugin"`
  * `public let jsName = "GoogleDriveAuth"`
  * `public let pluginMethods`: `signIn`, `restoreSession`, `getAccessToken`, `signOut` (`CAPPluginReturnPromise`)
* **공통 상수:** `private let driveScope = "https://www.googleapis.com/auth/drive.file"`
* **메서드별 동작:**
  1. **`signIn(_ call: CAPPluginCall)`:**
     * 메인 스레드(`DispatchQueue.main.async`)에서 `guard let vc = self.bridge?.viewController` 확보.
     * `Info.plist`의 `GIDClientID` 존재 여부 확인 (미설정 시 명확한 에러 메시지 reject — 예: `Local.xcconfig` 안내).
     * `GIDSignIn.sharedInstance.signIn(withPresenting: vc, hint: nil, additionalScopes: [driveScope])` 호출.
     * 사용자가 취소(`GIDSignInError.canceled`)하면 code `"USER_CANCELLED"`로 reject.
     * 반환된 `user.grantedScopes`에 `driveScope`가 없으면 code `"SCOPE_DENIED"`로 reject (단, 사용자가 기본 로그인만 승인하고 Drive 체크를 해제한 경우 대비).
     * 성공 시 `resolve(["accessToken": user.accessToken.tokenString, "expiresAt": Int64((user.accessToken.expirationDate?.timeIntervalSince1970 ?? (Date().timeIntervalSince1970 + 3600)) * 1000), "email": user.profile?.email ?? ""])`.
  2. **`restoreSession(_ call: CAPPluginCall)`:**
     * `GIDSignIn.sharedInstance.restorePreviousSignIn { user, error in ... }` 호출.
     * 저장된 세션이 없거나 복원 실패 시 에러로 reject하지 말고 `call.resolve(["session": NSNull()])` 또는 JS 어댑터 규약에 맞춰 빈 객체/null 처리 *(구현 시 `GoogleDriveAuthPlugin` 반환 타입과 일치시킬 것: 예 `resolve()` vs `resolve(["hasSession": false])` — 가장 깔끔한 방법은 `restoreSession`이 `{ accessToken, expiresAt, email } | { signedIn: false }` 또는 JS 어댑터가 `accessToken` 유무를 확인하도록 명시적 스키마 통일)*.
     * 세션이 있고 `grantedScopes?.contains(driveScope) == true`이면 곧바로 `user.refreshTokensIfNeeded` 실행 후 최신 `accessToken`, `expiresAt`, `email` 반환.
  3. **`getAccessToken(_ call: CAPPluginCall)`:**
     * `guard let user = GIDSignIn.sharedInstance.currentUser` 확인 (없으면 `restorePreviousSignIn` 1회 시도 후 그래도 없으면 `"SESSION_EXPIRED"` reject).
     * `grantedScopes?.contains(driveScope) == true` 확인 (없으면 `"SCOPE_DENIED"` reject).
     * `user.refreshTokensIfNeeded { refreshedUser, error in ... }` 호출 → 만료 전이면 캐시 토큰 즉시 반환, 만료/임박 시 Keychain의 Refresh Token으로 백그라운드 무음 갱신 후 반환!
  4. **`signOut(_ call: CAPPluginCall)`:**
     * `GIDSignIn.sharedInstance.signOut()` (또는 `disconnect` 선택 — 재로그인 시 계정 선택 UI를 위해 `signOut()` 사용) 후 `call.resolve()`.

### 5.4 로컬 플러그인 등록 (`WineForestViewController.swift` & `Main.storyboard`)
Capacitor 8에서 앱 내부에 직접 둔 Swift 플러그인은 외부 npm 패키지와 달리 자동 등록되지 않으므로 반드시 브릿지에 명시 등록합니다.

1. **`ios/App/App/WineForestViewController.swift`:**
   ```swift
   import UIKit
   import Capacitor

   class WineForestViewController: CAPBridgeViewController {
       override open func capacitorDidLoad() {
           super.capacitorDidLoad()
           bridge?.registerPluginInstance(GoogleDriveAuthPlugin())
       }
   }
   ```
2. **`ios/App/App/Main.storyboard`:**
   * 초기 뷰 컨트롤러의 `customClass`를 `"WineForestViewController"` (`customModule="App"`)로 변경합니다.

### 5.5 URL 콜백 처리 (`AppDelegate.swift` 및 `SceneDelegate.swift`)
* **`AppDelegate.swift`:** `application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool`에서 `if GIDSignIn.sharedInstance.handle(url) { return true }`를 `ApplicationDelegateProxy.shared.application(app, open: url, options: options)`보다 먼저 실행합니다.
* **`SceneDelegate.swift` 대응 (Capacitor 8.5+ `UIScene` 템플릿인 경우):** 만약 `npx cap add ios` 생성 결과에 `SceneDelegate.swift`가 포함되어 있다면 `scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>)`에도 동일하게 `if let url = URLContexts.first?.url, GIDSignIn.sharedInstance.handle(url) { return }`을 추가해야 iOS 18+/26 SDK 환경에서 로그인 리다이렉트가 누락되지 않습니다.

---

## 6. Android 스캐폴딩 & Kotlin 플러그인 명세 (`android/` — Windows PC 구현·검증 완료)

Windows PC(JDK 21 + Android API 36)에서 `feat/android-v1` 브랜치로 구현·실기기 검증을 완료했습니다.

### 6.1 플랫폼 생성 및 Gradle/Manifest 구성
1. `npx cap add android` 실행 (`compileSdkVersion = 36`, `targetSdkVersion = 36`, `minSdkVersion = 24`, `versionCode 2`, `versionName "1.0.1"`).
2. **`android/app/build.gradle` 수정:**
   * `plugins`에 `apply plugin: 'kotlin-android'` 적용 (`android/build.gradle` `kotlin_version = '2.2.20'`, `compileOptions`/`kotlinOptions` Java 21 정렬).
   * `dependencies`에 Google Play Services Auth 추가:
     ```groovy
     implementation 'com.google.android.gms:play-services-auth:22.0.0'
     ```
   * **조건부 Release Keystore 서명 설정:** `android/keystore.properties` 파일이 존재할 때만 `signingConfigs.release`를 로드하도록 작성(`file(keystoreProperties['storeFile'])`로 절대경로 지원)해, 키스토어가 없는 CI/Mac 환경이나 Debug 빌드 시 Gradle 오류가 나지 않게 방어합니다.
3. **`android/app/src/main/AndroidManifest.xml`:**
   * `android:allowBackup="false"` 설정(OS Auto Backup이 토큰 없는 오래된 `SharedPreferences` 플래그만 복원하는 불일치 차단).
   * Phase 2 카메라 촬영용 `<uses-permission android:name="android.permission.CAMERA" />` 및 `<uses-feature android:name="android.hardware.camera" android:required="false" />` 추가.

### 6.2 `GoogleDriveAuthPlugin.kt` 구현 명세
위치: `android/app/src/main/java/com/jihoon/wineforest/GoogleDriveAuthPlugin.kt`

* **핵심 API:** `com.google.android.gms.auth.api.identity.Identity.getAuthorizationClient(...)`
* **Scope:** `com.google.android.gms.common.api.Scope("https://www.googleapis.com/auth/drive.file")`
* **구현 세부 사항:**
  1. **`load()` 오버라이드 (`ActivityResultLauncher` & 영속 이메일 복원):**
     * `SharedPreferences`(`jh_wine_forest_auth`)에서 `PREF_ACCOUNT_EMAIL`을 복원해 재시작 후에도 `lastAccount`가 유지되게 합니다.
     * Deprecated된 `startIntentSenderForResult` 대신 `bridge.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult())`를 등록하고, `signIn()` 시 `bridge.saveCall(call)` + `pendingAuthCallId`로 생명주기를 관리해 저메모리 Activity 재생성에도 안전하게 대응합니다.
  2. **`authorize` 기반 `signIn` / `restoreSession` / `getAccessToken`:**
     * `AuthorizationRequest.builder().setRequestedScopes(listOf(driveScope)).build()` 생성.
     * `signIn`: `authorizationResult.hasResolution()`이 `true`이면 UI 스레드(`currentActivity.runOnUiThread`)에서 `authLauncher.launch(...)` 실행, `false`이면 즉시 `accessToken` 반환.
     * `restoreSession` / `getAccessToken`:
       * `forceRefresh == true`이고 마지막 `lastAccessToken`이 있으면 먼저 `clearToken(...)`을 호출한 뒤 `authorize()`를 실행합니다.
       * 오프라인/일시 네트워크 단절(`CommonStatusCodes.NETWORK_ERROR` / `TIMEOUT` / `INTERRUPTED`) 실패 시에는 `"SESSION_EXPIRED"` 대신 `"NETWORK_ERROR"`로 reject해 `NativeGoogleAuthAdapter`가 오프라인 세션을 보존하도록 합니다.
       * 권한 재동의가 필요한 경우(`hasResolution() == true`) 무음 복원/갱신에서는 팝업을 띄우지 않고 `"SESSION_EXPIRED"`(또는 `restoreSession`의 `signedIn: false`)를 반환합니다.
  3. **`signOut`:**
     * `SharedPreferences`의 `signed_in`·`account_email` 초기화 후, `lastAccessToken`이 있으면 `clearToken(...)` 호출, `lastAccount`(또는 영속 이메일로 복원한 `Account(email, "com.google")`)가 있으면 `revokeAccess(...)`를 안전 호출하고 `resolve()`.

### 6.3 `MainActivity` 플러그인 등록 (순서 엄수!)
위치: `android/app/src/main/java/com/jihoon/wineforest/MainActivity.kt` (또는 `.java` 템플릿 유지 시 Java/Kotlin 선택)

```kotlin
package com.jihoon.wineforest

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // CRITICAL: 반드시 super.onCreate(savedInstanceState) 이전에 등록해야 Capacitor 브릿지가 인식함
        registerPlugin(GoogleDriveAuthPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
```

---

## 7. iOS 빌드 환경 준비 · Google Cloud 설정 · 무료 실기기 설치 가이드

### 7.0 채택 경로 (Intel Mac + iOS 27): GitHub Actions (`xcode-27`) + Sideloadly/SideStore
Intel Mac에서는 Xcode 27(Apple Silicon 전용) 설치가 불가능하므로, Mac에 Xcode를 설치하지 않고 Public 저장소 무료 GitHub Actions 러너(`xcode-27`)로 미서명 `.ipa`를 빌드한 뒤 Sideloadly(권장) 또는 SideStore로 iOS 27 iPhone에 설치합니다.

1. **Google Cloud Console 설정 (아래 7.2 절차 수행):**
   * 기존 웹앱과 동일한 프로젝트에 iOS OAuth 클라이언트(`com.jihoon.wineforest`) 생성 + OAuth 동의 화면 `프로덕션(Production)` 게시.
2. **GitHub Repository Secret 등록:**
   * 저장소 **Settings → Secrets and variables → Actions → New repository secret**
   * `GOOGLE_IOS_CLIENT_ID`: 발급받은 `xxxx.apps.googleusercontent.com` 값 등록 (`GOOGLE_IOS_REVERSED_CLIENT_ID`는 워크플로가 자동 역순 변환하므로 생략 가능).
3. **`.ipa` 빌드 실행:**
   * GitHub **Actions → `Build iOS Unsigned IPA (Xcode 27)` → `Run workflow`** 클릭 → 완료 후 아티팩트 `JH-Wine-Forest-iOS-unsigned-ipa` (1일 보관) 다운로드 및 압축 해제.
4. **Sideloadly로 iPhone 설치 (무료 Apple ID):**
   * Mac 또는 Windows PC에 [Sideloadly](https://sideloadly.io/) 설치 → iPhone USB 연결 → `.ipa` 드래그 → Apple ID 입력 → **Advanced Options**에서 `Use automatic bundle ID`가 꺼져 있는지(원래 `com.jihoon.wineforest` 유지) 확인 후 `Start`.
   * *(만약 무료 Apple ID에서 Bundle ID가 충돌하거나 SideStore로 인해 `com.jihoon.wineforest.<TEAM_ID>`로 바뀐 경우, Google Cloud iOS OAuth 클라이언트의 번들 ID를 실제 설치된 Bundle ID와 동일하게 맞춰 주어야 Google 로그인이 동작합니다.)*
   * iPhone **설정 → 일반 → VPN 및 기기 관리 → 개발자 앱 신뢰** 승인 및 **설정 → 개인정보 보호 및 보안 → 개발자 모드** 켜기.

### 7.1 (대안) 로컬 Apple Silicon Mac Xcode 설치 및 디스크 절약 세팅
1. **Xcode 설치:** Mac App Store에서 최신 **Xcode** 설치.
2. **최초 실행 설정:**
   * Xcode 실행 시 추가 컴포넌트 선택 창에서 **iOS**만 체크 (watchOS/tvOS/visionOS는 체크 해제해 15GB+ 절약).
   * 터미널에서 Command Line Tools 경로 및 라이선스 등록:
     ```bash
     sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
     sudo xcodebuild -license accept
     ```
3. **확인:** `xcodebuild -version` 출력 확인.

### 7.2 Google Cloud Console iOS OAuth 설정 (필수 절차)
1. [Google Cloud Console](https://console.cloud.google.com/) 접속 → **기존 웹앱(`VITE_GOOGLE_CLIENT_ID`)이 있는 동일한 프로젝트 선택**. *(새 프로젝트 생성 절대 금지 — `drive.file` 파일 공유 불가)*
2. **Google Auth Platform → 클라이언트 → 클라이언트 만들기:**
   * 애플리케이션 유형: **iOS**
   * 이름: `JH Wine Forest iOS`
   * 번들 ID: **`com.jihoon.wineforest`**
3. 생성된 **클라이언트 ID**(`xxxx.apps.googleusercontent.com`)와 **iOS URL 스키마**(`com.googleusercontent.apps.xxxx`)를 복사해 `ios/App/Config/Local.xcconfig`에 저장.
4. **OAuth 동의 화면 → 대상(Audience) → 프로덕션 게시 (`Publish App`):**
   * `테스트(Testing)` 상태에서는 모바일 Refresh Token도 **7일 후 만료**됩니다.
   * 본 앱은 비민감 스코프(`drive.file`)만 사용하므로 프로덕션 게시 시 별도 CASA 유료 보안 심사가 요구되지 않습니다. 게시 전환 후 본인 계정으로 로그인 시 `"Google에서 확인하지 않은 앱"` 경고가 1회 뜰 수 있으며 `고급 → JH Wine Forest(으)로 이동`으로 1회 통과하면 이후 **영구 자동 로그인**이 유지됩니다.

### 7.3 무료 Apple ID(Personal Team) iPhone 실기기 설치 및 7일 재서명 루틴
1. **Xcode 서명 설정:**
   * `npm run cap:open:ios`로 `ios/App/App.xcodeproj` 열기.
   * 좌측 네비게이터 **App** 프로젝트 → **TARGETS > App > Signing & Capabilities**:
     * `Automatically manage signing` 체크.
     * `Team`: 본인 무료 Apple ID(`Personal Team`) 선택 (`Xcode > Settings > Accounts`에서 먼저 Apple ID 로그인).
     * `Bundle Identifier`: `com.jihoon.wineforest` 확인. *(무료 계정에서 혹시 번들 ID 충돌 경고가 뜰 경우에만 고유 suffix 적용 후 Google Cloud iOS Client Bundle ID도 동일하게 맞춤)*
2. **iPhone 기기 설정:**
   * Mac과 USB 케이블로 연결 → **이 컴퓨터 신뢰**.
   * iPhone **설정 → 개인정보 보호 및 보안 → 개발자 모드** 켜기(재시동 필요).
   * Xcode 상단 기기 선택에서 연결된 iPhone 선택 후 `▶ Run (Cmd+R)` 실행.
   * 첫 실행 시 iPhone **설정 → 일반 → VPN 및 기기 관리 → 개발자 앱(본인 Apple ID) → 신뢰** 1회 승인.
3. **7일 주기 재서명 (무료 계정 정책):**
   * 무료 Personal Team 서명 앱은 설치 후 **7일 경과 시 실행이 잠깁니다**.
   * **데이터 안전성:** 재서명 시 앱을 삭제하지 말고 Mac USB 연결 후 Xcode에서 `Cmd+R`로 덮어쓰기 빌드만 하면 **IndexedDB 캐시와 Keychain Google 로그인 세션이 그대로 유지**된 채 7일이 연장됩니다.
4. **부록 — 추후 TestFlight(90일 유지 · 무선 설치) 업그레이드:**
   * Apple Developer Program(연 \$99) 가입 시 Xcode에서 같은 Bundle ID의 Team만 유료 팀으로 변경 → `Product > Archive > Distribute App > TestFlight` 업로드 후 iPhone TestFlight 앱으로 90일간 USB 없이 설치·사용 가능.

---

## 8. 마일스톤 실행 계획 (M1~M5) 및 완료 기준 (DoD)

| 마일스톤 | 선행 조건 | 작업 범위 | 자가 검증 명령 및 통과 기준 |
| :---: | :---: | :--- | :--- |
| **M1** | 없음 | `.gitignore`, `.gitattributes`, `package.json`, `vite.config.ts`, `capacitor.config.ts` | `npm run build` (`dist/sw.js` 생성 + `/wine-forest/`) 및 `npm run build:mobile` (`dist/sw.js` 미생성 + `./`) 모두 성공 |
| **M2** | M1 | `googleDriveAuth.ts`, `src/services/auth/*`, `nativeBridge.ts`, `googleDriveAdapter.ts`, `useWineStore.ts`, `photoPicker.ts`(`@capacitor/camera` 분기 연결), UI(`BottomSheet`, `ConfirmDialog`, `AppShell`, `OnboardingView`, `SettingsPage`), `tests/authAdapter.test.ts`, `tests/auditFixes.test.tsx`, `tests/shareLink.test.tsx` | `npm run typecheck` (에러 0건), `npm run test` (전체 **9개 스위트 / 69개 테스트** 100% 통과) |
| **M3** | M2 | `npx cap add ios --packagemanager SPM`, `npx cap add android`, `ios/` Swift 플러그인·`Local.xcconfig.example`, `android/` Kotlin 플러그인·`MainActivity`·`build.gradle` 작성 후 Git 커밋·푸시 | `npx cap sync android` 성공, `git status`에 개인 설정/키스토어 미포함 확인 |
| **M4** | **Xcode 설치** | Xcode 초기 세팅, `GoogleSignIn-iOS` SPM 연결, `Local.xcconfig` 작성, Google Cloud iOS Client 추가 및 프로덕션 게시 | `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator build` 에러 0건 |
| **M5** | M4 + iPhone | 무료 Personal Team으로 iPhone 실기기 USB 설치 및 실사용 E2E 검증 | ① 최초 1회 로그인 후 `wine_db.json` 로드 ② 앱 강제 종료 후 재실행 시 로그인 팝업 없이 자동 동기화 ③ JSON 공유 시트 정상 동작 ④ 다크/라이트 상태바 전환 정상 |

### 8.1 신규 단위 테스트 필수 시나리오 (`tests/authAdapter.test.ts`)
1. **웹(GIS) 하위 호환성:** 비네이티브 환경에서 `ensureAccessToken()` 호출 시 토큰 만료 상태면 `AuthRequiredError`를 throw하고 팝업을 띄우지 않음.
2. **네이티브 무음 복원 & TTL 관리:** `restoreAuthSession()`이 네이티브 플러그인 결과를 메모리에 저장하고 `hasValidToken()`이 `true`를 반환함 (50분 기본 TTL 및 60초 안전 버퍼 경계값 검증).
3. **동시 토큰 갱신 단일화 (Single-Flight):** 만료 상태에서 여러 API가 동시에 `ensureAccessToken()`을 호출해도 네이티브 `getAccessToken` 브릿지는 **단 1회**만 호출됨.
4. **GoogleDriveAdapter 401 자동 1회 재시도:** Drive API가 401을 반환할 때 네이티브 어댑터가 `forceRefresh: true`로 토큰을 갱신한 뒤 요청을 1회 자동 재시도해 성공함(연속 401 시에는 무한 루프 없이 `AuthRequiredError` throw).
5. **사용자 취소 및 권한 거부 정규화:** 네이티브가 `USER_CANCELLED` 또는 `SCOPE_DENIED` 반환 시 명확한 에러를 전달하고 세션 상태를 오염시키지 않음.

---

## 9. Phase 2 완료 후 착수 시 추가 점검 항목 (경로 A 연계)

경로 A에 따라 웹 Phase 2 기능 개발이 끝난 뒤 본 지시서(M1~M5)를 착수할 때, 아래 2개 항목을 함께 반영합니다.

1. **라벨 / 시음 사진 카메라 연동 (`@capacitor/camera`):**
   * M1 패키지 설치 시 `@capacitor/camera`를 함께 설치합니다.
   * **단일 연동 지점:** 모든 UI(`WineDetailSheet`, `QuickConsumeModal`, `HistoryCard`)는 이미 [photoPicker.ts](../src/services/media/photoPicker.ts)의 `pickImageFile(options)`로 단일화되어 있으며, 스토어(`uploadWineLabelPhoto` / `uploadTastingPhoto`)도 `Blob`을 직접 수용합니다. **UI 파일은 수정하지 말고 `src/services/media/photoPicker.ts` 상단의 `NEXT AGENT HANDOFF` 주석대로 `Capacitor.isNativePlatform()` 분기만 추가**하십시오. (반환된 `Blob`은 `imageProcessor.ts`에서 자동 500px/1024px WebP 압축 후 `StorageAdapter.uploadPhoto()`로 저장됨)
   * **`ios/App/App/Info.plist` 필수 권한 키 3종 추가** *(미등록 시 `@capacitor/camera@8`의 `checkUsageDescriptions()`가 `saveToGallery: false`/앨범 선택 시에도 즉시 reject하여 iOS 카메라/앨범이 동작하지 않음)*:
     * `NSCameraUsageDescription`: `"와인 라벨 및 시음 사진을 촬영해 셀러에 저장하기 위해 카메라 접근 권한이 필요합니다."`
     * `NSPhotoLibraryUsageDescription`: `"앨범에서 와인 라벨 및 시음 사진을 선택해 등록하기 위해 사진 라이브러리 접근 권한이 필요합니다."`
     * `NSPhotoLibraryAddUsageDescription`: `"촬영한 와인 라벨 및 시음 사진을 처리하기 위해 사진 라이브러리 쓰기 권한 설명이 필요합니다."` *(반영 완료 ✅)*
2. **음용적기 OS 로컬 알림 (`@capacitor/local-notifications`, 채택 시):**
   * 무료 Apple ID(Personal Team)는 원격 푸시(APNs)를 지원하지 않으므로 OS 알림을 제공할 경우 `@capacitor/local-notifications`를 추가해 앱 내 음용적기 순수 함수와 연결하고, 최초 알림 설정 시 `requestPermissions()`를 요청합니다.
3. **M5 실기기 전수 감사 반영 완료 내역 (2026-11-26 반영 완료 ✅):**
   * `capacitor.config.ts` / `ios/App/App/capacitor.config.json`: `StatusBar.overlaysWebView: true` 적용(라이트모드 검은 상태바 방지).
   * `nativeBridge.ts`: `Share.share` 호출 시 `text` 제거(`url`만 전달해 iOS `text.txt` 중복 생성 차단) 및 `syncStatusBar` 방어 호출.
   * `GoogleDriveAuthPlugin.swift`: `restoreSession`/`getAccessToken`/`signOut` `DispatchQueue.main.async` 직렬화, `isClientIdConfigured()`에서 `CFBundleURLSchemes` 일치 검증, `SCOPE_DENIED` 시 `signOut()` 정리.
   * `SceneDelegate.swift`: `willConnectTo` 콜드스타트 URL 전달 및 `openURLContexts` 다중 URL 순회 처리.
   * `ConfirmDialog.tsx`: 전 화면 `window.confirm`을 React `<ConfirmDialog>`로 전면 교체(iOS `WKWebView` `presentedViewController` 충돌 크래시 방지).
   * `Info.plist` / `photoPicker.ts`: `CFBundleDevelopmentRegion: ko` + `CFBundleLocalizations`(`ko`, `en`) 및 카메라 시트 한글 `promptLabel*` 적용.
   * `vite.config.ts` / `.github/workflows/ios-ipa.yml`: Capacitor 빌드 Web GIS `<script>` 자동 제거, `bundle_id` 정규식 및 `REVERSED_ID` 일치 CI 검증 추가.
