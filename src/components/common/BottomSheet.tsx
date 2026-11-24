import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { registerModalCloser } from '@/services/native/nativeBridge';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  maxWidthClass?: string;
  dismissible?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}

export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  maxWidthClass = 'md:max-w-xl',
  dismissible = true,
  children,
  footer,
}: BottomSheetProps) {
  const sheetId = useId();
  const latestOnCloseRef = useRef(onClose);
  latestOnCloseRef.current = onClose;

  useEffect(() => {
    if (!open || !dismissible) return;
    return registerModalCloser(`sheet-${sheetId}`, () => latestOnCloseRef.current());
  }, [open, dismissible, sheetId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        latestOnCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, dismissible]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity"
        onClick={dismissible ? () => latestOnCloseRef.current() : undefined}
      />

      {/* Sheet / Dialog Panel */}
      <div
        className={`relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-subtle bg-surface shadow-sheet md:max-h-[88dvh] md:rounded-2xl ${maxWidthClass}`}
      >
        {/* Mobile Handle */}
        <div className="flex justify-center pt-2.5 pb-1 md:hidden">
          <div className="h-1 w-10 rounded-full bg-subtle" />
        </div>

        {/* Header */}
        {(title || subtitle) && (
          <div className="flex items-start justify-between gap-3 border-b border-subtle px-5 py-3.5">
            <div className="min-w-0">
              {title && (
                <h2 className="truncate text-base font-bold text-primary md:text-lg">{title}</h2>
              )}
              {subtitle && (
                <p className="mt-0.5 truncate text-xs text-secondary">{subtitle}</p>
              )}
            </div>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-full p-1.5 text-secondary hover:bg-elevated hover:text-primary transition-colors"
                aria-label="닫기"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div
          className={
            footer
              ? 'flex-1 overflow-y-auto px-5 py-4'
              : 'flex-1 overflow-y-auto px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]'
          }
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="border-t border-subtle bg-surface px-5 py-3.5 pb-safe">{footer}</div>
        )}
      </div>
    </div>
  );
}
