import { Capacitor } from '@capacitor/core';

interface ModalCloserEntry {
  id: string;
  close: () => void;
}

const modalCloserStack: ModalCloserEntry[] = [];

export function registerModalCloser(id: string, close: () => void): () => void {
  const existingIdx = modalCloserStack.findIndex((entry) => entry.id === id);
  if (existingIdx !== -1) {
    modalCloserStack.splice(existingIdx, 1);
  }
  modalCloserStack.push({ id, close });

  return () => {
    const idx = modalCloserStack.findIndex((entry) => entry.id === id);
    if (idx !== -1) {
      modalCloserStack.splice(idx, 1);
    }
  };
}

export function closeTopModal(): boolean {
  const top = modalCloserStack[modalCloserStack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

/**
 * 네이티브 앱에서 Light/Dark 테마 변경 시 OS 상태바(아이콘/배경) 자동 동기화
 */
export async function syncStatusBar(theme: 'light' | 'dark'): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({
      style: theme === 'dark' ? Style.Dark : Style.Light,
    });
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({
        color: theme === 'dark' ? '#0D1411' : '#FAF9F6',
      });
    }
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
    URL.revokeObjectURL(url);
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
      text: fileName,
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
 * 1) 열린 BottomSheet/모달 닫기 -> 2) 서브 탭에서 이전/홈 이동 -> 3) 홈('/')에서 2초 내 2회 시 종료
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
      if (closeTopModal()) {
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
