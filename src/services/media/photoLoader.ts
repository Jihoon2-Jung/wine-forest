import { useEffect, useState } from 'react';
import { isNativeAuth, isTokenValid } from '@/services/auth/googleAuth';
import { GoogleDriveAdapter } from '@/services/storage/googleDriveAdapter';
import {
  clearAllCachedPhotos,
  deleteCachedPhoto,
  getCachedPhoto,
  putCachedPhoto,
} from '@/services/storage/localCache';
import { AuthRequiredError, type StorageMode } from '@/services/storage/types';
import { useWineStore } from '@/store/useWineStore';

const photoDriveClient = new GoogleDriveAdapter();
const memoryObjectUrls = new Map<string, string>();
const inFlightLoads = new Map<string, Promise<string | null>>();

// 로그아웃·삭제 직후 완료된 백그라운드 다운로드가 캐시에 좀비 재삽입되는 레이스 차단
let cacheEpoch = 0;
const fileVersions = new Map<string, number>();

// 대량 라벨 로드 시 Drive API 429(Too Many Requests) 폭주 방지용 동시성 제한 큐
const MAX_CONCURRENT_DRIVE_DOWNLOADS = 5;
let activeDriveDownloads = 0;
const driveDownloadQueue: Array<() => void> = [];

function runWithDownloadSlot<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      activeDriveDownloads += 1;
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeDriveDownloads -= 1;
          const next = driveDownloadQueue.shift();
          if (next) next();
        });
    };
    if (activeDriveDownloads < MAX_CONCURRENT_DRIVE_DOWNLOADS) {
      start();
    } else {
      driveDownloadQueue.push(start);
    }
  });
}

function getImmediatePhotoUrl(fileId: string | null | undefined): string | null {
  if (!fileId) return null;
  if (fileId.startsWith('http://') || fileId.startsWith('https://') || fileId.startsWith('data:')) {
    return fileId;
  }
  return memoryObjectUrls.get(fileId) ?? null;
}

function setMemoryObjectUrl(fileId: string, blob: Blob): string {
  const existing = memoryObjectUrls.get(fileId);
  if (existing && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(existing);
  }
  const url = URL.createObjectURL(blob);
  memoryObjectUrls.set(fileId, url);
  return url;
}

/**
 * 업로드 직후 로컬 IndexedDB + 메모리 ObjectURL에 즉시 등록 (0ms 렌더링)
 */
export async function registerUploadedPhotoBlob(fileId: string, blob: Blob): Promise<string> {
  fileVersions.set(fileId, (fileVersions.get(fileId) ?? 0) + 1);
  await putCachedPhoto(fileId, blob);
  return setMemoryObjectUrl(fileId, blob);
}

export async function evictPhotoFromCache(fileId: string): Promise<void> {
  fileVersions.set(fileId, (fileVersions.get(fileId) ?? 0) + 1);
  const existing = memoryObjectUrls.get(fileId);
  if (existing) {
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(existing);
    }
    memoryObjectUrls.delete(fileId);
  }
  await deleteCachedPhoto(fileId);
}

export async function clearAllPhotoCaches(): Promise<void> {
  cacheEpoch += 1;
  fileVersions.clear();
  if (typeof URL.revokeObjectURL === 'function') {
    for (const url of memoryObjectUrls.values()) {
      URL.revokeObjectURL(url);
    }
  }
  memoryObjectUrls.clear();
  inFlightLoads.clear();
  await clearAllCachedPhotos();
}

/**
 * 라벨/시음 사진 URL 해석기:
 * 1) 외부 URL / Data URL 즉시 반환
 * 2) 메모리 ObjectURL 풀 히트 시 즉시 반환
 * 3) IndexedDB photoCache 히트 시 오프라인/토큰 만료 상태에서도 즉시 반환
 * 4) Google Drive 모드 + 유효 토큰 시 동시성 제한(5개)으로 Drive 다운로드 후 IndexedDB 캐싱
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

  const startEpoch = cacheEpoch;
  const startVersion = fileVersions.get(fileId) ?? 0;

  const isStale = () => startEpoch !== cacheEpoch || (fileVersions.get(fileId) ?? 0) !== startVersion;

  let task: Promise<string | null> | null = null;
  task = (async (): Promise<string | null> => {
    try {
      const cachedBlob = await getCachedPhoto(fileId);
      if (isStale()) return null;
      if (cachedBlob) {
        return setMemoryObjectUrl(fileId, cachedBlob);
      }

      if (
        storageMode === 'google_drive' &&
        (isTokenValid() || (isNativeAuth() && useWineStore.getState().googleConnected))
      ) {
        const remoteBlob = await runWithDownloadSlot(() => photoDriveClient.downloadPhoto(fileId));
        if (isStale()) return null;
        await putCachedPhoto(fileId, remoteBlob);
        if (isStale()) return null;
        return setMemoryObjectUrl(fileId, remoteBlob);
      }

      return null;
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        useWineStore.setState({ syncStatus: 'auth_required', syncError: err.message });
      }
      return null;
    } finally {
      if (inFlightLoads.get(fileId) === task) {
        inFlightLoads.delete(fileId);
      }
    }
  })();

  inFlightLoads.set(fileId, task);
  return task;
}

/**
 * React Hook: fileId에 대응하는 로컬 캐시/Drive 이미지 URL을 비동기 로드
 * - fileId 전환 시 이전 와인의 이미지가 잔존하지 않도록 동기 초기화
 * - 토큰 만료 후 재인증 완료 시 authRevision 증가에 반응해 미캐싱 Drive 사진도 자동 재로딩
 */
export function usePhotoUrl(fileId: string | null | undefined): string | null {
  const storageMode = useWineStore((s) => s.storageMode);
  const googleConnected = useWineStore((s) => s.googleConnected);
  const authRevision = useWineStore((s) => s.authRevision);
  const [url, setUrl] = useState<string | null>(() => getImmediatePhotoUrl(fileId));

  useEffect(() => {
    let active = true;
    const immediate = getImmediatePhotoUrl(fileId);
    setUrl(immediate);
    if (!fileId || immediate) {
      return;
    }
    void resolvePhotoUrl(fileId, storageMode).then((resolved) => {
      if (active) setUrl(resolved);
    });
    return () => {
      active = false;
    };
  }, [fileId, storageMode, googleConnected, authRevision]);

  return url;
}
