import {
  CalendarRange,
  Cloud,
  CloudDownload,
  Download,
  FlaskConical,
  HardDrive,
  History,
  Images,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  UploadCloud,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  parseApprovedLabelsBundle,
  parseWineDatabase,
  type ApprovedLabelsBundle,
} from '@/types/validation';
import { buildWineLabelGroupKey } from '@/services/domain/wineHelpers';
import { isGoogleAuthConfigured, isNativeAuth, isTokenValid } from '@/services/auth/googleAuth';
import { useWineStore } from '@/store/useWineStore';
import { BottomSheet } from '@/components/common/BottomSheet';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

export function SettingsPage() {
  const db = useWineStore((s) => s.db);
  const storageMode = useWineStore((s) => s.storageMode);
  const syncStatus = useWineStore((s) => s.syncStatus);
  const googleConnected = useWineStore((s) => s.googleConnected);
  const authRevision = useWineStore((s) => s.authRevision);
  const authUserEmail = useWineStore((s) => s.authUserEmail);
  const lastSyncedModifiedTime = useWineStore((s) => s.lastSyncedModifiedTime);
  const hasUnsyncedChanges = useWineStore((s) => s.hasUnsyncedChanges);
  const backups = useWineStore((s) => s.backups);
  const isLoadingBackups = useWineStore((s) => s.isLoadingBackups);
  const bulkLabelProgress = useWineStore((s) => s.bulkLabelProgress);

  const syncNow = useWineStore((s) => s.syncNow);
  const reauthenticateAndSync = useWineStore((s) => s.reauthenticateAndSync);
  const switchStorageMode = useWineStore((s) => s.switchStorageMode);
  const modeSwitchConflict = useWineStore((s) => s.modeSwitchConflict);
  const resolveModeSwitchConflict = useWineStore((s) => s.resolveModeSwitchConflict);
  const fetchBackups = useWineStore((s) => s.fetchBackups);
  const createManualBackup = useWineStore((s) => s.createManualBackup);
  const restoreFromBackup = useWineStore((s) => s.restoreFromBackup);
  const exportLocalJson = useWineStore((s) => s.exportLocalJson);
  const importJsonDatabase = useWineStore((s) => s.importJsonDatabase);
  const importApprovedLabelsBundle = useWineStore((s) => s.importApprovedLabelsBundle);
  const updateTrackingSinceDate = useWineStore((s) => s.updateTrackingSinceDate);
  const autoFillMissingDrinkingWindows = useWineStore((s) => s.autoFillMissingDrinkingWindows);
  const disconnectAndResetLocal = useWineStore((s) => s.disconnectAndResetLocal);
  const showToast = useWineStore((s) => s.showToast);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const labelsBundleInputRef = useRef<HTMLInputElement>(null);
  const [trackingDate, setTrackingDate] = useState(db?.metadata.trackingSinceDate ?? '2023-02-18');
  const [recalcAll, setRecalcAll] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [pendingLabelImport, setPendingLabelImport] = useState<{
    bundle: ApprovedLabelsBundle;
    overlapCount: number;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    tone?: 'primary' | 'danger';
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const dbTrackingSinceDate = db?.metadata.trackingSinceDate;
  useEffect(() => {
    if (dbTrackingSinceDate) {
      setTrackingDate(dbTrackingSinceDate);
    }
  }, [dbTrackingSinceDate]);

  useEffect(() => {
    void fetchBackups();
  }, [fetchBackups, storageMode, authRevision]);

  if (!db) return null;

  const clientIdReady = isGoogleAuthConfigured();
  const nativeMode = isNativeAuth();
  const tokenActive = isTokenValid();
  const nativeAutoRefreshReady =
    nativeMode && syncStatus !== 'auth_required' && (tokenActive || googleConnected);
  const missingDrinkingWindowCount = db.wines.filter(
    (w) => w.drinkingWindowStart == null && w.drinkingWindowEnd == null,
  ).length;
  const isTrackingDateValid = /^\d{4}-\d{2}-\d{2}$/.test(trackingDate);

  const runAction = async (fn: () => Promise<void>) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await fn();
    } finally {
      setActionBusy(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const validated = parseWineDatabase(parsed);
      setConfirmDialog({
        title: 'JSON 파일로 DB 덮어쓰기',
        message: `선택한 '${file.name}' (와인 ${validated.wines.length}종 · 병 ${validated.bottles.length}개)로 현재 DB 전체를 덮어쓸까요?`,
        confirmLabel: '덮어쓰기',
        tone: 'danger',
        onConfirm: async () => {
          await importJsonDatabase(validated);
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '유효하지 않은 JSON 형식입니다.';
      showToast(`가져오기 실패: ${msg}`, 'error');
    }
  };

  const handleImportLabelsBundle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const bundle = parseApprovedLabelsBundle(parsed);

      // 이미 라벨이 등록된 와인이 포함되어 있는지 사전 확인
      const wineById = new Map(db.wines.map((w) => [w.id, w]));
      const hasLabelByGroup = new Set(
        db.wines.filter((w) => Boolean(w.labelImageFileId)).map((w) => buildWineLabelGroupKey(w)),
      );
      let existingOverlapCount = 0;
      for (const item of bundle.items) {
        const ids = item.wineIds && item.wineIds.length > 0 ? item.wineIds : [item.wineId];
        const matchedExisting = ids.some((id) => {
          const w = wineById.get(id);
          return Boolean(w && (w.labelImageFileId || hasLabelByGroup.has(buildWineLabelGroupKey(w))));
        });
        const matchedByName =
          !matchedExisting &&
          Boolean(
            item.wineName &&
              item.color &&
              hasLabelByGroup.has(buildWineLabelGroupKey({ name: item.wineName, color: item.color })),
          );
        if (matchedExisting || matchedByName) {
          existingOverlapCount += 1;
        }
      }

      if (existingOverlapCount > 0) {
        setPendingLabelImport({ bundle, overlapCount: existingOverlapCount });
        return;
      }

      await importApprovedLabelsBundle(bundle, { overwriteExisting: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '유효하지 않은 승인 라벨 번들 형식입니다.';
      showToast(`라벨 일괄 적용 실패: ${msg}`, 'error');
    }
  };

  const handleConfirmLabelImport = async (choice: 'skip_existing' | 'overwrite_all' | 'cancel') => {
    const pending = pendingLabelImport;
    setPendingLabelImport(null);
    if (!pending || choice === 'cancel') return;
    await importApprovedLabelsBundle(pending.bundle, {
      overwriteExisting: choice === 'overwrite_all',
    });
  };

  const handleRestore = (fileId: string, name: string) => {
    setConfirmDialog({
      title: '백업 스냅샷 복원',
      message: `'${name}' 시점으로 복원할까요?\n현재 DB는 자동으로 pre_restore 백업에 대피 저장된 뒤 복원됩니다.`,
      confirmLabel: '복원',
      tone: 'primary',
      onConfirm: async () => {
        await restoreFromBackup(fileId);
      },
    });
  };

  const handleReset = () => {
    setConfirmDialog({
      title: '로컬 캐시 초기화',
      message:
        '이 기기의 로컬 캐시와 연결 상태를 초기화하고 온보딩 화면으로 돌아갈까요?\n(Google Drive 파일은 삭제되지 않습니다.)',
      confirmLabel: '초기화',
      tone: 'danger',
      onConfirm: async () => {
        await disconnectAndResetLocal();
      },
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="rounded-2xl border border-subtle bg-surface px-4 py-3.5 shadow-card">
        <h2 className="text-base font-bold text-primary">설정 · 동기화 · 백업</h2>
        <p className="text-xs text-secondary">저장소 모드, Google Drive 동기화, 주간 스냅샷 복원 및 JSON 관리</p>
      </div>

      {/* 1. 저장소 모드 & 동기화 상태 */}
      <section className="space-y-4 rounded-2xl border border-subtle bg-surface p-5 shadow-card">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {storageMode === 'google_drive' ? (
              <Cloud className="h-5 w-5 text-forest" />
            ) : (
              <FlaskConical className="h-5 w-5 text-gold" />
            )}
            <div>
              <h3 className="text-sm font-bold text-primary">
                {storageMode === 'google_drive' ? 'Google Drive 동기화 모드' : '로컬 테스트 모드'}
              </h3>
              {storageMode === 'google_drive' && authUserEmail && (
                <p className="text-[11px] font-medium text-forest">{authUserEmail}</p>
              )}
              <p className="text-xs text-secondary tabular-nums">
                마지막 저장:{' '}
                {lastSyncedModifiedTime
                  ? new Date(lastSyncedModifiedTime).toLocaleString('ko-KR')
                  : '아직 없음'}
                {db.metadata.deviceLabel ? ` (${db.metadata.deviceLabel})` : ''}
                {hasUnsyncedChanges ? ' · 미동기화 변경 있음' : ''}
              </p>
            </div>
          </div>

          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
              storageMode === 'local_test'
                ? 'bg-gold/15 text-gold'
                : tokenActive || nativeAutoRefreshReady
                  ? 'bg-status-ok/15 text-status-ok'
                  : 'bg-elevated text-secondary'
            }`}
          >
            {storageMode === 'local_test'
              ? 'IndexedDB 로컬'
              : nativeAutoRefreshReady
                ? '모바일 자동 갱신 활성'
                : tokenActive
                  ? '토큰 유효'
                  : '재인증 필요'}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {storageMode === 'google_drive' && (
            <>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void runAction(syncNow)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-forest px-3.5 py-2 text-xs font-bold text-white hover:bg-forest-hover disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>지금 동기화</span>
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void runAction(reauthenticateAndSync)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-subtle bg-elevated px-3.5 py-2 text-xs font-bold text-primary hover:border-forest disabled:opacity-50"
              >
                <KeyRound className="h-3.5 w-3.5 text-forest" />
                <span>구글 재인증</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() =>
              void runAction(() =>
                switchStorageMode(storageMode === 'google_drive' ? 'local_test' : 'google_drive'),
              )
            }
            disabled={actionBusy || (storageMode === 'local_test' && !clientIdReady)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-subtle bg-elevated px-3.5 py-2 text-xs font-semibold text-secondary hover:text-primary disabled:opacity-45"
          >
            <HardDrive className="h-3.5 w-3.5" />
            <span>
              {storageMode === 'google_drive'
                ? '로컬 테스트 모드로 전환'
                : clientIdReady
                  ? 'Google Drive 모드로 전환'
                  : 'Google Drive (Client ID 미설정)'}
            </span>
          </button>
        </div>
      </section>

      {/* 2. 주간 자동 백업 & 스냅샷 복원 */}
      <section className="space-y-3.5 rounded-2xl border border-subtle bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-primary">
              <History className="h-4 w-4 text-forest" />
              <span>백업 스냅샷 관리 (7일 자동 + 수동)</span>
            </h3>
            <p className="mt-0.5 text-xs text-secondary tabular-nums">
              마지막 백업:{' '}
              {db.metadata.lastBackupAt
                ? new Date(db.metadata.lastBackupAt).toLocaleString('ko-KR')
                : '아직 생성되지 않음'}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void runAction(fetchBackups)}
              className="rounded-xl border border-subtle bg-elevated px-3 py-2 text-xs font-semibold text-secondary hover:text-primary disabled:opacity-50"
            >
              새로고침
            </button>
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void runAction(createManualBackup)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-forest px-3.5 py-2 text-xs font-bold text-white hover:bg-forest-hover disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              <span>지금 수동 백업</span>
            </button>
          </div>
        </div>

        {isLoadingBackups ? (
          <div className="py-6 text-center text-xs text-secondary">백업 목록을 불러오는 중...</div>
        ) : storageMode === 'google_drive' && !tokenActive && !nativeAutoRefreshReady ? (
          <div className="flex flex-col items-center gap-2.5 rounded-xl border border-status-warn/35 bg-status-warn/10 px-4 py-5 text-center">
            <p className="text-xs font-semibold text-primary">
              구글 재인증 후 드라이브 백업 목록을 불러올 수 있습니다.
            </p>
            <button
              type="button"
              disabled={actionBusy}
              onClick={() =>
                void runAction(async () => {
                  await reauthenticateAndSync();
                  await fetchBackups();
                })
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-forest px-3.5 py-2 text-xs font-bold text-white hover:bg-forest-hover disabled:opacity-50"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>구글 재인증 후 백업 조회</span>
            </button>
          </div>
        ) : backups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-subtle py-6 text-center text-xs text-secondary">
            저장된 백업 스냅샷이 없습니다.
          </div>
        ) : (
          <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
            {backups.map((b) => (
              <div
                key={b.fileId}
                className="flex items-center justify-between gap-2 rounded-xl border border-subtle bg-elevated/50 px-3.5 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <div className="truncate font-bold text-primary">{b.name}</div>
                  <div className="text-[11px] text-secondary tabular-nums">
                    {b.createdTime ? new Date(b.createdTime).toLocaleString('ko-KR') : ''}
                    {b.sizeBytes ? ` · ${(b.sizeBytes / 1024).toFixed(1)} KB` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRestore(b.fileId, b.name)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-subtle bg-surface px-2.5 py-1.5 text-xs font-bold text-forest hover:border-forest"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>복원</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 3. 로컬 JSON 내보내기 / 가져오기 */}
      <section className="space-y-3 rounded-2xl border border-subtle bg-surface p-5 shadow-card">
        <h3 className="text-sm font-bold text-primary">JSON 데이터 내보내기 / 가져오기</h3>
        <p className="text-xs text-secondary">
          기존 백업 <code>wine_db.json</code>을 불러오거나 현재 DB를 로컬 파일로 저장합니다.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportLocalJson}
            className="inline-flex items-center gap-1.5 rounded-xl border border-subtle bg-elevated px-3.5 py-2 text-xs font-bold text-primary hover:border-forest"
          >
            <Download className="h-3.5 w-3.5 text-forest" />
            <span>로컬 JSON 내보내기</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-subtle bg-elevated px-3.5 py-2 text-xs font-bold text-primary hover:border-burgundy"
          >
            <Upload className="h-3.5 w-3.5 text-burgundy" />
            <span>JSON 파일로 덮어쓰기 (Import)</span>
          </button>
          <button
            type="button"
            disabled={Boolean(bulkLabelProgress)}
            onClick={() => labelsBundleInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-subtle bg-elevated px-3.5 py-2 text-xs font-bold text-primary hover:border-forest disabled:opacity-50"
          >
            <Images className="h-3.5 w-3.5 text-forest" />
            <span>
              {bulkLabelProgress
                ? `라벨 업로드 중... (${bulkLabelProgress.current}/${bulkLabelProgress.total})`
                : '승인된 라벨 일괄 적용 (approved_labels.json)'}
            </span>
          </button>
        </div>
        <p className="text-[11px] text-secondary">
          PC에서 <code>scripts/label_review_tool.py</code>로 검수·승인한 <code>approved_labels.json</code>을 올리면 Google Drive(<code>photos/</code>)에 일괄 업로드됩니다.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json,text/plain,*/*"
          className="hidden"
          onChange={(e) => void handleImportFile(e)}
        />
        <input
          ref={labelsBundleInputRef}
          type="file"
          accept=".json,application/json,text/plain,*/*"
          className="hidden"
          onChange={(e) => void handleImportLabelsBundle(e)}
        />
      </section>

      {/* 4. 음용 적기 일괄 자동 채우기 (지역·빈티지 기준표) */}
      <section className="space-y-3 rounded-2xl border border-subtle bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-primary">
              <Sparkles className="h-4 w-4 text-forest" />
              <span>음용 적기(Drinking Window) 일괄 자동 채우기</span>
            </h3>
            <p className="mt-0.5 text-xs text-secondary tabular-nums">
              Wine Spectator · Wine Advocate 지역·빈티지 기준표로 미입력 와인({missingDrinkingWindowCount}종)의 시작~종료 연도를 자동 채웁니다. (이미 입력된 와인은 유지)
            </p>
          </div>
          <button
            type="button"
            disabled={missingDrinkingWindowCount === 0}
            onClick={() =>
              setConfirmDialog({
                title: '음용 적기 일괄 자동 채우기',
                message: `음용 적기가 비어 있는 ${missingDrinkingWindowCount}종 와인에 지역·빈티지 기준 추천 연도를 일괄 채울까요?\n(이미 직접 입력한 와인은 덮어쓰지 않습니다.)`,
                confirmLabel: '자동 채우기',
                tone: 'primary',
                onConfirm: async () => {
                  await autoFillMissingDrinkingWindows();
                },
              })
            }
            className="inline-flex items-center gap-1.5 rounded-xl bg-forest px-3.5 py-2 text-xs font-bold text-white hover:bg-forest-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              {missingDrinkingWindowCount > 0
                ? `미입력 ${missingDrinkingWindowCount}종 자동 채우기`
                : '모두 입력됨'}
            </span>
          </button>
        </div>
      </section>

      {/* 5. 누적 지출 기준일 설정 */}
      <section className="space-y-3 rounded-2xl border border-subtle bg-surface p-5 shadow-card">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-primary">
          <CalendarRange className="h-4 w-4 text-forest" />
          <span>누적 지출 기준일 (From_230218)</span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={trackingDate}
            onChange={(e) => setTrackingDate(e.target.value)}
            className="rounded-xl border border-subtle bg-elevated px-3 py-2 text-xs font-bold tabular-nums text-primary"
          />
          <button
            type="button"
            disabled={actionBusy || !isTrackingDateValid}
            onClick={() => void runAction(() => updateTrackingSinceDate(trackingDate, recalcAll))}
            className="rounded-xl bg-forest px-3.5 py-2 text-xs font-bold text-white hover:bg-forest-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            기준일 저장
          </button>
        </div>
        {!isTrackingDateValid && (
          <p className="text-[11px] font-semibold text-status-danger">
            유효한 날짜(YYYY-MM-DD)를 입력해 주세요.
          </p>
        )}
        <label className="flex items-center gap-2 text-xs text-secondary">
          <input
            type="checkbox"
            checked={recalcAll}
            onChange={(e) => setRecalcAll(e.target.checked)}
            className="accent-forest"
          />
          <span>저장 시 기존 모든 병의 포함 여부(includeInTrackingSince)를 새 기준일로 일괄 재계산</span>
        </label>
      </section>

      {/* 6. 로컬 캐시 초기화 */}
      <section className="flex items-center justify-between gap-3 rounded-2xl border border-status-danger/30 bg-status-danger/5 p-4">
        <div>
          <h3 className="text-xs font-bold text-status-danger">로컬 캐시 초기화</h3>
          <p className="text-[11px] text-secondary">기기 로컬 캐시를 비우고 온보딩 화면으로 돌아갑니다.</p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-status-danger/40 bg-surface px-3 py-2 text-xs font-bold text-status-danger hover:bg-status-danger hover:text-white"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>초기화</span>
        </button>
      </section>

      {/* 승인 라벨 일괄 적용 시 기존 라벨 중복 처리 3버튼 확인 모달 */}
      <BottomSheet
        open={Boolean(pendingLabelImport)}
        onClose={() => void handleConfirmLabelImport('cancel')}
        title="이미 라벨이 등록된 와인이 포함되어 있습니다"
        subtitle={
          pendingLabelImport
            ? `총 ${pendingLabelImport.bundle.items.length}건 중 ${pendingLabelImport.overlapCount}건은 이미 라벨이 등록되어 있습니다.`
            : undefined
        }
      >
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => void handleConfirmLabelImport('skip_existing')}
            className="flex w-full items-center gap-3 rounded-xl bg-forest px-4 py-3 text-left text-white hover:bg-forest-hover"
          >
            <Images className="h-5 w-5 shrink-0" />
            <div>
              <div className="text-sm font-bold">미등록 와인만 새로 적용 (권장)</div>
              <div className="text-xs opacity-90">
                기존 라벨 {pendingLabelImport?.overlapCount ?? 0}건은 유지하고 라벨이 없는 와인만 업로드합니다.
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => void handleConfirmLabelImport('overwrite_all')}
            className="flex w-full items-center gap-3 rounded-xl border border-burgundy/40 bg-burgundy/10 px-4 py-3 text-left text-primary hover:bg-burgundy/15"
          >
            <UploadCloud className="h-5 w-5 shrink-0 text-burgundy" />
            <div>
              <div className="text-sm font-bold text-burgundy">기존 라벨도 새 이미지로 덮어쓰기</div>
              <div className="text-xs text-secondary">
                기존 라벨 파일을 새 이미지로 교체하며, 더 이상 쓰이지 않는 이전 파일은 자동 삭제됩니다.
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => void handleConfirmLabelImport('cancel')}
            className="w-full rounded-xl border border-subtle bg-elevated py-2.5 text-xs font-bold text-secondary hover:text-primary"
          >
            업로드 취소
          </button>
        </div>
      </BottomSheet>

      {/* T5 보강: 로컬 → Google Drive 전환 시 기존 Drive 파일 존재 확인 모달 */}
      <BottomSheet
        open={Boolean(modeSwitchConflict)}
        onClose={() => void resolveModeSwitchConflict('cancel')}
        title="Google Drive에 기존 데이터가 있습니다"
        subtitle="로컬 테스트 데이터와 원격 Drive 파일 중 어느 쪽을 사용할지 선택해 주세요."
      >
        <div className="space-y-3">
          {modeSwitchConflict && (
            <p className="rounded-xl bg-elevated px-3.5 py-2.5 text-xs text-secondary tabular-nums">
              원격 Drive 마지막 수정:{' '}
              <strong className="text-primary">
                {new Date(modeSwitchConflict.remoteModifiedTime).toLocaleString('ko-KR')}
              </strong>
            </p>
          )}
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => void runAction(() => resolveModeSwitchConflict('use_remote'))}
            className="flex w-full items-center gap-3 rounded-xl bg-forest px-4 py-3 text-left text-white hover:bg-forest-hover disabled:opacity-50"
          >
            <CloudDownload className="h-5 w-5 shrink-0" />
            <div>
              <div className="text-sm font-bold">원격 Google Drive 데이터 불러오기 (권장)</div>
              <div className="text-xs opacity-90">현재 로컬 테스트 데이터를 교체하고 Drive 데이터로 전환합니다.</div>
            </div>
          </button>
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => void runAction(() => resolveModeSwitchConflict('overwrite_remote'))}
            className="flex w-full items-center gap-3 rounded-xl border border-burgundy/40 bg-burgundy/10 px-4 py-3 text-left text-primary hover:bg-burgundy/15 disabled:opacity-50"
          >
            <UploadCloud className="h-5 w-5 shrink-0 text-burgundy" />
            <div>
              <div className="text-sm font-bold text-burgundy">현재 로컬 데이터로 Drive 덮어쓰기</div>
              <div className="text-xs text-secondary">
                기존 Drive 파일을 <code>backups/wine_db_conflict_*.json</code>으로 먼저 자동 대피 백업한 뒤 업로드합니다.
              </div>
            </div>
          </button>
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => void runAction(() => resolveModeSwitchConflict('cancel'))}
            className="w-full rounded-xl border border-subtle bg-elevated py-2.5 text-xs font-bold text-secondary hover:text-primary disabled:opacity-50"
          >
            취소 (로컬 테스트 모드 유지)
          </button>
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title ?? ''}
        message={confirmDialog?.message ?? ''}
        confirmLabel={confirmDialog?.confirmLabel}
        tone={confirmDialog?.tone}
        busy={confirmBusy}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={async () => {
          if (!confirmDialog || confirmBusy) return;
          setConfirmBusy(true);
          try {
            await confirmDialog.onConfirm();
            setConfirmDialog(null);
          } finally {
            setConfirmBusy(false);
          }
        }}
      />
    </div>
  );
}
