import { AlertTriangle, CloudDownload, Download, UploadCloud } from 'lucide-react';
import { useWineStore } from '@/store/useWineStore';
import { BottomSheet } from './BottomSheet';

export function ConflictModal() {
  const conflict = useWineStore((s) => s.conflict);
  const resolveConflict = useWineStore((s) => s.resolveConflict);

  if (!conflict) return null;

  const formatTs = (ts: string | null) => {
    if (!ts) return '기록 없음';
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('ko-KR');
  };

  return (
    <BottomSheet
      open={Boolean(conflict)}
      onClose={() => undefined}
      title="데이터 동기화 충돌이 감지되었습니다"
      subtitle="다른 기기에서 wine_db.json이 먼저 수정되었습니다."
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--status-danger)]/30 bg-[var(--status-danger)]/10 p-3.5 text-sm text-primary">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--status-danger)]" />
            <div className="space-y-1 text-xs leading-relaxed">
              <p className="font-semibold">덮어쓰기 방지를 위해 자동 저장이 중단되었습니다.</p>
              <p className="text-secondary tabular-nums">
                내 마지막 동기화: <strong className="text-primary">{formatTs(conflict.expectedModifiedTime)}</strong>
              </p>
              <p className="text-secondary tabular-nums">
                Google Drive 최신: <strong className="text-primary">{formatTs(conflict.remoteModifiedTime)}</strong>
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => void resolveConflict('pull_remote')}
            className="flex w-full items-center gap-3 rounded-xl bg-forest px-4 py-3 text-left text-white transition-colors hover:bg-forest-hover"
          >
            <CloudDownload className="h-5 w-5 shrink-0" />
            <div>
              <div className="text-sm font-bold">원격 최신본 불러오기 (권장)</div>
              <div className="text-xs opacity-90">방금 시도한 로컬 변경을 취소하고 Drive 최신 데이터로 맞춥니다.</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => void resolveConflict('force_overwrite')}
            className="flex w-full items-center gap-3 rounded-xl border border-burgundy/40 bg-burgundy/10 px-4 py-3 text-left text-primary transition-colors hover:bg-burgundy/15"
          >
            <UploadCloud className="h-5 w-5 shrink-0 text-burgundy" />
            <div>
              <div className="text-sm font-bold text-burgundy">내 변경으로 덮어쓰기</div>
              <div className="text-xs text-secondary">
                원격 파일을 <code className="text-[11px]">backups/wine_db_conflict_*.json</code>으로 먼저 자동 대피 백업한 뒤 저장합니다.
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => void resolveConflict('download_local')}
            className="flex w-full items-center gap-3 rounded-xl border border-subtle bg-elevated px-4 py-3 text-left text-primary transition-colors hover:bg-surface"
          >
            <Download className="h-5 w-5 shrink-0 text-secondary" />
            <div>
              <div className="text-sm font-semibold">내 데이터 로컬 JSON 다운로드</div>
              <div className="text-xs text-secondary">현재 화면의 로컬 데이터를 PC/폰에 별도 파일로 보관합니다.</div>
            </div>
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
