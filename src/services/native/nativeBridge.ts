import { Capacitor } from '@capacitor/core';

/**
 * 네이티브 앱(iOS)에서 Light/Dark 테마 변경 시 OS 상태바 스타일 자동 동기화
 */
export async function syncStatusBar(theme: 'light' | 'dark'): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({
      style: theme === 'dark' ? Style.Dark : Style.Light,
    });
  } catch {
    // ignore native status bar errors
  }
}

/**
 * JSON 백업 내보내기: 웹은 Blob 다운로드, 네이티브(iOS)는 Cache 저장 후 OS 공유 시트 호출
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
