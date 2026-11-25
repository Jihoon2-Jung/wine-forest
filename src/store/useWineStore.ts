import { Capacitor } from '@capacitor/core';
import { create } from 'zustand';
import type {
  BottleInstance,
  CellarLocation,
  TastingRecord,
  WineColor,
  WineDatabase,
  WineMaster,
} from '@/types/schema';
import { parseApprovedLabelsBundle, parseWineDatabase } from '@/types/validation';
import {
  clearAccessToken,
  ensureAccessToken,
  getAuthUserEmail,
  isGoogleAuthConfigured,
  isNativeAuth,
  isTokenValid,
  requestAccessToken,
  restoreAuthSession,
} from '@/services/auth/googleAuth';
import { exportJsonWithNativeShare, syncStatusBar } from '@/services/native/nativeBridge';
import {
  buildWineLabelGroupKey,
  findMatchingWineMaster,
  formatBackupDateTimeStamp,
  generateId,
  getTodayIsoDate,
  shouldIncludeInTrackingSince,
} from '@/services/domain/wineHelpers';
import { estimateDrinkingWindow } from '@/services/domain/drinkingWindowEstimator';
import { createDemoDatabase, createEmptyDatabase } from '@/services/storage/defaultTemplates';
import { GoogleDriveAdapter } from '@/services/storage/googleDriveAdapter';
import {
  clearAllLocalBackups,
  clearCachedState,
  getCachedPhoto,
  loadCachedState,
  saveCachedState,
} from '@/services/storage/localCache';
import { LocalOnlyAdapter } from '@/services/storage/localOnlyAdapter';
import { syncEngine } from '@/services/storage/syncEngine';
import { compressImageFile, dataUrlToBlob } from '@/services/media/imageProcessor';
import {
  clearAllPhotoCaches,
  evictPhotoFromCache,
  registerUploadedPhotoBlob,
} from '@/services/media/photoLoader';
import {
  AuthRequiredError,
  ConflictError,
  FileNotFoundError,
  type BackupSnapshot,
  type StorageAdapter,
  type StorageMode,
} from '@/services/storage/types';

export type CommitResult = 'synced' | 'queued_local' | 'conflict' | 'error' | 'invalid';

export type ThemeMode = 'light' | 'dark';
export type SyncStatus = 'synced' | 'offline_cache' | 'syncing' | 'auth_required' | 'conflict' | 'error';

export type InventorySortKey =
  | 'recent_purchase'
  | 'vintage_asc'
  | 'vintage_desc'
  | 'price_desc'
  | 'price_asc'
  | 'quantity_desc'
  | 'name_asc';

export type DrinkingWindowFilter = '' | 'ready_now' | 'closing_soon' | 'past_peak' | 'too_young';

export interface InventoryFilters {
  query: string;
  colors: WineColor[];
  country: string; // '' = 전체
  region: string; // '' = 전체
  subRegion: string; // '' = 전체
  zone: string; // '' = 전체, '__UNASSIGNED__' = 미지정
  drinkingWindow: DrinkingWindowFilter;
  sortBy: InventorySortKey;
  includeOutOfStock: boolean;
}

export interface ConflictState {
  fileId: string;
  expectedModifiedTime: string | null;
  remoteModifiedTime: string;
}

export interface ModeSwitchConflictState {
  remoteFileId: string;
  remoteModifiedTime: string;
}

export interface AddBottlesInput {
  name: string;
  producer?: string;
  country: string;
  region: string;
  subRegion?: string;
  color: WineColor;
  vintage: string;
  bottleSizeMl: number;
  quantity: number;
  purchasePrice: number;
  locationId: string | null;
  purchaseDate: string | null;
  purchaseDateUncertain?: boolean;
  purchaseSource: string;
  fxNote?: string;
  memo?: string;
  includeInTrackingSince?: boolean;
  drinkingWindowStart?: number | null;
  drinkingWindowEnd?: number | null;
}

export interface ConsumeBottleInput {
  bottleId: string;
  type: 'CONSUMED' | 'GIFTED';
  eventDate: string | null;
  occasion?: string;
  memo?: string;
  companions?: string;
  rating?: number | null;
  tastingNote?: string;
  photoFileIds?: string[];
}

export interface ToastMessage {
  id: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

const PRIVACY_KEY = 'jh-wine-forest-privacy';
const THEME_KEY = 'jh-wine-forest-theme';

function safeGetStorage(key: string): string | null {
  try {
    if (typeof window === 'undefined' || typeof window.localStorage?.getItem !== 'function') {
      return null;
    }
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorage(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage?.setItem === 'function') {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // ignore storage quota / private mode errors
  }
}

function loadInitialTheme(): ThemeMode {
  const stored = safeGetStorage(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function loadInitialPrivacy(): boolean {
  return safeGetStorage(PRIVACY_KEY) === 'true';
}

export function applyThemeToDom(theme: ThemeMode): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#0D1411' : '#1B4332');
    }
  }
  void syncStatusBar(theme);
}

function detectDeviceLabel(): string {
  if (Capacitor.isNativePlatform()) {
    const platform = Capacitor.getPlatform();
    if (platform === 'ios') return 'iOS App';
    return 'Mobile App';
  }
  if (typeof navigator === 'undefined') return 'Web';
  const ua = navigator.userAgent || '';
  const os = /iPhone/i.test(ua)
    ? 'iPhone'
    : /iPad/i.test(ua)
      ? 'iPad'
      : /Android/i.test(ua)
        ? 'Android'
        : /Mac/i.test(ua)
          ? 'Mac'
          : /Windows/i.test(ua)
            ? 'Windows'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'Web';
  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /CriOS|Chrome/i.test(ua)
      ? 'Chrome'
      : /FxiOS|Firefox/i.test(ua)
        ? 'Firefox'
        : /Safari/i.test(ua)
          ? 'Safari'
          : '';
  return browser ? `${os} ${browser}` : os;
}

const googleDriveAdapter = new GoogleDriveAdapter();
const localOnlyAdapter = new LocalOnlyAdapter();

function getAdapter(mode: StorageMode): StorageAdapter {
  return mode === 'local_test' ? localOnlyAdapter : googleDriveAdapter;
}

const DEFAULT_FILTERS: InventoryFilters = {
  query: '',
  colors: [],
  country: '',
  region: '',
  subRegion: '',
  zone: '',
  drinkingWindow: '',
  sortBy: 'recent_purchase',
  includeOutOfStock: false,
};

interface WineStoreState {
  // Core DB & Sync
  db: WineDatabase | null;
  isHydrated: boolean;
  storageMode: StorageMode;
  googleConnected: boolean;
  authUserEmail: string | null;
  authRevision: number;
  fileId: string | null;
  lastSyncedModifiedTime: string | null;
  hasUnsyncedChanges: boolean;
  syncStatus: SyncStatus;
  syncError: string | null;
  conflict: ConflictState | null;
  modeSwitchConflict: ModeSwitchConflictState | null;
  backups: BackupSnapshot[];
  isLoadingBackups: boolean;
  bulkLabelProgress: { current: number; total: number } | null;

  // Global UI
  isPrivacyMode: boolean;
  theme: ThemeMode;
  filters: InventoryFilters;
  toast: ToastMessage | null;

  // Modals (shared global triggers)
  quickAddPresetWineId: string | null;
  isQuickAddOpen: boolean;

  // Lifecycle & Auth
  hydrate: () => Promise<void>;
  connectGoogleAndLoad: () => Promise<'loaded' | 'needs_setup' | 'cancelled'>;
  startLocalTestMode: (withDemoData?: boolean) => Promise<void>;
  switchStorageMode: (mode: StorageMode) => Promise<void>;
  resolveModeSwitchConflict: (choice: 'use_remote' | 'overwrite_remote' | 'cancel') => Promise<void>;
  initEmptyCellar: () => Promise<void>;
  importJsonDatabase: (raw: unknown) => Promise<void>;
  disconnectAndResetLocal: () => Promise<void>;

  // Sync & Conflict & Backups
  reauthenticateAndSync: () => Promise<void>;
  syncNow: () => Promise<void>;
  resolveConflict: (strategy: 'pull_remote' | 'force_overwrite' | 'download_local') => Promise<void>;
  fetchBackups: () => Promise<void>;
  createManualBackup: () => Promise<void>;
  restoreFromBackup: (backupFileId: string) => Promise<void>;
  exportLocalJson: () => void;

  // Domain Mutations
  addBottles: (input: AddBottlesInput) => Promise<void>;
  updateWineMaster: (
    wineId: string,
    patch: Partial<Omit<WineMaster, 'id' | 'createdAt'>>,
    mergeTargetWineId?: string | null,
  ) => Promise<void>;
  updateBottle: (bottleId: string, patch: Partial<Omit<BottleInstance, 'id' | 'wineId' | 'createdAt'>>) => Promise<void>;
  deleteBottle: (bottleId: string) => Promise<void>;
  moveBottle: (bottleId: string, targetLocationId: string | null) => Promise<void>;
  consumeOrGiftBottle: (input: ConsumeBottleInput) => Promise<void>;
  restoreBottleToStock: (bottleId: string, targetLocationId: string | null) => Promise<void>;
  updateTastingRecord: (
    tastingId: string,
    patch: Partial<
      Pick<
        TastingRecord,
        'eventDate' | 'occasion' | 'memo' | 'type' | 'companions' | 'rating' | 'tastingNote' | 'photoFileIds'
      >
    >,
  ) => Promise<CommitResult>;
  addLocation: (loc: Omit<CellarLocation, 'id'>) => Promise<void>;
  updateLocation: (id: string, patch: Partial<Omit<CellarLocation, 'id'>>) => Promise<void>;
  reorderLocations: (orderedIds: string[]) => Promise<void>;
  deleteLocation: (id: string) => Promise<void>;
  updateTrackingSinceDate: (newDate: string, recalculateExisting: boolean) => Promise<void>;
  autoFillMissingDrinkingWindows: () => Promise<number>;

  // Phase 2-3A & 2-3B: Media (Label & Tasting Photos + Bulk Approved Label Bundle)
  uploadWineLabelPhoto: (wineId: string, file: Blob) => Promise<void>;
  removeWineLabelPhoto: (wineId: string) => Promise<void>;
  uploadTastingPhoto: (file: Blob) => Promise<string | null>;
  deleteTastingPhotoFile: (fileId: string) => Promise<void>;
  importApprovedLabelsBundle: (
    raw: unknown,
    options?: { overwriteExisting?: boolean },
  ) => Promise<{ applied: number; skipped: number; failed: number }>;

  // UI Actions
  togglePrivacyMode: () => void;
  toggleTheme: () => void;
  setFilters: (patch: Partial<InventoryFilters>) => void;
  resetFilters: () => void;
  openQuickAdd: (presetWineId?: string | null) => void;
  closeQuickAdd: () => void;
  showToast: (text: string, tone?: ToastMessage['tone']) => void;
  clearToast: () => void;
}

export const useWineStore = create<WineStoreState>((set, get) => {
  let mutationRevision = 0;

  const persistLocalCache = async (override?: Partial<{
    data: WineDatabase | null;
    fileId: string | null;
    lastSyncedModifiedTime: string | null;
    hasUnsyncedChanges: boolean;
    storageMode: StorageMode;
  }>): Promise<boolean> => {
    const state = get();
    try {
      await saveCachedState({
        data: override?.data !== undefined ? override.data : state.db,
        fileId: override?.fileId !== undefined ? override.fileId : state.fileId,
        lastSyncedModifiedTime:
          override?.lastSyncedModifiedTime !== undefined
            ? override.lastSyncedModifiedTime
            : state.lastSyncedModifiedTime,
        hasUnsyncedChanges:
          override?.hasUnsyncedChanges !== undefined
            ? override.hasUnsyncedChanges
            : state.hasUnsyncedChanges,
        storageMode: override?.storageMode !== undefined ? override.storageMode : state.storageMode,
      });
      return true;
    } catch (err) {
      console.warn('[JH Wine Forest] IndexedDB 로컬 캐시 저장 실패:', err);
      return false;
    }
  };

  const syncNativeAuthStateIfNeeded = () => {
    if (get().storageMode === 'google_drive' && isNativeAuth() && !get().googleConnected) {
      set({
        googleConnected: true,
        authUserEmail: getAuthUserEmail(),
        authRevision: get().authRevision + 1,
      });
    }
  };

  const migrateLocalPhotosToDrive = async (sourceDb: WineDatabase): Promise<WineDatabase> => {
    const localIds = new Set<string>();
    for (const w of sourceDb.wines) {
      if (w.labelImageFileId?.startsWith('local_photo_')) {
        localIds.add(w.labelImageFileId);
      }
    }
    for (const t of sourceDb.tastings) {
      for (const pid of t.photoFileIds ?? []) {
        if (pid.startsWith('local_photo_')) {
          localIds.add(pid);
        }
      }
    }
    if (localIds.size === 0) return sourceDb;

    const idMapping = new Map<string, string>();
    for (const oldId of localIds) {
      try {
        const blob = await getCachedPhoto(oldId);
        if (!blob) continue;
        const ext = blob.type.includes('webp') ? 'webp' : blob.type.includes('png') ? 'png' : 'jpg';
        const { fileId } = await googleDriveAdapter.uploadPhoto(blob, `migrated_${oldId}.${ext}`);
        await registerUploadedPhotoBlob(fileId, blob);
        idMapping.set(oldId, fileId);
      } catch (err) {
        if (err instanceof AuthRequiredError) throw err;
        // 개별 로컬 사진 이관 실패 시 나머지 이관 계속 진행
      }
    }
    if (idMapping.size === 0) return sourceDb;

    return {
      ...sourceDb,
      wines: sourceDb.wines.map((w) =>
        w.labelImageFileId && idMapping.has(w.labelImageFileId)
          ? { ...w, labelImageFileId: idMapping.get(w.labelImageFileId)! }
          : w,
      ),
      tastings: sourceDb.tastings.map((t) =>
        t.photoFileIds
          ? { ...t, photoFileIds: t.photoFileIds.map((pid) => idMapping.get(pid) ?? pid) }
          : t,
      ),
    };
  };

  const cleanupUnreferencedPhotoFiles = (
    candidateIds: Iterable<string>,
    nextDb: WineDatabase,
    allowRemoteDelete = true,
  ) => {
    const uniqueCandidates = new Set<string>();
    for (const id of candidateIds) {
      if (id) uniqueCandidates.add(id);
    }
    if (uniqueCandidates.size === 0) return;

    const referenced = new Set<string>();
    for (const w of nextDb.wines) {
      if (w.labelImageFileId) referenced.add(w.labelImageFileId);
    }
    for (const t of nextDb.tastings) {
      for (const pid of t.photoFileIds ?? []) {
        if (pid) referenced.add(pid);
      }
    }

    const mode = get().storageMode;
    const adapter = getAdapter(mode);
    for (const fileId of uniqueCandidates) {
      if (!referenced.has(fileId)) {
        if (
          allowRemoteDelete &&
          (mode === 'local_test' || isTokenValid() || (isNativeAuth() && get().googleConnected))
        ) {
          void adapter.deletePhoto(fileId).catch(() => undefined);
        }
        void evictPhotoFromCache(fileId);
      }
    }
  };

  const commitMutation = async (
    nextDb: WineDatabase,
    successToast?: string,
  ): Promise<CommitResult> => {
    const state = get();
    const nowIso = new Date().toISOString();
    const candidateDb: WineDatabase = {
      ...nextDb,
      metadata: {
        ...nextDb.metadata,
        lastModifiedAt: nowIso,
        deviceLabel: detectDeviceLabel(),
      },
    };

    // 0. Zustand·IndexedDB 반영 전 반드시 Zod 스키마 검증 (손상 캐시 영구 오염 방지)
    let updatedDb: WineDatabase;
    try {
      updatedDb = parseWineDatabase(candidateDb);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '입력값이 데이터 스키마 규칙에 맞지 않습니다.';
      get().showToast(`저장할 수 없습니다: ${msg}`, 'error');
      return 'invalid';
    }

    mutationRevision += 1;

    // 1. 낙관적 UI + IndexedDB 영속화 (hasUnsyncedChanges = true로 보호)
    set({
      db: updatedDb,
      hasUnsyncedChanges: true,
      syncError: null,
    });
    const localSavedBeforeSync = await persistLocalCache({
      data: updatedDb,
      hasUnsyncedChanges: true,
    });

    // 2. Google Drive 모드(웹 GIS)인데 토큰이 만료/없음 -> 비동기 팝업 호출 금지(R2 보강)!
    //    안전하게 로컬 보관 후 1클릭 재인증 배지/토스트로 유도 (네이티브 앱은 saveWithPolicy 내부에서 무음 갱신 시도)
    if (state.storageMode === 'google_drive' && !isNativeAuth() && !isTokenValid()) {
      set({ syncStatus: 'auth_required' });
      get().showToast(
        localSavedBeforeSync
          ? '변경사항이 기기에 안전 저장되었습니다. 상단 [재인증]을 눌러 Google Drive에 동기화하세요.'
          : '인증이 만료되었고 로컬 캐시 저장에도 실패했습니다. 상단 [재인증]으로 즉시 동기화해 주세요.',
        'warning',
      );
      return 'queued_local';
    }

    // 3. 저장소 동기화 실행 (SyncEngine Write Mutex 내부에서 최신 상태 스냅샷)
    set({ syncStatus: 'syncing' });
    const modeAtCall = state.storageMode;
    const adapter = getAdapter(modeAtCall);
    let flushRev = mutationRevision;

    const executeSave = async (forceRecreate = false) => {
      return syncEngine.saveWithPolicy(adapter, () => {
        const latest = get();
        if (!latest.db) return null;
        flushRev = mutationRevision;
        return {
          fileId: forceRecreate ? null : latest.fileId,
          data: latest.db,
          expectedModifiedTime: forceRecreate ? null : latest.lastSyncedModifiedTime,
        };
      });
    };

    try {
      let result;
      try {
        result = await executeSave(false);
      } catch (err) {
        if (err instanceof FileNotFoundError && modeAtCall === 'google_drive') {
          // 원격 wine_db.json이 휴지통 이동/영구 삭제된 경우 fileId 초기화 후 안전 재생성
          set({ fileId: null, lastSyncedModifiedTime: null });
          result = await executeSave(true);
        } else {
          throw err;
        }
      }

      if (get().storageMode !== modeAtCall) {
        return 'synced';
      }

      const hasNewerLocalMutation = mutationRevision !== flushRev;
      const currentDb = get().db;
      const mergedDb =
        hasNewerLocalMutation && currentDb
          ? {
              ...currentDb,
              metadata: {
                ...currentDb.metadata,
                lastBackupAt: result.savedData.metadata.lastBackupAt ?? currentDb.metadata.lastBackupAt,
              },
            }
          : result.savedData;

      set({
        db: mergedDb,
        fileId: result.fileId,
        lastSyncedModifiedTime: result.modifiedTime,
        hasUnsyncedChanges: hasNewerLocalMutation,
        syncStatus: hasNewerLocalMutation ? 'syncing' : 'synced',
        conflict: null,
        syncError: null,
      });
      syncNativeAuthStateIfNeeded();

      const localSavedAfterSync = await persistLocalCache({
        data: mergedDb,
        fileId: result.fileId,
        lastSyncedModifiedTime: result.modifiedTime,
        hasUnsyncedChanges: hasNewerLocalMutation,
      });

      if (!localSavedAfterSync) {
        get().showToast(
          'Google Drive 동기화는 완료했으나 브라우저 로컬 캐시 저장 공간이 부족합니다.',
          'warning',
        );
      } else if (result.autoBackupCreated) {
        get().showToast(
          `${successToast ? `${successToast} · ` : ''}주간 자동 백업 완료 (${result.autoBackupCreated.name})`,
          'success',
        );
      } else if (successToast) {
        get().showToast(successToast, 'success');
      }
      return 'synced';
    } catch (err) {
      if (err instanceof ConflictError) {
        set({
          syncStatus: 'conflict',
          conflict: {
            fileId: err.fileId,
            expectedModifiedTime: err.expectedModifiedTime,
            remoteModifiedTime: err.remoteModifiedTime,
          },
        });
        return 'conflict';
      }
      if (err instanceof AuthRequiredError) {
        set({ syncStatus: 'auth_required', syncError: err.message });
        get().showToast('인증이 만료되었습니다. 상단 배지를 눌러 1클릭 재인증 후 동기화하세요.', 'warning');
        return 'queued_local';
      }
      const msg = err instanceof Error ? err.message : '동기화 중 오류가 발생했습니다.';
      set({ syncStatus: 'error', syncError: msg });
      get().showToast(
        localSavedBeforeSync
          ? `로컬에 저장되었으나 동기화 실패: ${msg}`
          : `로컬 캐시 및 동기화 모두 실패했습니다: ${msg}`,
        'error',
      );
      return 'error';
    }
  };

  return {
    db: null,
    isHydrated: false,
    storageMode: isGoogleAuthConfigured() ? 'google_drive' : 'local_test',
    googleConnected: false,
    authUserEmail: null,
    authRevision: 0,
    fileId: null,
    lastSyncedModifiedTime: null,
    hasUnsyncedChanges: false,
    syncStatus: 'offline_cache',
    syncError: null,
    conflict: null,
    modeSwitchConflict: null,
    backups: [],
    isLoadingBackups: false,
    bulkLabelProgress: null,

    isPrivacyMode: loadInitialPrivacy(),
    theme: loadInitialTheme(),
    filters: { ...DEFAULT_FILTERS },
    toast: null,
    quickAddPresetWineId: null,
    isQuickAddOpen: false,

    hydrate: async () => {
      const theme = get().theme;
      applyThemeToDom(theme);

      const cached = await loadCachedState();
      if (!cached || !cached.data) {
        set({
          isHydrated: true,
          storageMode:
            cached?.storageMode ?? (isGoogleAuthConfigured() ? 'google_drive' : 'local_test'),
        });
        return;
      }

      let validDb: WineDatabase | null = null;
      try {
        validDb = parseWineDatabase(cached.data);
      } catch {
        validDb = null;
      }

      const mode = cached.storageMode;
      const nativeMode = mode === 'google_drive' && isNativeAuth();
      const initialSyncStatus: SyncStatus =
        mode === 'local_test'
          ? 'synced'
          : nativeMode
            ? cached.hasUnsyncedChanges
              ? 'syncing'
              : 'offline_cache'
            : cached.hasUnsyncedChanges
              ? 'auth_required'
              : isTokenValid()
                ? 'synced'
                : 'offline_cache';

      set({
        db: validDb,
        fileId: validDb ? cached.fileId : null,
        lastSyncedModifiedTime: validDb ? cached.lastSyncedModifiedTime : null,
        hasUnsyncedChanges: validDb ? cached.hasUnsyncedChanges : false,
        storageMode: mode,
        syncStatus: validDb ? initialSyncStatus : 'offline_cache',
        isHydrated: true,
      });

      if (nativeMode && validDb) {
        void (async () => {
          const session = await restoreAuthSession();
          // 비동기 세션 복원 중 사용자가 연결 해제하거나 로컬 테스트 모드로 전환한 경우 중단
          if (get().storageMode !== 'google_drive' || !get().db) return;
          if (session) {
            set({
              googleConnected: true,
              authUserEmail: session.email ?? getAuthUserEmail(),
              authRevision: get().authRevision + 1,
              syncError: null,
            });
            const latest = get();
            if (latest.hasUnsyncedChanges && latest.db) {
              await commitMutation(latest.db, '대기 중이던 변경사항을 Google Drive에 동기화했습니다.');
            } else if (latest.db) {
              await get().syncNow();
            }
          } else if (get().hasUnsyncedChanges) {
            set({ syncStatus: 'auth_required' });
          }
        })();
        return;
      }

      // R3 보강: 미동기화 변경사항(hasUnsyncedChanges)이 있으면 절대 자동 Pull 덮어쓰기 금지!
      if (mode === 'google_drive' && validDb && isTokenValid() && !cached.hasUnsyncedChanges) {
        void get().syncNow();
      }
    },

    connectGoogleAndLoad: async () => {
      // 반드시 사용자 버튼 클릭 핸들러에서 직접 호출됨 (팝업 차단 방지)
      try {
        await requestAccessToken();
      } catch (err) {
        const msg = err instanceof Error ? err.message : '구글 로그인에 실패했습니다.';
        get().showToast(msg, 'error');
        return 'cancelled';
      }

      set({
        storageMode: 'google_drive',
        authUserEmail: getAuthUserEmail(),
        authRevision: get().authRevision + 1,
        syncStatus: 'syncing',
        syncError: null,
      });

      try {
        googleDriveAdapter.resetWorkspaceCache();
        await googleDriveAdapter.ensureWorkspace();
        const found = await googleDriveAdapter.findDbFile();
        if (found) {
          const loaded = await googleDriveAdapter.loadDb(found.fileId);
          set({
            db: loaded.data,
            googleConnected: true,
            fileId: found.fileId,
            lastSyncedModifiedTime: loaded.modifiedTime,
            hasUnsyncedChanges: false,
            syncStatus: 'synced',
          });
          await persistLocalCache({
            data: loaded.data,
            fileId: found.fileId,
            lastSyncedModifiedTime: loaded.modifiedTime,
            hasUnsyncedChanges: false,
            storageMode: 'google_drive',
          });
          get().showToast('Google Drive에서 와인 셀러를 불러왔습니다.', 'success');
          return 'loaded';
        }
        set({ googleConnected: true, syncStatus: 'synced' });
        return 'needs_setup';
      } catch (err) {
        const msg = err instanceof Error ? err.message : '드라이브 연결 중 오류가 발생했습니다.';
        // Drive 조회 실패 시 googleConnected: false 유지(기존 사용자에게 빈 셀러 생성 유도 방지)
        set({ googleConnected: false, syncStatus: 'error', syncError: msg });
        get().showToast(msg, 'error');
        return 'cancelled';
      }
    },

    startLocalTestMode: async (withDemoData = false) => {
      const db = withDemoData ? createDemoDatabase() : createEmptyDatabase();
      const saved = await syncEngine.saveWithPolicy(localOnlyAdapter, {
        fileId: null,
        data: db,
        expectedModifiedTime: null,
      });
      set({
        db: saved.savedData,
        storageMode: 'local_test',
        googleConnected: false,
        fileId: saved.fileId,
        lastSyncedModifiedTime: saved.modifiedTime,
        hasUnsyncedChanges: false,
        syncStatus: 'synced',
        conflict: null,
      });
      await persistLocalCache({
        data: saved.savedData,
        fileId: saved.fileId,
        lastSyncedModifiedTime: saved.modifiedTime,
        hasUnsyncedChanges: false,
        storageMode: 'local_test',
      });
      get().showToast(
        withDemoData
          ? '로컬 테스트 모드(데모 와인 6종)로 시작했습니다.'
          : '로컬 테스트 모드(빈 셀러)로 시작했습니다.',
        'success',
      );
    },

    switchStorageMode: async (mode) => {
      if (mode === 'local_test') {
        localOnlyAdapter.reset();
        set({
          storageMode: 'local_test',
          fileId: null,
          lastSyncedModifiedTime: null,
          hasUnsyncedChanges: false,
          conflict: null,
          modeSwitchConflict: null,
          syncStatus: 'synced',
          syncError: null,
        });
        await persistLocalCache({
          storageMode: 'local_test',
          fileId: null,
          lastSyncedModifiedTime: null,
          hasUnsyncedChanges: false,
        });
        get().showToast('로컬 테스트 모드로 전환했습니다. 변경사항은 이 브라우저에 저장됩니다.', 'info');
        return;
      }

      if (!isGoogleAuthConfigured()) {
        get().showToast('VITE_GOOGLE_CLIENT_ID가 설정되어 있지 않아 Google Drive 모드로 전환할 수 없습니다.', 'error');
        return;
      }

      try {
        await requestAccessToken();
        set({
          authRevision: get().authRevision + 1,
          authUserEmail: getAuthUserEmail(),
        });
        googleDriveAdapter.resetWorkspaceCache();
        const currentDb = get().db;
        const found = await googleDriveAdapter.findDbFile();
        if (found) {
          // T5 보강: 로컬에 와인/병 데이터가 있고 Drive에도 기존 파일이 있으면 사용자 확인 모달 표시
          if (currentDb && (currentDb.bottles.length > 0 || currentDb.wines.length > 0)) {
            set({
              googleConnected: true,
              modeSwitchConflict: {
                remoteFileId: found.fileId,
                remoteModifiedTime: found.modifiedTime,
              },
            });
            return;
          }

          const loaded = await googleDriveAdapter.loadDb(found.fileId);
          set({
            db: loaded.data,
            storageMode: 'google_drive',
            googleConnected: true,
            fileId: found.fileId,
            lastSyncedModifiedTime: loaded.modifiedTime,
            hasUnsyncedChanges: false,
            syncStatus: 'synced',
          });
          await persistLocalCache({
            data: loaded.data,
            fileId: found.fileId,
            lastSyncedModifiedTime: loaded.modifiedTime,
            hasUnsyncedChanges: false,
            storageMode: 'google_drive',
          });
          get().showToast('Google Drive 모드로 전환하고 원격 DB를 불러왔습니다.', 'success');
        } else if (currentDb) {
          const migratedDb = await migrateLocalPhotosToDrive(currentDb);
          set({
            storageMode: 'google_drive',
            googleConnected: true,
            fileId: null,
            lastSyncedModifiedTime: null,
          });
          await commitMutation(migratedDb, '현재 데이터를 Google Drive에 최초 업로드했습니다.');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Google Drive 전환에 실패했습니다.';
        get().showToast(msg, 'error');
      }
    },

    resolveModeSwitchConflict: async (choice) => {
      const state = get();
      const pending = state.modeSwitchConflict;
      if (!pending) return;

      if (choice === 'cancel') {
        set({ modeSwitchConflict: null, googleConnected: false });
        get().showToast('전환을 취소하고 로컬 테스트 모드를 유지합니다.', 'info');
        return;
      }

      if (choice === 'use_remote') {
        set({ modeSwitchConflict: null, syncStatus: 'syncing' });
        try {
          const loaded = await googleDriveAdapter.loadDb(pending.remoteFileId);
          set({
            db: loaded.data,
            storageMode: 'google_drive',
            googleConnected: true,
            fileId: pending.remoteFileId,
            lastSyncedModifiedTime: loaded.modifiedTime,
            hasUnsyncedChanges: false,
            syncStatus: 'synced',
          });
          await persistLocalCache({
            data: loaded.data,
            fileId: pending.remoteFileId,
            lastSyncedModifiedTime: loaded.modifiedTime,
            hasUnsyncedChanges: false,
            storageMode: 'google_drive',
          });
          get().showToast('Google Drive 원격 데이터로 전환했습니다.', 'success');
        } catch (err) {
          if (err instanceof AuthRequiredError) {
            set({ syncStatus: 'auth_required', syncError: err.message });
            get().showToast('구글 재인증 후 다시 시도해 주세요.', 'warning');
          } else {
            const msg = err instanceof Error ? err.message : '원격 데이터 로드 실패';
            set({ syncStatus: 'error', syncError: msg });
            get().showToast(msg, 'error');
          }
        }
        return;
      }

      // overwrite_remote: 로컬 사진 이관 + 원격 파일 conflict 대피 백업 후 로컬 데이터 업로드
      if (choice === 'overwrite_remote' && state.db) {
        set({ modeSwitchConflict: null, storageMode: 'google_drive', syncStatus: 'syncing' });
        try {
          const migratedDb = await migrateLocalPhotosToDrive(state.db);
          const result = await syncEngine.saveWithPolicy(googleDriveAdapter, {
            fileId: pending.remoteFileId,
            data: migratedDb,
            expectedModifiedTime: null,
            forceOverwrite: true,
          });
          set({
            db: result.savedData,
            storageMode: 'google_drive',
            googleConnected: true,
            fileId: result.fileId,
            lastSyncedModifiedTime: result.modifiedTime,
            hasUnsyncedChanges: false,
            syncStatus: 'synced',
          });
          await persistLocalCache({
            data: result.savedData,
            fileId: result.fileId,
            lastSyncedModifiedTime: result.modifiedTime,
            hasUnsyncedChanges: false,
            storageMode: 'google_drive',
          });
          get().showToast(
            result.conflictBackupCreated === false
              ? '현재 로컬 데이터로 덮어썼습니다. (주의: 기존 Drive 원격 대피 백업 생성은 실패했습니다)'
              : '기존 Drive 파일을 대피 백업한 뒤 현재 로컬 데이터로 덮어썼습니다.',
            result.conflictBackupCreated === false ? 'warning' : 'success',
          );
        } catch (err) {
          if (err instanceof AuthRequiredError) {
            set({ storageMode: 'local_test', syncStatus: 'auth_required', syncError: err.message });
            get().showToast('구글 재인증 후 다시 시도해 주세요.', 'warning');
          } else {
            const msg = err instanceof Error ? err.message : 'Drive 덮어쓰기 실패';
            set({ storageMode: 'local_test', syncStatus: 'error', syncError: msg });
            get().showToast(msg, 'error');
          }
        }
      }
    },

    initEmptyCellar: async () => {
      const db = createEmptyDatabase();
      await commitMutation(db, '새 빈 셀러가 생성되었습니다.');
    },

    importJsonDatabase: async (raw) => {
      const validated = parseWineDatabase(raw);
      const state = get();
      if (state.storageMode === 'google_drive' && !isNativeAuth() && !isTokenValid()) {
        // 드라이브 연결 안 된 상태면 로컬 캐시에만 먼저 반영 후 동기화 안내
        set({
          db: validated,
          hasUnsyncedChanges: true,
          syncStatus: 'auth_required',
        });
        await persistLocalCache({ data: validated, hasUnsyncedChanges: true });
        get().showToast('JSON을 불러왔습니다. 상단 [재인증]을 눌러 Google Drive에 업로드하세요.', 'warning');
        return;
      }
      await commitMutation(validated, `와인 ${validated.wines.length}종 · ${validated.bottles.length}병 데이터를 가져왔습니다.`);
    },

    disconnectAndResetLocal: async () => {
      mutationRevision += 1;
      await clearAccessToken();
      googleDriveAdapter.resetWorkspaceCache();
      localOnlyAdapter.reset();
      await clearCachedState();
      await clearAllLocalBackups();
      await clearAllPhotoCaches();
      set({
        db: null,
        fileId: null,
        lastSyncedModifiedTime: null,
        hasUnsyncedChanges: false,
        googleConnected: false,
        authUserEmail: null,
        syncStatus: 'offline_cache',
        syncError: null,
        conflict: null,
        modeSwitchConflict: null,
        backups: [],
      });
      get().showToast('로컬 캐시와 연결을 초기화했습니다.', 'info');
    },

    reauthenticateAndSync: async () => {
      const state = get();
      if (state.storageMode === 'local_test') {
        set({ syncStatus: 'synced' });
        get().showToast('현재 로컬 테스트 모드입니다.', 'info');
        return;
      }

      const prevEmail = state.authUserEmail;

      // 반드시 클릭 핸들러 동기 컨텍스트에서 requestAccessToken() 호출
      try {
        await requestAccessToken();
        googleDriveAdapter.resetWorkspaceCache();
        const nextEmail = getAuthUserEmail();
        const accountSwitched = Boolean(prevEmail && nextEmail && prevEmail !== nextEmail);

        set({
          googleConnected: true,
          authUserEmail: nextEmail,
          authRevision: get().authRevision + 1,
          syncError: null,
          ...(accountSwitched
            ? { fileId: null, lastSyncedModifiedTime: null, hasUnsyncedChanges: false, conflict: null }
            : {}),
        });

        if (accountSwitched) {
          get().showToast(
            `Google 계정이 변경되어(${nextEmail}) 해당 계정의 Drive 데이터를 다시 불러옵니다.`,
            'info',
          );
          await get().syncNow();
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '구글 재인증에 실패했습니다.';
        get().showToast(msg, 'error');
        return;
      }

      const afterAuth = get();
      if (afterAuth.conflict) {
        set({ syncStatus: 'conflict' });
        get().showToast('구글 재인증 완료. 충돌 해결 방식을 다시 선택해 주세요.', 'info');
        return;
      }
      if (afterAuth.hasUnsyncedChanges && afterAuth.db) {
        await commitMutation(afterAuth.db, '대기 중이던 변경사항을 Google Drive에 동기화했습니다.');
      } else {
        await get().syncNow();
      }
    },

    syncNow: async () => {
      const state = get();
      if (state.storageMode === 'local_test') {
        set({ syncStatus: 'synced' });
        get().showToast('로컬 테스트 모드는 모든 변경이 즉시 저장됩니다.', 'info');
        return;
      }
      if (!isNativeAuth() && !isTokenValid()) {
        set({ syncStatus: 'auth_required' });
        get().showToast('토큰이 만료되었습니다. [구글 재인증]을 눌러 주세요.', 'warning');
        return;
      }

      if (state.hasUnsyncedChanges && state.db) {
        await commitMutation(state.db, 'Google Drive 동기화를 완료했습니다.');
        return;
      }

      const startRev = mutationRevision;
      set({ syncStatus: 'syncing', syncError: null });
      try {
        const found = await googleDriveAdapter.findDbFile();
        if (get().storageMode !== 'google_drive') return;

        if (!found) {
          const latest = get();
          if (latest.db) {
            // 원격 파일이 사라진 상태이므로 죽은 fileId를 초기화하고 새로 생성
            set({ fileId: null, lastSyncedModifiedTime: null });
            await commitMutation(latest.db, 'Google Drive에 새 DB 파일을 생성했습니다.');
          } else {
            set({ syncStatus: 'synced' });
            syncNativeAuthStateIfNeeded();
          }
          return;
        }

        if (found.modifiedTime !== get().lastSyncedModifiedTime || !get().db) {
          const loaded = await googleDriveAdapter.loadDb(found.fileId);
          // Pull 도중 로컬 편집·모드 전환·로그아웃이 발생했다면 원격 데이터로 덮어쓰지 않음(R3 보호)
          const latest = get();
          if (
            latest.storageMode !== 'google_drive' ||
            latest.hasUnsyncedChanges ||
            mutationRevision !== startRev
          ) {
            return;
          }
          set({
            db: loaded.data,
            fileId: found.fileId,
            lastSyncedModifiedTime: loaded.modifiedTime,
            hasUnsyncedChanges: false,
            syncStatus: 'synced',
          });
          syncNativeAuthStateIfNeeded();
          await persistLocalCache({
            data: loaded.data,
            fileId: found.fileId,
            lastSyncedModifiedTime: loaded.modifiedTime,
            hasUnsyncedChanges: false,
          });
          get().showToast('Google Drive 최신 데이터를 반영했습니다.', 'success');
        } else {
          if (mutationRevision === startRev && !get().hasUnsyncedChanges) {
            set({ syncStatus: 'synced' });
          }
          syncNativeAuthStateIfNeeded();
          get().showToast('이미 최신 상태입니다.', 'info');
        }
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          set({ syncStatus: 'auth_required', syncError: err.message });
        } else {
          const msg = err instanceof Error ? err.message : '동기화 실패';
          set({ syncStatus: 'error', syncError: msg });
          get().showToast(msg, 'error');
        }
      }
    },

    resolveConflict: async (strategy) => {
      const state = get();
      if (strategy === 'download_local') {
        get().exportLocalJson();
        return;
      }
      if (!state.conflict) return;
      const adapter = getAdapter(state.storageMode);

      if (strategy === 'pull_remote') {
        set({ syncStatus: 'syncing' });
        try {
          const loaded = await adapter.loadDb(state.conflict.fileId);
          mutationRevision += 1;
          set({
            db: loaded.data,
            fileId: state.conflict.fileId,
            lastSyncedModifiedTime: loaded.modifiedTime,
            hasUnsyncedChanges: false,
            syncStatus: 'synced',
            conflict: null,
          });
          await persistLocalCache({
            data: loaded.data,
            fileId: state.conflict.fileId,
            lastSyncedModifiedTime: loaded.modifiedTime,
            hasUnsyncedChanges: false,
          });
          get().showToast('원격 최신본을 불러와 충돌을 해결했습니다.', 'success');
        } catch (err) {
          if (err instanceof AuthRequiredError) {
            set({ syncStatus: 'auth_required', syncError: err.message });
            get().showToast('인증이 만료되었습니다. [구글 재인증]을 먼저 진행해 주세요.', 'warning');
          } else {
            const msg = err instanceof Error ? err.message : '원격 불러오기 실패';
            set({ syncStatus: 'error', syncError: msg });
            get().showToast(msg, 'error');
          }
        }
        return;
      }

      if (strategy === 'force_overwrite' && state.db) {
        set({ syncStatus: 'syncing' });
        try {
          const result = await syncEngine.saveWithPolicy(adapter, {
            fileId: state.conflict.fileId,
            data: state.db,
            expectedModifiedTime: state.lastSyncedModifiedTime,
            forceOverwrite: true,
          });
          set({
            db: result.savedData,
            fileId: result.fileId,
            lastSyncedModifiedTime: result.modifiedTime,
            hasUnsyncedChanges: false,
            syncStatus: 'synced',
            conflict: null,
          });
          await persistLocalCache({
            data: result.savedData,
            fileId: result.fileId,
            lastSyncedModifiedTime: result.modifiedTime,
            hasUnsyncedChanges: false,
          });
          get().showToast(
            result.conflictBackupCreated === false
              ? '내 데이터로 덮어썼습니다. (주의: 원격 충돌 대피 백업은 실패했습니다)'
              : '원격 파일을 충돌 백업으로 대피시킨 뒤 내 데이터로 덮어썼습니다.',
            result.conflictBackupCreated === false ? 'warning' : 'success',
          );
        } catch (err) {
          if (err instanceof AuthRequiredError) {
            set({ syncStatus: 'auth_required', syncError: err.message });
            get().showToast('인증이 만료되었습니다. [구글 재인증]을 먼저 진행해 주세요.', 'warning');
          } else {
            const msg = err instanceof Error ? err.message : '덮어쓰기 실패';
            set({ syncStatus: 'error', syncError: msg });
            get().showToast(msg, 'error');
          }
        }
      }
    },

    fetchBackups: async () => {
      const state = get();
      if (state.storageMode === 'google_drive' && !isNativeAuth() && !isTokenValid()) {
        return;
      }
      set({ isLoadingBackups: true });
      try {
        const list = await getAdapter(state.storageMode).listBackups();
        set({ backups: list, isLoadingBackups: false });
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          set({ isLoadingBackups: false, syncStatus: 'auth_required', syncError: err.message });
          get().showToast('백업 조회를 위해 [구글 재인증]을 진행해 주세요.', 'warning');
        } else {
          set({ isLoadingBackups: false });
          const msg = err instanceof Error ? err.message : '백업 목록 조회 실패';
          get().showToast(msg, 'error');
        }
      }
    },

    createManualBackup: async () => {
      const state = get();
      if (!state.db) return;
      if (state.storageMode === 'google_drive' && !isNativeAuth() && !isTokenValid()) {
        get().showToast('수동 백업을 위해 먼저 구글 재인증을 진행해 주세요.', 'warning');
        return;
      }
      try {
        const fileName = `wine_db_manual_${formatBackupDateTimeStamp()}.json`;
        const snapshot = await getAdapter(state.storageMode).createBackup(state.db, fileName);
        const latestDb = get().db;
        if (!latestDb || get().storageMode !== state.storageMode) return;
        const updatedDb: WineDatabase = {
          ...latestDb,
          metadata: {
            ...latestDb.metadata,
            lastBackupAt: snapshot.createdTime,
          },
        };
        await commitMutation(updatedDb, `수동 백업 생성 완료 (${snapshot.name})`);
        await get().fetchBackups();
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          set({ syncStatus: 'auth_required', syncError: err.message });
          get().showToast('수동 백업을 위해 먼저 구글 재인증을 진행해 주세요.', 'warning');
        } else {
          const msg = err instanceof Error ? err.message : '수동 백업 실패';
          get().showToast(msg, 'error');
        }
      }
    },

    restoreFromBackup: async (backupFileId) => {
      const state = get();
      if (state.storageMode === 'google_drive' && !isNativeAuth() && !isTokenValid()) {
        get().showToast('복원을 위해 먼저 구글 재인증을 진행해 주세요.', 'warning');
        return;
      }
      set({ syncStatus: 'syncing' });
      try {
        const result = await syncEngine.restoreBackupSafely(getAdapter(state.storageMode), {
          currentData: state.db,
          backupFileId,
          fileId: state.fileId,
          expectedModifiedTime: state.lastSyncedModifiedTime,
        });
        mutationRevision += 1;
        set({
          db: result.savedData,
          fileId: result.fileId,
          lastSyncedModifiedTime: result.modifiedTime,
          hasUnsyncedChanges: false,
          syncStatus: 'synced',
          conflict: null,
        });
        await persistLocalCache({
          data: result.savedData,
          fileId: result.fileId,
          lastSyncedModifiedTime: result.modifiedTime,
          hasUnsyncedChanges: false,
        });
        await get().fetchBackups();
        get().showToast('현재 DB를 대피 백업한 뒤 선택한 스냅샷으로 복원했습니다.', 'success');
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          set({ syncStatus: 'auth_required', syncError: err.message });
          get().showToast('복원을 위해 먼저 구글 재인증을 진행해 주세요.', 'warning');
        } else {
          const msg = err instanceof Error ? err.message : '백업 복원 실패';
          set({ syncStatus: 'error', syncError: msg });
          get().showToast(msg, 'error');
        }
      }
    },

    exportLocalJson: () => {
      const db = get().db;
      if (!db) return;
      const fileName = `wine_db_export_${formatBackupDateTimeStamp()}.json`;
      const jsonText = JSON.stringify(db, null, 2);
      void exportJsonWithNativeShare(fileName, jsonText)
        .then((res) => {
          if (res === 'downloaded') {
            get().showToast('JSON 백업 파일을 다운로드했습니다.', 'success');
          } else if (res === 'shared') {
            get().showToast('JSON 백업 공유 시트를 열었습니다.', 'success');
          }
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : 'JSON 내보내기에 실패했습니다.';
          get().showToast(msg, 'error');
        });
    },

    // --- Domain Mutations ---

    addBottles: async (input) => {
      const db = get().db;
      if (!db) return;
      const now = new Date().toISOString();
      const trimmedName = input.name.trim();
      const trimmedCountry = input.country.trim() || '미분류';
      const trimmedRegion = input.region.trim() || trimmedCountry;
      const trimmedSubRegion = input.subRegion?.trim() || undefined;
      const vintage = input.vintage.trim().toUpperCase() || 'NV';
      const sizeMl = input.bottleSizeMl || 750;
      const qty = Math.max(1, Math.floor(input.quantity));

      const existingMaster = findMatchingWineMaster(db.wines, {
        name: trimmedName,
        vintage,
        bottleSizeMl: sizeMl,
        color: input.color,
      });

      let wineId: string;
      let nextWines = db.wines;

      if (existingMaster) {
        wineId = existingMaster.id;
        // 기존 마스터에 음용 적기가 비어 있고 새로 입력되었으면 함께 업데이트
        if (
          (input.drinkingWindowStart != null || input.drinkingWindowEnd != null) &&
          existingMaster.drinkingWindowStart == null &&
          existingMaster.drinkingWindowEnd == null
        ) {
          nextWines = db.wines.map((w) =>
            w.id === existingMaster.id
              ? {
                  ...w,
                  drinkingWindowStart: input.drinkingWindowStart ?? null,
                  drinkingWindowEnd: input.drinkingWindowEnd ?? null,
                  updatedAt: now,
                }
              : w,
          );
        }
      } else {
        wineId = generateId();
        // 빈티지 무관 라벨 공유: 같은 (와인명, 색상)의 기존 라벨이 있으면 새 빈티지에도 자동 상속
        const labelGroupKey = buildWineLabelGroupKey({ name: trimmedName, color: input.color });
        const inheritedLabelId =
          db.wines.find(
            (w) => w.labelImageFileId && buildWineLabelGroupKey(w) === labelGroupKey,
          )?.labelImageFileId ?? null;
        const newMaster: WineMaster = {
          id: wineId,
          name: trimmedName,
          producer: input.producer?.trim() || undefined,
          country: trimmedCountry,
          region: trimmedRegion,
          subRegion: trimmedSubRegion,
          color: input.color,
          vintage,
          bottleSizeMl: sizeMl,
          labelImageFileId: inheritedLabelId,
          drinkingWindowStart: input.drinkingWindowStart ?? null,
          drinkingWindowEnd: input.drinkingWindowEnd ?? null,
          createdAt: now,
          updatedAt: now,
        };
        nextWines = [...db.wines, newMaster];
      }

      const includeTracking =
        input.includeInTrackingSince !== undefined
          ? input.includeInTrackingSince
          : shouldIncludeInTrackingSince(input.purchaseDate, db.metadata.trackingSinceDate);

      const createdBottles: BottleInstance[] = Array.from({ length: qty }, () => ({
        id: generateId(),
        wineId,
        status: 'IN_STOCK',
        locationId: input.locationId,
        purchaseDate: input.purchaseDate || null,
        purchaseDateUncertain: input.purchaseDateUncertain,
        purchaseSource: input.purchaseSource.trim(),
        purchasePrice: Math.max(0, Math.round(input.purchasePrice)),
        fxNote: input.fxNote?.trim() || undefined,
        includeInTrackingSince: includeTracking,
        memo: input.memo?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      }));

      await commitMutation(
        {
          ...db,
          wines: nextWines,
          bottles: [...db.bottles, ...createdBottles],
        },
        `${trimmedName} ${qty}병 입고 완료`,
      );
    },

    updateWineMaster: async (wineId, patch, mergeTargetWineId = null) => {
      const db = get().db;
      if (!db) return;
      const now = new Date().toISOString();

      // ⑤ 보강: 사용자가 확인한 경우 중복 4중 키 마스터와 병합 (bottles.wineId 이전 + 메타데이터 계승 + 중복 마스터 제거)
      if (mergeTargetWineId && mergeTargetWineId !== wineId) {
        const sourceMaster = db.wines.find((w) => w.id === wineId);
        const targetMaster = db.wines.find((w) => w.id === mergeTargetWineId);
        if (sourceMaster && targetMaster) {
          const nextBottles = db.bottles.map((b) =>
            b.wineId === wineId ? { ...b, wineId: mergeTargetWineId, updatedAt: now } : b,
          );
          const inheritedLabel = targetMaster.labelImageFileId ?? sourceMaster.labelImageFileId ?? null;
          let inheritedDwStart =
            targetMaster.drinkingWindowStart ??
            patch.drinkingWindowStart ??
            sourceMaster.drinkingWindowStart ??
            null;
          let inheritedDwEnd =
            targetMaster.drinkingWindowEnd ??
            patch.drinkingWindowEnd ??
            sourceMaster.drinkingWindowEnd ??
            null;
          // 서로 다른 부분 음용적기 결합 시 start > end 역전 방지
          if (inheritedDwStart != null && inheritedDwEnd != null && inheritedDwStart > inheritedDwEnd) {
            inheritedDwStart = targetMaster.drinkingWindowStart ?? null;
            inheritedDwEnd = targetMaster.drinkingWindowEnd ?? null;
          }
          const inheritedProducer =
            targetMaster.producer || patch.producer?.trim() || sourceMaster.producer || undefined;

          const nextWines = db.wines
            .filter((w) => w.id !== wineId)
            .map((w) =>
              w.id === mergeTargetWineId
                ? {
                    ...w,
                    producer: inheritedProducer,
                    labelImageFileId: inheritedLabel,
                    drinkingWindowStart: inheritedDwStart,
                    drinkingWindowEnd: inheritedDwEnd,
                    updatedAt: now,
                  }
                : w,
            );
          const nextDb: WineDatabase = { ...db, wines: nextWines, bottles: nextBottles };
          const commitRes = await commitMutation(nextDb, '기존 동일 와인과 하나로 병합했습니다.');
          if (sourceMaster.labelImageFileId && sourceMaster.labelImageFileId !== inheritedLabel) {
            cleanupUnreferencedPhotoFiles([sourceMaster.labelImageFileId], nextDb, commitRes === 'synced');
          }
          return;
        }
      }

      const nextWines = db.wines.map((w) =>
        w.id === wineId
          ? {
              ...w,
              ...patch,
              name: patch.name !== undefined ? patch.name.trim() : w.name,
              country: patch.country !== undefined ? patch.country.trim() || '미분류' : w.country,
              region: patch.region !== undefined ? patch.region.trim() || w.country : w.region,
              subRegion:
                patch.subRegion !== undefined
                  ? patch.subRegion.trim() || undefined
                  : w.subRegion,
              vintage: patch.vintage !== undefined ? patch.vintage.trim().toUpperCase() : w.vintage,
              updatedAt: now,
            }
          : w,
      );
      await commitMutation({ ...db, wines: nextWines }, '와인 정보를 수정했습니다.');
    },

    updateBottle: async (bottleId, patch) => {
      const db = get().db;
      if (!db) return;
      const now = new Date().toISOString();
      const nextBottles = db.bottles.map((b) =>
        b.id === bottleId
          ? {
              ...b,
              ...patch,
              purchasePrice:
                patch.purchasePrice !== undefined
                  ? Math.max(0, Math.round(patch.purchasePrice))
                  : b.purchasePrice,
              updatedAt: now,
            }
          : b,
      );
      await commitMutation({ ...db, bottles: nextBottles }, '병 정보를 수정했습니다.');
    },

    deleteBottle: async (bottleId) => {
      const db = get().db;
      if (!db) return;
      const target = db.bottles.find((b) => b.id === bottleId);
      const removedTastings = db.tastings.filter((t) => t.bottleId === bottleId);
      const nextBottles = db.bottles.filter((b) => b.id !== bottleId);
      const nextTastings = db.tastings.filter((t) => t.bottleId !== bottleId);

      // ⑤ 보강: 보유·소비·선물 병이 모두 0병이 된 고아 WineMaster는 자동 정리
      const hasRemainingForWine = target
        ? nextBottles.some((b) => b.wineId === target.wineId)
        : true;
      const removedMaster =
        target && !hasRemainingForWine ? db.wines.find((w) => w.id === target.wineId) : undefined;
      const nextWines = removedMaster ? db.wines.filter((w) => w.id !== removedMaster.id) : db.wines;

      const nextDb: WineDatabase = {
        ...db,
        wines: nextWines,
        bottles: nextBottles,
        tastings: nextTastings,
      };
      const commitRes = await commitMutation(nextDb, '병 기록을 삭제했습니다.');

      const candidatePhotoIds: string[] = [];
      for (const t of removedTastings) {
        candidatePhotoIds.push(...(t.photoFileIds ?? []));
      }
      if (removedMaster?.labelImageFileId) {
        candidatePhotoIds.push(removedMaster.labelImageFileId);
      }
      cleanupUnreferencedPhotoFiles(candidatePhotoIds, nextDb, commitRes === 'synced');
    },

    moveBottle: async (bottleId, targetLocationId) => {
      const db = get().db;
      if (!db) return;
      const now = new Date().toISOString();
      const locName =
        db.locations.find((l) => l.id === targetLocationId)?.displayName ?? '미지정';
      const nextBottles = db.bottles.map((b) =>
        b.id === bottleId ? { ...b, locationId: targetLocationId, updatedAt: now } : b,
      );
      await commitMutation({ ...db, bottles: nextBottles }, `${locName}(으)로 이동했습니다.`);
    },

    consumeOrGiftBottle: async ({
      bottleId,
      type,
      eventDate,
      occasion,
      memo,
      companions,
      rating,
      tastingNote,
      photoFileIds,
    }) => {
      const db = get().db;
      if (!db) return;
      if (!db.bottles.some((b) => b.id === bottleId)) {
        get().showToast('대상 병 기록을 찾을 수 없습니다.', 'warning');
        return;
      }
      const now = new Date().toISOString();
      const nextBottles = db.bottles.map((b) =>
        b.id === bottleId
          ? {
              ...b,
              status: type,
              // 직전 locationId는 복원 편의를 위해 보존
              updatedAt: now,
            }
          : b,
      );
      const newTasting: TastingRecord = {
        id: generateId(),
        bottleId,
        type,
        eventDate: eventDate || getTodayIsoDate(),
        occasion: occasion?.trim() || undefined,
        memo: memo?.trim() || undefined,
        companions: companions?.trim() || undefined,
        rating: rating ?? null,
        tastingNote: tastingNote?.trim() || undefined,
        photoFileIds: photoFileIds && photoFileIds.length > 0 ? photoFileIds : undefined,
        createdAt: now,
      };
      const filteredTastings = db.tastings.filter((t) => t.bottleId !== bottleId);
      await commitMutation(
        {
          ...db,
          bottles: nextBottles,
          tastings: [newTasting, ...filteredTastings],
        },
        type === 'CONSUMED' ? '소비 완료 처리했습니다.' : '선물·양도 처리했습니다.',
      );
    },

    restoreBottleToStock: async (bottleId, targetLocationId) => {
      const db = get().db;
      if (!db) return;
      const now = new Date().toISOString();
      const removedTastings = db.tastings.filter((t) => t.bottleId === bottleId);
      const nextBottles = db.bottles.map((b) =>
        b.id === bottleId
          ? {
              ...b,
              status: 'IN_STOCK' as const,
              locationId: targetLocationId,
              updatedAt: now,
            }
          : b,
      );
      const nextTastings = db.tastings.filter((t) => t.bottleId !== bottleId);
      const nextDb: WineDatabase = {
        ...db,
        bottles: nextBottles,
        tastings: nextTastings,
      };
      const commitRes = await commitMutation(nextDb, '보유 상태로 복원했습니다.');

      const candidatePhotoIds = removedTastings.flatMap((t) => t.photoFileIds ?? []);
      cleanupUnreferencedPhotoFiles(candidatePhotoIds, nextDb, commitRes === 'synced');
    },

    updateTastingRecord: async (tastingId, patch) => {
      const db = get().db;
      if (!db) return 'invalid';
      const target = db.tastings.find((t) => t.id === tastingId);
      if (!target) return 'invalid';
      const nextTastings = db.tastings.map((t) =>
        t.id === tastingId
          ? {
              ...t,
              ...patch,
              occasion: patch.occasion !== undefined ? patch.occasion.trim() || undefined : t.occasion,
              memo: patch.memo !== undefined ? patch.memo.trim() || undefined : t.memo,
              companions:
                patch.companions !== undefined ? patch.companions.trim() || undefined : t.companions,
              tastingNote:
                patch.tastingNote !== undefined ? patch.tastingNote.trim() || undefined : t.tastingNote,
              rating: patch.rating !== undefined ? patch.rating : t.rating,
              photoFileIds:
                patch.photoFileIds !== undefined
                  ? patch.photoFileIds.length > 0
                    ? patch.photoFileIds
                    : undefined
                  : t.photoFileIds,
            }
          : t,
      );
      const nextBottles =
        patch.type && patch.type !== target.type
          ? db.bottles.map((b) =>
              b.id === target.bottleId ? { ...b, status: patch.type!, updatedAt: new Date().toISOString() } : b,
            )
          : db.bottles;

      return commitMutation(
        { ...db, bottles: nextBottles, tastings: nextTastings },
        '소비·선물 이력을 수정했습니다.',
      );
    },

    addLocation: async (loc) => {
      const db = get().db;
      if (!db) return;
      const zone = loc.zone.trim();
      const shelf = loc.shelf.trim();
      const displayName = loc.displayName.trim();
      if (!zone || !shelf || !displayName) {
        get().showToast('구역, 선반명, 표시 이름은 비워둘 수 없습니다.', 'warning');
        return;
      }
      const newLoc: CellarLocation = {
        ...loc,
        id: `loc_${generateId().slice(0, 8)}`,
        zone,
        shelf,
        displayName,
        maxCapacity: Math.max(0, Math.round(loc.maxCapacity)),
        sortOrder: Math.round(loc.sortOrder),
      };
      await commitMutation(
        { ...db, locations: [...db.locations, newLoc] },
        `선반 '${newLoc.displayName}'을 추가했습니다.`,
      );
    },

    updateLocation: async (id, patch) => {
      const db = get().db;
      if (!db) return;
      const sanitized: Partial<Omit<CellarLocation, 'id'>> = {
        ...patch,
        ...(patch.zone !== undefined ? { zone: patch.zone.trim() } : {}),
        ...(patch.shelf !== undefined ? { shelf: patch.shelf.trim() } : {}),
        ...(patch.displayName !== undefined ? { displayName: patch.displayName.trim() } : {}),
        ...(patch.maxCapacity !== undefined
          ? { maxCapacity: Math.max(0, Math.round(patch.maxCapacity)) }
          : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: Math.round(patch.sortOrder) } : {}),
      };
      const nextLocations = db.locations.map((l) => (l.id === id ? { ...l, ...sanitized } : l));
      await commitMutation({ ...db, locations: nextLocations }, '선반 정보를 수정했습니다.');
    },

    reorderLocations: async (orderedIds) => {
      const db = get().db;
      if (!db) return;
      const orderIndex = new Map(orderedIds.map((id, idx) => [id, idx + 1]));
      let nextExtra = orderedIds.length + 1;
      const nextLocations = db.locations.map((loc) => {
        const assigned = orderIndex.get(loc.id);
        if (assigned !== undefined) {
          return { ...loc, sortOrder: assigned };
        }
        const fallback = nextExtra;
        nextExtra += 1;
        return { ...loc, sortOrder: fallback };
      });
      await commitMutation({ ...db, locations: nextLocations }, '선반 순서를 변경했습니다.');
    },

    deleteLocation: async (id) => {
      const db = get().db;
      if (!db) return;
      // M1 보강: IN_STOCK 병만 삭제 차단 검사, 과거 CONSUMED/GIFTED 병의 dangling locationId는 null 정리
      const inStockCount = db.bottles.filter(
        (b) => b.status === 'IN_STOCK' && b.locationId === id,
      ).length;
      if (inStockCount > 0) {
        get().showToast(
          `현재 보유 중인 와인 ${inStockCount}병이 있어 삭제할 수 없습니다. 먼저 다른 선반으로 이동해 주세요.`,
          'warning',
        );
        return;
      }

      const nextLocations = db.locations.filter((l) => l.id !== id);
      const nextBottles = db.bottles.map((b) =>
        b.locationId === id ? { ...b, locationId: null } : b,
      );
      await commitMutation(
        { ...db, locations: nextLocations, bottles: nextBottles },
        '선반을 삭제했습니다.',
      );
    },

    updateTrackingSinceDate: async (newDate, recalculateExisting) => {
      const db = get().db;
      if (!db) return;
      const trimmed = newDate.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        get().showToast('유효한 기준일(YYYY-MM-DD)을 입력해 주세요.', 'warning');
        return;
      }
      const nextBottles = recalculateExisting
        ? db.bottles.map((b) => ({
            ...b,
            includeInTrackingSince: shouldIncludeInTrackingSince(b.purchaseDate, trimmed),
          }))
        : db.bottles;

      await commitMutation(
        {
          ...db,
          metadata: {
            ...db.metadata,
            trackingSinceDate: trimmed,
          },
          bottles: nextBottles,
        },
        recalculateExisting
          ? `누적 지출 기준일을 ${trimmed}로 변경하고 전체 병을 재계산했습니다.`
          : `누적 지출 기준일을 ${trimmed}로 변경했습니다.`,
      );
    },

    autoFillMissingDrinkingWindows: async () => {
      const db = get().db;
      if (!db) return 0;

      // NV 와인의 기준 연도로 사용할 와인별 최초 구입연도 맵
      const earliestYearByWine = new Map<string, number>();
      for (const b of db.bottles) {
        if (b.purchaseDate && /^\d{4}/.test(b.purchaseDate)) {
          const yr = Number(b.purchaseDate.slice(0, 4));
          const prev = earliestYearByWine.get(b.wineId);
          if (prev === undefined || yr < prev) {
            earliestYearByWine.set(b.wineId, yr);
          }
        }
      }

      const now = new Date().toISOString();
      let updatedCount = 0;
      const nextWines = db.wines.map((w) => {
        if (w.drinkingWindowStart != null || w.drinkingWindowEnd != null) {
          return w;
        }
        const est = estimateDrinkingWindow({
          name: w.name,
          country: w.country,
          region: w.region,
          subRegion: w.subRegion,
          color: w.color,
          vintage: w.vintage,
          referenceYear: earliestYearByWine.get(w.id),
        });
        if (!est) return w;
        updatedCount += 1;
        return {
          ...w,
          drinkingWindowStart: est.start,
          drinkingWindowEnd: est.end,
          updatedAt: now,
        };
      });

      if (updatedCount === 0) {
        get().showToast('음용 적기가 비어 있는 와인이 없습니다.', 'info');
        return 0;
      }

      await commitMutation(
        { ...db, wines: nextWines },
        `미입력 와인 ${updatedCount}종의 음용 적기를 지역·빈티지 기준으로 자동 채웠습니다.`,
      );
      return updatedCount;
    },

    uploadWineLabelPhoto: async (wineId, file) => {
      const state = get();
      const db = state.db;
      if (!db) return;
      if (state.storageMode === 'google_drive' && !isNativeAuth() && !isTokenValid()) {
        set({ syncStatus: 'auth_required' });
        get().showToast('사진을 업로드하려면 상단 [구글 재인증]을 먼저 눌러 주세요.', 'warning');
        return;
      }

      const wine = db.wines.find((w) => w.id === wineId);
      if (!wine) return;

      try {
        const processed = await compressImageFile(file, 'label');
        const adapter = getAdapter(state.storageMode);
        const fileName = `label_${wineId.slice(0, 8)}_${Date.now()}.${processed.extension}`;
        const { fileId } = await adapter.uploadPhoto(processed.blob, fileName);
        await registerUploadedPhotoBlob(fileId, processed.blob);

        // 비동기 업로드 후 최신 db 재조회(업로드 도중 발생한 타 편집 덮어쓰기 방지)
        const latestDb = get().db;
        if (!latestDb || get().storageMode !== state.storageMode) {
          void adapter.deletePhoto(fileId).catch(() => undefined);
          void evictPhotoFromCache(fileId);
          return;
        }
        const latestWine = latestDb.wines.find((w) => w.id === wineId) ?? wine;

        // 빈티지 구분 없이 동일 (와인명, 색상) 전체 빈티지에 라벨 1장을 공통 적용
        const targetGroupKey = buildWineLabelGroupKey(latestWine);
        const oldFileIds = new Set<string>();
        let sharedCount = 0;
        const now = new Date().toISOString();
        const nextWines = latestDb.wines.map((w) => {
          if (buildWineLabelGroupKey(w) === targetGroupKey) {
            if (w.labelImageFileId && w.labelImageFileId !== fileId) {
              oldFileIds.add(w.labelImageFileId);
            }
            sharedCount += 1;
            return { ...w, labelImageFileId: fileId, updatedAt: now };
          }
          return w;
        });

        const nextDb: WineDatabase = { ...latestDb, wines: nextWines };
        const commitRes = await commitMutation(
          nextDb,
          sharedCount > 1
            ? `라벨 사진을 등록해 동일 와인 ${sharedCount}개 빈티지에 공통 적용했습니다.`
            : '와인 라벨 사진을 등록했습니다.',
        );
        cleanupUnreferencedPhotoFiles(oldFileIds, nextDb, commitRes === 'synced');
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          set({ syncStatus: 'auth_required', syncError: err.message });
          get().showToast('사진을 업로드하려면 상단 [구글 재인증]을 먼저 눌러 주세요.', 'warning');
        } else {
          const msg = err instanceof Error ? err.message : '라벨 사진 업로드에 실패했습니다.';
          get().showToast(msg, 'error');
        }
      }
    },

    removeWineLabelPhoto: async (wineId) => {
      const state = get();
      const db = state.db;
      if (!db) return;
      const wine = db.wines.find((w) => w.id === wineId);
      if (!wine?.labelImageFileId) return;

      const targetGroupKey = buildWineLabelGroupKey(wine);
      const removedFileIds = new Set<string>();
      const now = new Date().toISOString();
      const nextWines = db.wines.map((w) => {
        if (buildWineLabelGroupKey(w) === targetGroupKey && w.labelImageFileId) {
          removedFileIds.add(w.labelImageFileId);
          return { ...w, labelImageFileId: null, updatedAt: now };
        }
        return w;
      });
      const nextDb: WineDatabase = { ...db, wines: nextWines };
      const commitRes = await commitMutation(nextDb, '라벨 사진을 삭제했습니다.');
      cleanupUnreferencedPhotoFiles(removedFileIds, nextDb, commitRes === 'synced');
    },

    uploadTastingPhoto: async (file) => {
      const state = get();
      if (state.storageMode === 'google_drive' && !isNativeAuth() && !isTokenValid()) {
        set({ syncStatus: 'auth_required' });
        get().showToast('사진을 업로드하려면 상단 [구글 재인증]을 먼저 눌러 주세요.', 'warning');
        return null;
      }
      try {
        const processed = await compressImageFile(file, 'tasting');
        const adapter = getAdapter(state.storageMode);
        const fileName = `tasting_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${processed.extension}`;
        const { fileId } = await adapter.uploadPhoto(processed.blob, fileName);
        await registerUploadedPhotoBlob(fileId, processed.blob);
        return fileId;
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          set({ syncStatus: 'auth_required', syncError: err.message });
          get().showToast('사진을 업로드하려면 상단 [구글 재인증]을 먼저 눌러 주세요.', 'warning');
        } else {
          const msg = err instanceof Error ? err.message : '시음 사진 업로드에 실패했습니다.';
          get().showToast(msg, 'error');
        }
        return null;
      }
    },

    deleteTastingPhotoFile: async (fileId) => {
      const state = get();
      const adapter = getAdapter(state.storageMode);
      if (
        state.storageMode === 'local_test' ||
        isTokenValid() ||
        (isNativeAuth() && state.googleConnected)
      ) {
        void adapter.deletePhoto(fileId).catch(() => undefined);
      }
      void evictPhotoFromCache(fileId);
    },

    importApprovedLabelsBundle: async (raw, options) => {
      const overwriteExisting = options?.overwriteExisting ?? false;
      const state = get();
      const db = state.db;
      if (!db) return { applied: 0, skipped: 0, failed: 0 };

      const bundle = parseApprovedLabelsBundle(raw);
      if (state.storageMode === 'google_drive') {
        if (isNativeAuth()) {
          try {
            await ensureAccessToken();
          } catch (err) {
            set({
              syncStatus: 'auth_required',
              syncError: err instanceof Error ? err.message : undefined,
            });
            get().showToast(
              '라벨을 Google Drive에 일괄 업로드하려면 먼저 상단 [구글 재인증]을 눌러 주세요.',
              'warning',
            );
            return { applied: 0, skipped: 0, failed: bundle.items.length };
          }
        } else if (!isTokenValid()) {
          set({ syncStatus: 'auth_required' });
          get().showToast(
            '라벨을 Google Drive에 일괄 업로드하려면 먼저 상단 [구글 재인증]을 눌러 주세요.',
            'warning',
          );
          return { applied: 0, skipped: 0, failed: bundle.items.length };
        }
      }

      const wineMap = new Map(db.wines.map((w) => [w.id, w]));
      const winesByLabelGroup = new Map<string, WineMaster[]>();
      for (const w of db.wines) {
        const gKey = buildWineLabelGroupKey(w);
        const list = winesByLabelGroup.get(gKey) ?? [];
        list.push(w);
        winesByLabelGroup.set(gKey, list);
      }

      const adapter = getAdapter(state.storageMode);
      const uploadedByWineId = new Map<string, string>();
      const propagatedByWineId = new Map<string, string>();
      const oldFileIdsToDelete = new Set<string>();
      let skipped = 0;
      let failed = 0;
      let abortReason: 'auth' | 'rate_limit' | null = null;

      set({ bulkLabelProgress: { current: 0, total: bundle.items.length } });
      try {
        for (let idx = 0; idx < bundle.items.length; idx += 1) {
          const item = bundle.items[idx];
          set({ bulkLabelProgress: { current: idx + 1, total: bundle.items.length } });

          // 빈티지 구분 없이 매칭: wineIds / wineId + 동일 (와인명, 색상) 전체 빈티지에 1장 공통 적용
          const candidateIds = item.wineIds && item.wineIds.length > 0 ? item.wineIds : [item.wineId];
          const matchedWines = new Map<string, WineMaster>();
          for (const cid of candidateIds) {
            const found = wineMap.get(cid);
            if (found) {
              matchedWines.set(found.id, found);
              for (const sibling of winesByLabelGroup.get(buildWineLabelGroupKey(found)) ?? []) {
                matchedWines.set(sibling.id, sibling);
              }
            }
          }
          if (matchedWines.size === 0 && item.wineName && item.color) {
            const gKey = buildWineLabelGroupKey({ name: item.wineName, color: item.color });
            for (const sibling of winesByLabelGroup.get(gKey) ?? []) {
              matchedWines.set(sibling.id, sibling);
            }
          }

          if (matchedWines.size === 0) {
            skipped += 1;
            continue;
          }

          const matchedList = [...matchedWines.values()];
          const existingGroupLabelId = matchedList
            .map((w) => uploadedByWineId.get(w.id) ?? propagatedByWineId.get(w.id) ?? w.labelImageFileId)
            .find((id): id is string => Boolean(id));

          // 부분 라벨 그룹 정합성 및 번들 내 동일 그룹 중복 항목 방지:
          // overwriteExisting=false인데 그룹 내 기존(또는 이번 배치 선행) 라벨이 이미 있으면
          // 새 중복 파일을 올리지 않고 기존 라벨을 비어있는 형제 빈티지에 공유
          if (!overwriteExisting && existingGroupLabelId) {
            for (const w of matchedList) {
              if (!w.labelImageFileId && !uploadedByWineId.has(w.id)) {
                propagatedByWineId.set(w.id, existingGroupLabelId);
              }
            }
            skipped += 1;
            continue;
          }

          const targetsToUpdate = matchedList;

          try {
            const { blob, extension } = dataUrlToBlob(item.dataUrl);
            const fileName = `label_${item.wineId.slice(0, 8)}_${Date.now()}_${idx}.${extension}`;
            const { fileId } = await adapter.uploadPhoto(blob, fileName);
            await registerUploadedPhotoBlob(fileId, blob);
            for (const targetWine of targetsToUpdate) {
              const prevUploaded = uploadedByWineId.get(targetWine.id);
              if (prevUploaded && prevUploaded !== fileId) {
                oldFileIdsToDelete.add(prevUploaded);
              }
              if (targetWine.labelImageFileId && targetWine.labelImageFileId !== fileId) {
                oldFileIdsToDelete.add(targetWine.labelImageFileId);
              }
              uploadedByWineId.set(targetWine.id, fileId);
            }
          } catch (err) {
            if (err instanceof AuthRequiredError) {
              abortReason = 'auth';
              failed += bundle.items.length - idx;
              set({ syncStatus: 'auth_required', syncError: err.message });
              break;
            }
            const errMsg = err instanceof Error ? err.message : '';
            if (/\b429\b|rate\s*limit|too many requests/i.test(errMsg)) {
              abortReason = 'rate_limit';
              failed += bundle.items.length - idx;
              break;
            }
            failed += 1;
          }
        }

        const applied = uploadedByWineId.size;
        const totalUpdatedWines = applied + propagatedByWineId.size;
        if (totalUpdatedWines > 0) {
          const now = new Date().toISOString();
          const latestDb = get().db ?? db;
          const nextWines = latestDb.wines.map((w) => {
            const nextFileId = uploadedByWineId.get(w.id) ?? propagatedByWineId.get(w.id);
            return nextFileId ? { ...w, labelImageFileId: nextFileId, updatedAt: now } : w;
          });
          const nextDb: WineDatabase = { ...latestDb, wines: nextWines };
          const summaryMsg =
            abortReason === 'auth'
              ? `인증 만료로 중단되었습니다. 먼저 완료된 ${applied}개 와인은 로컬에 반영했으니 [구글 재인증] 후 다시 진행해 주세요.`
              : abortReason === 'rate_limit'
                ? `Google Drive 요청 제한(429)으로 중단되었습니다. 먼저 완료된 ${applied}개 와인은 저장했으니 잠시 후 다시 진행해 주세요.`
                : applied > 0
                  ? `승인된 라벨을 ${applied}개 와인(전체 빈티지 포함)에 일괄 적용했습니다.` +
                    (skipped > 0 ? ` (기존/미일치 ${skipped}건 건너뜀)` : '') +
                    (failed > 0 ? ` (실패 ${failed}건)` : '')
                  : `기존 그룹 라벨을 미등록 빈티지 ${propagatedByWineId.size}건에 공유 반영했습니다. (신규 업로드 없음)`;
          const commitRes = await commitMutation(nextDb, abortReason ? undefined : summaryMsg);
          if (abortReason) {
            get().showToast(summaryMsg, 'warning');
          }
          cleanupUnreferencedPhotoFiles(oldFileIdsToDelete, nextDb, commitRes === 'synced');
        } else if (abortReason === 'auth') {
          get().showToast(
            '업로드 중 구글 인증이 만료되어 중단했습니다. 상단 [구글 재인증] 후 다시 시도해 주세요.',
            'warning',
          );
        } else if (abortReason === 'rate_limit') {
          get().showToast(
            'Google Drive 요청 한도(429)에 도달해 업로드를 중단했습니다. 잠시 후 다시 시도해 주세요.',
            'warning',
          );
        } else {
          get().showToast(
            `새로 적용된 라벨이 없습니다. (기존/미일치 ${skipped}건 건너뜀${failed > 0 ? ` · 실패 ${failed}건` : ''})`,
            'info',
          );
        }

        return { applied, skipped, failed };
      } finally {
        set({ bulkLabelProgress: null });
      }
    },

    // --- UI Actions ---

    togglePrivacyMode: () => {
      set((state) => {
        const next = !state.isPrivacyMode;
        safeSetStorage(PRIVACY_KEY, String(next));
        return { isPrivacyMode: next };
      });
    },

    toggleTheme: () => {
      set((state) => {
        const next: ThemeMode = state.theme === 'light' ? 'dark' : 'light';
        safeSetStorage(THEME_KEY, next);
        applyThemeToDom(next);
        return { theme: next };
      });
    },

    setFilters: (patch) => {
      set((state) => {
        const merged = { ...state.filters, ...patch };
        // 1단계 국가 변경 시 하위 지역·세부지역 초기화
        if (patch.country !== undefined && patch.country !== state.filters.country) {
          if (patch.region === undefined) merged.region = '';
          if (patch.subRegion === undefined) merged.subRegion = '';
        }
        // 2단계 지역 변경 시 하위 세부지역 초기화
        if (patch.region !== undefined && patch.region !== state.filters.region) {
          if (patch.subRegion === undefined) merged.subRegion = '';
        }
        return { filters: merged };
      });
    },

    resetFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),

    openQuickAdd: (presetWineId = null) =>
      set({ isQuickAddOpen: true, quickAddPresetWineId: presetWineId }),

    closeQuickAdd: () => set({ isQuickAddOpen: false, quickAddPresetWineId: null }),

    showToast: (text, tone = 'info') => {
      const id = generateId();
      set({ toast: { id, text, tone } });
      setTimeout(() => {
        if (get().toast?.id === id) {
          set({ toast: null });
        }
      }, 3600);
    },

    clearToast: () => set({ toast: null }),
  };
});
