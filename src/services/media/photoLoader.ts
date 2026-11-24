import { useEffect, useState } from 'react';
import { isTokenValid } from '@/services/auth/googleAuth';
import { GoogleDriveAdapter } from '@/services/storage/googleDriveAdapter';
import { deleteCachedPhoto, getCachedPhoto, putCachedPhoto } from '@/services/storage/localCache';
import type { StorageMode } from '@/services/storage/types';
import { useWineStore } from '@/store/useWineStore';

const photoDriveClient = new GoogleDriveAdapter();
const memoryObjectUrls = new Map<string, string>();
const inFlightLoads = new Map<string, Promise<string | null>>();

/**
 * 업로드 직후 로컬 IndexedDB + 메모리 ObjectURL에 즉시 등록 (0ms 렌더링)
 */
export async function registerUploadedPhotoBlob(fileId: string, blob: Blob): Promise<string> {
  await putCachedPhoto(fileId, blob);
  const existing = memoryObjectUrls.get(fileId);
  if (existing) {
    URL.revokeObjectURL(existing);
  }
  const url = URL.createObjectURL(blob);
  memoryObjectUrls.set(fileId, url);
  return url;
}

export async function evictPhotoFromCache(fileId: string): Promise<void> {
  const existing = memoryObjectUrls.get(fileId);
  if (existing) {
    URL.revokeObjectURL(existing);
    memoryObjectUrls.delete(fileId);
  }
  await deleteCachedPhoto(fileId);
}

/**
 * 라벨/시음 사진 URL 해석기:
 * 1) 외부 URL / Data URL 즉시 반환
 * 2) 메모리 ObjectURL 풀 히트 시 즉시 반환
 * 3) IndexedDB photoCache 히트 시 오프라인/토큰 만료 상태에서도 즉시 반환
 * 4) Google Drive 모드 + 유효 토큰 시 Drive에서 다운로드 후 IndexedDB 캐싱
 */
export async function resolvePhotoUrl(
  fileId: string | null | undefined,
  storageMode: StorageMode,
): Promise<string | null> {
  if (!fileId) return null;
  if (fileId.startsWith('http://') || fileId.startsWith('https://') || fileId.startsWith('data:')) {
    return fileId;
  }

  const memUrl = memoryObjectUrls.get(fileId);
  if (memUrl) return memUrl;

  const existingPromise = inFlightLoads.get(fileId);
  if (existingPromise) return existingPromise;

  const task = (async (): Promise<string | null> => {
    try {
      const cachedBlob = await getCachedPhoto(fileId);
      if (cachedBlob) {
        const url = URL.createObjectURL(cachedBlob);
        memoryObjectUrls.set(fileId, url);
        return url;
      }

      if (storageMode === 'google_drive' && isTokenValid()) {
        const remoteBlob = await photoDriveClient.downloadPhoto(fileId);
        await putCachedPhoto(fileId, remoteBlob);
        const url = URL.createObjectURL(remoteBlob);
        memoryObjectUrls.set(fileId, url);
        return url;
      }

      return null;
    } catch {
      return null;
    } finally {
      inFlightLoads.delete(fileId);
    }
  })();

  inFlightLoads.set(fileId, task);
  return task;
}

/**
 * React Hook: fileId에 대응하는 로컬 캐시/Drive 이미지 URL을 비동기 로드
 * (재인증 완료 시 googleConnected 변화에 반응해 미캐싱 Drive 사진도 자동 로드)
 */
export function usePhotoUrl(fileId: string | null | undefined): string | null {
  const storageMode = useWineStore((s) => s.storageMode);
  const googleConnected = useWineStore((s) => s.googleConnected);
  const [url, setUrl] = useState<string | null>(() => {
    if (!fileId) return null;
    if (fileId.startsWith('http://') || fileId.startsWith('https://') || fileId.startsWith('data:')) {
      return fileId;
    }
    return memoryObjectUrls.get(fileId) ?? null;
  });

  useEffect(() => {
    let active = true;
    if (!fileId) {
      setUrl(null);
      return;
    }
    void resolvePhotoUrl(fileId, storageMode).then((resolved) => {
      if (active) setUrl(resolved);
    });
    return () => {
      active = false;
    };
  }, [fileId, storageMode, googleConnected]);

  return url;
}
