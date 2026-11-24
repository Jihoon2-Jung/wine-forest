import { Star, X } from 'lucide-react';

interface StarRatingBadgeProps {
  rating: number | null | undefined;
  count?: number;
  size?: 'xs' | 'sm';
}

export function StarRatingBadge({ rating, count, size = 'xs' }: StarRatingBadgeProps) {
  if (rating === null || rating === undefined) return null;
  const isLegacyHundredScale = rating > 5;
  const formatted = isLegacyHundredScale
    ? `${Math.round(rating)}점`
    : Number.isInteger(rating)
      ? `${rating}.0`
      : rating.toFixed(1);
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full border border-gold/35 bg-gold/12 font-bold tabular-nums text-gold ${
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0.5 text-[11px]'
      }`}
      aria-label={`평점 ${isLegacyHundredScale ? formatted : `${formatted}점`}`}
    >
      <Star className={size === 'sm' ? 'h-3.5 w-3.5 fill-current' : 'h-3 w-3 fill-current'} />
      <span>{formatted}</span>
      {count !== undefined && <span className="opacity-75">({count})</span>}
    </span>
  );
}

interface StarRatingInputProps {
  value: number | null;
  onChange: (next: number | null) => void;
}

/**
 * 5.0점 만점, 0.5점 단위 별점 입력기 (모바일 원탭 친화)
 */
export function StarRatingInput({ value, onChange }: StarRatingInputProps) {
  const current = value ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-0.5" role="radiogroup" aria-label="와인 평점 (5점 만점)">
        {[1, 2, 3, 4, 5].map((starIndex) => {
          const halfVal = starIndex - 0.5;
          const fullVal = starIndex;
          const isFull = current >= fullVal;
          const isHalf = !isFull && current >= halfVal;

          return (
            <div key={starIndex} className="relative h-7 w-7">
              {/* 바탕 빈 별 */}
              <Star className="h-7 w-7 text-subtle" />
              {/* 채워진 별 (전체 또는 좌측 절반 클립) */}
              {(isFull || isHalf) && (
                <div
                  className="pointer-events-none absolute inset-0 overflow-hidden"
                  style={{ width: isFull ? '100%' : '50%' }}
                >
                  <Star className="h-7 w-7 fill-gold text-gold" />
                </div>
              )}
              {/* 좌측 0.5점 클릭 영역 */}
              <button
                type="button"
                onClick={() => onChange(value === halfVal ? null : halfVal)}
                className="absolute inset-y-0 left-0 w-1/2 cursor-pointer"
                aria-label={`${halfVal}점`}
                title={`${halfVal}점`}
              />
              {/* 우측 1.0점 클릭 영역 */}
              <button
                type="button"
                onClick={() => onChange(value === fullVal ? null : fullVal)}
                className="absolute inset-y-0 right-0 w-1/2 cursor-pointer"
                aria-label={`${fullVal}.0점`}
                title={`${fullVal}.0점`}
              />
            </div>
          );
        })}
      </div>

      <span className="min-w-[4.2rem] text-xs font-bold tabular-nums text-primary">
        {value !== null
          ? value > 5
            ? `${Math.round(value)}점 (100점제)`
            : `${value.toFixed(1)} / 5.0`
          : '미평가'}
      </span>

      {value !== null && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="inline-flex items-center gap-0.5 rounded-lg border border-subtle bg-surface px-2 py-1 text-[11px] font-semibold text-secondary hover:text-primary"
          aria-label="평점 초기화"
        >
          <X className="h-3 w-3" />
          <span>초기화</span>
        </button>
      )}
    </div>
  );
}
