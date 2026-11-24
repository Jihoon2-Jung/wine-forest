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
  hasGoogleClientId,
  isTokenValid,
  requestAccessToken,
} from '@/services/auth/googleAuth';
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
import { clearCachedState, loadCachedState, saveCachedState } from '@/services/storage/localCache';
import { LocalOnlyAdapter } from '@/services/storage/localOnlyAdapter';
import { syncEngine } from '@/services/storage/syncEngine';
import { compressImageFile, dataUrlToBlob } from '@/services/media/imageProcessor';
import { evictPhotoFromCache, registerUploadedPhotoBlob } from '@/services/media/photoLoader';
import {
  AuthRequiredError,
  ConflictError,
  type BackupSnapshot,
  type StorageAdapter,
  type StorageMode,
} from '@/services/storage/types';

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
}

function detectDeviceLabel(): string {
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
  ) => Promise<void>;
  addLocation: (loc: Omit<CellarLocation, 'id'>) => Promise<void>;
  updateLocation: (id: string, patch: Partial<Omit<CellarLocation, 'id'>>) => Promise<void>;
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
  const persistLocalCache = async (override?: Partial<{
    data: WineDatabase | null;
    fileId: string | null;
    lastSyncedModifiedTime: string | null;
    hasUnsyncedChanges: boolean;
    storageMode: StorageMode;
  }>) => {
    const state = get();
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
  };

  const commitMutation = async (nextDb: WineDatabase, successToast?: string) => {
    const state = get();
    const nowIso = new Date().toISOString();
    const updatedDb: WineDatabase = {
      ...nextDb,
      metadata: {
        ...nextDb.metadata,
        lastModifiedAt: nowIso,
        deviceLabel: detectDeviceLabel(),
      },
    };

    // 1. 낙관적 UI + IndexedDB 영속화 (hasUnsyncedChanges = true로 보호)
    set({
      db: updatedDb,
      hasUnsyncedChanges: true,
      syncError: null,
    });
    await persistLocalCache({ data: updatedDb, hasUnsyncedChanges: true });

    // 2. Google Drive 모드인데 토큰이 만료/없음 -> 비동기 팝업 호출 금지(R2 보강)!
    //    안전하게 로컬 보관 후 1클릭 재인증 배지/토스트로 유도
    if (state.storageMode === 'google_drive' && !isTokenValid()) {
      set({ syncStatus: 'auth_required' });
      get().showToast(
        '변경사항이 기기에 안전 저장되었습니다. 상단 [재인증]을 눌러 Google Drive에 동기화하세요.',
        'warning',
      );
      return;
    }

    // 3. 저장소 동기화 실행 (SyncEngine Write Mutex)
    set({ syncStatus: 'syncing' });
    try {
      const adapter = getAdapter(state.storageMode);
      const latestState = get();
      const result = await syncEngine.saveWithPolicy(adapter, {
        fileId: latestState.fileId,
        data: latestState.db ?? updatedDb,
        expectedModifiedTime: latestState.lastSyncedModifiedTime,
      });

      set({
        db: result.savedData,
        fileId: result.fileId,
        lastSyncedModifiedTime: result.modifiedTime,
        hasUnsyncedChanges: false,
        syncStatus: 'synced',
        conflict: null,
        syncError: null,
      });
      await persistLocalCache({
        data: result.savedData,
        fileId: result.fileId,
        lastSyncedModifiedTime: result.modifiedTime,
        hasUnsyncedChanges: false,
      });

      if (result.autoBackupCreated) {
        get().showToast(
          `${successToast ? `${successToast} · ` : ''}주간 자동 백업 완료 (${result.autoBackupCreated.name})`,
          'success',
        );
      } else if (successToast) {
        get().showToast(successToast, 'success');
      }
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
      } else if (err instanceof AuthRequiredError) {
        set({ syncStatus: 'auth_required', syncError: err.message });
        get().showToast('인증이 만료되었습니다. 상단 배지를 눌러 1클릭 재인증 후 동기화하세요.', 'warning');
      } else {
        const msg = err instanceof Error ? err.message : '동기화 중 오류가 발생했습니다.';
        set({ syncStatus: 'error', syncError: msg });
        get().showToast(`로컬에 저장되었으나 동기화 실패: ${msg}`, 'error');
      }
    }
  };

  return {
    db: null,
    isHydrated: false,
    storageMode: hasGoogleClientId() ? 'google_drive' : 'local_test',
    googleConnected: false,
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
          storageMode: cached?.storageMode ?? (hasGoogleClientId() ? 'google_drive' : 'local_test'),
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
      const initialSyncStatus: SyncStatus =
        mode === 'local_test'
          ? 'synced'
          : cached.hasUnsyncedChanges
            ? 'auth_required'
            : isTokenValid()
              ? 'synced'
              : 'offline_cache';

      set({
        db: validDb,
        fileId: cached.fileId,
        lastSyncedModifiedTime: cached.lastSyncedModifiedTime,
        hasUnsyncedChanges: cached.hasUnsyncedChanges,
        storageMode: mode,
        syncStatus: initialSyncStatus,
        isHydrated: true,
      });

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
        googleConnected: true,
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
        set({ syncStatus: 'synced' });
        return 'needs_setup';
      } catch (err) {
        const msg = err instanceof Error ? err.message : '드라이브 연결 중 오류가 발생했습니다.';
        set({ syncStatus: 'error', syncError: msg });
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
        set({ storageMode: 'local_test', syncStatus: 'synced', syncError: null });
        await persistLocalCache({ storageMode: 'local_test' });
        get().showToast('로컬 테스트 모드로 전환했습니다. 변경사항은 이 브라우저에 저장됩니다.', 'info');
        return;
      }

      if (!hasGoogleClientId()) {
        get().showToast('VITE_GOOGLE_CLIENT_ID가 설정되어 있지 않아 Google Drive 모드로 전환할 수 없습니다.', 'error');
        return;
      }

      try {
        await requestAccessToken();
        googleDriveAdapter.resetWorkspaceCache();
        const currentDb = get().db;
        const found = await googleDriveAdapter.findDbFile();
        if (found) {
          // T5 보강: 로컬에 데이터가 있고 Drive에도 기존 파일이 있으면 사용자 확인 모달 표시
          if (currentDb && currentDb.bottles.length > 0) {
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
          set({
            storageMode: 'google_drive',
            googleConnected: true,
            fileId: null,
            lastSyncedModifiedTime: null,
          });
          await commitMutation(currentDb, '현재 데이터를 Google Drive에 최초 업로드했습니다.');
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
        set({ modeSwitchConflict: null });
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
          const msg = err instanceof Error ? err.message : '원격 데이터 로드 실패';
          set({ syncStatus: 'error', syncError: msg });
          get().showToast(msg, 'error');
        }
        return;
      }

      // overwrite_remote: 원격 파일을 먼저 conflict 백업으로 대피시킨 뒤 로컬 데이터 업로드
      if (choice === 'overwrite_remote' && state.db) {
        set({ modeSwitchConflict: null, storageMode: 'google_drive', syncStatus: 'syncing' });
        try {
          const result = await syncEngine.saveWithPolicy(googleDriveAdapter, {
            fileId: pending.remoteFileId,
            data: state.db,
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
          get().showToast('기존 Drive 파일을 대피 백업한 뒤 현재 로컬 데이터로 덮어썼습니다.', 'success');
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Drive 덮어쓰기 실패';
          set({ storageMode: 'local_test', syncStatus: 'error', syncError: msg });
          get().showToast(msg, 'error');
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
      if (state.storageMode === 'google_drive' && !isTokenValid()) {
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
      clearAccessToken();
      googleDriveAdapter.resetWorkspaceCache();
      await clearCachedState();
      set({
        db: null,
        fileId: null,
        lastSyncedModifiedTime: null,
        hasUnsyncedChanges: false,
        googleConnected: false,
        syncStatus: 'offline_cache',
        conflict: null,
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

      // 반드시 클릭 핸들러 동기 컨텍스트에서 requestAccessToken() 호출
      try {
        await requestAccessToken();
        set({ googleConnected: true, syncError: null });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '구글 재인증에 실패했습니다.';
        get().showToast(msg, 'error');
        return;
      }

      const afterAuth = get();
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
      if (!isTokenValid()) {
        set({ syncStatus: 'auth_required' });
        get().showToast('토큰이 만료되었습니다. [구글 재인증]을 눌러 주세요.', 'warning');
        return;
      }

      if (state.hasUnsyncedChanges && state.db) {
        await commitMutation(state.db, 'Google Drive 동기화를 완료했습니다.');
        return;
      }

      set({ syncStatus: 'syncing', syncError: null });
      try {
        const found = await googleDriveAdapter.findDbFile();
        if (!found) {
          if (state.db) {
            await commitMutation(state.db, 'Google Drive에 새 DB 파일을 생성했습니다.');
          } else {
            set({ syncStatus: 'synced' });
          }
          return;
        }

        if (found.modifiedTime !== state.lastSyncedModifiedTime || !state.db) {
          const loaded = await googleDriveAdapter.loadDb(found.fileId);
          set({
            db: loaded.data,
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
          });
          get().showToast('Google Drive 최신 데이터를 반영했습니다.', 'success');
        } else {
          set({ syncStatus: 'synced' });
          get().showToast('이미 최신 상태입니다.', 'info');
        }
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          set({ syncStatus: 'auth_required' });
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
          const msg = err instanceof Error ? err.message : '원격 불러오기 실패';
          set({ syncStatus: 'error', syncError: msg });
          get().showToast(msg, 'error');
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
          get().showToast('원격 파일을 충돌 백업으로 대피시킨 뒤 내 데이터로 덮어썼습니다.', 'success');
        } catch (err) {
          const msg = err instanceof Error ? err.message : '덮어쓰기 실패';
          set({ syncStatus: 'error', syncError: msg });
          get().showToast(msg, 'error');
        }
      }
    },

    fetchBackups: async () => {
      const state = get();
      if (state.storageMode === 'google_drive' && !isTokenValid()) {
        return;
      }
      set({ isLoadingBackups: true });
      try {
        const list = await getAdapter(state.storageMode).listBackups();
        set({ backups: list, isLoadingBackups: false });
      } catch (err) {
        set({ isLoadingBackups: false });
        const msg = err instanceof Error ? err.message : '백업 목록 조회 실패';
        get().showToast(msg, 'error');
      }
    },

    createManualBackup: async () => {
      const state = get();
      if (!state.db) return;
      if (state.storageMode === 'google_drive' && !isTokenValid()) {
        get().showToast('수동 백업을 위해 먼저 구글 재인증을 진행해 주세요.', 'warning');
        return;
      }
      try {
        const fileName = `wine_db_manual_${formatBackupDateTimeStamp()}.json`;
        const snapshot = await getAdapter(state.storageMode).createBackup(state.db, fileName);
        const updatedDb: WineDatabase = {
          ...state.db,
          metadata: {
            ...state.db.metadata,
            lastBackupAt: snapshot.createdTime,
          },
        };
        await commitMutation(updatedDb, `수동 백업 생성 완료 (${snapshot.name})`);
        await get().fetchBackups();
      } catch (err) {
        const msg = err instanceof Error ? err.message : '수동 백업 실패';
        get().showToast(msg, 'error');
      }
    },

    restoreFromBackup: async (backupFileId) => {
      const state = get();
      if (state.storageMode === 'google_drive' && !isTokenValid()) {
        get().showToast('복원을 위해 먼저 구글 재인증을 진행해 주세요.', 'warning');
        return;
      }
      set({ syncStatus: 'syncing' });
      try {
        const result = await syncEngine.restoreBackupSafely(getAdapter(state.storageMode), {
          currentData: state.db,
          backupFileId,
          fileId: state.fileId,
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
        await get().fetchBackups();
        get().showToast('현재 DB를 대피 백업한 뒤 선택한 스냅샷으로 복원했습니다.', 'success');
      } catch (err) {
        const msg = err instanceof Error ? err.message : '백업 복원 실패';
        set({ syncStatus: 'error', syncError: msg });
        get().showToast(msg, 'error');
      }
    },

    exportLocalJson: () => {
      const db = get().db;
      if (!db) return;
      const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wine_db_export_${formatBackupDateTimeStamp()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      get().showToast('JSON 백업 파일을 다운로드했습니다.', 'success');
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

      // ⑤ 보강: 사용자가 확인한 경우 중복 4중 키 마스터와 병합 (bottles.wineId 이전 + 중복 마스터 제거)
      if (mergeTargetWineId && mergeTargetWineId !== wineId) {
        const targetExists = db.wines.some((w) => w.id === mergeTargetWineId);
        if (targetExists) {
          const nextBottles = db.bottles.map((b) =>
            b.wineId === wineId ? { ...b, wineId: mergeTargetWineId, updatedAt: now } : b,
          );
          const nextWines = db.wines.filter((w) => w.id !== wineId);
          await commitMutation(
            { ...db, wines: nextWines, bottles: nextBottles },
            '기존 동일 와인과 하나로 병합했습니다.',
          );
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
      const nextBottles = db.bottles.filter((b) => b.id !== bottleId);
      const nextTastings = db.tastings.filter((t) => t.bottleId !== bottleId);

      // ⑤ 보강: 보유·소비·선물 병이 모두 0병이 된 고아 WineMaster는 자동 정리
      const hasRemainingForWine = target
        ? nextBottles.some((b) => b.wineId === target.wineId)
        : true;
      const nextWines =
        target && !hasRemainingForWine
          ? db.wines.filter((w) => w.id !== target.wineId)
          : db.wines;

      await commitMutation(
        { ...db, wines: nextWines, bottles: nextBottles, tastings: nextTastings },
        '병 기록을 삭제했습니다.',
      );
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
      await commitMutation(
        {
          ...db,
          bottles: nextBottles,
          tastings: nextTastings,
        },
        '보유 상태로 복원했습니다.',
      );
    },

    updateTastingRecord: async (tastingId, patch) => {
      const db = get().db;
      if (!db) return;
      const target = db.tastings.find((t) => t.id === tastingId);
      if (!target) return;
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

      await commitMutation(
        { ...db, bottles: nextBottles, tastings: nextTastings },
        '소비·선물 이력을 수정했습니다.',
      );
    },

    addLocation: async (loc) => {
      const db = get().db;
      if (!db) return;
      const newLoc: CellarLocation = {
        ...loc,
        id: `loc_${generateId().slice(0, 8)}`,
        zone: loc.zone.trim(),
        shelf: loc.shelf.trim(),
        displayName: loc.displayName.trim(),
      };
      await commitMutation(
        { ...db, locations: [...db.locations, newLoc] },
        `선반 '${newLoc.displayName}'을 추가했습니다.`,
      );
    },

    updateLocation: async (id, patch) => {
      const db = get().db;
      if (!db) return;
      const nextLocations = db.locations.map((l) => (l.id === id ? { ...l, ...patch } : l));
      await commitMutation({ ...db, locations: nextLocations }, '선반 정보를 수정했습니다.');
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
      const nextBottles = recalculateExisting
        ? db.bottles.map((b) => ({
            ...b,
            includeInTrackingSince: shouldIncludeInTrackingSince(b.purchaseDate, newDate),
          }))
        : db.bottles;

      await commitMutation(
        {
          ...db,
          metadata: {
            ...db.metadata,
            trackingSinceDate: newDate,
          },
          bottles: nextBottles,
        },
        recalculateExisting
          ? `누적 지출 기준일을 ${newDate}로 변경하고 전체 병을 재계산했습니다.`
          : `누적 지출 기준일을 ${newDate}로 변경했습니다.`,
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
      if (state.storageMode === 'google_drive' && !isTokenValid()) {
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

        // 빈티지 구분 없이 동일 (와인명, 색상) 전체 빈티지에 라벨 1장을 공통 적용
        const targetGroupKey = buildWineLabelGroupKey(wine);
        const oldFileIds = new Set<string>();
        let sharedCount = 0;
        const now = new Date().toISOString();
        const nextWines = db.wines.map((w) => {
          if (buildWineLabelGroupKey(w) === targetGroupKey) {
            if (w.labelImageFileId && w.labelImageFileId !== fileId) {
              oldFileIds.add(w.labelImageFileId);
            }
            sharedCount += 1;
            return { ...w, labelImageFileId: fileId, updatedAt: now };
          }
          return w;
        });

        await commitMutation(
          { ...db, wines: nextWines },
          sharedCount > 1
            ? `라벨 사진을 등록해 동일 와인 ${sharedCount}개 빈티지에 공통 적용했습니다.`
            : '와인 라벨 사진을 등록했습니다.',
        );

        const stillReferenced = new Set(
          nextWines.map((w) => w.labelImageFileId).filter((id): id is string => Boolean(id)),
        );
        for (const oldId of oldFileIds) {
          if (!stillReferenced.has(oldId)) {
            void adapter.deletePhoto(oldId).catch(() => undefined);
            void evictPhotoFromCache(oldId);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '라벨 사진 업로드에 실패했습니다.';
        get().showToast(msg, 'error');
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
      await commitMutation({ ...db, wines: nextWines }, '라벨 사진을 삭제했습니다.');

      const stillReferenced = new Set(
        nextWines.map((w) => w.labelImageFileId).filter((id): id is string => Boolean(id)),
      );
      const adapter = getAdapter(state.storageMode);
      for (const oldFileId of removedFileIds) {
        if (!stillReferenced.has(oldFileId)) {
          if (state.storageMode === 'local_test' || isTokenValid()) {
            void adapter.deletePhoto(oldFileId).catch(() => undefined);
          }
          void evictPhotoFromCache(oldFileId);
        }
      }
    },

    uploadTastingPhoto: async (file) => {
      const state = get();
      if (state.storageMode === 'google_drive' && !isTokenValid()) {
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
        const msg = err instanceof Error ? err.message : '시음 사진 업로드에 실패했습니다.';
        get().showToast(msg, 'error');
        return null;
      }
    },

    deleteTastingPhotoFile: async (fileId) => {
      const state = get();
      const adapter = getAdapter(state.storageMode);
      if (state.storageMode === 'local_test' || isTokenValid()) {
        void adapter.deletePhoto(fileId).catch(() => undefined);
      }
      void evictPhotoFromCache(fileId);
    },

    importApprovedLabelsBundle: async (raw) => {
      const state = get();
      const db = state.db;
      if (!db) return { applied: 0, skipped: 0, failed: 0 };

      const bundle = parseApprovedLabelsBundle(raw);
      if (state.storageMode === 'google_drive' && !isTokenValid()) {
        set({ syncStatus: 'auth_required' });
        get().showToast(
          '라벨을 Google Drive에 일괄 업로드하려면 먼저 상단 [구글 재인증]을 눌러 주세요.',
          'warning',
        );
        return { applied: 0, skipped: 0, failed: bundle.items.length };
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
      const oldFileIdsToDelete = new Set<string>();
      let skipped = 0;
      let failed = 0;

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

          try {
            const { blob, extension } = dataUrlToBlob(item.dataUrl);
            const fileName = `label_${item.wineId.slice(0, 8)}_${Date.now()}_${idx}.${extension}`;
            const { fileId } = await adapter.uploadPhoto(blob, fileName);
            await registerUploadedPhotoBlob(fileId, blob);
            for (const targetWine of matchedWines.values()) {
              if (targetWine.labelImageFileId && targetWine.labelImageFileId !== fileId) {
                oldFileIdsToDelete.add(targetWine.labelImageFileId);
              }
              uploadedByWineId.set(targetWine.id, fileId);
            }
          } catch {
            failed += 1;
          }
        }

        const applied = uploadedByWineId.size;
        if (applied > 0) {
          const now = new Date().toISOString();
          const latestDb = get().db ?? db;
          const nextWines = latestDb.wines.map((w) => {
            const nextFileId = uploadedByWineId.get(w.id);
            return nextFileId ? { ...w, labelImageFileId: nextFileId, updatedAt: now } : w;
          });
          const summaryMsg =
            `승인된 라벨을 ${applied}개 와인(전체 빈티지 포함)에 일괄 적용했습니다.` +
            (skipped > 0 ? ` (미일치 ${skipped}건 제외)` : '') +
            (failed > 0 ? ` (실패 ${failed}건)` : '');
          await commitMutation({ ...latestDb, wines: nextWines }, summaryMsg);

          const stillReferenced = new Set(
            nextWines.map((w) => w.labelImageFileId).filter((id): id is string => Boolean(id)),
          );
          for (const oldId of oldFileIdsToDelete) {
            if (!stillReferenced.has(oldId)) {
              void adapter.deletePhoto(oldId).catch(() => undefined);
              void evictPhotoFromCache(oldId);
            }
          }
        } else {
          get().showToast(
            `적용된 라벨이 없습니다. (미일치 ${skipped}건 · 실패 ${failed}건)`,
            'warning',
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
