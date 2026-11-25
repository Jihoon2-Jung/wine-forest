import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { WineDatabase } from '@/types/schema';
import type { BackupSnapshot, StorageMode } from './types';

export interface CachedAppState {
  id: 'singleton';
  data: WineDatabase | null;
  fileId: string | null;
  lastSyncedModifiedTime: string | null;
  hasUnsyncedChanges: boolean;
  storageMode: StorageMode;
  updatedAt: string;
}

export interface LocalBackupRecord {
  fileId: string;
  name: string;
  createdTime: string;
  sizeBytes: number;
  data: WineDatabase;
}

export interface CachedPhotoRecord {
  fileId: string;
  blob: Blob;
  mimeType: string;
  cachedAt: string;
}

interface WineForestIdbSchema extends DBSchema {
  appState: {
    key: 'singleton';
    value: CachedAppState;
  };
  localBackups: {
    key: string;
    value: LocalBackupRecord;
  };
  photoCache: {
    key: string;
    value: CachedPhotoRecord;
  };
}

const DB_NAME = 'jh-wine-forest-idb';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<WineForestIdbSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<WineForestIdbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<WineForestIdbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('appState')) {
          db.createObjectStore('appState', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('localBackups')) {
          db.createObjectStore('localBackups', { keyPath: 'fileId' });
        }
        if (!db.objectStoreNames.contains('photoCache')) {
          db.createObjectStore('photoCache', { keyPath: 'fileId' });
        }
      },
      blocking(_currentVersion, _blockedVersion, _event) {
        void dbPromise?.then((d) => d.close()).catch(() => undefined);
        dbPromise = null;
      },
      terminated() {
        // iOS WKWebView / Safari 백그라운드 유휴 연결 종료 시 다음 호출에서 자동 재오픈
        dbPromise = null;
      },
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

async function withDbRetry<T>(op: (db: IDBPDatabase<WineForestIdbSchema>) => Promise<T>): Promise<T> {
  try {
    const db = await getDb();
    return await op(db);
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'InvalidStateError' || name === 'TransactionInactiveError') {
      dbPromise = null;
      const db = await getDb();
      return await op(db);
    }
    throw err;
  }
}

export async function loadCachedState(): Promise<CachedAppState | null> {
  try {
    const record = await withDbRetry((db) => db.get('appState', 'singleton'));
    return record ?? null;
  } catch {
    return null;
  }
}

export async function saveCachedState(
  state: Omit<CachedAppState, 'id' | 'updatedAt'>,
): Promise<void> {
  await withDbRetry((db) =>
    db.put('appState', {
      ...state,
      id: 'singleton',
      updatedAt: new Date().toISOString(),
    }),
  );
}

export async function clearCachedState(): Promise<void> {
  await withDbRetry((db) => db.delete('appState', 'singleton'));
}

export async function saveLocalBackup(record: LocalBackupRecord): Promise<void> {
  await withDbRetry((db) => db.put('localBackups', record));
}

export async function listLocalBackups(): Promise<BackupSnapshot[]> {
  const records = await withDbRetry((db) => db.getAll('localBackups'));
  return records
    .sort((a, b) => b.createdTime.localeCompare(a.createdTime))
    .map(({ fileId, name, createdTime, sizeBytes }) => ({
      fileId,
      name,
      createdTime,
      sizeBytes,
    }));
}

export async function loadLocalBackup(fileId: string): Promise<WineDatabase | null> {
  const record = await withDbRetry((db) => db.get('localBackups', fileId));
  return record?.data ?? null;
}

export async function clearAllLocalBackups(): Promise<void> {
  try {
    await withDbRetry((db) => db.clear('localBackups'));
  } catch {
    // ignore backup clear errors
  }
}

export async function getCachedPhoto(fileId: string): Promise<Blob | null> {
  try {
    const record = await withDbRetry((db) => db.get('photoCache', fileId));
    return record?.blob ?? null;
  } catch {
    return null;
  }
}

export async function putCachedPhoto(fileId: string, blob: Blob): Promise<void> {
  try {
    await withDbRetry((db) =>
      db.put('photoCache', {
        fileId,
        blob,
        mimeType: blob.type || 'image/webp',
        cachedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // ignore storage quota errors
  }
}

export async function deleteCachedPhoto(fileId: string): Promise<void> {
  try {
    await withDbRetry((db) => db.delete('photoCache', fileId));
  } catch {
    // ignore cache deletion errors
  }
}

export async function clearAllCachedPhotos(): Promise<void> {
  try {
    await withDbRetry((db) => db.clear('photoCache'));
  } catch {
    // ignore cache clear errors
  }
}
