import { X } from 'lucide-react';
import { useEffect } from 'react';
import { usePhotoUrl } from '@/services/media/photoLoader';

interface PhotoLightboxProps {
  fileId: string | null;
  alt?: string;
  onClose: () => void;
}

export function PhotoLightbox({ fileId, alt = '와인 사진', onClose }: PhotoLightboxProps) {
  const url = usePhotoUrl(fileId);

  useEffect(() => {
    if (!fileId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fileId, onClose]);

  if (!fileId || !url) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
        aria-label="사진 닫기"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={url}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85dvh] max-w-[92vw] rounded-2xl object-contain shadow-2xl"
      />
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
        <button
          type="button"
          onClick={onClick}
          className="h-full w-full cursor-pointer overflow-hidden"
          title="클릭하여 확대"
        >
          <img src={url} alt={alt} className="h-full w-full object-cover" loading="lazy" />
        </button>
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
