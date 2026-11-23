import type { WineColor } from '@/types/schema';
import { getWineColorBorderCssVar, getWineColorCssVar } from './WineColorBadge';

interface WineThumbnailProps {
  color: WineColor;
  vintage: string;
  labelImageFileId?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Phase 2 라벨 사진 예약 슬롯:
 * - labelImageFileId가 추후 연결되면 실제 라벨 이미지를 렌더링
 * - 1차 MVP에서는 와인 색상별 프리미엄 미니멀 보틀 실루엣 + 빈티지 워터마크 표시
 */
export function WineThumbnail({
  color,
  vintage,
  labelImageFileId,
  size = 'md',
}: WineThumbnailProps) {
  const accent = getWineColorCssVar(color);
  const bottleStroke = getWineColorBorderCssVar(color) ?? 'none';
  const dims =
    size === 'sm'
      ? 'w-11 h-16'
      : size === 'lg'
        ? 'w-16 h-24'
        : 'w-13 h-[74px]';

  // Phase 2 hook placeholder (URL resolution will plug in here)
  const hasPhoto = Boolean(labelImageFileId && labelImageFileId.startsWith('http'));

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-xl border border-subtle bg-elevated flex flex-col items-center justify-center select-none ${dims}`}
      style={{
        background: `linear-gradient(155deg, color-mix(in srgb, ${accent} 14%, var(--bg-elevated)), var(--bg-elevated))`,
      }}
    >
      {hasPhoto && labelImageFileId ? (
        <img
          src={labelImageFileId}
          alt="와인 라벨"
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <>
          <svg
            viewBox="0 0 36 72"
            className={size === 'sm' ? 'h-11 w-6' : size === 'lg' ? 'h-16 w-8' : 'h-13 w-7'}
            fill="none"
            aria-hidden="true"
          >
            {/* Bottle Neck */}
            <rect
              x="14"
              y="4"
              width="8"
              height="14"
              rx="2"
              fill={accent}
              stroke={bottleStroke}
              strokeWidth={color === 'W' ? '1.1' : '0'}
              opacity="0.95"
            />
            {/* Capsule Gold Ring */}
            <rect x="13.5" y="4" width="9" height="4.5" rx="1.2" fill="var(--brand-gold)" />
            {/* Bottle Body */}
            <path
              d="M14 18C14 23 8 25.5 8 32.5V63C8 65.8 10.2 68 13 68H23C25.8 68 28 65.8 28 63V32.5C28 25.5 22 23 22 18H14Z"
              fill={accent}
              stroke={bottleStroke}
              strokeWidth={color === 'W' ? '1.2' : '0'}
              opacity="0.95"
            />
            {/* Minimal Label */}
            <rect
              x="10.5"
              y="36"
              width="15"
              height="18"
              rx="1.8"
              fill="var(--bg-surface)"
              opacity="0.92"
            />
            <line x1="13" y1="42" x2="23" y2="42" stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
            <line
              x1="14.5"
              y1="46.5"
              x2="21.5"
              y2="46.5"
              stroke="var(--brand-gold)"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
          <span
            className="absolute bottom-1 rounded bg-surface/85 px-1 text-[9px] font-bold tracking-tight text-primary tabular-nums backdrop-blur-sm"
          >
            {vintage === 'NV' ? 'NV' : vintage.slice(2)}
          </span>
        </>
      )}
    </div>
  );
}
