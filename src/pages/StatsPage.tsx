import { Clock, Sparkles } from 'lucide-react';
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
  const autoFillMissingDrinkingWindows = useWineStore((s) => s.autoFillMissingDrinkingWindows);
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

  const missingDwCount = db.wines.filter(
    (w) => w.drinkingWindowStart == null && w.drinkingWindowEnd == null,
  ).length;

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
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-secondary tabular-nums">
              {stats.drinkingWindow.configuredBottles > 0
                ? `음용 적기 등록됨 ${stats.drinkingWindow.configuredBottles}병 · 카드 클릭 시 목록 이동`
                : '지역·빈티지 기준표로 보유 와인의 음용 적기를 자동 채울 수 있습니다'}
            </span>
            {missingDwCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      `음용 적기가 비어 있는 ${missingDwCount}종 와인에 지역·빈티지 기준 추천 연도를 일괄 채울까요?\n(이미 입력된 와인은 유지됩니다.)`,
                    )
                  ) {
                    void autoFillMissingDrinkingWindows();
                  }
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-forest px-2.5 py-1 text-[11px] font-bold text-white hover:bg-forest-hover"
              >
                <Sparkles className="h-3 w-3" />
                <span>미입력 {missingDwCount}종 자동 채우기</span>
              </button>
            )}
          </div>
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
