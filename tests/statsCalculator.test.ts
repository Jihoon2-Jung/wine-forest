import { describe, expect, it } from 'vitest';
import {
  calculateColorDistribution,
  calculateKpiSummary,
  calculatePriceDistribution,
  calculatePurchaseVsConsumptionTrend,
  calculateRegionTop10,
  calculateWineGroupPrice,
} from '@/services/analytics/statsCalculator';
import { createDemoDatabase } from '@/services/storage/defaultTemplates';

describe('statsCalculator — KPI, From_230218, Distributions & Trends', () => {
  it('separates IN_STOCK, CONSUMED, GIFTED and computes From_230218 across all statuses', () => {
    const db = createDemoDatabase();
    const kpi = calculateKpiSummary(db);

    // Demo DB:
    // IN_STOCK: 165000 + 148000 + 210000(pre-230218) + 118000 + 295000 + 52000 = 988,000 (6병, 5종)
    // CONSUMED: 42,000 (1병, tracking=true)
    // GIFTED: 115,000 (1병, tracking=true)
    // TrackingSince (includeInTrackingSince=true): 988000 - 210000 + 42000 + 115000 = 935,000 (7병)
    expect(kpi.inStockCount).toBe(6);
    expect(kpi.inStockUniqueWines).toBe(5);
    expect(kpi.inStockTotalValue).toBe(988_000);
    expect(kpi.inStockAvgPrice).toBe(Math.round(988_000 / 6));

    expect(kpi.consumedCount).toBe(1);
    expect(kpi.consumedTotalValue).toBe(42_000);

    expect(kpi.giftedCount).toBe(1);
    expect(kpi.giftedTotalValue).toBe(115_000);

    expect(kpi.trackingSinceCount).toBe(7);
    expect(kpi.trackingSinceTotalValue).toBe(935_000);
  });

  it('computes group average and price range accurately', () => {
    const db = createDemoDatabase();
    const leflaiveBottles = db.bottles.filter((b) => b.wineId === 'demo-wine-1');
    const summary = calculateWineGroupPrice(leflaiveBottles);

    expect(summary.isUniform).toBe(false);
    expect(summary.minPrice).toBe(148_000);
    expect(summary.maxPrice).toBe(165_000);
    expect(summary.avgPrice).toBe(156_500);
  });

  it('computes color, country/region top 10, price buckets, and null-date trend tracking', () => {
    const db = createDemoDatabase();
    db.bottles[0].purchaseDate = null;

    const colors = calculateColorDistribution(db);
    expect(colors.reduce((acc, c) => acc + c.count, 0)).toBe(6);

    const countries = calculateRegionTop10(db, 'country');
    expect(countries[0].country).toBe('프랑스');
    expect(countries[0].count).toBe(5);

    const regions = calculateRegionTop10(db, 'region');
    expect(regions[0].region).toBe('부르고뉴');

    const subRegions = calculateRegionTop10(db, 'subRegion');
    expect(subRegions.some((sr) => sr.subRegion === '뽀이약' && sr.region === '보르도')).toBe(true);
    expect(subRegions.some((sr) => sr.subRegion === '몬탈치노' && sr.region === '토스카나')).toBe(true);

    const priceBuckets = calculatePriceDistribution(db);
    expect(priceBuckets.reduce((acc, b) => acc + b.count, 0)).toBe(6);
    expect(priceBuckets.find((b) => b.id === '5_10')?.count).toBe(1); // 52,000
    expect(priceBuckets.find((b) => b.id === '10_20')?.count).toBe(3); // 165k, 148k, 118k
    expect(priceBuckets.find((b) => b.id === '20_50')?.count).toBe(2); // 210k, 295k

    const trend = calculatePurchaseVsConsumptionTrend(db, 'monthly_12', new Date('2026-11-24'));
    expect(trend.points).toHaveLength(12);
    expect(trend.unknownPurchaseDateCount).toBe(1);
    // 2026-07 consumed 1 bottle (GIFTED in 2026-09 is excluded from pure consumption)
    expect(trend.points.find((p) => p.period === '2026-07')?.consumedCount).toBe(1);
    expect(trend.points.find((p) => p.period === '2026-09')?.consumedCount).toBe(0);
  });
});
