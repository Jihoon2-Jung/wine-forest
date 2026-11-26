import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { handleTopModalBack } from '@/components/common/BottomSheet';

/**
 * 네이티브 앱(iOS/Android)에서 Light/Dark 테마 변경 시 OS 시스템 바 스타일 자동 동기화
 * - Android 15~17(API 35+): Capacitor 8 내장 SystemBars로 상단 상태바 + 하단 제스처 바 동시 동기화
 * - Android <=14: StatusBar 배경색/아이콘 보조 적용
 * - iOS: StatusBar overlaysWebView: true 유지
 */
export async function syncStatusBar(theme: 'light' | 'dark'): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const platform = Capacitor.getPlatform();
    if (platform === 'android') {
      await SystemBars.setStyle({
        style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
      }).catch(() => undefined);
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      await StatusBar.setStyle({
        style: theme === 'dark' ? Style.Dark : Style.Light,
      }).catch(() => undefined);
      await StatusBar.setBackgroundColor({
        color: theme === 'dark' ? '#0D1411' : '#FAF9F6',
      }).catch(() => undefined);
      return;
    }
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
    await StatusBar.setStyle({
      style: theme === 'dark' ? Style.Dark : Style.Light,
    });
  } catch {
    // ignore native status bar errors
  }
}

/**
 * JSON 백업 내보내기: 웹은 Blob 다운로드, 네이티브(iOS/Android)는 Cache 저장 후 OS 공유 시트 호출
 */
export async function exportJsonWithNativeShare(
  fileName: string,
  jsonText: string,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'downloaded';
  }

  try {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);

    await Filesystem.writeFile({
      path: fileName,
      data: jsonText,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });

    const { uri } = await Filesystem.getUri({
      path: fileName,
      directory: Directory.Cache,
    });

    await Share.share({
      title: 'JH Wine Forest 백업 내보내기',
      url: uri,
      dialogTitle: 'wine_db.json 내보내기',
    });
    return 'shared';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err ?? '');
    if (/cancel|abort/i.test(msg)) {
      return 'cancelled';
    }
    throw err;
  }
}

export interface AndroidBackHandlers {
  getPathname: () => string;
  navigateBack: () => void;
  navigateHome: () => void;
  showExitHint: () => void;
}

/**
 * Android 하드웨어/제스처 뒤로가기 처리:
 * 1) 열린 모달(BottomSheet/ConfirmDialog/PhotoLightbox) 닫기 -> 2) 서브 탭에서 이전/홈 이동 -> 3) 홈('/')에서 2초 내 2회 시 종료
 */
export async function initAndroidBackButton(handlers: AndroidBackHandlers): Promise<() => void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return () => {};
  }

  let removed = false;
  let lastBackPressAt = 0;

  try {
    const { App } = await import('@capacitor/app');
    const handle = await App.addListener('backButton', ({ canGoBack }) => {
      if (handleTopModalBack()) {
        return;
      }

      if (handlers.getPathname() !== '/') {
        if (canGoBack) {
          handlers.navigateBack();
        } else {
          handlers.navigateHome();
        }
        return;
      }

      const now = Date.now();
      if (now - lastBackPressAt < 2000) {
        void App.exitApp();
      } else {
        lastBackPressAt = now;
        handlers.showExitHint();
      }
    });

    if (removed) {
      void handle.remove();
      return () => {};
    }

    return () => {
      removed = true;
      void handle.remove();
    };
  } catch {
    return () => {
      removed = true;
    };
  }
}

export interface AppLifecycleHandlers {
  onResume: () => void;
  onCameraRestored?: () => void;
}

/**
 * 포그라운드 복귀 자동 동기화 + Android 저메모리 카메라 Activity 재생성 복구 안내
 * - 네이티브(iOS/Android): @capacitor/app appStateChange / appRestoredResult 리스너
 * - 웹: document visibilitychange 리스너
 */
export async function initAppLifecycleListeners(
  handlers: AppLifecycleHandlers,
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) {
    if (typeof document === 'undefined') return () => {};
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handlers.onResume();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }

  let removed = false;
  const cleanups: Array<() => void> = [];

  try {
    const { App } = await import('@capacitor/app');
    const stateHandle = await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        handlers.onResume();
      }
    });
    cleanups.push(() => void stateHandle.remove());

    if (Capacitor.getPlatform() === 'android' && handlers.onCameraRestored) {
      const restoredHandle = await App.addListener('appRestoredResult', (result) => {
        if (result.pluginId === 'Camera') {
          handlers.onCameraRestored?.();
        }
      });
      cleanups.push(() => void restoredHandle.remove());
    }

    if (removed) {
      cleanups.forEach((fn) => fn());
      return () => {};
    }

    return () => {
      removed = true;
      cleanups.forEach((fn) => fn());
    };
  } catch {
    return () => {
      removed = true;
    };
  }
}
