import {
  CalendarRange,
  Cloud,
  CloudDownload,
  Download,
  FlaskConical,
  HardDrive,
  History,
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
import { hasGoogleClientId, isTokenValid } from '@/services/auth/googleAuth';
import { useWineStore } from '@/store/useWineStore';
import { BottomSheet } from '@/components/common/BottomSheet';

export function SettingsPage() {
  const db = useWineStore((s) => s.db);
  const storageMode = useWineStore((s) => s.storageMode);
  const lastSyncedModifiedTime = useWineStore((s) => s.lastSyncedModifiedTime);
  const hasUnsyncedChanges = useWineStore((s) => s.hasUnsyncedChanges);
  const backups = useWineStore((s) => s.backups);
  const isLoadingBackups = useWineStore((s) => s.isLoadingBackups);

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
  const updateTrackingSinceDate = useWineStore((s) => s.updateTrackingSinceDate);
  const autoFillMissingDrinkingWindows = useWineStore((s) => s.autoFillMissingDrinkingWindows);
  const disconnectAndResetLocal = useWineStore((s) => s.disconnectAndResetLocal);
  const showToast = useWineStore((s) => s.showToast);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [trackingDate, setTrackingDate] = useState(db?.metadata.trackingSinceDate ?? '2023-02-18');
  const [recalcAll, setRecalcAll] = useState(false);

  useEffect(() => {
    if (db) {
      setTrackingDate(db.metadata.trackingSinceDate);
    }
  }, [db]);

  useEffect(() => {
    void fetchBackups();
  }, [fetchBackups, storageMode]);

  if (!db) return null;

  const clientIdReady = hasGoogleClientId();
  const tokenActive = isTokenValid();
  const missingDrinkingWindowCount = db.wines.filter(
    (w) => w.drinkingWindowStart == null && w.drinkingWindowEnd == null,
  ).length;

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm('선택한 wine_db.json 파일로 현재 DB 전체를 덮어쓸까요?')) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      await importJsonDatabase(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '유효하지 않은 JSON 형식입니다.';
      showToast(`가져오기 실패: ${msg}`, 'error');
    }
  };

  const handleRestore = async (fileId: string, name: string) => {
    if (
      window.confirm(
        `'${name}' 시점으로 복원할까요?\n현재 DB는 자동으로 pre_restore 백업에 대피 저장된 뒤 복원됩니다.`,
      )
    ) {
      await restoreFromBackup(fileId);
    }
  };

  const handleReset = async () => {
    if (
      window.confirm(
        '이 브라우저의 로컬 캐시와 연결 상태를 초기화하고 온보딩 화면으로 돌아갈까요?\n(Google Drive 파일은 삭제되지 않습니다.)',
      )
    ) {
      await disconnectAndResetLocal();
    }
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
                : tokenActive
                  ? 'bg-[var(--status-ok)]/15 text-[var(--status-ok)]'
                  : 'bg-elevated text-secondary'
            }`}
          >
            {storageMode === 'local_test'
              ? 'IndexedDB 로컬'
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
                onClick={() => void syncNow()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-forest px-3.5 py-2 text-xs font-bold text-white hover:bg-forest-hover"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>지금 동기화</span>
              </button>
              <button
                type="button"
                onClick={() => void reauthenticateAndSync()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-subtle bg-elevated px-3.5 py-2 text-xs font-bold text-primary hover:border-forest"
              >
                <KeyRound className="h-3.5 w-3.5 text-forest" />
                <span>구글 재인증</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() =>
              void switchStorageMode(storageMode === 'google_drive' ? 'local_test' : 'google_drive')
            }
            disabled={storageMode === 'local_test' && !clientIdReady}
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
              onClick={() => void fetchBackups()}
              className="rounded-xl border border-subtle bg-elevated px-3 py-2 text-xs font-semibold text-secondary hover:text-primary"
            >
              새로고침
            </button>
            <button
              type="button"
              onClick={() => void createManualBackup()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-forest px-3.5 py-2 text-xs font-bold text-white hover:bg-forest-hover"
            >
              <Save className="h-3.5 w-3.5" />
              <span>지금 수동 백업</span>
            </button>
          </div>
        </div>

        {isLoadingBackups ? (
          <div className="py-6 text-center text-xs text-secondary">백업 목록을 불러오는 중...</div>
        ) : storageMode === 'google_drive' && !tokenActive ? (
          <div className="flex flex-col items-center gap-2.5 rounded-xl border border-[var(--status-warn)]/35 bg-[var(--status-warn)]/10 px-4 py-5 text-center">
            <p className="text-xs font-semibold text-primary">
              구글 재인증 후 드라이브 백업 목록을 불러올 수 있습니다.
            </p>
            <button
              type="button"
              onClick={async () => {
                await reauthenticateAndSync();
                await fetchBackups();
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-forest px-3.5 py-2 text-xs font-bold text-white hover:bg-forest-hover"
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
          <code>기존 백업 도구</code>로 변환한 <code>wine_db.json</code>을 불러오거나 현재 DB를 로컬 파일로 저장합니다.
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
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void handleImportFile(e)}
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
            onClick={() => {
              if (
                window.confirm(
                  `음용 적기가 비어 있는 ${missingDrinkingWindowCount}종 와인에 지역·빈티지 기준 추천 연도를 일괄 채울까요?\n(이미 직접 입력한 와인은 덮어쓰지 않습니다.)`,
                )
              ) {
                void autoFillMissingDrinkingWindows();
              }
            }}
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
            onClick={() => void updateTrackingSinceDate(trackingDate, recalcAll)}
            className="rounded-xl bg-forest px-3.5 py-2 text-xs font-bold text-white hover:bg-forest-hover"
          >
            기준일 저장
          </button>
        </div>
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

      {/* 5. 로컬 캐시 초기화 */}
      <section className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--status-danger)]/30 bg-[var(--status-danger)]/5 p-4">
        <div>
          <h3 className="text-xs font-bold text-[var(--status-danger)]">로컬 캐시 초기화</h3>
          <p className="text-[11px] text-secondary">브라우저 캐시를 비우고 온보딩 화면으로 돌아갑니다.</p>
        </div>
        <button
          type="button"
          onClick={() => void handleReset()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--status-danger)]/40 bg-surface px-3 py-2 text-xs font-bold text-[var(--status-danger)] hover:bg-[var(--status-danger)] hover:text-white"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>초기화</span>
        </button>
      </section>

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
            onClick={() => void resolveModeSwitchConflict('use_remote')}
            className="flex w-full items-center gap-3 rounded-xl bg-forest px-4 py-3 text-left text-white hover:bg-forest-hover"
          >
            <CloudDownload className="h-5 w-5 shrink-0" />
            <div>
              <div className="text-sm font-bold">원격 Google Drive 데이터 불러오기 (권장)</div>
              <div className="text-xs opacity-90">현재 로컬 테스트 데이터를 교체하고 Drive 데이터로 전환합니다.</div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => void resolveModeSwitchConflict('overwrite_remote')}
            className="flex w-full items-center gap-3 rounded-xl border border-burgundy/40 bg-burgundy/10 px-4 py-3 text-left text-primary hover:bg-burgundy/15"
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
            onClick={() => void resolveModeSwitchConflict('cancel')}
            className="w-full rounded-xl border border-subtle bg-elevated py-2.5 text-xs font-bold text-secondary hover:text-primary"
          >
            취소 (로컬 테스트 모드 유지)
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
