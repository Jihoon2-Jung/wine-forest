import {
  WINE_COLORS,
  WINE_COLOR_LABELS,
  type BottleInstance,
  type WineColor,
  type WineDatabase,
  type WineMaster,
} from '@/types/schema';
import { getDrinkingWindowStatus } from '@/services/domain/wineHelpers';

export interface KpiSummary {
  inStockCount: number;
  inStockUniqueWines: number;
  inStockTotalValue: number;
  inStockAvgPrice: number;
  trackingSinceDate: string;
  trackingSinceCount: number;
  trackingSinceTotalValue: number;
  consumedCount: number;
  consumedTotalValue: number;
  giftedCount: number;
  giftedTotalValue: number;
}

export interface ColorDistributionItem {
  color: WineColor;
  label: string;
  count: number;
  value: number;
  ratio: number; // 0 ~ 100
}

export interface RegionRankItem {
  key: string;
  country: string;
  region?: string;
  subRegion?: string;
  label: string;
  count: number;
  value: number;
}

export interface TrendPoint {
  period: string; // 'YYYY-MM' or 'YYYY'
  label: string;
  purchasedCount: number;
  purchasedValue: number;
  consumedCount: number;
  consumedValue: number;
}

export interface TrendResult {
  points: TrendPoint[];
  unknownPurchaseDateCount: number;
  unknownEventDateCount: number;
}

export interface PriceBucketItem {
  id: string;
  label: string;
  min: number;
  max: number | null;
  count: number;
  value: number;
}

export interface WineGroupPriceSummary {
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  isUniform: boolean;
}

export function calculateWineGroupPrice(bottles: BottleInstance[]): WineGroupPriceSummary {
  if (bottles.length === 0) {
    return { minPrice: 0, maxPrice: 0, avgPrice: 0, isUniform: true };
  }
  let minPrice = bottles[0].purchasePrice;
  let maxPrice = bottles[0].purchasePrice;
  let sum = 0;
  for (const b of bottles) {
    if (b.purchasePrice < minPrice) minPrice = b.purchasePrice;
    if (b.purchasePrice > maxPrice) maxPrice = b.purchasePrice;
    sum += b.purchasePrice;
  }
  return {
    minPrice,
    maxPrice,
    avgPrice: Math.round(sum / bottles.length),
    isUniform: minPrice === maxPrice,
  };
}

export function calculateKpiSummary(db: WineDatabase): KpiSummary {
  let inStockCount = 0;
  let inStockTotalValue = 0;
  const inStockWineIds = new Set<string>();

  let trackingSinceCount = 0;
  let trackingSinceTotalValue = 0;

  let consumedCount = 0;
  let consumedTotalValue = 0;

  let giftedCount = 0;
  let giftedTotalValue = 0;

  for (const bottle of db.bottles) {
    if (bottle.status === 'IN_STOCK') {
      inStockCount += 1;
      inStockTotalValue += bottle.purchasePrice;
      inStockWineIds.add(bottle.wineId);
    } else if (bottle.status === 'CONSUMED') {
      consumedCount += 1;
      consumedTotalValue += bottle.purchasePrice;
    } else if (bottle.status === 'GIFTED') {
      giftedCount += 1;
      giftedTotalValue += bottle.purchasePrice;
    }

    if (bottle.includeInTrackingSince) {
      trackingSinceCount += 1;
      trackingSinceTotalValue += bottle.purchasePrice;
    }
  }

  return {
    inStockCount,
    inStockUniqueWines: inStockWineIds.size,
    inStockTotalValue,
    inStockAvgPrice: inStockCount > 0 ? Math.round(inStockTotalValue / inStockCount) : 0,
    trackingSinceDate: db.metadata.trackingSinceDate,
    trackingSinceCount,
    trackingSinceTotalValue,
    consumedCount,
    consumedTotalValue,
    giftedCount,
    giftedTotalValue,
  };
}

export function calculateColorDistribution(db: WineDatabase): ColorDistributionItem[] {
  const wineMap = new Map<string, WineMaster>(db.wines.map((w) => [w.id, w]));
  const counts = new Map<WineColor, { count: number; value: number }>();
  for (const c of WINE_COLORS) {
    counts.set(c, { count: 0, value: 0 });
  }

  let total = 0;
  for (const bottle of db.bottles) {
    if (bottle.status !== 'IN_STOCK') continue;
    const wine = wineMap.get(bottle.wineId);
    if (!wine) continue;
    const entry = counts.get(wine.color);
    if (!entry) continue;
    entry.count += 1;
    entry.value += bottle.purchasePrice;
    total += 1;
  }

  return WINE_COLORS.map((color) => {
    const entry = counts.get(color)!;
    return {
      color,
      label: WINE_COLOR_LABELS[color],
      count: entry.count,
      value: entry.value,
      ratio: total > 0 ? Math.round((entry.count / total) * 1000) / 10 : 0,
    };
  }).filter((item) => item.count > 0);
}

export function calculateRegionTop10(
  db: WineDatabase,
  mode: 'country' | 'region' | 'subRegion',
  limit = 10,
): RegionRankItem[] {
  const wineMap = new Map<string, WineMaster>(db.wines.map((w) => [w.id, w]));
  const agg = new Map<string, RegionRankItem>();

  for (const bottle of db.bottles) {
    if (bottle.status !== 'IN_STOCK') continue;
    const wine = wineMap.get(bottle.wineId);
    if (!wine) continue;

    if (mode === 'subRegion' && !wine.subRegion) continue;

    const key =
      mode === 'country'
        ? wine.country
        : mode === 'region'
          ? `${wine.country}::${wine.region}`
          : `${wine.country}::${wine.region}::${wine.subRegion}`;
    const label =
      mode === 'country'
        ? wine.country
        : mode === 'region'
          ? wine.region === wine.country
            ? wine.country
            : `${wine.region} (${wine.country})`
          : `${wine.subRegion} (${wine.region})`;

    const existing = agg.get(key);
    if (existing) {
      existing.count += 1;
      existing.value += bottle.purchasePrice;
    } else {
      agg.set(key, {
        key,
        country: wine.country,
        region: mode === 'country' ? undefined : wine.region,
        subRegion: mode === 'subRegion' ? wine.subRegion : undefined,
        label,
        count: 1,
        value: bottle.purchasePrice,
      });
    }
  }

  return [...agg.values()]
    .sort((a, b) => b.count - a.count || b.value - a.value || a.label.localeCompare(b.label, 'ko'))
    .slice(0, limit);
}

export function calculatePurchaseVsConsumptionTrend(
  db: WineDatabase,
  granularity: 'monthly_12' | 'yearly',
  referenceDate: Date = new Date(),
): TrendResult {
  const bottleMap = new Map<string, BottleInstance>(db.bottles.map((b) => [b.id, b]));
  let unknownPurchaseDateCount = 0;
  let unknownEventDateCount = 0;

  if (granularity === 'monthly_12') {
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push(ym);
    }
    const pointMap = new Map<string, TrendPoint>(
      months.map((ym) => [
        ym,
        {
          period: ym,
          label: `${ym.slice(2, 4)}.${ym.slice(5, 7)}`,
          purchasedCount: 0,
          purchasedValue: 0,
          consumedCount: 0,
          consumedValue: 0,
        },
      ]),
    );

    for (const bottle of db.bottles) {
      if (!bottle.purchaseDate) {
        unknownPurchaseDateCount += 1;
        continue;
      }
      const ym = bottle.purchaseDate.slice(0, 7);
      const pt = pointMap.get(ym);
      if (pt) {
        pt.purchasedCount += 1;
        pt.purchasedValue += bottle.purchasePrice;
      }
    }

    const seenConsumedBottleIds = new Set<string>();
    for (const tasting of db.tastings) {
      if (tasting.type !== 'CONSUMED') continue;
      if (seenConsumedBottleIds.has(tasting.bottleId)) continue;
      const bottle = bottleMap.get(tasting.bottleId);
      if (!bottle || bottle.status !== 'CONSUMED') continue;
      seenConsumedBottleIds.add(tasting.bottleId);
      if (!tasting.eventDate) {
        unknownEventDateCount += 1;
        continue;
      }
      const ym = tasting.eventDate.slice(0, 7);
      const pt = pointMap.get(ym);
      if (pt) {
        pt.consumedCount += 1;
        pt.consumedValue += bottle.purchasePrice;
      }
    }

    return {
      points: months.map((ym) => pointMap.get(ym)!),
      unknownPurchaseDateCount,
      unknownEventDateCount,
    };
  }

  // Yearly
  const yearMap = new Map<string, TrendPoint>();
  const ensureYear = (year: string) => {
    let pt = yearMap.get(year);
    if (!pt) {
      pt = {
        period: year,
        label: `${year}년`,
        purchasedCount: 0,
        purchasedValue: 0,
        consumedCount: 0,
        consumedValue: 0,
      };
      yearMap.set(year, pt);
    }
    return pt;
  };

  for (const bottle of db.bottles) {
    if (!bottle.purchaseDate) {
      unknownPurchaseDateCount += 1;
      continue;
    }
    const year = bottle.purchaseDate.slice(0, 4);
    const pt = ensureYear(year);
    pt.purchasedCount += 1;
    pt.purchasedValue += bottle.purchasePrice;
  }

  const seenConsumedBottleIds = new Set<string>();
  for (const tasting of db.tastings) {
    if (tasting.type !== 'CONSUMED') continue;
    if (seenConsumedBottleIds.has(tasting.bottleId)) continue;
    const bottle = bottleMap.get(tasting.bottleId);
    if (!bottle || bottle.status !== 'CONSUMED') continue;
    seenConsumedBottleIds.add(tasting.bottleId);
    if (!tasting.eventDate) {
      unknownEventDateCount += 1;
      continue;
    }
    const year = tasting.eventDate.slice(0, 4);
    const pt = ensureYear(year);
    pt.consumedCount += 1;
    pt.consumedValue += bottle.purchasePrice;
  }

  const numericYears = [...yearMap.keys()]
    .filter((y) => /^\d{4}$/.test(y))
    .map(Number)
    .sort((a, b) => a - b);
  if (numericYears.length >= 2) {
    const minY = numericYears[0];
    const maxY = numericYears[numericYears.length - 1];
    if (maxY - minY <= 20) {
      for (let y = minY; y <= maxY; y += 1) {
        ensureYear(String(y));
      }
    }
  }

  return {
    points: [...yearMap.values()].sort((a, b) => a.period.localeCompare(b.period)),
    unknownPurchaseDateCount,
    unknownEventDateCount,
  };
}

const PRICE_BUCKETS: ReadonlyArray<{ id: string; label: string; min: number; max: number | null }> =
  [
    { id: 'u3', label: '~3만', min: 0, max: 30_000 },
    { id: '3_5', label: '3~5만', min: 30_000, max: 50_000 },
    { id: '5_10', label: '5~10만', min: 50_000, max: 100_000 },
    { id: '10_20', label: '10~20만', min: 100_000, max: 200_000 },
    { id: '20_50', label: '20~50만', min: 200_000, max: 500_000 },
    { id: '50p', label: '50만+', min: 500_000, max: null },
  ];

export function calculatePriceDistribution(db: WineDatabase): PriceBucketItem[] {
  const result: PriceBucketItem[] = PRICE_BUCKETS.map((b) => ({
    ...b,
    count: 0,
    value: 0,
  }));

  for (const bottle of db.bottles) {
    if (bottle.status !== 'IN_STOCK') continue;
    const price = bottle.purchasePrice;
    const bucket = result.find((b) => price >= b.min && (b.max === null || price < b.max));
    if (bucket) {
      bucket.count += 1;
      bucket.value += price;
    }
  }

  return result;
}

export interface DrinkingWindowSummary {
  readyBottles: number;
  readyWines: number;
  closingSoonBottles: number;
  closingSoonWines: number;
  pastPeakBottles: number;
  pastPeakWines: number;
  tooYoungBottles: number;
  tooYoungWines: number;
  configuredBottles: number;
}

export function calculateDrinkingWindowSummary(
  db: WineDatabase,
  currentYear: number = new Date().getFullYear(),
): DrinkingWindowSummary {
  const wineMap = new Map(db.wines.map((w) => [w.id, w]));
  const readySet = new Set<string>();
  const closingSet = new Set<string>();
  const pastSet = new Set<string>();
  const youngSet = new Set<string>();

  let readyBottles = 0;
  let closingSoonBottles = 0;
  let pastPeakBottles = 0;
  let tooYoungBottles = 0;

  for (const b of db.bottles) {
    if (b.status !== 'IN_STOCK') continue;
    const wine = wineMap.get(b.wineId);
    if (!wine) continue;
    const status = getDrinkingWindowStatus(wine, currentYear);
    if (status === 'ready') {
      readyBottles += 1;
      readySet.add(wine.id);
    } else if (status === 'closing_soon') {
      closingSoonBottles += 1;
      closingSet.add(wine.id);
    } else if (status === 'past_peak') {
      pastPeakBottles += 1;
      pastSet.add(wine.id);
    } else if (status === 'too_young') {
      tooYoungBottles += 1;
      youngSet.add(wine.id);
    }
  }

  return {
    readyBottles,
    readyWines: readySet.size,
    closingSoonBottles,
    closingSoonWines: closingSet.size,
    pastPeakBottles,
    pastPeakWines: pastSet.size,
    tooYoungBottles,
    tooYoungWines: youngSet.size,
    configuredBottles: readyBottles + closingSoonBottles + pastPeakBottles + tooYoungBottles,
  };
}
