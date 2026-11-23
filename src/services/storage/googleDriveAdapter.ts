import type { WineDatabase } from '@/types/schema';
import { parseWineDatabase } from '@/types/validation';
import { getAccessToken } from '@/services/auth/googleAuth';
import {
  AuthRequiredError,
  ConflictError,
  type BackupSnapshot,
  type RemoteFileMeta,
  type StorageAdapter,
} from './types';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const ROOT_FOLDER_NAME = 'JH_Wine_Forest';
const BACKUP_FOLDER_NAME = 'backups';
const PHOTO_FOLDER_NAME = 'photos';
const DB_FILE_NAME = 'wine_db.json';
const APP_PROP_KEY = 'jhApp';
const APP_PROP_VAL = 'wine-forest';

interface DriveFileItem {
  id: string;
  name: string;
  modifiedTime?: string;
  createdTime?: string;
  size?: string;
}

export class GoogleDriveAdapter implements StorageAdapter {
  private workspaceIds: {
    rootFolderId: string;
    backupFolderId: string;
    photoFolderId: string;
  } | null = null;

  private requireToken(): string {
    const token = getAccessToken();
    if (!token) {
      throw new AuthRequiredError();
    }
    return token;
  }

  private async fetchDrive(url: string, init: RequestInit = {}): Promise<Response> {
    const token = this.requireToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(url, { ...init, headers });
    if (response.status === 401) {
      throw new AuthRequiredError('구글 인증이 만료되었습니다. 1클릭 재인증을 진행해 주세요.');
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Google Drive API 오류 (${response.status}): ${detail || response.statusText}`);
    }
    return response;
  }

  private async findFolder(name: string, parentId?: string): Promise<string | null> {
    const parentClause = parentId ? `'${parentId}' in parents` : `'root' in parents`;
    // 먼저 appProperties 태그가 있는 폴더를 우선 검색(중복 생성 레이스 대응)
    const taggedQ = [
      `name = '${name}'`,
      `mimeType = '${FOLDER_MIME}'`,
      'trashed = false',
      parentClause,
      `appProperties has { key='${APP_PROP_KEY}' and value='${APP_PROP_VAL}' }`,
    ].join(' and ');

    const taggedParams = new URLSearchParams({
      q: taggedQ,
      fields: 'files(id,name,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: '5',
    });
    const taggedRes = await this.fetchDrive(`${DRIVE_API_BASE}/files?${taggedParams}`);
    const taggedJson = (await taggedRes.json()) as { files?: DriveFileItem[] };
    if (taggedJson.files && taggedJson.files.length > 0) {
      if (taggedJson.files.length > 1) {
        console.warn(`[JH Wine Forest] 중복 폴더(${name}) 감지 — 최신 폴더를 사용합니다.`);
      }
      return taggedJson.files[0].id;
    }

    // 태그 없는 기존 폴더 fallback 검색
    const fallbackQ = [
      `name = '${name}'`,
      `mimeType = '${FOLDER_MIME}'`,
      'trashed = false',
      parentClause,
    ].join(' and ');
    const fallbackParams = new URLSearchParams({
      q: fallbackQ,
      fields: 'files(id,name,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: '5',
    });
    const fallbackRes = await this.fetchDrive(`${DRIVE_API_BASE}/files?${fallbackParams}`);
    const fallbackJson = (await fallbackRes.json()) as { files?: DriveFileItem[] };
    return fallbackJson.files?.[0]?.id ?? null;
  }

  private async createFolder(name: string, parentId?: string): Promise<string> {
    const metadata: Record<string, unknown> = {
      name,
      mimeType: FOLDER_MIME,
      appProperties: { [APP_PROP_KEY]: APP_PROP_VAL },
    };
    if (parentId) {
      metadata.parents = [parentId];
    }
    const res = await this.fetchDrive(`${DRIVE_API_BASE}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
    const created = (await res.json()) as { id: string };
    return created.id;
  }

  async ensureWorkspace(): Promise<{
    rootFolderId: string;
    backupFolderId: string;
    photoFolderId: string;
  }> {
    if (this.workspaceIds) {
      return this.workspaceIds;
    }

    const rootFolderId =
      (await this.findFolder(ROOT_FOLDER_NAME)) ?? (await this.createFolder(ROOT_FOLDER_NAME));

    const [backupFolderId, photoFolderId] = await Promise.all([
      this.findFolder(BACKUP_FOLDER_NAME, rootFolderId).then(
        (id) => id ?? this.createFolder(BACKUP_FOLDER_NAME, rootFolderId),
      ),
      this.findFolder(PHOTO_FOLDER_NAME, rootFolderId).then(
        (id) => id ?? this.createFolder(PHOTO_FOLDER_NAME, rootFolderId),
      ),
    ]);

    this.workspaceIds = { rootFolderId, backupFolderId, photoFolderId };
    return this.workspaceIds;
  }

  resetWorkspaceCache(): void {
    this.workspaceIds = null;
  }

  async findDbFile(): Promise<RemoteFileMeta | null> {
    const { rootFolderId } = await this.ensureWorkspace();
    const q = [
      `name = '${DB_FILE_NAME}'`,
      `'${rootFolderId}' in parents`,
      'trashed = false',
    ].join(' and ');
    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: '5',
    });
    const res = await this.fetchDrive(`${DRIVE_API_BASE}/files?${params}`);
    const json = (await res.json()) as { files?: DriveFileItem[] };
    const files = json.files ?? [];
    if (files.length === 0) return null;
    if (files.length > 1) {
      console.warn('[JH Wine Forest] 중복 wine_db.json 감지 — 최신 modifiedTime 파일을 사용합니다.');
    }
    const latest = files[0];
    return {
      fileId: latest.id,
      modifiedTime: latest.modifiedTime ?? new Date().toISOString(),
    };
  }

  async getFileModifiedTime(fileId: string): Promise<string> {
    const res = await this.fetchDrive(`${DRIVE_API_BASE}/files/${fileId}?fields=modifiedTime`);
    const meta = (await res.json()) as { modifiedTime: string };
    return meta.modifiedTime;
  }

  async loadDb(fileId: string): Promise<{ data: WineDatabase; modifiedTime: string }> {
    const [modifiedTime, contentRes] = await Promise.all([
      this.getFileModifiedTime(fileId),
      this.fetchDrive(`${DRIVE_API_BASE}/files/${fileId}?alt=media`),
    ]);
    const raw = (await contentRes.json()) as unknown;
    const data = parseWineDatabase(raw);
    return { data, modifiedTime };
  }

  private buildMultipartBody(
    metadata: Record<string, unknown>,
    jsonString: string,
    boundary: string,
  ): string {
    return [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      jsonString,
      `--${boundary}--`,
    ].join('\r\n');
  }

  async saveDb(
    fileId: string | null,
    data: WineDatabase,
    expectedModifiedTime: string | null,
  ): Promise<{ fileId: string; modifiedTime: string }> {
    const validated = parseWineDatabase(data);
    const jsonString = JSON.stringify(validated, null, 2);

    if (fileId) {
      // 저장 직전 낙관적 잠금 충돌 검사
      if (expectedModifiedTime !== null) {
        const remoteModifiedTime = await this.getFileModifiedTime(fileId);
        if (remoteModifiedTime !== expectedModifiedTime) {
          throw new ConflictError(fileId, expectedModifiedTime, remoteModifiedTime);
        }
      }

      const res = await this.fetchDrive(
        `${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=media&fields=id,modifiedTime`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: jsonString,
        },
      );
      const updated = (await res.json()) as { id: string; modifiedTime: string };
      return { fileId: updated.id, modifiedTime: updated.modifiedTime };
    }

    // 최초 파일 생성
    const { rootFolderId } = await this.ensureWorkspace();
    const boundary = `jh_wine_forest_${Date.now()}`;
    const body = this.buildMultipartBody(
      {
        name: DB_FILE_NAME,
        mimeType: 'application/json',
        parents: [rootFolderId],
        appProperties: { [APP_PROP_KEY]: APP_PROP_VAL },
      },
      jsonString,
      boundary,
    );

    const res = await this.fetchDrive(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,modifiedTime`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    const created = (await res.json()) as { id: string; modifiedTime: string };
    return { fileId: created.id, modifiedTime: created.modifiedTime };
  }

  async createBackup(data: WineDatabase, fileName: string): Promise<BackupSnapshot> {
    const validated = parseWineDatabase(data);
    const { backupFolderId } = await this.ensureWorkspace();
    const jsonString = JSON.stringify(validated, null, 2);
    const boundary = `jh_wine_backup_${Date.now()}`;

    const body = this.buildMultipartBody(
      {
        name: fileName,
        mimeType: 'application/json',
        parents: [backupFolderId],
        appProperties: { [APP_PROP_KEY]: APP_PROP_VAL, jhKind: 'backup' },
      },
      jsonString,
      boundary,
    );

    const res = await this.fetchDrive(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,createdTime,size`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    const created = (await res.json()) as DriveFileItem;
    return {
      fileId: created.id,
      name: created.name,
      createdTime: created.createdTime ?? new Date().toISOString(),
      sizeBytes: created.size ? Number(created.size) : new Blob([jsonString]).size,
    };
  }

  async listBackups(): Promise<BackupSnapshot[]> {
    const { backupFolderId } = await this.ensureWorkspace();
    const q = [`'${backupFolderId}' in parents`, 'trashed = false'].join(' and ');
    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,createdTime,size)',
      orderBy: 'createdTime desc',
      pageSize: '100',
    });
    const res = await this.fetchDrive(`${DRIVE_API_BASE}/files?${params}`);
    const json = (await res.json()) as { files?: DriveFileItem[] };
    return (json.files ?? []).map((f) => ({
      fileId: f.id,
      name: f.name,
      createdTime: f.createdTime ?? '',
      sizeBytes: f.size ? Number(f.size) : undefined,
    }));
  }

  async loadBackup(fileId: string): Promise<WineDatabase> {
    const res = await this.fetchDrive(`${DRIVE_API_BASE}/files/${fileId}?alt=media`);
    const raw = (await res.json()) as unknown;
    return parseWineDatabase(raw);
  }
}
