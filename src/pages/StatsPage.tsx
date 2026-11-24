import { Clock } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WineColor } from '@/types/schema';
import {
  calculateColorDistribution,
  calculateDrinkingWindowSummary,
  calculateKpiSummary,
  calculatePriceDistribution,
  calculatePurchaseVsConsumptionTrend,
  calculateRegionTop10,
  type RegionRankItem,
} from '@/services/analytics/statsCalculator';
import { useWineStore, type DrinkingWindowFilter } from '@/store/useWineStore';
import { ColorDonutChart } from '@/components/stats/ColorDonutChart';
import { KpiGrid } from '@/components/stats/KpiGrid';
import { PriceDistChart } from '@/components/stats/PriceDistChart';
import { RegionBarChart } from '@/components/stats/RegionBarChart';
import { TrendChart } from '@/components/stats/TrendChart';

export default function StatsPage() {
  const db = useWineStore((s) => s.db);
  const resetFilters = useWineStore((s) => s.resetFilters);
  const setFilters = useWineStore((s) => s.setFilters);
  const navigate = useNavigate();

  const stats = useMemo(() => {
    if (!db) return null;
    return {
      kpi: calculateKpiSummary(db),
      colors: calculateColorDistribution(db),
      countries: calculateRegionTop10(db, 'country'),
      regions: calculateRegionTop10(db, 'region'),
      subRegions: calculateRegionTop10(db, 'subRegion'),
      monthlyTrend: calculatePurchaseVsConsumptionTrend(db, 'monthly_12'),
      yearlyTrend: calculatePurchaseVsConsumptionTrend(db, 'yearly'),
      priceDist: calculatePriceDistribution(db),
      drinkingWindow: calculateDrinkingWindowSummary(db),
    };
  }, [db]);

  if (!db || !stats) return null;

  const handleDrillColor = (color: WineColor) => {
    resetFilters();
    setFilters({ colors: [color] });
    navigate('/');
  };

  const handleDrillRegion = (item: RegionRankItem) => {
    resetFilters();
    setFilters({
      country: item.country,
      region: item.region ?? '',
      subRegion: item.subRegion ?? '',
    });
    navigate('/');
  };

  const handleDrillDrinkingWindow = (filter: DrinkingWindowFilter) => {
    resetFilters();
    setFilters({ drinkingWindow: filter });
    navigate('/');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-subtle bg-surface px-4 py-3.5 shadow-card">
        <h2 className="text-base font-bold text-primary">통계 대시보드</h2>
        <p className="text-xs text-secondary">
          보유 현황, {stats.kpi.trackingSinceDate} 이후 누적 지출, 소비·선물 분리 통계
        </p>
      </div>

      <KpiGrid kpi={stats.kpi} />

      {/* Phase 2-1: 적정 음용 시기 현황 알림 카드 */}
      <section className="rounded-2xl border border-subtle bg-surface p-4 shadow-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-forest" />
            <h3 className="text-sm font-bold text-primary">적정 음용 시기 현황 (보유 와인)</h3>
          </div>
          <span className="text-[11px] text-secondary tabular-nums">
            {stats.drinkingWindow.configuredBottles > 0
              ? `음용 적기 등록됨 ${stats.drinkingWindow.configuredBottles}병 · 카드 클릭 시 목록 이동`
              : '와인 상세 수정 또는 입고 시 음용 적기 연도를 입력하면 자동 집계됩니다'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => handleDrillDrinkingWindow('ready_now')}
            className="rounded-xl border border-[var(--status-ok)]/30 bg-[var(--status-ok)]/10 p-3 text-left transition-colors hover:bg-[var(--status-ok)]/15"
          >
            <div className="text-[11px] font-bold text-[var(--status-ok)]">지금 마시기 좋음</div>
            <div className="mt-1 text-lg font-extrabold tabular-nums text-primary">
              {stats.drinkingWindow.readyBottles + stats.drinkingWindow.closingSoonBottles}병
            </div>
            <div className="text-[11px] text-secondary tabular-nums">
              {stats.drinkingWindow.readyWines + stats.drinkingWindow.closingSoonWines}종
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleDrillDrinkingWindow('closing_soon')}
            className="rounded-xl border border-[var(--status-warn)]/35 bg-[var(--status-warn)]/10 p-3 text-left transition-colors hover:bg-[var(--status-warn)]/15"
          >
            <div className="text-[11px] font-bold text-[var(--status-warn)]">마감 임박</div>
            <div className="mt-1 text-lg font-extrabold tabular-nums text-primary">
              {stats.drinkingWindow.closingSoonBottles}병
            </div>
            <div className="text-[11px] text-secondary tabular-nums">
              {stats.drinkingWindow.closingSoonWines}종 (올해~내년)
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleDrillDrinkingWindow('past_peak')}
            className="rounded-xl border border-[var(--status-danger)]/30 bg-[var(--status-danger)]/10 p-3 text-left transition-colors hover:bg-[var(--status-danger)]/15"
          >
            <div className="text-[11px] font-bold text-[var(--status-danger)]">적기 경과</div>
            <div className="mt-1 text-lg font-extrabold tabular-nums text-primary">
              {stats.drinkingWindow.pastPeakBottles}병
            </div>
            <div className="text-[11px] text-secondary tabular-nums">
              {stats.drinkingWindow.pastPeakWines}종
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleDrillDrinkingWindow('too_young')}
            className="rounded-xl border border-subtle bg-elevated/60 p-3 text-left transition-colors hover:border-forest/40"
          >
            <div className="text-[11px] font-bold text-secondary">숙성 중</div>
            <div className="mt-1 text-lg font-extrabold tabular-nums text-primary">
              {stats.drinkingWindow.tooYoungBottles}병
            </div>
            <div className="text-[11px] text-secondary tabular-nums">
              {stats.drinkingWindow.tooYoungWines}종
            </div>
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ColorDonutChart data={stats.colors} onSelectColor={handleDrillColor} />
        <RegionBarChart
          countryData={stats.countries}
          regionData={stats.regions}
          subRegionData={stats.subRegions}
          onSelectItem={handleDrillRegion}
        />
        <TrendChart monthlyData={stats.monthlyTrend} yearlyData={stats.yearlyTrend} />
        <PriceDistChart data={stats.priceDist} />
      </div>
    </div>
  );
}
