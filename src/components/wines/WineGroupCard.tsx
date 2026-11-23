import { MapPin, Wine } from 'lucide-react';
import type { BottleInstance, WineMaster } from '@/types/schema';
import { calculateWineGroupPrice } from '@/services/analytics/statsCalculator';
import { formatBottleSizeBadge, formatWineOrigin } from '@/services/domain/wineHelpers';
import { useWineStore } from '@/store/useWineStore';
import { PriceText } from '@/components/common/PriceText';
import { WineColorBadge } from '@/components/common/WineColorBadge';
import { WineThumbnail } from '@/components/common/WineThumbnail';

export interface WineGroupItem {
  wine: WineMaster;
  inStockBottles: BottleInstance[];
  allBottles: BottleInstance[];
  locationSummary: string;
  latestPurchaseDate: string;
}

interface WineGroupCardProps {
  group: WineGroupItem;
  compact?: boolean;
  onOpenDetail: (wineId: string) => void;
  onQuickConsume: (group: WineGroupItem) => void;
}

export function WineGroupCard({
  group,
  compact = false,
  onOpenDetail,
  onQuickConsume,
}: WineGroupCardProps) {
  const { wine, inStockBottles, locationSummary } = group;
  const isPrivacyMode = useWineStore((s) => s.isPrivacyMode);
  const count = inStockBottles.length;
  const priceStats = calculateWineGroupPrice(
    count > 0 ? inStockBottles : group.allBottles,
  );
  const sizeBadge = formatBottleSizeBadge(wine.bottleSizeMl);

  if (compact) {
    return (
      <div
        onClick={() => onOpenDetail(wine.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenDetail(wine.id);
          }
        }}
        className="group flex cursor-pointer items-center gap-3 rounded-xl border border-subtle bg-surface px-3.5 py-2.5 shadow-card transition-all hover:border-forest/40 hover:shadow-card-hover"
      >
        <WineColorBadge color={wine.color} />
        <span className="w-11 shrink-0 font-serif text-xs font-bold tabular-nums text-gold">
          {wine.vintage}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold text-primary group-hover:text-forest">
              {wine.name}
            </span>
            {sizeBadge && (
              <span className="shrink-0 rounded bg-elevated px-1.5 py-0.5 text-[10px] font-semibold text-secondary">
                {sizeBadge}
              </span>
            )}
          </div>
          <div className="truncate text-[11px] text-secondary">
            {formatWineOrigin(wine)} · {locationSummary}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <PriceText
            value={priceStats.avgPrice}
            prefix={priceStats.isUniform ? '' : '평균 '}
            className="block text-xs font-bold text-primary"
          />
        </div>
        <span
          className={`shrink-0 rounded-lg px-2 py-1 text-xs font-extrabold tabular-nums ${
            count > 0
              ? 'bg-forest/12 text-forest'
              : 'bg-elevated text-secondary'
          }`}
        >
          ×{count}
        </span>
        {count > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onQuickConsume(group);
            }}
            className="shrink-0 rounded-lg bg-burgundy/12 p-1.5 text-burgundy transition-colors hover:bg-burgundy hover:text-white"
            title="빠른 소비 / 선물"
            aria-label={`${wine.name} 빠른 소비`}
          >
            <Wine className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={() => onOpenDetail(wine.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenDetail(wine.id);
        }
      }}
      className={`group relative flex cursor-pointer gap-3 rounded-2xl border border-subtle bg-surface p-3.5 shadow-card transition-all hover:border-forest/45 hover:shadow-card-hover ${
        count === 0 ? 'opacity-70' : ''
      }`}
    >
      {/* 좌측: 2차 라벨 사진 예약 슬롯 + 색상별 보틀 실루엣 */}
      <WineThumbnail
        color={wine.color}
        vintage={wine.vintage}
        labelImageFileId={wine.labelImageFileId}
        size="md"
      />

      {/* 중앙 메타 정보 */}
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5">
        <div>
          <div className="flex items-center gap-1.5">
            <WineColorBadge color={wine.color} />
            <span className="font-serif text-xs font-bold tabular-nums text-gold">
              {wine.vintage}
            </span>
            {sizeBadge && (
              <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] font-semibold text-secondary">
                {sizeBadge}
              </span>
            )}
          </div>
          <h3 className="mt-1 line-clamp-2 text-[14px] font-bold leading-snug text-primary transition-colors group-hover:text-forest">
            {wine.name}
          </h3>
          <p className="mt-0.5 truncate text-xs text-secondary">
            {formatWineOrigin(wine)}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-0.5 text-xs">
          <span className="inline-flex max-w-[60%] items-center gap-1 truncate rounded-md bg-elevated px-2 py-0.5 text-[11px] font-medium text-secondary">
            <MapPin className="h-3 w-3 shrink-0 text-forest" />
            <span className="truncate">{locationSummary}</span>
          </span>

          <div className="text-right">
            <PriceText
              value={priceStats.avgPrice}
              prefix={priceStats.isUniform ? '' : '평균 '}
              className="text-xs font-bold text-primary"
            />
            {/* T3 보강: 데스크톱 카드에만 병별 가격 범위 보조 표기 (프라이버시 모드 시 숨김) */}
            {!priceStats.isUniform && !isPrivacyMode && (
              <div className="hidden text-[10px] text-secondary tabular-nums sm:block">
                <PriceText value={priceStats.minPrice} compact />~
                <PriceText value={priceStats.maxPrice} compact />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 우측 강조: ×N 수량 배지 + 1탭 소비 버튼 */}
      <div className="flex shrink-0 flex-col items-end justify-between">
        <span
          className={`inline-flex min-w-[2.4rem] items-center justify-center rounded-xl px-2 py-1 text-xs font-extrabold tabular-nums ${
            count > 0
              ? 'bg-forest/12 text-forest'
              : 'bg-elevated text-secondary'
          }`}
        >
          {count > 0 ? `×${count}` : '품절'}
        </span>

        {count > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onQuickConsume(group);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-burgundy/12 text-burgundy transition-colors hover:bg-burgundy hover:text-white active:scale-95"
            title="빠른 소비 / 선물"
            aria-label={`${wine.name} 빠른 소비`}
          >
            <Wine className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
