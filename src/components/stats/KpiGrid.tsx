import { CalendarRange, Gift, Package, Wine } from 'lucide-react';
import type { KpiSummary } from '@/services/analytics/statsCalculator';
import { PriceText } from '@/components/common/PriceText';

export function KpiGrid({ kpi }: { kpi: KpiSummary }) {
  const shortDate = kpi.trackingSinceDate.slice(2).replace(/-/g, '.');

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {/* 1. 현재 보유 */}
      <div className="rounded-2xl border border-subtle bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between text-xs font-semibold text-secondary">
          <span>현재 보유</span>
          <Package className="h-4 w-4 text-forest" />
        </div>
        <div className="mt-2 text-2xl font-extrabold tabular-nums text-primary">
          {kpi.inStockCount.toLocaleString('ko-KR')}
          <span className="ml-1 text-sm font-semibold text-secondary">병</span>
        </div>
        <div className="mt-1.5 space-y-0.5 text-xs">
          <div className="font-bold text-forest">
            <PriceText value={kpi.inStockTotalValue} />
          </div>
          <div className="text-[11px] text-secondary tabular-nums">
            {kpi.inStockUniqueWines}종 · 평균 <PriceText value={kpi.inStockAvgPrice} />
          </div>
        </div>
      </div>

      {/* 2. 23.02.18 이후 누적 지출 */}
      <div className="rounded-2xl border border-forest/35 bg-forest/5 p-4 shadow-card">
        <div className="flex items-center justify-between text-xs font-semibold text-forest">
          <span className="truncate">{shortDate} 이후 누적 지출</span>
          <CalendarRange className="h-4 w-4 shrink-0 text-forest" />
        </div>
        <div className="mt-2 text-xl font-extrabold text-primary sm:text-2xl">
          <PriceText value={kpi.trackingSinceTotalValue} />
        </div>
        <div className="mt-1.5 text-xs text-secondary tabular-nums">
          총 <strong className="text-primary">{kpi.trackingSinceCount}병</strong> (보유·소비·선물 포함)
        </div>
      </div>

      {/* 3. 누적 소비 (순수 음용) */}
      <div className="rounded-2xl border border-subtle bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between text-xs font-semibold text-secondary">
          <span>누적 소비</span>
          <Wine className="h-4 w-4 text-burgundy" />
        </div>
        <div className="mt-2 text-2xl font-extrabold tabular-nums text-primary">
          {kpi.consumedCount.toLocaleString('ko-KR')}
          <span className="ml-1 text-sm font-semibold text-secondary">병</span>
        </div>
        <div className="mt-1.5 text-xs font-bold text-burgundy">
          <PriceText value={kpi.consumedTotalValue} />
        </div>
      </div>

      {/* 4. 선물 · 양도 */}
      <div className="rounded-2xl border border-subtle bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between text-xs font-semibold text-secondary">
          <span>선물 · 양도</span>
          <Gift className="h-4 w-4 text-gold" />
        </div>
        <div className="mt-2 text-2xl font-extrabold tabular-nums text-primary">
          {kpi.giftedCount.toLocaleString('ko-KR')}
          <span className="ml-1 text-sm font-semibold text-secondary">병</span>
        </div>
        <div className="mt-1.5 text-xs font-bold text-gold">
          <PriceText value={kpi.giftedTotalValue} />
        </div>
      </div>
    </div>
  );
}
