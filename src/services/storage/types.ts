import type { WineDatabase } from '@/types/schema';

export interface RemoteFileMeta {
  fileId: string;
  modifiedTime: string;
}

export interface BackupSnapshot {
  fileId: string;
  name: string;
  createdTime: string;
  sizeBytes?: number;
}

export interface StorageAdapter {
  ensureWorkspace(): Promise<{
    rootFolderId: string;
    backupFolderId: string;
    photoFolderId: string;
  }>;
  findDbFile(): Promise<RemoteFileMeta | null>;
  getFileModifiedTime(fileId: string): Promise<string | null>;
  loadDb(fileId: string): Promise<{ data: WineDatabase; modifiedTime: string }>;
  saveDb(
    fileId: string | null,
    data: WineDatabase,
    expectedModifiedTime: string | null,
  ): Promise<{ fileId: string; modifiedTime: string }>;
  createBackup(data: WineDatabase, fileName: string): Promise<BackupSnapshot>;
  listBackups(): Promise<BackupSnapshot[]>;
  loadBackup(fileId: string): Promise<WineDatabase>;
  uploadPhoto(blob: Blob, fileName: string): Promise<{ fileId: string }>;
  downloadPhoto(fileId: string): Promise<Blob>;
  deletePhoto(fileId: string): Promise<void>;
}

export class ConflictError extends Error {
  readonly fileId: string;
  readonly expectedModifiedTime: string | null;
  readonly remoteModifiedTime: string;

  constructor(fileId: string, expectedModifiedTime: string | null, remoteModifiedTime: string) {
    super(
      `원격 데이터 충돌 감지: 로컬 기준(${expectedModifiedTime ?? '없음'}) != 원격(${remoteModifiedTime})`,
    );
    this.name = 'ConflictError';
    this.fileId = fileId;
    this.expectedModifiedTime = expectedModifiedTime;
    this.remoteModifiedTime = remoteModifiedTime;
  }
}

export class AuthRequiredError extends Error {
  constructor(message = '구글 인증 토큰이 만료되었거나 로그인이 필요합니다.') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export type StorageMode = 'google_drive' | 'local_test';
