import { create } from 'zustand';
import type {
  BottleInstance,
  CellarLocation,
  TastingRecord,
  WineColor,
  WineDatabase,
  WineMaster,
} from '@/types/schema';
import { parseWineDatabase } from '@/types/validation';
import {
  clearAccessToken,
  hasGoogleClientId,
  isTokenValid,
  requestAccessToken,
} from '@/services/auth/googleAuth';
import {
  findMatchingWineMaster,
  formatBackupDateTimeStamp,
  generateId,
  getTodayIsoDate,
  shouldIncludeInTrackingSince,
} from '@/services/domain/wineHelpers';
import { createDemoDatabase, createEmptyDatabase } from '@/services/storage/defaultTemplates';
import { GoogleDriveAdapter } from '@/services/storage/googleDriveAdapter';
import { clearCachedState, loadCachedState, saveCachedState } from '@/services/storage/localCache';
import { LocalOnlyAdapter } from '@/services/storage/localOnlyAdapter';
import { syncEngine } from '@/services/storage/syncEngine';
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

export interface InventoryFilters {
  query: string;
  colors: WineColor[];
  country: string; // '' = 전체
  region: string; // '' = 전체
  subRegion: string; // '' = 전체
  zone: string; // '' = 전체, '__UNASSIGNED__' = 미지정
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
}

export interface ConsumeBottleInput {
  bottleId: string;
  type: 'CONSUMED' | 'GIFTED';
  eventDate: string | null;
  occasion?: string;
  memo?: string;
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
    patch: Partial<Pick<TastingRecord, 'eventDate' | 'occasion' | 'memo' | 'type'>>,
  ) => Promise<void>;
  addLocation: (loc: Omit<CellarLocation, 'id'>) => Promise<void>;
  updateLocation: (id: string, patch: Partial<Omit<CellarLocation, 'id'>>) => Promise<void>;
  deleteLocation: (id: string) => Promise<void>;
  updateTrackingSinceDate: (newDate: string, recalculateExisting: boolean) => Promise<void>;

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
      } else {
        wineId = generateId();
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
          labelImageFileId: null,
          drinkingWindowStart: null,
          drinkingWindowEnd: null,
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

    consumeOrGiftBottle: async ({ bottleId, type, eventDate, occasion, memo }) => {
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
