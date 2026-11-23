import { AlertTriangle, CheckCircle2, CloudOff, FlaskConical, KeyRound, Loader2 } from 'lucide-react';
import { useWineStore } from '@/store/useWineStore';

export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const syncStatus = useWineStore((s) => s.syncStatus);
  const storageMode = useWineStore((s) => s.storageMode);
  const hasUnsyncedChanges = useWineStore((s) => s.hasUnsyncedChanges);
  const syncNow = useWineStore((s) => s.syncNow);
  const reauthenticateAndSync = useWineStore((s) => s.reauthenticateAndSync);

  const handleClick = () => {
    // R2 보강: 인증이 필요한 상태에서는 사용자 클릭 이벤트 콜스택에서 바로 GIS 팝업 호출
    if (syncStatus === 'auth_required' || syncStatus === 'offline_cache') {
      void reauthenticateAndSync();
    } else {
      void syncNow();
    }
  };

  if (storageMode === 'local_test') {
    return (
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs font-medium text-gold transition-colors hover:bg-gold/20"
        title="로컬 테스트 모드 (브라우저 IndexedDB 저장)"
      >
        <FlaskConical className="h-3.5 w-3.5" />
        {!compact && <span>로컬 테스트</span>}
      </button>
    );
  }

  const config = {
    synced: {
      icon: CheckCircle2,
      label: '동기화됨',
      cls: 'border-[var(--status-ok)]/30 bg-[var(--status-ok)]/10 text-[var(--status-ok)]',
      spin: false,
    },
    offline_cache: {
      icon: CloudOff,
      label: '오프라인 캐시',
      cls: 'border-subtle bg-elevated text-secondary',
      spin: false,
    },
    syncing: {
      icon: Loader2,
      label: '저장 중',
      cls: 'border-forest/30 bg-forest/10 text-forest',
      spin: true,
    },
    auth_required: {
      icon: KeyRound,
      label: hasUnsyncedChanges ? '재인증·저장 필요' : '재인증 필요',
      cls: 'border-[var(--status-warn)]/40 bg-[var(--status-warn)]/15 text-[var(--status-warn)]',
      spin: false,
    },
    conflict: {
      icon: AlertTriangle,
      label: '충돌 발생',
      cls: 'border-[var(--status-danger)]/40 bg-[var(--status-danger)]/15 text-[var(--status-danger)]',
      spin: false,
    },
    error: {
      icon: AlertTriangle,
      label: '동기화 오류',
      cls: 'border-[var(--status-danger)]/40 bg-[var(--status-danger)]/15 text-[var(--status-danger)]',
      spin: false,
    },
  }[syncStatus];

  const Icon = config.icon;

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-opacity hover:opacity-85 ${config.cls}`}
      title={`동기화 상태: ${config.label} (클릭하여 동기화 또는 재인증)`}
    >
      <Icon className={`h-3.5 w-3.5 ${config.spin ? 'animate-spin' : ''}`} />
      {!compact && <span>{config.label}</span>}
    </button>
  );
}
