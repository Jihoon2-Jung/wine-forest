import type { WineDatabase } from '@/types/schema';
import { parseWineDatabase } from '@/types/validation';
import {
  listLocalBackups,
  loadCachedState,
  loadLocalBackup,
  saveLocalBackup,
} from './localCache';
import {
  ConflictError,
  type BackupSnapshot,
  type RemoteFileMeta,
  type StorageAdapter,
} from './types';

const LOCAL_FILE_ID = 'local-test-wine-db';

/**
 * Google OAuth Client ID 없이도 로컬 브라우저에서 전체 기능(저장·충돌·백업·복원)을
 * 검증할 수 있는 LocalOnlyAdapter (IndexedDB 기반)
 */
export class LocalOnlyAdapter implements StorageAdapter {
  private lastSavedModifiedTime: string | null = null;

  async ensureWorkspace() {
    return {
      rootFolderId: 'local-root',
      backupFolderId: 'local-backups',
      photoFolderId: 'local-photos',
    };
  }

  async findDbFile(): Promise<RemoteFileMeta | null> {
    const cached = await loadCachedState();
    if (!cached?.data) return null;
    const modifiedTime =
      this.lastSavedModifiedTime ?? cached.lastSyncedModifiedTime ?? cached.data.metadata.lastModifiedAt;
    return {
      fileId: LOCAL_FILE_ID,
      modifiedTime,
    };
  }

  async getFileModifiedTime(_fileId: string): Promise<string | null> {
    const meta = await this.findDbFile();
    return meta?.modifiedTime ?? null;
  }

  async loadDb(_fileId: string): Promise<{ data: WineDatabase; modifiedTime: string }> {
    const cached = await loadCachedState();
    if (!cached?.data) {
      throw new Error('로컬 테스트 DB가 존재하지 않습니다.');
    }
    const data = parseWineDatabase(cached.data);
    const modifiedTime =
      this.lastSavedModifiedTime ?? cached.lastSyncedModifiedTime ?? data.metadata.lastModifiedAt;
    return { data, modifiedTime };
  }

  async saveDb(
    _fileId: string | null,
    data: WineDatabase,
    expectedModifiedTime: string | null,
  ): Promise<{ fileId: string; modifiedTime: string }> {
    parseWineDatabase(data);
    if (
      expectedModifiedTime !== null &&
      this.lastSavedModifiedTime !== null &&
      expectedModifiedTime !== this.lastSavedModifiedTime
    ) {
      throw new ConflictError(LOCAL_FILE_ID, expectedModifiedTime, this.lastSavedModifiedTime);
    }

    const modifiedTime = new Date().toISOString();
    this.lastSavedModifiedTime = modifiedTime;
    return {
      fileId: LOCAL_FILE_ID,
      modifiedTime,
    };
  }

  async createBackup(data: WineDatabase, fileName: string): Promise<BackupSnapshot> {
    const validated = parseWineDatabase(data);
    const createdTime = new Date().toISOString();
    const fileId = `local_backup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const sizeBytes = new Blob([JSON.stringify(validated)]).size;

    await saveLocalBackup({
      fileId,
      name: fileName,
      createdTime,
      sizeBytes,
      data: validated,
    });

    return {
      fileId,
      name: fileName,
      createdTime,
      sizeBytes,
    };
  }

  async listBackups(): Promise<BackupSnapshot[]> {
    return listLocalBackups();
  }

  async loadBackup(fileId: string): Promise<WineDatabase> {
    const data = await loadLocalBackup(fileId);
    if (!data) {
      throw new Error('선택한 로컬 백업 파일을 찾을 수 없습니다.');
    }
    return parseWineDatabase(data);
  }
}
