import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WineColor } from '@/types/schema';
import {
  calculateColorDistribution,
  calculateKpiSummary,
  calculatePriceDistribution,
  calculatePurchaseVsConsumptionTrend,
  calculateRegionTop10,
  type RegionRankItem,
} from '@/services/analytics/statsCalculator';
import { useWineStore } from '@/store/useWineStore';
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

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-subtle bg-surface px-4 py-3.5 shadow-card">
        <h2 className="text-base font-bold text-primary">통계 대시보드</h2>
        <p className="text-xs text-secondary">
          보유 현황, {stats.kpi.trackingSinceDate} 이후 누적 지출, 소비·선물 분리 통계
        </p>
      </div>

      <KpiGrid kpi={stats.kpi} />

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
