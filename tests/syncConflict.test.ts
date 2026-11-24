import { describe, expect, it, vi } from 'vitest';
import type { WineDatabase } from '@/types/schema';
import { createDemoDatabase } from '@/services/storage/defaultTemplates';
import { SyncEngine, shouldTriggerWeeklyBackup } from '@/services/storage/syncEngine';
import {
  ConflictError,
  type BackupSnapshot,
  type RemoteFileMeta,
  type StorageAdapter,
} from '@/services/storage/types';

function createMockAdapter(initialDb: WineDatabase, initialModifiedTime: string) {
  let remoteDb: WineDatabase = structuredClone(initialDb);
  let remoteModifiedTime = initialModifiedTime;
  const backups: Array<BackupSnapshot & { data: WineDatabase }> = [];
  let versionCounter = 1;

  const adapter: StorageAdapter & {
    simulateRemoteEdit: (newModifiedTime: string) => void;
    getBackups: () => Array<BackupSnapshot & { data: WineDatabase }>;
  } = {
    simulateRemoteEdit(newModifiedTime: string) {
      remoteModifiedTime = newModifiedTime;
    },
    getBackups() {
      return backups;
    },
    ensureWorkspace: vi.fn(async () => ({
      rootFolderId: 'root-1',
      backupFolderId: 'backup-1',
      photoFolderId: 'photo-1',
    })),
    findDbFile: vi.fn(async (): Promise<RemoteFileMeta | null> => ({
      fileId: 'file-1',
      modifiedTime: remoteModifiedTime,
    })),
    getFileModifiedTime: vi.fn(async (): Promise<string | null> => remoteModifiedTime),
    loadDb: vi.fn(async () => ({
      data: structuredClone(remoteDb),
      modifiedTime: remoteModifiedTime,
    })),
    saveDb: vi.fn(async (fileId, data, expectedModifiedTime) => {
      if (expectedModifiedTime !== null && expectedModifiedTime !== remoteModifiedTime) {
        throw new ConflictError(fileId ?? 'file-1', expectedModifiedTime, remoteModifiedTime);
      }
      versionCounter += 1;
      remoteDb = structuredClone(data);
      remoteModifiedTime = `2026-11-24T00:0${versionCounter}:00.000Z`;
      return {
        fileId: fileId ?? 'file-1',
        modifiedTime: remoteModifiedTime,
      };
    }),
    createBackup: vi.fn(async (data, fileName) => {
      const snap: BackupSnapshot = {
        fileId: `bak-${backups.length + 1}`,
        name: fileName,
        createdTime: new Date().toISOString(),
        sizeBytes: JSON.stringify(data).length,
      };
      backups.push({ ...snap, data: structuredClone(data) });
      return snap;
    }),
    listBackups: vi.fn(async () => backups.map(({ data: _d, ...rest }) => rest)),
    loadBackup: vi.fn(async (fileId) => {
      const found = backups.find((b) => b.fileId === fileId);
      if (!found) throw new Error('backup not found');
      return structuredClone(found.data);
    }),
    uploadPhoto: vi.fn(async () => ({ fileId: 'mock-photo-1' })),
    downloadPhoto: vi.fn(async () => new Blob(['img'], { type: 'image/webp' })),
    deletePhoto: vi.fn(async () => undefined),
  };

  return adapter;
}

describe('SyncEngine — Optimistic Locking, Weekly Backup & Safe Restore', () => {
  it('triggers weekly auto backup when lastBackupAt is null or >= 7 days old', () => {
    const now = new Date('2026-11-24T09:00:00.000Z');
    expect(shouldTriggerWeeklyBackup(null, now)).toBe(true);
    expect(shouldTriggerWeeklyBackup('2026-11-17T08:59:59.000Z', now)).toBe(true);
    expect(shouldTriggerWeeklyBackup('2026-11-20T09:00:00.000Z', now)).toBe(false);
  });

  it('creates a weekly backup once and persists lastBackupAt in a single saveDb call', async () => {
    const db = createDemoDatabase();
    db.metadata.lastBackupAt = null;
    const adapter = createMockAdapter(db, '2026-11-24T00:00:00.000Z');
    const engine = new SyncEngine();

    const now = new Date('2026-11-24T09:00:00.000Z');
    const res = await engine.saveWithPolicy(adapter, {
      fileId: 'file-1',
      data: db,
      expectedModifiedTime: '2026-11-24T00:00:00.000Z',
      now,
    });

    expect(res.autoBackupCreated?.name).toBe('wine_db_backup_20261124.json');
    expect(res.savedData.metadata.lastBackupAt).toBe(now.toISOString());
    expect(adapter.saveDb).toHaveBeenCalledTimes(1);
    expect(adapter.createBackup).toHaveBeenCalledTimes(1);

    // 3일 뒤 저장 시에는 백업을 다시 만들지 않음
    const res2 = await engine.saveWithPolicy(adapter, {
      fileId: res.fileId,
      data: res.savedData,
      expectedModifiedTime: res.modifiedTime,
      now: new Date('2026-11-27T09:00:00.000Z'),
    });
    expect(res2.autoBackupCreated).toBeNull();
    expect(adapter.createBackup).toHaveBeenCalledTimes(1);
  });

  it('throws ConflictError without creating spurious weekly backup when remote modifiedTime differs', async () => {
    const db = createDemoDatabase();
    db.metadata.lastBackupAt = null;
    const adapter = createMockAdapter(db, '2026-11-24T00:00:00.000Z');
    adapter.simulateRemoteEdit('2026-11-24T05:30:00.000Z');

    const engine = new SyncEngine();
    await expect(
      engine.saveWithPolicy(adapter, {
        fileId: 'file-1',
        data: db,
        expectedModifiedTime: '2026-11-24T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(adapter.getFileModifiedTime).toHaveBeenCalledWith('file-1');
    expect(adapter.findDbFile).not.toHaveBeenCalled();
    expect(adapter.createBackup).not.toHaveBeenCalled();
  });

  it('backs up remote DB into conflict snapshot before force overwrite', async () => {
    const db = createDemoDatabase();
    db.metadata.lastBackupAt = '2026-11-23T00:00:00.000Z';
    const adapter = createMockAdapter(db, '2026-11-24T00:00:00.000Z');
    adapter.simulateRemoteEdit('2026-11-24T05:30:00.000Z');

    const engine = new SyncEngine();
    const res = await engine.saveWithPolicy(adapter, {
      fileId: 'file-1',
      data: db,
      expectedModifiedTime: '2026-11-24T00:00:00.000Z',
      forceOverwrite: true,
      now: new Date('2026-11-24T10:15:30.000Z'),
    });

    expect(res.fileId).toBe('file-1');
    expect(adapter.getBackups().some((b) => b.name.startsWith('wine_db_conflict_'))).toBe(true);
  });

  it('creates pre_restore backup before restoring a historical snapshot', async () => {
    const db = createDemoDatabase();
    const adapter = createMockAdapter(db, '2026-11-24T00:00:00.000Z');
    const oldSnap = await adapter.createBackup(db, 'wine_db_backup_20261101.json');

    const engine = new SyncEngine();
    await engine.restoreBackupSafely(adapter, {
      currentData: db,
      backupFileId: oldSnap.fileId,
      fileId: 'file-1',
      now: new Date('2026-11-24T11:00:00.000Z'),
    });

    expect(adapter.getBackups().some((b) => b.name.startsWith('wine_db_pre_restore_'))).toBe(true);
  });
});
