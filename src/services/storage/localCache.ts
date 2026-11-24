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
    });
  }
  return dbPromise;
}

export async function loadCachedState(): Promise<CachedAppState | null> {
  try {
    const db = await getDb();
    const record = await db.get('appState', 'singleton');
    return record ?? null;
  } catch {
    return null;
  }
}

export async function saveCachedState(
  state: Omit<CachedAppState, 'id' | 'updatedAt'>,
): Promise<void> {
  const db = await getDb();
  await db.put('appState', {
    ...state,
    id: 'singleton',
    updatedAt: new Date().toISOString(),
  });
}

export async function clearCachedState(): Promise<void> {
  const db = await getDb();
  await db.delete('appState', 'singleton');
}

export async function saveLocalBackup(record: LocalBackupRecord): Promise<void> {
  const db = await getDb();
  await db.put('localBackups', record);
}

export async function listLocalBackups(): Promise<BackupSnapshot[]> {
  const db = await getDb();
  const records = await db.getAll('localBackups');
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
  const db = await getDb();
  const record = await db.get('localBackups', fileId);
  return record?.data ?? null;
}

export async function getCachedPhoto(fileId: string): Promise<Blob | null> {
  try {
    const db = await getDb();
    const record = await db.get('photoCache', fileId);
    return record?.blob ?? null;
  } catch {
    return null;
  }
}

export async function putCachedPhoto(fileId: string, blob: Blob): Promise<void> {
  try {
    const db = await getDb();
    await db.put('photoCache', {
      fileId,
      blob,
      mimeType: blob.type || 'image/webp',
      cachedAt: new Date().toISOString(),
    });
  } catch {
    // ignore storage quota errors
  }
}

export async function deleteCachedPhoto(fileId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete('photoCache', fileId);
  } catch {
    // ignore cache deletion errors
  }
}
