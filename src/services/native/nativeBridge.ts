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

/**
 * 클립보드 텍스트 복사 (Clipboard API 우선 + 구형/WebView textarea 폴백)
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback below
    }
  }
  if (typeof document === 'undefined') {
    return false;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

/**
 * OS 네이티브 공유 시트 호출 가능 여부 (Capacitor 네이티브 또는 Web Share API)
 */
export function canUseNativeShareSheet(): boolean {
  return (
    Capacitor.isNativePlatform() ||
    (typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  );
}

/**
 * 공유 링크 또는 텍스트를 OS 공유 시트로 전송 (미지원/실패 시 클립보드 복사로 안전 폴백)
 */
export async function shareTextOrUrl(params: {
  title: string;
  text?: string;
  url?: string;
}): Promise<'shared' | 'copied' | 'cancelled'> {
  const fallbackText = params.url ?? params.text ?? '';

  if (Capacitor.isNativePlatform()) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({
        title: params.title,
        text: params.text,
        url: params.url,
        dialogTitle: params.title,
      });
      return 'shared';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      if (/cancel|abort/i.test(msg)) {
        return 'cancelled';
      }
      if (fallbackText && (await copyTextToClipboard(fallbackText))) {
        return 'copied';
      }
      throw err;
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: params.title,
        text: params.text,
        url: params.url,
      });
      return 'shared';
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      const msg = err instanceof Error ? err.message : String(err ?? '');
      if (name === 'AbortError' || /cancel|abort/i.test(msg)) {
        return 'cancelled';
      }
      if (fallbackText && (await copyTextToClipboard(fallbackText))) {
        return 'copied';
      }
      throw err;
    }
  }

  if (fallbackText && (await copyTextToClipboard(fallbackText))) {
    return 'copied';
  }
  throw new Error('클립보드에 복사할 수 없습니다. 브라우저 권한을 확인해 주세요.');
}
