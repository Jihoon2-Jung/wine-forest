# JH Wine Forest — Windows PC Android 빌드 · 서명 · 배포 실전 가이드 (`GUIDE_WIN_ANDROID.md`)

> **문서 목적:** 본 가이드는 **단일 Git 저장소(`wine-forest`) + PC 이원화 빌드 전략(Mac = iOS / Windows = Android)**에 따라, **Windows PC에서 Android 앱을 구현·빌드·서명·실기기 설치**하기 위한 단독 실행형 매뉴얼입니다.
> - **상태:** **WINDOWS ANDROID RELEASE APK v1.0.1 (versionCode 2) VERIFIED & `main` 통합 완료 (2026-11-26) — Windows PC(JDK 21 + Android API 36)에서 `@capacitor/android@8.6.2` · `@capacitor/app@8.1.2` · `GoogleDriveAuthPlugin.kt`(이메일 영속화·`bridge.saveCall`·오프라인 네트워크 세션 보존) · `MainActivity.kt` · `SystemBars` Edge-to-Edge 상/하단바 동기화 · 포그라운드 복귀 자동 동기화 · 카메라 이중 탭 잠금 · 검증 실패 모달/사진 보존 · Android `.json` 피커 호환 · `allowBackup=false` · 조건부 Release 서명까지 전량 반영 및 서명된 `app-release.apk` 실기기 설치 완료 (`main` 통합 + 무서버 공유 링크 포함 `9개 스위트 / 69개 테스트` 통과).**
>
> **전제 조건:** `feat/android-v1` 브랜치에 `@capacitor/android@8.6.2` · `@capacitor/app@8.1.2` · `android/` · `GoogleDriveAuthPlugin.kt` · `MainActivity.kt` · `build.gradle` 조건부 Release 서명 설정까지 모두 구현·검증되어 있습니다. *(Mac에서 iOS 작업을 `main`에서 동시 진행 중인 동안에는 `feat/android-v1` 브랜치로 분리 관리하며, Mac iOS 푸시 완료 후 `main`과 통합합니다. 전체 설계는 [MOBILE_IMPLEMENTATION_PLAN.md](./MOBILE_IMPLEMENTATION_PLAN.md) 참고)*

---

## 1. 이원화 협업 구조 및 Git 운영 원칙

### 1.1 작업 흐름 한눈에 보기
* **코드 원본은 오직 1곳(GitHub `wine-forest`):** Windows PC에서 앱 UI나 로직을 별도로 복제 수정하지 않습니다.
* Mac에서 기능 수정/Android 네이티브 코드가 푸시되면, Windows PC에서는 **`git pull` → 모바일 웹 번들 빌드 → `cap sync android` → APK 설치**만 반복합니다.

### 1.2 Windows Git 초기 설정 (줄바꿈 충돌 방지)
Windows에서 체크아웃 시 `android/gradlew` 쉘 스크립트의 줄바꿈(LF)이 CRLF로 변환되면 Linux/Mac에서 깨질 수 있습니다. 저장소에 `.gitattributes`가 포함되어 있지만 Windows Git 전역 설정도 아래처럼 맞춰 두는 것이 안전합니다.

```powershell
git config --global core.autocrlf input
```

### 1.3 최초 1회 클론 & Android 프로젝트 초기화 (PowerShell)
```powershell
git clone https://github.com/Jihoon2-Jung/wine-forest.git
cd wine-forest

npm ci
# 저장소에 android/ 및 @capacitor/android, @capacitor/app이 아직 없으므로 Windows에서 최초 1회 추가
npm install -D @capacitor/android
npm install @capacitor/app
npm run build:mobile
npx cap add android
npx cap sync android
```
* 이후 [SPEC_MOBILE_IOS.md §4.3 · §6](./SPEC_MOBILE_IOS.md)의 명세를 참고해 `android/app/build.gradle`(`play-services-auth:22.0.0`, 조건부 `keystore.properties` 서명), `GoogleDriveAuthPlugin.kt`, `MainActivity` 등록 및 필요 시 Android 뒤로가기/상태바 배경을 구성합니다.

### 1.4 일상 업데이트 루틴 (Mac 작업 후 Windows 동기화)
새로운 변경사항을 반영할 때는 항상 아래 4줄만 순서대로 실행합니다.

```powershell
# 1. 최신 코드 받기 (충돌 없는 fast-forward 확인)
git pull --ff-only origin main

# 2. package.json / package-lock.json이 변경되었다면 의존성 동기화
npm ci

# 3. Capacitor용 웹 번들 빌드 (base: './', PWA 비활성)
npm run build:mobile

# 4. dist/ 및 플러그인 변경사항을 android/ 프로젝트에 복사
npx cap sync android
```

### 1.5 Windows에서 커밋/푸시할 때 보안 체크
만약 Windows에서 `android/` 설정을 수정해 푸시해야 한다면, **개인 키스토어와 비밀번호 파일이 절대 포함되지 않았는지** 먼저 확인합니다.

```powershell
git status --short
# *.keystore, *.jks, keystore.properties, .env.local 이 목록에 절대 나타나면 안 됩니다!
```

---

## 2. Windows 개발 환경 설치

1. **Git for Windows:** 최신 버전 설치 (설치 중 줄바꿈 옵션은 `Checkout as-is, commit Unix-style line endings` 권장).
2. **Node.js 22+ LTS:** [nodejs.org](https://nodejs.org/)에서 LTS 설치 (`node -v`로 확인).
3. **JDK 21 & Android SDK (필수 — Capacitor 8 기준):**
   * **Capacitor 8 (`AGP 8.13.0` / `Gradle 8.14.3` / `Kotlin 2.2.20`)**은 **JDK 21**(`JAVA_HOME`)과 **Android API 36 (`compileSdkVersion = 36`, `targetSdkVersion = 36`, `Build-Tools 36.0.0`)**이 필요합니다.
   * **Android Studio (2025.2.1 Otter 이상)**를 Standard로 설치하면 호환 JBR 21과 Android SDK가 자동 설치되며, CLI 전용으로 운영할 경우 **Eclipse Temurin JDK 21**과 `sdkmanager "platforms;android-36" "build-tools;36.0.0"`으로 구성할 수 있습니다.
4. **SDK Manager 필수 항목 확인:**
   * Android Studio 열기 → **More Actions > SDK Manager** (또는 `Settings > Languages & Frameworks > Android SDK`):
     * **SDK Platforms 탭:** Android 16 (API 36) 체크 (`android/variables.gradle` 기본값)
     * **SDK Tools 탭:**
       * `Android SDK Build-Tools` (`36.0.0`)
       * `Android SDK Platform-Tools` (`adb` 포함)
       * `Android SDK Command-line Tools (latest)`
5. *(선택) PowerShell에서 `adb` 바로 쓰기:* `%LOCALAPPDATA%\Android\Sdk\platform-tools`를 Windows 사용자 환경변수 `Path`에 추가하면 어느 폴더에서든 `adb` 명령어를 사용할 수 있습니다.

---

## 3. Keystore 생성 및 SHA-1 지문 추출 (PowerShell)

Android에서 Google `AuthorizationClient`(`drive.file` 로그인)가 동작하려면 **APK 서명에 사용된 키스토어의 SHA-1 인증서 지문**이 Google Cloud Console에 등록되어 있어야 합니다.

> **팁:** 별도 JDK를 설치하지 않았더라도 Android Studio 내장 `keytool.exe`를 그대로 사용할 수 있습니다.
> 기본 경로: `C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe`

### 3.1 Debug 키스토어 SHA-1 확인 (USB 개발/테스트용)
Android Studio에서 `Run ▶`로 바로 폰에 설치할 때는 Debug 키스토어가 사용됩니다. *(아직 `debug.keystore`가 없다면 Android Studio에서 프로젝트를 1회 열거나 Gradle Sync를 실행하면 자동 생성됩니다.)*

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" `
  -list -v `
  -keystore "$env:USERPROFILE\.android\debug.keystore" `
  -alias androiddebugkey `
  -storepass android -keypass android
```
* 출력된 항목 중 **`SHA1:`** 줄(예: `AA:BB:CC:...`)을 메모해 둡니다.

### 3.2 Release 키스토어 생성 (본인 폰 영구 설치용)
Release 키스토어는 **프로젝트 폴더(`wine-forest`) 바깥의 개인 백업 폴더**에 안전하게 보관합니다.

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\Documents\WineBackup" | Out-Null

& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" `
  -genkeypair -v `
  -keystore "$env:USERPROFILE\Documents\WineBackup\wine-forest-release.keystore" `
  -alias wineforest `
  -keyalg RSA -keysize 2048 -validity 10000
```
* 비밀번호와 이름 정보(CN 등)를 입력한 뒤, 방금 만든 **Release 키스토어의 SHA-1**도 추출합니다:

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" `
  -list -v `
  -keystore "$env:USERPROFILE\Documents\WineBackup\wine-forest-release.keystore" `
  -alias wineforest
```

### 3.3 `android/keystore.properties` 생성 (Git 차단 대상)
`android/` 폴더 바로 아래에 `keystore.properties` 파일을 생성합니다. (`.gitignore`에 의해 Git 커밋에서 자동 차단됩니다.)

```properties
storeFile=C:/Users/<본인Windows계정명>/Documents/WineBackup/wine-forest-release.keystore
storePassword=<키스토어_비밀번호>
keyAlias=wineforest
keyPassword=<키_비밀번호>
```
> **주의:** Windows 경로 구분자는 백슬래시(`\`) 대신 **슬래시(`/`)**를 사용해야 Gradle 파싱 이스케이프 오류가 나지 않습니다.

---

## 4. Google Cloud Console Android OAuth 클라이언트 등록

> ⚠️ **CRITICAL — 절대 새 프로젝트를 만들지 마세요!**
> `drive.file` 권한은 **동일한 Google Cloud 프로젝트** 내의 앱들끼리만 파일 접근 권한을 공유합니다.
> 반드시 기존 웹앱(`VITE_GOOGLE_CLIENT_ID`) 및 iOS 앱이 등록된 **같은 프로젝트**에 Android 클라이언트를 추가해야 기존 `JH_Wine_Forest/wine_db.json`을 그대로 불러올 수 있습니다.

1. [Google Cloud Console](https://console.cloud.google.com/) 접속 → 상단에서 **기존 `JH Wine Forest` 프로젝트 선택**.
2. **Google Auth Platform → 클라이언트 → + 클라이언트 만들기**:
   * **애플리케이션 유형:** `Android`
   * **이름:** `JH Wine Forest Android (Debug)`
   * **패키지 이름:** **`com.jihoon.wineforest`** *(오타 주의)*
   * **SHA-1 인증서 디지털 지문:** 3.1절에서 추출한 **Debug SHA-1** 입력 → 만들기
3. 같은 방식으로 **Release용 Android 클라이언트 1개 더 추가** (또는 추후 Release APK 빌드 전 등록):
   * **이름:** `JH Wine Forest Android (Release)`
   * **패키지 이름:** **`com.jihoon.wineforest`**
   * **SHA-1 인증서 디지털 지문:** 3.2절에서 추출한 **Release SHA-1** 입력 → 만들기
   * *(Android는 Google Cloud가 패키지명 + SHA-1 조합으로 앱을 식별하므로, Web/iOS와 달리 코드에 Client ID를 따로 하드코딩할 필요가 없습니다.)*
4. **OAuth 동의 화면 상태 확인:**
   * **Google Auth Platform → 대상(Audience)** 메뉴에서 게시 상태가 **`프로덕션(Production)`**인지 확인합니다. (`테스트` 상태면 7일마다 재인증이 요구됩니다.)

---

## 5. Android Studio 빌드 · USB 디버깅 · Release APK 영구 설치

### 5.1 프로젝트 열기 및 Gradle Sync
```powershell
npm run cap:open:android
```
* Android Studio가 열리면 우측 하단 **Gradle Sync**가 완료될 때까지 대기합니다(최초 1회는 SDK/의존성 다운로드로 2~5분 소요).

### 5.2 스마트폰 개발자 옵션 & USB 디버깅 켜기
1. 안드로이드 폰 **설정 → 휴대전화 정보 → 소프트웨어 정보 → 빌드번호**를 **7회 연속 탭**.
2. **설정 → 개발자 옵션 → USB 디버깅** 활성화.
3. Windows PC와 USB 케이블 연결 후 폰 화면의 **"USB 디버깅을 허용하시겠습니까?"** 팝업에서 `항상 허용` → `허용`.

### 5.3 Debug 빌드 & 무음 자동 로그인 검증
1. Android Studio 상단 기기 드롭다운에서 연결된 스마트폰 선택 → **Run (`Shift+F10` 또는 ▶)** 클릭.
2. 하단 **Logcat** 탭을 열고 검색 필터에 `package:com.jihoon.wineforest GoogleDriveAuth` 또는 `Capacitor` 입력해 로그 확인.
3. 앱에서 **`[Google 계정으로 시작하기]`** 클릭 → 기기에 등록된 Google 계정 선택 및 `drive.file` 권한 허용 → 기존 `wine_db.json` 로드 확인.
4. **무음 로그인 테스트:** 앱을 최근 앱 목록에서 완전히 밀어 강제 종료한 뒤 다시 실행했을 때 **로그인 팝업 없이 즉시 동기화**되는지 확인합니다.
5. **UX 체크:** 상단 상태바(다크/라이트 전환 시 아이콘 색상), 스마트폰 뒤로가기 버튼(모달 닫기 → 목록 복귀 → 홈 2회 종료), JSON 내보내기 공유 시트를 확인합니다.
6. **Phase 2 권한 체크 (경로 A 완료 후):** Phase 2 카메라/라벨 사진 및 로컬 알림이 포함된 경우 `android/app/src/main/AndroidManifest.xml`에 `<uses-permission android:name="android.permission.CAMERA" />` 및 (Android 13+ 알림 채택 시) `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />`가 반영되어 있는지 확인합니다.

### 5.4 Release APK 빌드 및 스마트폰 영구 설치
USB 케이블 없이 상시 사용할 수 있는 서명된 Release APK를 생성합니다.

* **방법 A (PowerShell Gradle 직접 빌드 — 빠름):**
  ```powershell
  npm run cap:sync:android
  cd android
  .\gradlew.bat assembleRelease
  ```
  * 생성 경로: `android\app\build\outputs\apk\release\app-release.apk`
* **방법 B (Android Studio 메뉴):**
  * 상단 메뉴 **Build > Generate Signed App Bundle / APK...** → `APK` 선택 → 3.2절의 `wine-forest-release.keystore` 지정 → `release` 빌드.
* **스마트폰 설치:**
  ```powershell
  # USB 연결된 상태에서 바로 설치 (platform-tools Path 등록 시)
  adb install -r android\app\build\outputs\apk\release\app-release.apk
  ```
  *(또는 `app-release.apk` 파일을 카톡 내게 쓰기/구글 드라이브/USB로 스마트폰에 옮겨 직접 탭하여 설치 — 기존 Debug 빌드가 깔려 있으면 삭제 후 설치하세요. 서명 키가 달라 덮어쓰기가 거부될 수 있습니다.)*

---

## 6. 3기기(PC 웹 · iOS · Android) 교차 검증 및 트러블슈팅 FAQ

### 6.1 3기기 교차 동기화 검증 체크리스트
- [ ] **동일 데이터 확인:** PC 웹(GitHub Pages) · iPhone · Android 앱 3곳 모두에서 동일한 병 수/금액/셀러 배치가 조회되는가?
- [ ] **모바일 → 웹 반영:** Android에서 와인 1병 입고(또는 소비) 시 로그인 팝업 없이 즉시 Drive에 저장되고, PC 웹 `[지금 동기화]` 시 바로 반영되는가?
- [ ] **충돌 감지 검증:** PC 웹과 Android 중 한쪽이 구버전 상태일 때 다른 쪽에서 먼저 수정 후 저장을 시도하면 `ConflictModal`이 안전하게 뜨는가?
- [ ] **Android 뒤로가기:** 상세 시트(`WineDetailSheet`)가 열린 상태에서 Android 뒤로가기 제스처를 쓰면 앱이 꺼지지 않고 시트만 닫히는가?

### 6.2 자주 발생하는 오류 및 해결법 (FAQ)

| 증상 / 에러 메시지 | 원인 | 해결 방법 |
| :--- | :--- | :--- |
| **`ApiException: 10` (`DEVELOPER_ERROR`) 또는 권한 요청 실패** | Google Cloud Console의 Android OAuth 클라이언트에 **현재 빌드의 SHA-1 지문 또는 패키지명(`com.jihoon.wineforest`)이 등록되지 않음** | 3.1(Debug) 또는 3.2(Release) SHA-1을 재확인해 Google Cloud Console에 정확히 등록. Debug로 돌리다 Release로 바꿨다면 두 SHA-1 모두 등록되어 있는지 확인 |
| **Google 로그인은 성공했는데 기존 `wine_db.json`을 못 찾음** | Android OAuth 클라이언트를 웹앱/iOS와 **다른 Google Cloud 프로젝트**에 만들었거나, 스마트폰에 다른 Google 계정으로 로그인함 | Google Cloud에서 웹앱과 **동일 프로젝트**인지 확인 + 스마트폰에서 PC 웹과 같은 Google 계정 선택 |
| **`gradlew` 관련 `\r: command not found` 또는 스크립트 깨짐** | Windows Git 체크아웃 시 LF가 CRLF로 변환됨 | `git config --global core.autocrlf input` 설정 후 `git checkout -- android/gradlew` (또는 `git rm --cached -r . && git reset --hard`) |
| **7일이 지나니 다시 로그인/권한 창이 뜸** | Google Cloud OAuth 동의 화면이 **`테스트(Testing)`** 상태에 머물러 있음 | **Google Auth Platform → 대상(Audience)**에서 **프로덕션 게시(Publish App)** 실행 |
| **`adb install` 시 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`** | 스마트폰에 Debug 서명 앱이 이미 깔려 있는데 Release 서명 APK로 덮어쓰려고 함 | 기존 Debug 앱을 폰에서 제거(Uninstall)한 뒤 `app-release.apk` 설치 |
| **Android Studio에서 `Kotlin` 또는 `play-services-auth` Gradle Sync 실패** | 네트워크/프록시 문제 또는 Gradle 캐시 손상 | **File > Invalidate Caches...** 후 다시 Sync, `android/keystore.properties` 경로에 `\` 대신 `/`를 썼는지 확인 |
| **JSON 내보내기 시 공유 시트가 안 뜨거나 파일 오류** | Cache 디렉터리 권한 또는 FileProvider 설정 누락 | `@capacitor/filesystem` + `@capacitor/share`가 `npx cap sync android`로 `capacitor.settings.gradle`에 정상 등록되었는지 확인 |
