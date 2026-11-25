import { Clock, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';
import { useMemo } from 'react';
import { WINE_COLORS, WINE_COLOR_LABELS, type WineColor } from '@/types/schema';
import {
  useWineStore,
  type DrinkingWindowFilter,
  type InventorySortKey,
} from '@/store/useWineStore';
import {
  getWineColorBorderCssVar,
  getWineColorCssVar,
  getWineColorFgCssVar,
} from '@/components/common/WineColorBadge';

const SORT_OPTIONS: Array<{ value: InventorySortKey; label: string }> = [
  { value: 'recent_purchase', label: '최근 구입순' },
  { value: 'vintage_asc', label: '빈티지 오래된순' },
  { value: 'vintage_desc', label: '빈티지 최신순' },
  { value: 'price_desc', label: '가격 높은순' },
  { value: 'price_asc', label: '가격 낮은순' },
  { value: 'quantity_desc', label: '보유 수량순' },
  { value: 'name_asc', label: '가나다순' },
];

export function FilterBar() {
  const db = useWineStore((s) => s.db);
  const filters = useWineStore((s) => s.filters);
  const setFilters = useWineStore((s) => s.setFilters);
  const resetFilters = useWineStore((s) => s.resetFilters);

  const { countryCounts, regionCounts, subRegionCounts, zones } = useMemo(() => {
    if (!db) {
      return {
        countryCounts: [] as Array<[string, number]>,
        regionCounts: [] as Array<[string, number]>,
        subRegionCounts: [] as Array<[string, number]>,
        zones: [] as string[],
      };
    }

    const wineMap = new Map(db.wines.map((w) => [w.id, w]));
    const cMap = new Map<string, number>();
    const rMap = new Map<string, number>();
    const srMap = new Map<string, number>();

    for (const b of db.bottles) {
      if (!filters.includeOutOfStock && b.status !== 'IN_STOCK') continue;
      const w = wineMap.get(b.wineId);
      if (!w) continue;

      cMap.set(w.country, (cMap.get(w.country) ?? 0) + 1);

      if (!filters.country || w.country === filters.country) {
        rMap.set(w.region, (rMap.get(w.region) ?? 0) + 1);
      }

      if (
        w.subRegion &&
        (!filters.country || w.country === filters.country) &&
        (!filters.region || w.region === filters.region)
      ) {
        srMap.set(w.subRegion, (srMap.get(w.subRegion) ?? 0) + 1);
      }
    }

    const zoneSet = new Set<string>();
    for (const loc of [...db.locations].sort((a, b) => a.sortOrder - b.sortOrder)) {
      zoneSet.add(loc.zone);
    }

    const byCountThenName = (a: [string, number], b: [string, number]) =>
      b[1] - a[1] || a[0].localeCompare(b[0], 'ko');

    return {
      countryCounts: [...cMap.entries()].sort(byCountThenName),
      regionCounts: [...rMap.entries()].sort(byCountThenName),
      subRegionCounts: [...srMap.entries()].sort(byCountThenName),
      zones: [...zoneSet],
    };
  }, [db, filters.country, filters.region, filters.includeOutOfStock]);

  const toggleColor = (color: WineColor) => {
    const exists = filters.colors.includes(color);
    const next = exists
      ? filters.colors.filter((c) => c !== color)
      : [...filters.colors, color];
    setFilters({ colors: next });
  };

  const hasActiveFilter =
    Boolean(filters.query.trim()) ||
    filters.colors.length > 0 ||
    Boolean(filters.country) ||
    Boolean(filters.region) ||
    Boolean(filters.subRegion) ||
    Boolean(filters.zone) ||
    Boolean(filters.drinkingWindow) ||
    filters.includeOutOfStock;

  return (
    <div className="space-y-2.5">
      {/* 초고속 즉시 검색바 */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
        <input
          type="search"
          value={filters.query}
          onChange={(e) => setFilters({ query: e.target.value })}
          placeholder="와인명, 국가, 지역(부르고뉴·보르도), 세부지역(에세죠·생줄리앙), 빈티지, 선반 검색..."
          className="w-full rounded-2xl border border-subtle bg-surface py-2.5 pl-10 pr-10 text-sm text-primary shadow-card placeholder:text-secondary/70 focus:border-forest focus:outline-none"
        />
        {filters.query && (
          <button
            type="button"
            onClick={() => setFilters({ query: '' })}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-secondary hover:bg-elevated hover:text-primary"
            aria-label="검색어 지우기"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 색상 칩 가로 스크롤 */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
        <button
          type="button"
          onClick={() => setFilters({ colors: [] })}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
            filters.colors.length === 0
              ? 'border-forest bg-forest text-white'
              : 'border-subtle bg-surface text-secondary hover:text-primary'
          }`}
        >
          전체 색상
        </button>
        {WINE_COLORS.map((c) => {
          const active = filters.colors.includes(c);
          const borderVar = getWineColorBorderCssVar(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggleColor(c)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-all ${
                active
                  ? 'shadow-sm'
                  : 'border-subtle bg-surface text-secondary hover:text-primary'
              }`}
              style={
                active
                  ? {
                      backgroundColor: getWineColorCssVar(c),
                      color: getWineColorFgCssVar(c),
                      borderColor: borderVar ?? 'transparent',
                    }
                  : undefined
              }
            >
              {!active && (
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: getWineColorCssVar(c),
                    boxShadow: borderVar ? `inset 0 0 0 1px ${borderVar}` : undefined,
                  }}
                />
              )}
              <span>{c}</span>
              <span className="hidden sm:inline font-medium opacity-85">{WINE_COLOR_LABELS[c]}</span>
            </button>
          );
        })}
      </div>

      {/* 3단계 생산지(국가 → 지역 → 세부지역) + 보관 위치 + 정렬 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 1단계: 국가 */}
        <select
          aria-label="국가 필터"
          value={filters.country}
          onChange={(e) => setFilters({ country: e.target.value, region: '', subRegion: '' })}
          className={`rounded-xl border px-3 py-1.5 text-xs font-semibold tabular-nums focus:border-forest focus:outline-none ${
            filters.country
              ? 'border-forest bg-forest/10 text-forest'
              : 'border-subtle bg-surface text-primary'
          }`}
        >
          <option value="">국가: 전체</option>
          {filters.country && !countryCounts.some(([c]) => c === filters.country) && (
            <option value={filters.country}>{filters.country} (0)</option>
          )}
          {countryCounts.map(([country, cnt]) => (
            <option key={country} value={country}>
              {country} ({cnt})
            </option>
          ))}
        </select>

        {/* 2단계: 지역 (예: 부르고뉴 선택 시 하위 에세죠·볼네·샤블리 모두 표시) */}
        <select
          aria-label="지역 필터"
          value={filters.region}
          onChange={(e) => setFilters({ region: e.target.value, subRegion: '' })}
          className={`rounded-xl border px-3 py-1.5 text-xs font-semibold tabular-nums focus:border-forest focus:outline-none ${
            filters.region
              ? 'border-forest bg-forest/10 text-forest'
              : 'border-subtle bg-surface text-primary'
          }`}
        >
          <option value="">지역: 전체</option>
          {filters.region && !regionCounts.some(([r]) => r === filters.region) && (
            <option value={filters.region}>{filters.region} (0)</option>
          )}
          {regionCounts.map(([region, cnt]) => (
            <option key={region} value={region}>
              {region} ({cnt})
            </option>
          ))}
        </select>

        {/* 3단계: 세부지역 (마을·밭·그랑크뤼 — 해당 범위에 세부지역이 있을 때 활성화) */}
        {(subRegionCounts.length > 0 || Boolean(filters.subRegion)) && (
          <select
            aria-label="세부지역 필터"
            value={filters.subRegion}
            onChange={(e) => setFilters({ subRegion: e.target.value })}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold tabular-nums focus:border-forest focus:outline-none ${
              filters.subRegion
                ? 'border-forest bg-forest/10 text-forest'
                : 'border-subtle bg-surface text-primary'
            }`}
          >
            <option value="">세부지역: 전체</option>
            {filters.subRegion && !subRegionCounts.some(([sr]) => sr === filters.subRegion) && (
              <option value={filters.subRegion}>{filters.subRegion} (0)</option>
            )}
            {subRegionCounts.map(([sub, cnt]) => (
              <option key={sub} value={sub}>
                {sub} ({cnt})
              </option>
            ))}
          </select>
        )}

        {/* 보관 위치 (셀러) 필터 */}
        <select
          aria-label="보관 위치 필터"
          value={filters.zone}
          onChange={(e) => setFilters({ zone: e.target.value })}
          className={`rounded-xl border px-3 py-1.5 text-xs font-semibold focus:border-forest focus:outline-none ${
            filters.zone
              ? 'border-forest bg-forest/10 text-forest'
              : 'border-subtle bg-surface text-primary'
          }`}
        >
          <option value="">보관 위치: 전체</option>
          {filters.zone &&
            filters.zone !== '__UNASSIGNED__' &&
            !zones.includes(filters.zone) && (
              <option value={filters.zone}>{filters.zone} (삭제됨)</option>
            )}
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
          <option value="__UNASSIGNED__">미지정</option>
        </select>

        {/* Phase 2-1: 음용 적기 필터 */}
        <select
          aria-label="음용 적기 필터"
          value={filters.drinkingWindow}
          onChange={(e) => setFilters({ drinkingWindow: e.target.value as DrinkingWindowFilter })}
          className={`rounded-xl border px-3 py-1.5 text-xs font-semibold focus:border-forest focus:outline-none ${
            filters.drinkingWindow
              ? 'border-forest bg-forest/10 text-forest'
              : 'border-subtle bg-surface text-primary'
          }`}
        >
          <option value="">음용 적기: 전체</option>
          <option value="ready_now">지금 마시기 좋은 와인</option>
          <option value="closing_soon">마감 임박 (올해~내년)</option>
          <option value="past_peak">적기 경과</option>
          <option value="too_young">숙성 중</option>
        </select>

        <button
          type="button"
          onClick={() =>
            setFilters({
              drinkingWindow: filters.drinkingWindow === 'ready_now' ? '' : 'ready_now',
            })
          }
          className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-bold transition-colors ${
            filters.drinkingWindow === 'ready_now'
              ? 'border-status-ok bg-status-ok/15 text-status-ok'
              : 'border-subtle bg-surface text-secondary hover:border-forest hover:text-forest'
          }`}
          title="지금 마시기 좋은 와인만 모아보기"
        >
          <Clock className="h-3.5 w-3.5" />
          <span>지금 적기</span>
        </button>

        {/* 정렬 */}
        <div className="ml-auto flex items-center gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5 text-secondary" />
          <select
            aria-label="정렬 기준"
            value={filters.sortBy}
            onChange={(e) => setFilters({ sortBy: e.target.value as InventorySortKey })}
            className="rounded-xl border border-subtle bg-surface px-2.5 py-1.5 text-xs font-semibold text-primary focus:border-forest focus:outline-none"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 지역 선택 시 하위 세부지역(마을·밭) 퀵 칩 */}
      {filters.region && subRegionCounts.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
          <button
            type="button"
            onClick={() => setFilters({ subRegion: '' })}
            className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
              !filters.subRegion
                ? 'bg-forest/15 text-forest'
                : 'bg-elevated text-secondary hover:text-primary'
            }`}
          >
            {filters.region} 전체
          </button>
          {subRegionCounts.map(([sub, cnt]) => (
            <button
              key={sub}
              type="button"
              onClick={() => setFilters({ subRegion: filters.subRegion === sub ? '' : sub })}
              className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold tabular-nums transition-colors ${
                filters.subRegion === sub
                  ? 'bg-forest text-white'
                  : 'bg-elevated text-secondary hover:text-primary'
              }`}
            >
              {sub} <span className="opacity-75">{cnt}</span>
            </button>
          ))}
        </div>
      )}

      {/* 국가만 선택했을 때 지역 퀵 칩 */}
      {filters.country && !filters.region && regionCounts.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
          <button
            type="button"
            onClick={() => setFilters({ region: '', subRegion: '' })}
            className="shrink-0 rounded-lg bg-forest/15 px-2.5 py-1 text-[11px] font-bold text-forest"
          >
            {filters.country} 전체
          </button>
          {regionCounts.map(([region, cnt]) => (
            <button
              key={region}
              type="button"
              onClick={() => setFilters({ region, subRegion: '' })}
              className="shrink-0 rounded-lg bg-elevated px-2.5 py-1 text-[11px] font-semibold tabular-nums text-secondary hover:text-primary"
            >
              {region} <span className="opacity-75">{cnt}</span>
            </button>
          ))}
        </div>
      )}

      {/* 하단 보조 바: 품절 포함 토글 & 필터 초기화 */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-secondary hover:text-primary">
          <input
            type="checkbox"
            checked={filters.includeOutOfStock}
            onChange={(e) => setFilters({ includeOutOfStock: e.target.checked })}
            className="h-3.5 w-3.5 rounded accent-forest"
          />
          <span>품절 / 소비완료 와인 포함</span>
        </label>

        {hasActiveFilter && (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-burgundy hover:bg-burgundy/10"
          >
            <RotateCcw className="h-3 w-3" />
            <span>필터 초기화</span>
          </button>
        )}
      </div>
    </div>
  );
}
