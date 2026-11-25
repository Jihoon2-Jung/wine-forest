import { ChevronDown, History, Search } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { BottleInstance, TastingRecord, WineMaster } from '@/types/schema';
import { useWineStore } from '@/store/useWineStore';
import { HistoryCard } from '@/components/history/HistoryCard';

interface EnrichedHistoryItem {
  tasting: TastingRecord;
  bottle: BottleInstance;
  wine: WineMaster;
}

const PAGE_SIZE = 50;

export function HistoryPage() {
  const db = useWineStore((s) => s.db);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CONSUMED' | 'GIFTED'>('ALL');
  const [yearFilter, setYearFilter] = useState<string>('ALL');
  const [ratingFilter, setRatingFilter] = useState<'ALL' | 'RATED' | '4.0' | '4.5'>('ALL');
  const [sortBy, setSortBy] = useState<'date_desc' | 'rating_desc'>('date_desc');
  const [query, setQuery] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [typeFilter, yearFilter, ratingFilter, sortBy, deferredQuery]);

  const { years, groupedTimeline, totalCount, displayedCount, sortedLocations } = useMemo(() => {
    if (!db) {
      return {
        years: [] as string[],
        groupedTimeline: [] as Array<{
          monthKey: string;
          label: string;
          items: EnrichedHistoryItem[];
          totalInGroup: number;
        }>,
        totalCount: 0,
        displayedCount: 0,
        sortedLocations: [],
      };
    }

    const wineMap = new Map(db.wines.map((w) => [w.id, w]));
    const bottleMap = new Map(db.bottles.map((b) => [b.id, b]));
    const yearSet = new Set<string>();

    const allItems: EnrichedHistoryItem[] = [];
    for (const tasting of db.tastings) {
      const bottle = bottleMap.get(tasting.bottleId);
      if (!bottle || bottle.status === 'IN_STOCK') continue;
      const wine = wineMap.get(bottle.wineId);
      if (!wine) continue;
      if (tasting.eventDate) {
        yearSet.add(tasting.eventDate.slice(0, 4));
      }
      allItems.push({ tasting, bottle, wine });
    }

    const filtered = allItems.filter(({ tasting, wine }) => {
      if (typeFilter !== 'ALL' && tasting.type !== typeFilter) return false;
      if (yearFilter !== 'ALL') {
        if (yearFilter === 'UNKNOWN') {
          if (tasting.eventDate !== null) return false;
        } else if (!tasting.eventDate?.startsWith(yearFilter)) {
          return false;
        }
      }
      if (ratingFilter !== 'ALL') {
        const r = tasting.rating;
        if (r === null || r === undefined) return false;
        if (ratingFilter === '4.5' && r < 4.5) return false;
        if (ratingFilter === '4.0' && r < 4.0) return false;
      }
      if (deferredQuery) {
        const hay =
          `${wine.name} ${wine.country} ${wine.region} ${wine.subRegion ?? ''} ${wine.vintage} ${tasting.occasion ?? ''} ${tasting.companions ?? ''} ${tasting.tastingNote ?? ''} ${tasting.memo ?? ''}`.toLowerCase();
        if (!hay.includes(deferredQuery)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (sortBy === 'rating_desc') {
        const ra = a.tasting.rating ?? -1;
        const rb = b.tasting.rating ?? -1;
        if (ra !== rb) return rb - ra;
      }
      const da = a.tasting.eventDate ?? '0000-00-00';
      const dbDate = b.tasting.eventDate ?? '0000-00-00';
      if (da !== dbDate) return dbDate.localeCompare(da);
      return b.tasting.createdAt.localeCompare(a.tasting.createdAt);
    });

    const sliced = filtered.slice(0, visibleLimit);

    // 평점순 정렬 시 단일 랭킹 그룹, 날짜순 정렬 시 월별 그룹('날짜 미상' 최하단)
    if (sortBy === 'rating_desc') {
      return {
        years: [...yearSet].sort((a, b) => b.localeCompare(a)),
        groupedTimeline:
          sliced.length > 0
            ? [
                {
                  monthKey: 'BY_RATING',
                  label: '평점 높은순',
                  items: sliced,
                  totalInGroup: filtered.length,
                },
              ]
            : [],
        totalCount: filtered.length,
        displayedCount: sliced.length,
        sortedLocations: [...db.locations].sort((a, b) => a.sortOrder - b.sortOrder),
      };
    }

    // 전체 필터링 결과의 월별 총 건수를 먼저 집계 (페이지네이션 경계 월 카운트 오차 방지)
    const fullMonthTotals = new Map<string, number>();
    for (const item of filtered) {
      const monthKey = item.tasting.eventDate ? item.tasting.eventDate.slice(0, 7) : 'UNKNOWN';
      fullMonthTotals.set(monthKey, (fullMonthTotals.get(monthKey) ?? 0) + 1);
    }

    // M4 보강: eventDate === null은 최하단 '날짜 미상' 그룹으로 분리
    const groupsMap = new Map<string, EnrichedHistoryItem[]>();
    for (const item of sliced) {
      const monthKey = item.tasting.eventDate ? item.tasting.eventDate.slice(0, 7) : 'UNKNOWN';
      const list = groupsMap.get(monthKey) ?? [];
      list.push(item);
      groupsMap.set(monthKey, list);
    }

    const timeline = [...groupsMap.entries()]
      .sort(([a], [b]) => {
        if (a === 'UNKNOWN') return 1;
        if (b === 'UNKNOWN') return -1;
        return b.localeCompare(a);
      })
      .map(([monthKey, items]) => {
        const label =
          monthKey === 'UNKNOWN'
            ? '날짜 미상'
            : `${monthKey.slice(0, 4)}년 ${Number(monthKey.slice(5, 7))}월`;
        return {
          monthKey,
          label,
          items,
          totalInGroup: fullMonthTotals.get(monthKey) ?? items.length,
        };
      });

    return {
      years: [...yearSet].sort((a, b) => b.localeCompare(a)),
      groupedTimeline: timeline,
      totalCount: filtered.length,
      displayedCount: sliced.length,
      sortedLocations: [...db.locations].sort((a, b) => a.sortOrder - b.sortOrder),
    };
  }, [db, typeFilter, yearFilter, ratingFilter, sortBy, deferredQuery, visibleLimit]);

  if (!db) return null;

  return (
    <div className="space-y-4">
      {/* 상단 필터 */}
      <div className="space-y-3 rounded-2xl border border-subtle bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-primary">소비 · 선물 이력</h2>
            <p className="text-xs text-secondary tabular-nums">총 {totalCount}병 기록됨</p>
          </div>

          <div className="flex items-center gap-1.5">
            {(
              [
                ['ALL', '전체'],
                ['CONSUMED', '🍷 소비완료'],
                ['GIFTED', '🎁 선물·양도'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTypeFilter(key)}
                className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                  typeFilter === key
                    ? 'border-forest bg-forest text-white'
                    : 'border-subtle bg-elevated text-secondary hover:text-primary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="와인명, 모임, 동반자, 시음노트, 메모 검색..."
              className="w-full rounded-xl border border-subtle bg-elevated py-2 pl-9 pr-3 text-xs text-primary focus:border-forest focus:outline-none"
            />
          </div>

          <select
            aria-label="연도 필터"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="rounded-xl border border-subtle bg-elevated px-3 py-2 text-xs font-semibold tabular-nums text-primary focus:border-forest focus:outline-none"
          >
            <option value="ALL">연도: 전체</option>
            {yearFilter !== 'ALL' && yearFilter !== 'UNKNOWN' && !years.includes(yearFilter) && (
              <option value={yearFilter}>{yearFilter}년 (0)</option>
            )}
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
            <option value="UNKNOWN">날짜 미상</option>
          </select>

          <select
            aria-label="평점 필터"
            value={ratingFilter}
            onChange={(e) => setRatingFilter(e.target.value as 'ALL' | 'RATED' | '4.0' | '4.5')}
            className={`rounded-xl border px-3 py-2 text-xs font-semibold focus:border-forest focus:outline-none ${
              ratingFilter !== 'ALL'
                ? 'border-gold bg-gold/10 text-gold'
                : 'border-subtle bg-elevated text-primary'
            }`}
          >
            <option value="ALL">평점: 전체</option>
            <option value="4.5">★ 4.5 이상</option>
            <option value="4.0">★ 4.0 이상</option>
            <option value="RATED">평점 기록됨</option>
          </select>

          <select
            aria-label="이력 정렬"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date_desc' | 'rating_desc')}
            className="rounded-xl border border-subtle bg-elevated px-3 py-2 text-xs font-semibold text-primary focus:border-forest focus:outline-none"
          >
            <option value="date_desc">최신순</option>
            <option value="rating_desc">평점 높은순</option>
          </select>
        </div>
      </div>

      {/* 월별 그룹 타임라인 */}
      {groupedTimeline.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-subtle bg-surface/60 px-6 py-16 text-center">
          <History className="h-8 w-8 text-secondary" />
          <p className="mt-3 text-sm font-bold text-primary">표시할 이력이 없습니다</p>
          <p className="mt-1 text-xs text-secondary">
            와인 목록에서 병을 소비하거나 선물 처리하면 이곳에 타임라인으로 기록됩니다.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedTimeline.map((group) => (
            <section key={group.monthKey} className="space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-sm font-extrabold text-primary tabular-nums">
                  {group.label}{' '}
                  <span className="font-semibold text-secondary">
                    (
                    {group.items.length < group.totalInGroup
                      ? `${group.items.length}/${group.totalInGroup}병`
                      : `${group.items.length}병`}
                    )
                  </span>
                </h3>
              </div>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <HistoryCard
                    key={item.tasting.id}
                    tasting={item.tasting}
                    bottle={item.bottle}
                    wine={item.wine}
                    locations={sortedLocations}
                  />
                ))}
              </div>
            </section>
          ))}

          {/* T2 보강: 최근 50건씩 점진적 렌더링으로 모바일 60fps 확보 */}
          {displayedCount < totalCount && (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setVisibleLimit((prev) => prev + PAGE_SIZE)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-subtle bg-surface px-4 py-2.5 text-xs font-bold text-primary shadow-card transition-colors hover:border-forest hover:text-forest"
              >
                <ChevronDown className="h-4 w-4" />
                <span>
                  이전 이력 {Math.min(PAGE_SIZE, totalCount - displayedCount)}건 더보기 (남은{' '}
                  {totalCount - displayedCount}건)
                </span>
              </button>
              <button
                type="button"
                onClick={() => setVisibleLimit(totalCount)}
                className="rounded-xl border border-subtle bg-elevated px-3.5 py-2.5 text-xs font-semibold text-secondary hover:text-primary"
              >
                전체 {totalCount}건 보기
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
