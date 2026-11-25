import { LayoutGrid, List, Plus, RotateCcw, Wine } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import type { BottleInstance } from '@/types/schema';
import { calculateWineGroupPrice } from '@/services/analytics/statsCalculator';
import { compareVintage, getDrinkingWindowStatus } from '@/services/domain/wineHelpers';
import { useWineStore } from '@/store/useWineStore';
import { PriceText } from '@/components/common/PriceText';
import { FilterBar } from '@/components/wines/FilterBar';
import { QuickConsumeModal } from '@/components/wines/QuickConsumeModal';
import { WineDetailSheet } from '@/components/wines/WineDetailSheet';
import { WineGroupCard, type WineGroupItem } from '@/components/wines/WineGroupCard';

export function InventoryPage() {
  const db = useWineStore((s) => s.db);
  const filters = useWineStore((s) => s.filters);
  const resetFilters = useWineStore((s) => s.resetFilters);
  const openQuickAdd = useWineStore((s) => s.openQuickAdd);

  const [selectedWineId, setSelectedWineId] = useState<string | null>(null);
  const [quickConsumeWineId, setQuickConsumeWineId] = useState<string | null>(null);
  const [compactView, setCompactView] = useState(false);

  const deferredQuery = useDeferredValue(filters.query.trim().toLowerCase());

  const { groups, totalVisibleBottles, totalVisibleValue } = useMemo(() => {
    if (!db) {
      return { groups: [] as WineGroupItem[], totalVisibleBottles: 0, totalVisibleValue: 0 };
    }

    const locationMap = new Map(db.locations.map((l) => [l.id, l]));
    const bottlesByWine = new Map<string, BottleInstance[]>();
    for (const b of db.bottles) {
      const list = bottlesByWine.get(b.wineId) ?? [];
      list.push(b);
      bottlesByWine.set(b.wineId, list);
    }

    const result: WineGroupItem[] = [];
    let visibleBottleCount = 0;
    let visibleValue = 0;

    for (const wine of db.wines) {
      const allBottles = bottlesByWine.get(wine.id) ?? [];
      const inStockAll = allBottles.filter((b) => b.status === 'IN_STOCK');

      // 구역 필터가 있을 때는 해당 구역에 있는 보유 병 기준으로 필터링
      const matchingInStock = filters.zone
        ? inStockAll.filter((b) => {
            if (filters.zone === '__UNASSIGNED__') return b.locationId === null;
            const loc = b.locationId ? locationMap.get(b.locationId) : undefined;
            return loc?.zone === filters.zone;
          })
        : inStockAll;

      if (!filters.includeOutOfStock && matchingInStock.length === 0) continue;
      if (filters.zone && matchingInStock.length === 0) continue;

      if (filters.colors.length > 0 && !filters.colors.includes(wine.color)) continue;
      if (filters.country && wine.country !== filters.country) continue;
      if (filters.region && wine.region !== filters.region) continue;
      if (filters.subRegion && wine.subRegion !== filters.subRegion) continue;
      if (filters.drinkingWindow) {
        const dwStatus = getDrinkingWindowStatus(wine);
        if (filters.drinkingWindow === 'ready_now') {
          if (dwStatus !== 'ready' && dwStatus !== 'closing_soon') continue;
        } else if (dwStatus !== filters.drinkingWindow) {
          continue;
        }
      }

      // 통합 검색 (와인명, 생산자, 국가, 지역, 세부지역, 빈티지, 구매처, 보관 위치, 메모)
      if (deferredQuery) {
        const bottleTokens = (matchingInStock.length > 0 ? matchingInStock : allBottles)
          .map((b) => {
            const locName = b.locationId ? locationMap.get(b.locationId)?.displayName ?? '' : '미지정';
            return `${b.purchaseSource} ${b.memo ?? ''} ${b.fxNote ?? ''} ${locName}`;
          })
          .join(' ');
        const haystack =
          `${wine.name} ${wine.producer ?? ''} ${wine.country} ${wine.region} ${wine.subRegion ?? ''} ${wine.vintage} ${bottleTokens}`.toLowerCase();
        if (!haystack.includes(deferredQuery)) continue;
      }

      // 보관 위치 요약
      const locNames = [
        ...new Set(
          matchingInStock.map((b) =>
            b.locationId ? locationMap.get(b.locationId)?.displayName ?? '미지정' : '미지정',
          ),
        ),
      ];
      const locationSummary =
        locNames.length === 0
          ? '보유 없음'
          : locNames.length === 1
            ? locNames[0]
            : `${locNames[0]} 외 ${locNames.length - 1}곳`;

      const latestPurchaseDate = (matchingInStock.length > 0 ? matchingInStock : allBottles)
        .map((b) => b.purchaseDate ?? '0000-00-00')
        .sort()
        .at(-1) ?? '0000-00-00';

      result.push({
        wine,
        inStockBottles: matchingInStock,
        allBottles,
        locationSummary,
        latestPurchaseDate,
      });

      visibleBottleCount += matchingInStock.length;
      for (const b of matchingInStock) {
        visibleValue += b.purchasePrice;
      }
    }

    // 정렬
    result.sort((a, b) => {
      switch (filters.sortBy) {
        case 'vintage_asc':
          return (
            compareVintage(a.wine.vintage, b.wine.vintage, 'asc') ||
            a.wine.name.localeCompare(b.wine.name, 'ko')
          );
        case 'vintage_desc':
          return (
            compareVintage(a.wine.vintage, b.wine.vintage, 'desc') ||
            a.wine.name.localeCompare(b.wine.name, 'ko')
          );
        case 'price_desc': {
          const pa = calculateWineGroupPrice(a.inStockBottles.length ? a.inStockBottles : a.allBottles).avgPrice;
          const pb = calculateWineGroupPrice(b.inStockBottles.length ? b.inStockBottles : b.allBottles).avgPrice;
          return pb - pa;
        }
        case 'price_asc': {
          const pa = calculateWineGroupPrice(a.inStockBottles.length ? a.inStockBottles : a.allBottles).avgPrice;
          const pb = calculateWineGroupPrice(b.inStockBottles.length ? b.inStockBottles : b.allBottles).avgPrice;
          return pa - pb;
        }
        case 'quantity_desc':
          return (
            b.inStockBottles.length - a.inStockBottles.length ||
            a.wine.name.localeCompare(b.wine.name, 'ko')
          );
        case 'name_asc':
          return a.wine.name.localeCompare(b.wine.name, 'ko');
        case 'recent_purchase':
        default:
          return (
            b.latestPurchaseDate.localeCompare(a.latestPurchaseDate) ||
            a.wine.name.localeCompare(b.wine.name, 'ko')
          );
      }
    });

    return {
      groups: result,
      totalVisibleBottles: visibleBottleCount,
      totalVisibleValue: visibleValue,
    };
  }, [db, filters, deferredQuery]);

  const quickConsumeTarget = useMemo(() => {
    if (!db || !quickConsumeWineId) return null;
    const fromGroups = groups.find((g) => g.wine.id === quickConsumeWineId);
    if (fromGroups) {
      return { wine: fromGroups.wine, bottles: fromGroups.inStockBottles };
    }
    const wine = db.wines.find((w) => w.id === quickConsumeWineId) ?? null;
    if (!wine) return null;
    const bottles = db.bottles.filter(
      (b) => b.wineId === quickConsumeWineId && b.status === 'IN_STOCK',
    );
    return { wine, bottles };
  }, [db, groups, quickConsumeWineId]);

  if (!db) return null;

  const hasAnyWineInCellar = db.wines.length > 0;

  return (
    <div className="space-y-4">
      {/* 상단 요약 스트립 + 데스크톱 밀도 전환 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-subtle bg-surface px-4 py-3 shadow-card">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
          <span className="font-bold text-primary tabular-nums">
            표시 중 <strong className="text-forest">{totalVisibleBottles}병</strong> ·{' '}
            {groups.length}종
          </span>
          <span className="text-subtle">|</span>
          <span className="text-xs text-secondary">
            보유 총액{' '}
            <PriceText value={totalVisibleValue} className="text-sm font-extrabold text-primary" />
          </span>
        </div>

        <div className="hidden items-center gap-1 rounded-xl border border-subtle bg-elevated p-0.5 md:flex">
          <button
            type="button"
            onClick={() => setCompactView(false)}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
              !compactView ? 'bg-surface text-primary shadow-sm' : 'text-secondary hover:text-primary'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>카드</span>
          </button>
          <button
            type="button"
            onClick={() => setCompactView(true)}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
              compactView ? 'bg-surface text-primary shadow-sm' : 'text-secondary hover:text-primary'
            }`}
          >
            <List className="h-3.5 w-3.5" />
            <span>컴팩트</span>
          </button>
        </div>
      </div>

      {/* 검색 & 다중 필터 */}
      <FilterBar />

      {/* 와인 카드 그리드 / 리스트 */}
      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-subtle bg-surface/60 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-forest/10 text-forest">
            <Wine className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-base font-bold text-primary">
            {hasAnyWineInCellar ? '조건에 맞는 와인이 없습니다' : '표시할 와인이 없습니다'}
          </h3>
          <p className="mt-1 max-w-sm text-xs text-secondary">
            {hasAnyWineInCellar
              ? '검색어나 필터 조건을 초기화하거나 완화해 보세요.'
              : '새로운 와인을 셀러에 입고해 보세요.'}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {hasAnyWineInCellar && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1.5 rounded-xl border border-subtle bg-surface px-4 py-2.5 text-sm font-bold text-primary hover:bg-elevated"
              >
                <RotateCcw className="h-4 w-4" />
                <span>필터 초기화</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => openQuickAdd(null)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-forest px-4 py-2.5 text-sm font-bold text-white hover:bg-forest-hover"
            >
              <Plus className="h-4 w-4" />
              <span>{hasAnyWineInCellar ? '와인 입고하기' : '첫 와인 입고하기'}</span>
            </button>
          </div>
        </div>
      ) : compactView ? (
        <div className="space-y-2">
          {groups.map((group) => (
            <WineGroupCard
              key={group.wine.id}
              group={group}
              compact
              onOpenDetail={setSelectedWineId}
              onQuickConsume={(g) => setQuickConsumeWineId(g.wine.id)}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <WineGroupCard
              key={group.wine.id}
              group={group}
              onOpenDetail={setSelectedWineId}
              onQuickConsume={(g) => setQuickConsumeWineId(g.wine.id)}
            />
          ))}
        </div>
      )}

      {/* 상세 바텀시트 */}
      <WineDetailSheet wineId={selectedWineId} onClose={() => setSelectedWineId(null)} />

      {/* 빠른 소비/선물 모달 */}
      <QuickConsumeModal
        open={Boolean(quickConsumeTarget)}
        wine={quickConsumeTarget?.wine ?? null}
        bottles={quickConsumeTarget?.bottles ?? []}
        onClose={() => setQuickConsumeWineId(null)}
      />
    </div>
  );
}
