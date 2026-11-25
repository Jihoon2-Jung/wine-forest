import { BottomSheet } from './BottomSheet';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <BottomSheet
      open={open}
      onClose={busy ? () => undefined : onCancel}
      dismissible={!busy}
      title={title}
      maxWidthClass="md:max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-xl border border-subtle bg-elevated px-4 py-2 text-xs font-semibold text-primary hover:bg-surface disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm()}
            className={`rounded-xl px-4 py-2 text-xs font-bold text-white transition-colors disabled:opacity-50 ${
              tone === 'danger'
                ? 'bg-status-danger hover:opacity-90'
                : 'bg-forest hover:bg-forest-hover'
            }`}
          >
            {busy ? '처리 중...' : confirmLabel}
          </button>
        </div>
      }
    >
      <p className="whitespace-pre-line text-sm leading-relaxed text-secondary">{message}</p>
    </BottomSheet>
  );
}
