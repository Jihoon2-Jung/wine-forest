import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Clock,
  Eye,
  EyeOff,
  LayoutGrid,
  List,
  MapPin,
  Moon,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sun,
  Wine,
  X,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { WINE_COLORS, WINE_COLOR_LABELS, type WineColor } from '@/types/schema';
import {
  compareVintage,
  DRINKING_WINDOW_BADGE_META,
  formatBottleSizeBadge,
  formatCompactKrw,
  formatDrinkingWindowRange,
  formatKrw,
  formatWineOrigin,
  getDrinkingWindowStatus,
} from '@/services/domain/wineHelpers';
import {
  decodeSharedPayload,
  type DecodeShareErrorReason,
  type SharedWineItem,
  type SharedWineListPayload,
} from '@/services/share/shareCodec';
import { useWineStore } from '@/store/useWineStore';
import { ToastBar } from '@/components/common/ToastBar';
import {
  getWineColorBorderCssVar,
  getWineColorCssVar,
  getWineColorFgCssVar,
  WineColorBadge,
} from '@/components/common/WineColorBadge';

type SharedSortKey =
  | 'snapshot'
  | 'vintage_asc'
  | 'vintage_desc'
  | 'quantity_desc'
  | 'name_asc'
  | 'price_desc'
  | 'price_asc';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; reason: DecodeShareErrorReason; message: string }
  | { status: 'expired'; payload: SharedWineListPayload }
  | { status: 'ready'; payload: SharedWineListPayload };

function formatSharedPrice(item: SharedWineItem, hidePrice: boolean): string | null {
  if (item.avgPrice === undefined) return null;
  const prefix = item.isPriceUniform === false ? '평균 ' : '';
  if (hidePrice) {
    return `${prefix}••••원`;
  }
  return `${prefix}${formatKrw(item.avgPrice)}`;
}

export function SharedListPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const hasLocalDb = useWineStore((s) => Boolean(s.db));
  const theme = useWineStore((s) => s.theme);
  const toggleTheme = useWineStore((s) => s.toggleTheme);

  const rawToken = searchParams.get('d');
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });

  // 수신자 전용 독립 필터/뷰 상태 (전역 useWineStore.filters · isPrivacyMode 절대 미사용)
  const [query, setQuery] = useState('');
  const [selectedColors, setSelectedColors] = useState<WineColor[]>([]);
  const [onlyReadyNow, setOnlyReadyNow] = useState(false);
  const [sortBy, setSortBy] = useState<SharedSortKey>('snapshot');
  const [compactView, setCompactView] = useState(false);
  const [hidePrice, setHidePrice] = useState(false);

  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: 'loading' });
    setQuery('');
    setSelectedColors([]);
    setOnlyReadyNow(false);
    setSortBy('snapshot');
    setHidePrice(false);

    void decodeSharedPayload(rawToken).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setLoadState({ status: 'error', reason: res.reason, message: res.message });
        return;
      }
      if (res.isExpired) {
        setLoadState({ status: 'expired', payload: res.payload });
        return;
      }
      setLoadState({ status: 'ready', payload: res.payload });
    });

    return () => {
      cancelled = true;
    };
  }, [rawToken]);

  const readyPayload = loadState.status === 'ready' ? loadState.payload : null;

  const hasPriceData = Boolean(
    readyPayload?.options.includePrice &&
      readyPayload.items.some((item) => item.avgPrice !== undefined),
  );

  const hasDrinkingWindowData = Boolean(
    readyPayload?.items.some(
      (item) => item.drinkingWindowStart != null || item.drinkingWindowEnd != null,
    ),
  );

  // 가격이 숨겨졌을 때 가격 정렬이 남아 있지 않도록 안전 복귀
  useEffect(() => {
    if ((hidePrice || !hasPriceData) && (sortBy === 'price_desc' || sortBy === 'price_asc')) {
      setSortBy('snapshot');
    }
  }, [hidePrice, hasPriceData, sortBy]);

  const { filteredItems, filteredTotalBottles, filteredTotalValue } = useMemo(() => {
    if (!readyPayload) {
      return {
        filteredItems: [] as SharedWineItem[],
        filteredTotalBottles: 0,
        filteredTotalValue: 0,
      };
    }

    const list = readyPayload.items.filter((item) => {
      if (selectedColors.length > 0 && !selectedColors.includes(item.color)) {
        return false;
      }
      if (onlyReadyNow) {
        const dw = getDrinkingWindowStatus({
          drinkingWindowStart: item.drinkingWindowStart ?? null,
          drinkingWindowEnd: item.drinkingWindowEnd ?? null,
        });
        if (dw !== 'ready' && dw !== 'closing_soon') {
          return false;
        }
      }
      if (deferredQuery) {
        const haystack = [
          item.name,
          item.producer ?? '',
          item.country,
          item.region,
          item.subRegion ?? '',
          item.vintage,
          item.purchaseSource ?? '',
          item.locationSummary ?? '',
          item.memo ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(deferredQuery)) {
          return false;
        }
      }
      return true;
    });

    const sorted = [...list];
    if (sortBy !== 'snapshot') {
      sorted.sort((a, b) => {
        switch (sortBy) {
          case 'vintage_asc':
            return compareVintage(a.vintage, b.vintage, 'asc') || a.name.localeCompare(b.name, 'ko');
          case 'vintage_desc':
            return (
              compareVintage(a.vintage, b.vintage, 'desc') || a.name.localeCompare(b.name, 'ko')
            );
          case 'quantity_desc':
            return b.quantity - a.quantity || a.name.localeCompare(b.name, 'ko');
          case 'name_asc':
            return a.name.localeCompare(b.name, 'ko');
          case 'price_desc':
            return (b.avgPrice ?? 0) - (a.avgPrice ?? 0) || a.name.localeCompare(b.name, 'ko');
          case 'price_asc':
            return (a.avgPrice ?? 0) - (b.avgPrice ?? 0) || a.name.localeCompare(b.name, 'ko');
          default:
            return 0;
        }
      });
    }

    let bottles = 0;
    let totalValue = 0;
    for (const item of sorted) {
      bottles += item.quantity;
      if (item.avgPrice !== undefined && item.quantity > 0) {
        totalValue += item.avgPrice * item.quantity;
      }
    }

    return {
      filteredItems: sorted,
      filteredTotalBottles: bottles,
      filteredTotalValue: totalValue,
    };
  }, [readyPayload, selectedColors, onlyReadyNow, deferredQuery, sortBy]);

  const toggleColor = (color: WineColor) => {
    setSelectedColors((prev) =>
      prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color],
    );
  };

  const hasActiveLocalFilter =
    Boolean(query.trim()) || selectedColors.length > 0 || onlyReadyNow;

  const resetLocalFilters = () => {
    setQuery('');
    setSelectedColors([]);
    setOnlyReadyNow(false);
    setSortBy('snapshot');
  };

  return (
    <div className="min-h-dvh bg-canvas text-primary">
      {/* 상단 고정 헤더 (Safe-Area 대응) */}
      <header className="sticky top-0 z-30 border-b border-subtle bg-surface/90 pt-safe backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <img
              src={`${import.meta.env.BASE_URL}favicon.svg`}
              alt="JH Wine Forest"
              className="h-8 w-8 shrink-0 rounded-xl shadow-sm"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-serif text-sm font-bold text-primary">
                  JH Wine Forest
                </span>
                <span className="shrink-0 rounded-full bg-forest/15 px-2 py-0.5 text-[10px] font-bold text-forest">
                  읽기 전용 공유
                </span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {hasPriceData && (
              <button
                type="button"
                onClick={() => setHidePrice((prev) => !prev)}
                className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  hidePrice
                    ? 'border-forest bg-forest/10 text-forest'
                    : 'border-subtle bg-elevated text-secondary hover:text-primary'
                }`}
                aria-label={hidePrice ? '공유 금액 보기' : '공유 금액 가리기'}
                title={hidePrice ? '금액 보기' : '금액 가리기'}
              >
                {hidePrice ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{hidePrice ? '금액 숨김' : '금액 가리기'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-subtle bg-elevated text-secondary transition-colors hover:text-primary"
              aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
              title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {hasLocalDb && (
              <button
                type="button"
                onClick={() => navigate('/')}
                className="inline-flex items-center gap-1 rounded-xl bg-forest px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-forest-hover"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>내 셀러</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5 pb-[calc(3rem+env(safe-area-inset-bottom,0px))]">
        {loadState.status === 'loading' && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <img
              src={`${import.meta.env.BASE_URL}favicon.svg`}
              alt="JH Wine Forest"
              className="h-12 w-12 animate-pulse rounded-2xl"
            />
            <p className="mt-3 text-sm font-semibold text-secondary">
              공유된 와인 리스트를 불러오는 중...
            </p>
          </div>
        )}

        {loadState.status === 'error' && (
          <div className="mx-auto mt-10 max-w-md rounded-3xl border border-subtle bg-surface p-6 text-center shadow-card">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-status-danger/10 text-status-danger">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h1 className="mt-4 text-base font-bold text-primary">
              공유 링크를 열 수 없습니다
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-secondary">{loadState.message}</p>
            {(loadState.reason === 'corrupted_encoding' ||
              loadState.reason === 'invalid_schema' ||
              loadState.reason === 'unsupported_prefix') && (
              <p className="mt-2 text-[11px] leading-relaxed text-secondary">
                보낸 분께 필터 범위를 줄이거나 [텍스트 목록 복사]로 다시 요청해 보세요.
              </p>
            )}
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white hover:bg-forest-hover"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>{hasLocalDb ? '내 셀러로 돌아가기' : 'JH Wine Forest 홈으로'}</span>
              </button>
            </div>
          </div>
        )}

        {loadState.status === 'expired' && (
          <div className="mx-auto mt-10 max-w-md rounded-3xl border border-subtle bg-surface p-6 text-center shadow-card">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-status-warn/15 text-status-warn">
              <Clock className="h-6 w-6" />
            </div>
            <h1 className="mt-4 text-base font-bold text-primary">만료된 공유 리스트입니다</h1>
            <p className="mt-1.5 text-sm font-semibold text-primary">
              {loadState.payload.title}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-secondary">
              열람 기한({loadState.payload.expiresAt})이 지나 화면 표시가 종료되었습니다. 보낸 분에게 최신 공유 링크를 다시 요청해 주세요.
            </p>
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white hover:bg-forest-hover"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>{hasLocalDb ? '내 셀러로 돌아가기' : 'JH Wine Forest 홈으로'}</span>
              </button>
            </div>
          </div>
        )}

        {loadState.status === 'ready' && readyPayload && (
          <div className="space-y-4">
            {/* 공유 리스트 메타 헤더 카드 */}
            <section className="rounded-2xl border border-subtle bg-surface p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1.5">
                  <h1 className="font-serif text-lg font-bold leading-snug text-primary sm:text-xl">
                    {readyPayload.title}
                  </h1>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-secondary">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-elevated px-2 py-0.5 font-medium">
                      <Calendar className="h-3 w-3 text-forest" />
                      <span>{readyPayload.generatedAt} 스냅샷</span>
                    </span>
                    {readyPayload.filterSummary && (
                      <span className="rounded-lg bg-forest/10 px-2 py-0.5 font-semibold text-forest">
                        {readyPayload.filterSummary}
                      </span>
                    )}
                    {readyPayload.expiresAt && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-status-warn/10 px-2 py-0.5 font-semibold text-status-warn">
                        <Clock className="h-3 w-3" />
                        <span>~ {readyPayload.expiresAt}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* 데스크톱 카드/컴팩트 보기 전환 */}
                <div className="hidden items-center gap-1 rounded-xl border border-subtle bg-elevated p-0.5 md:flex">
                  <button
                    type="button"
                    onClick={() => setCompactView(false)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                      !compactView
                        ? 'bg-surface text-primary shadow-sm'
                        : 'text-secondary hover:text-primary'
                    }`}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    <span>카드</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompactView(true)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                      compactView
                        ? 'bg-surface text-primary shadow-sm'
                        : 'text-secondary hover:text-primary'
                    }`}
                  >
                    <List className="h-3.5 w-3.5" />
                    <span>컴팩트</span>
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-subtle pt-3 text-sm">
                <span className="font-bold text-primary tabular-nums">
                  표시 중 <strong className="text-forest">{filteredTotalBottles}병</strong> ·{' '}
                  {filteredItems.length}종
                </span>
                {filteredItems.length !== readyPayload.items.length && (
                  <span className="text-xs text-secondary tabular-nums">
                    (전체 {readyPayload.items.length}종 중)
                  </span>
                )}
                {hasPriceData && (
                  <>
                    <span className="text-subtle">|</span>
                    <span className="text-xs text-secondary tabular-nums">
                      예상 총액{' '}
                      <strong className="text-sm font-extrabold text-primary">
                        {hidePrice ? '••••원' : formatKrw(filteredTotalValue)}
                      </strong>
                    </span>
                  </>
                )}
              </div>
            </section>

            {/* 수신자용 검색 · 색상 필터 · 정렬 바 */}
            <section className="space-y-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="와인명, 생산자, 국가, 지역, 빈티지 검색..."
                  className="w-full rounded-2xl border border-subtle bg-surface py-2.5 pl-10 pr-10 text-sm text-primary shadow-card placeholder:text-secondary/70 focus:border-forest focus:outline-none"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-secondary hover:bg-elevated hover:text-primary"
                    aria-label="검색어 지우기"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                  <button
                    type="button"
                    onClick={() => setSelectedColors([])}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                      selectedColors.length === 0
                        ? 'border-forest bg-forest text-white'
                        : 'border-subtle bg-surface text-secondary hover:text-primary'
                    }`}
                  >
                    전체 색상
                  </button>
                  {WINE_COLORS.map((c) => {
                    const active = selectedColors.includes(c);
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
                        <span className="hidden font-medium opacity-85 sm:inline">
                          {WINE_COLOR_LABELS[c]}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {hasDrinkingWindowData && (
                  <button
                    type="button"
                    onClick={() => setOnlyReadyNow((prev) => !prev)}
                    className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-bold transition-colors ${
                      onlyReadyNow
                        ? 'border-status-ok bg-status-ok/15 text-status-ok'
                        : 'border-subtle bg-surface text-secondary hover:border-forest hover:text-forest'
                    }`}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    <span>지금 적기</span>
                  </button>
                )}

                <div className="ml-auto flex items-center gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-secondary" />
                  <select
                    aria-label="공유 리스트 정렬 기준"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SharedSortKey)}
                    className="rounded-xl border border-subtle bg-surface px-2.5 py-1.5 text-xs font-semibold text-primary focus:border-forest focus:outline-none"
                  >
                    <option value="snapshot">기본 순서</option>
                    <option value="vintage_asc">빈티지 오래된순</option>
                    <option value="vintage_desc">빈티지 최신순</option>
                    <option value="quantity_desc">보유 수량순</option>
                    <option value="name_asc">가나다순</option>
                    {hasPriceData && !hidePrice && (
                      <>
                        <option value="price_desc">가격 높은순</option>
                        <option value="price_asc">가격 낮은순</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              {hasActiveLocalFilter && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={resetLocalFilters}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-burgundy hover:bg-burgundy/10"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>필터 초기화</span>
                  </button>
                </div>
              )}
            </section>

            {/* 와인 목록 */}
            {filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-subtle bg-surface/60 px-6 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-forest/10 text-forest">
                  <Wine className="h-6 w-6" />
                </div>
                <p className="mt-3 text-sm font-bold text-primary">
                  {readyPayload.items.length === 0
                    ? '공유된 와인이 없습니다'
                    : '조건에 맞는 와인이 없습니다'}
                </p>
                {hasActiveLocalFilter && (
                  <button
                    type="button"
                    onClick={resetLocalFilters}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-subtle bg-surface px-3.5 py-2 text-xs font-bold text-primary hover:bg-elevated"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>필터 초기화</span>
                  </button>
                )}
              </div>
            ) : compactView ? (
              <div className="space-y-2">
                {filteredItems.map((item, idx) => {
                  const sizeBadge = formatBottleSizeBadge(item.bottleSizeMl);
                  const dwStatus = getDrinkingWindowStatus({
                    drinkingWindowStart: item.drinkingWindowStart ?? null,
                    drinkingWindowEnd: item.drinkingWindowEnd ?? null,
                  });
                  const dwRange = formatDrinkingWindowRange({
                    drinkingWindowStart: item.drinkingWindowStart ?? null,
                    drinkingWindowEnd: item.drinkingWindowEnd ?? null,
                  });
                  const dwMeta = dwStatus !== 'unset' ? DRINKING_WINDOW_BADGE_META[dwStatus] : null;
                  const priceLabel = formatSharedPrice(item, hidePrice);

                  return (
                    <article
                      key={`${item.name}-${item.vintage}-${item.color}-${idx}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-subtle bg-surface px-3.5 py-2.5 shadow-card"
                    >
                      <WineColorBadge color={item.color} />
                      <span className="w-11 shrink-0 font-serif text-xs font-bold tabular-nums text-gold">
                        {item.vintage}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-bold text-primary">{item.name}</span>
                          {sizeBadge && (
                            <span className="shrink-0 rounded bg-elevated px-1.5 py-0.5 text-[10px] font-semibold text-secondary">
                              {sizeBadge}
                            </span>
                          )}
                          {dwMeta && (
                            <span
                              className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${dwMeta.className}`}
                            >
                              {dwMeta.shortLabel}
                              {dwRange ? ` ${dwRange}` : ''}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-secondary">
                          {formatWineOrigin(item)}
                          {item.producer ? ` · ${item.producer}` : ''}
                          {item.locationSummary ? ` · ${item.locationSummary}` : ''}
                        </div>
                      </div>
                      {priceLabel && (
                        <span className="shrink-0 text-xs font-bold tabular-nums text-primary">
                          {priceLabel}
                        </span>
                      )}
                      <span
                        className={`shrink-0 rounded-lg px-2 py-1 text-xs font-extrabold tabular-nums ${
                          item.quantity > 0
                            ? 'bg-forest/[0.12] text-forest'
                            : 'bg-elevated text-secondary'
                        }`}
                      >
                        {item.quantity > 0 ? `×${item.quantity}` : '품절'}
                      </span>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {filteredItems.map((item, idx) => {
                  const sizeBadge = formatBottleSizeBadge(item.bottleSizeMl);
                  const dwStatus = getDrinkingWindowStatus({
                    drinkingWindowStart: item.drinkingWindowStart ?? null,
                    drinkingWindowEnd: item.drinkingWindowEnd ?? null,
                  });
                  const dwRange = formatDrinkingWindowRange({
                    drinkingWindowStart: item.drinkingWindowStart ?? null,
                    drinkingWindowEnd: item.drinkingWindowEnd ?? null,
                  });
                  const dwMeta = dwStatus !== 'unset' ? DRINKING_WINDOW_BADGE_META[dwStatus] : null;
                  const priceLabel = formatSharedPrice(item, hidePrice);

                  return (
                    <article
                      key={`${item.name}-${item.vintage}-${item.color}-${idx}`}
                      className={`flex min-w-0 flex-col justify-between gap-2.5 rounded-2xl border border-subtle bg-surface p-4 shadow-card transition-colors hover:border-forest/35 ${
                        item.quantity === 0 ? 'opacity-75' : ''
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <WineColorBadge color={item.color} showLabel />
                            <span className="font-serif text-xs font-bold tabular-nums text-gold">
                              {item.vintage}
                            </span>
                            {sizeBadge && (
                              <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] font-semibold text-secondary">
                                {sizeBadge}
                              </span>
                            )}
                          </div>
                          <span
                            className={`inline-flex shrink-0 items-center justify-center rounded-xl px-2.5 py-1 text-xs font-extrabold tabular-nums ${
                              item.quantity > 0
                                ? 'bg-forest/[0.12] text-forest'
                                : 'bg-elevated text-secondary'
                            }`}
                          >
                            {item.quantity > 0 ? `${item.quantity}병` : '품절'}
                          </span>
                        </div>

                        <h2 className="text-[15px] font-bold leading-snug text-primary">
                          {item.name}
                        </h2>
                        {item.producer && (
                          <p className="text-xs font-medium text-secondary">{item.producer}</p>
                        )}
                        <p className="text-xs text-secondary">{formatWineOrigin(item)}</p>

                        {dwMeta && (
                          <div className="pt-0.5">
                            <span
                              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${dwMeta.className}`}
                            >
                              {dwMeta.label}
                              {dwRange ? ` (${dwRange})` : ''}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* 선택 포함 메타데이터 (옵션 ON + 값 존재 시에만 렌더링) */}
                      {(item.locationSummary ||
                        priceLabel ||
                        item.purchaseSource ||
                        item.latestPurchaseDate ||
                        item.memo) && (
                        <div className="space-y-1.5 border-t border-subtle pt-2.5 text-xs">
                          {(item.locationSummary || priceLabel) && (
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              {item.locationSummary ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-elevated px-2 py-0.5 text-[11px] font-medium text-secondary">
                                  <MapPin className="h-3 w-3 shrink-0 text-forest" />
                                  <span>{item.locationSummary}</span>
                                </span>
                              ) : (
                                <span />
                              )}

                              {priceLabel && (
                                <div className="text-right tabular-nums">
                                  <span className="font-bold text-primary">{priceLabel}</span>
                                  {!hidePrice &&
                                    item.isPriceUniform === false &&
                                    item.minPrice !== undefined &&
                                    item.maxPrice !== undefined && (
                                      <span className="ml-1.5 text-[10px] text-secondary">
                                        ({formatCompactKrw(item.minPrice)}~
                                        {formatCompactKrw(item.maxPrice)})
                                      </span>
                                    )}
                                  {!hidePrice && item.fxNote && (
                                    <div className="text-[10px] text-secondary">{item.fxNote}</div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {(item.purchaseSource || item.latestPurchaseDate) && (
                            <p className="text-[11px] text-secondary tabular-nums">
                              구입:{' '}
                              {[item.purchaseSource, item.latestPurchaseDate]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          )}

                          {item.memo && (
                            <p className="rounded-xl bg-elevated px-2.5 py-2 text-[11px] leading-relaxed text-secondary">
                              {item.memo}
                            </p>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {/* 푸터 */}
            <footer className="mt-8 border-t border-subtle pt-5 text-center text-xs text-secondary">
              <p>본 페이지는 {readyPayload.generatedAt} 시점의 읽기 전용 스냅샷입니다.</p>
              {!hasLocalDb && (
                <p className="mt-1.5">
                  나만의 와인 셀러를 관리해 보세요.{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/')}
                    className="font-bold text-forest underline underline-offset-2 hover:text-forest-hover"
                  >
                    JH Wine Forest 시작하기
                  </button>
                </p>
              )}
            </footer>
          </div>
        )}
      </main>

      <ToastBar hasSidebar={false} />
    </div>
  );
}
