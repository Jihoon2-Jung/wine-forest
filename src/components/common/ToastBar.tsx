import { X } from 'lucide-react';
import { useWineStore } from '@/store/useWineStore';

export function ToastBar({ hasSidebar = false }: { hasSidebar?: boolean }) {
  const toast = useWineStore((s) => s.toast);
  const clearToast = useWineStore((s) => s.clearToast);

  if (!toast) return null;

  const toneStyle = {
    info: 'border-subtle bg-surface text-primary',
    success: 'border-status-ok/40 bg-surface text-primary',
    warning: 'border-status-warn/40 bg-surface text-primary',
    error: 'border-status-danger/40 bg-surface text-primary',
  }[toast.tone];

  const dotColor = {
    info: 'bg-forest',
    success: 'bg-status-ok',
    warning: 'bg-status-warn',
    error: 'bg-status-danger',
  }[toast.tone];

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] z-50 flex justify-center px-4 lg:bottom-6 ${
        hasSidebar ? 'lg:left-60' : ''
      }`}
    >
      <div
        className={`pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-medium shadow-card-hover ${toneStyle}`}
        role="status"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
        <span className="leading-snug">{toast.text}</span>
        <button
          type="button"
          onClick={clearToast}
          className="ml-1 shrink-0 rounded-full p-1 text-secondary hover:bg-elevated"
          aria-label="알림 닫기"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
