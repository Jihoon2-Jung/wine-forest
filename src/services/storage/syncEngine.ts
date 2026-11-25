import type { WineDatabase } from '@/types/schema';
import { formatBackupDateStamp, formatBackupDateTimeStamp } from '@/services/domain/wineHelpers';
import { ConflictError, type BackupSnapshot, type StorageAdapter } from './types';

export const WEEKLY_BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldTriggerWeeklyBackup(
  lastBackupAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!lastBackupAt) return true;
  const lastMs = Date.parse(lastBackupAt);
  if (Number.isNaN(lastMs)) return true;
  return now.getTime() - lastMs >= WEEKLY_BACKUP_INTERVAL_MS;
}

export interface SyncSaveResult {
  fileId: string;
  modifiedTime: string;
  savedData: WineDatabase;
  autoBackupCreated: BackupSnapshot | null;
  conflictBackupCreated?: boolean;
}

export interface SavePolicyParams {
  fileId: string | null;
  data: WineDatabase;
  expectedModifiedTime: string | null;
  forceOverwrite?: boolean;
  now?: Date;
}

/**
 * R4 보강:
 * - 단일 직렬 Write Mutex로 연속 쓰기 시 자가 충돌 방지
 * - 저장 직전 충돌 검사 후, 주 1회 자동 백업이 필요하면 백업 스냅샷 생성 + lastBackupAt 갱신까지
 *   단일 뮤텍스 안에서 원자적으로 수행
 */
export class SyncEngine {
  private writeChain: Promise<unknown> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(task, task);
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  saveWithPolicy(
    adapter: StorageAdapter,
    paramsOrProvider: SavePolicyParams | (() => SavePolicyParams | null),
  ): Promise<SyncSaveResult> {
    return this.enqueue(async () => {
      const params =
        typeof paramsOrProvider === 'function' ? paramsOrProvider() : paramsOrProvider;
      if (!params) {
        throw new Error('저장할 최신 셀러 데이터가 없습니다.');
      }

      const now = params.now ?? new Date();
      const nowIso = now.toISOString();

      // 1. 강제 덮어쓰기 시 원격 파일을 충돌 백업 폴더에 먼저 대피
      let conflictBackupCreated: boolean | undefined;
      if (params.forceOverwrite && params.fileId) {
        conflictBackupCreated = false;
        try {
          const remote = await adapter.loadDb(params.fileId);
          const conflictName = `wine_db_conflict_${formatBackupDateTimeStamp(now)}.json`;
          await adapter.createBackup(remote.data, conflictName);
          conflictBackupCreated = true;
        } catch (err) {
          console.warn('[SyncEngine] 강제 덮어쓰기 전 원격 대피 백업 실패:', err);
        }
      }

      const expected = params.forceOverwrite ? null : params.expectedModifiedTime;
      const needsBackup = shouldTriggerWeeklyBackup(params.data.metadata.lastBackupAt, now);

      // 2. 주 1회 자동 백업 필요 시:
      //    원격 파일이 존재하고 강제 덮어쓰기가 아니라면 먼저 원격 modifiedTime으로 사전 충돌 검증
      //    (충돌 시 불필요한 백업을 만들지 않기 위함)
      if (needsBackup && params.fileId && expected !== null) {
        const remoteModifiedTime = await adapter.getFileModifiedTime(params.fileId);
        if (remoteModifiedTime && remoteModifiedTime !== expected) {
          throw new ConflictError(params.fileId, expected, remoteModifiedTime);
        }
      }

      // 3. 백업 선행 업로드 → 성공 시 lastBackupAt 포함한 메인 DB를 단 1회 저장 (이중 쓰기 제거)
      let autoBackupCreated: BackupSnapshot | null = null;
      let payloadToSave: WineDatabase = {
        ...params.data,
        metadata: {
          ...params.data.metadata,
          lastModifiedAt: nowIso,
        },
      };

      if (needsBackup) {
        try {
          const backupFileName = `wine_db_backup_${formatBackupDateStamp(now)}.json`;
          autoBackupCreated = await adapter.createBackup(payloadToSave, backupFileName);
          payloadToSave = {
            ...payloadToSave,
            metadata: {
              ...payloadToSave.metadata,
              lastBackupAt: nowIso,
            },
          };
        } catch (err) {
          // 백업 생성 실패가 메인 저장을 막지 않도록 경고만 남기고 다음 저장에서 재시도
          console.warn('[SyncEngine] 주 1회 자동 백업 실패(다음 저장 시 재시도):', err);
        }
      }

      const saved = await adapter.saveDb(params.fileId, payloadToSave, expected);
      return {
        fileId: saved.fileId,
        modifiedTime: saved.modifiedTime,
        savedData: payloadToSave,
        autoBackupCreated,
        conflictBackupCreated,
      };
    });
  }

  /**
   * M3 보강: 과거 백업 스냅샷 복원 직전에 복원본 검증 + 원격 최신본(또는 현재 로컬본)을 pre_restore 백업으로 대피 저장
   */
  restoreBackupSafely(
    adapter: StorageAdapter,
    params: {
      currentData: WineDatabase | null;
      backupFileId: string;
      fileId: string | null;
      expectedModifiedTime?: string | null;
      now?: Date;
    },
  ): Promise<SyncSaveResult> {
    return this.enqueue(async () => {
      const now = params.now ?? new Date();
      // 1) 먼저 복원할 스냅샷을 로드·검증(유효하지 않은 백업이면 불필요한 pre_restore 백업을 만들지 않음)
      const restoredRaw = await adapter.loadBackup(params.backupFileId);

      // 2) 원격에 더 최신 변경이 있다면 원격본을 우선 대피 백업하고, 실패/미존재 시 로컬 currentData 대피
      let snapshotToBackup: WineDatabase | null = params.currentData;
      if (params.fileId) {
        try {
          const remoteMod = await adapter.getFileModifiedTime(params.fileId);
          if (remoteMod && (!params.expectedModifiedTime || remoteMod !== params.expectedModifiedTime)) {
            const remote = await adapter.loadDb(params.fileId);
            snapshotToBackup = remote.data;
          }
        } catch {
          // 원격 조회 실패 시 로컬 currentData 대피로 폴백
        }
      }
      if (snapshotToBackup) {
        const preRestoreName = `wine_db_pre_restore_${formatBackupDateTimeStamp(now)}.json`;
        await adapter.createBackup(snapshotToBackup, preRestoreName);
      }

      const restored: WineDatabase = {
        ...restoredRaw,
        metadata: {
          ...restoredRaw.metadata,
          lastModifiedAt: now.toISOString(),
        },
      };

      const saved = await adapter.saveDb(params.fileId, restored, null);
      return {
        fileId: saved.fileId,
        modifiedTime: saved.modifiedTime,
        savedData: restored,
        autoBackupCreated: null,
      };
    });
  }
}

export const syncEngine = new SyncEngine();
