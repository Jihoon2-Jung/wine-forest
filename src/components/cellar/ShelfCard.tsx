import { WINE_COLORS, type CellarLocation, type WineColor } from '@/types/schema';
import { getWineColorBorderCssVar, getWineColorCssVar } from '@/components/common/WineColorBadge';

interface ShelfCardProps {
  location: CellarLocation;
  colorCounts: Record<WineColor, number>;
  totalCount: number;
  compactRack?: boolean;
  onSelect: (location: CellarLocation) => void;
}

export function ShelfCard({
  location,
  colorCounts,
  totalCount,
  compactRack = false,
  onSelect,
}: ShelfCardProps) {
  const remain = location.maxCapacity - totalCount;
  const isOverflow = remain < 0;
  const isFull = remain === 0 && location.maxCapacity > 0;
  const barBase = Math.max(location.maxCapacity, totalCount, 1);

  const badgeClass = isOverflow
    ? 'bg-[var(--status-danger)]/15 text-[var(--status-danger)] border-[var(--status-danger)]/40'
    : isFull
      ? 'bg-elevated text-secondary border-subtle'
      : 'bg-[var(--status-ok)]/12 text-[var(--status-ok)] border-[var(--status-ok)]/30';

  const badgeLabel = isOverflow
    ? `초과 ${remain}`
    : isFull
      ? '만석'
      : `여유 +${remain}`;

  // 물리적 와인 셀러 선반 랙 스타일 (아래 1-1 -> 위 2-7/3-2 수직 적층)
  if (compactRack) {
    return (
      <button
        type="button"
        onClick={() => onSelect(location)}
        className={`group flex w-full items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 text-left transition-all hover:border-forest/55 hover:shadow-card ${
          isOverflow
            ? 'border-[var(--status-danger)]/45 bg-[var(--status-danger)]/[0.03]'
            : 'border-subtle'
        }`}
      >
        {/* 선반 번호 */}
        <div className="w-16 shrink-0">
          <span className="block text-xs font-extrabold tabular-nums text-primary group-hover:text-forest">
            {location.shelf === '기본' ? location.displayName : location.shelf}
          </span>
          <span className="block text-[10px] font-medium tabular-nums text-secondary">
            {totalCount}/{location.maxCapacity}병
          </span>
        </div>

        {/* InVintory 스타일 멀티 컬러 점유 바 + 색상별 미니 카운트 */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-elevated p-[1px]">
            {WINE_COLORS.map((c) => {
              const cnt = colorCounts[c] ?? 0;
              if (cnt === 0) return null;
              const widthPct = (cnt / barBase) * 100;
              return (
                <div
                  key={c}
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: getWineColorCssVar(c),
                    boxShadow: getWineColorBorderCssVar(c)
                      ? `inset 0 0 0 1px ${getWineColorBorderCssVar(c)}`
                      : undefined,
                  }}
                  title={`${c}: ${cnt}병`}
                  className="h-full first:rounded-l-full last:rounded-r-full transition-all"
                />
              );
            })}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-secondary tabular-nums">
            {totalCount === 0 ? (
              <span className="opacity-60">비어 있음</span>
            ) : (
              WINE_COLORS.map((c) => {
                const cnt = colorCounts[c] ?? 0;
                if (cnt === 0) return null;
                return (
                  <span key={c} className="inline-flex items-center gap-0.5 font-semibold">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: getWineColorCssVar(c) }}
                    />
                    {c} {cnt}
                  </span>
                );
              })
            )}
          </div>
        </div>

        {/* 잔여/초과 상태 배지 */}
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums ${badgeClass}`}
        >
          {badgeLabel}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(location)}
      className={`group flex w-full flex-col gap-2.5 rounded-2xl border bg-surface p-3.5 text-left shadow-card transition-all hover:border-forest/45 hover:shadow-card-hover ${
        isOverflow ? 'border-[var(--status-danger)]/40' : 'border-subtle'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-secondary">
            {location.zone}
          </span>
          <h3 className="truncate text-sm font-bold text-primary group-hover:text-forest">
            {location.displayName}
          </h3>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums ${badgeClass}`}
        >
          {badgeLabel}
        </span>
      </div>

      <div className="space-y-1.5">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-elevated">
          {WINE_COLORS.map((c) => {
            const cnt = colorCounts[c] ?? 0;
            if (cnt === 0) return null;
            const widthPct = (cnt / barBase) * 100;
            return (
              <div
                key={c}
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: getWineColorCssVar(c),
                }}
                title={`${c}: ${cnt}병`}
                className="h-full transition-all"
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[11px] text-secondary tabular-nums">
          <span>
            <strong className="text-primary">{totalCount}</strong> / {location.maxCapacity}병
          </span>
          <div className="flex items-center gap-1.5">
            {WINE_COLORS.map((c) => {
              const cnt = colorCounts[c] ?? 0;
              if (cnt === 0) return null;
              return (
                <span key={c} className="inline-flex items-center gap-0.5 text-[10px] font-semibold">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: getWineColorCssVar(c) }}
                  />
                  {cnt}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </button>
  );
}
