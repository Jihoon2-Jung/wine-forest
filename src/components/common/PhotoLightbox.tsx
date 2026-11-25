import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { usePhotoUrl } from '@/services/media/photoLoader';
import { registerModalLayer } from './BottomSheet';

interface PhotoLightboxProps {
  fileId: string | null;
  alt?: string;
  onClose: () => void;
}

export function PhotoLightbox({ fileId, alt = '와인 사진', onClose }: PhotoLightboxProps) {
  const url = usePhotoUrl(fileId);
  const latestOnCloseRef = useRef(onClose);
  latestOnCloseRef.current = onClose;

  useEffect(() => {
    if (!fileId) return;
    return registerModalLayer(
      () => true,
      () => latestOnCloseRef.current(),
    );
  }, [fileId]);

  if (!fileId) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top,0px))] rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
        aria-label="사진 닫기"
      >
        <X className="h-5 w-5" />
      </button>
      {url ? (
        <img
          src={url}
          alt={alt}
          onClick={(e) => e.stopPropagation()}
          className="max-h-[85dvh] max-w-[92vw] rounded-2xl object-contain shadow-2xl"
        />
      ) : (
        <div
          onClick={(e) => e.stopPropagation()}
          className="rounded-2xl border border-subtle bg-surface px-5 py-4 text-center text-xs text-secondary shadow-2xl"
        >
          사진을 불러오는 중이거나 오프라인/재인증 필요 상태입니다.
        </div>
      )}
    </div>
  );
}

interface TastingPhotoThumbProps {
  fileId: string;
  alt?: string;
  onClick?: () => void;
  onRemove?: () => void;
}

export function TastingPhotoThumb({ fileId, alt = '시음 사진', onClick, onRemove }: TastingPhotoThumbProps) {
  const url = usePhotoUrl(fileId);

  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-subtle bg-elevated">
      {url ? (
        onClick ? (
          <button
            type="button"
            onClick={onClick}
            className="h-full w-full cursor-pointer overflow-hidden"
            title="클릭하여 확대"
          >
            <img src={url} alt={alt} className="h-full w-full object-cover" loading="lazy" />
          </button>
        ) : (
          <div className="h-full w-full overflow-hidden">
            <img src={url} alt={alt} className="h-full w-full object-cover" loading="lazy" />
          </div>
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] text-secondary">
          로딩중
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-1 top-1 rounded-full bg-black/65 p-0.5 text-white hover:bg-black"
          aria-label="사진 제거"
          title="사진 제거"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
