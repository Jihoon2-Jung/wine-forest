import { ChevronDown, ChevronUp, Minus, Plus, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  WINE_COLORS,
  WINE_COLOR_LABELS,
  type WineColor,
  type WineMaster,
} from '@/types/schema';
import { getTodayIsoDate, formatWineOrigin, shouldIncludeInTrackingSince } from '@/services/domain/wineHelpers';
import { estimateDrinkingWindow } from '@/services/domain/drinkingWindowEstimator';
import { useWineStore } from '@/store/useWineStore';
import { BottomSheet } from '@/components/common/BottomSheet';
import {
  getWineColorBorderCssVar,
  getWineColorCssVar,
  getWineColorFgCssVar,
} from '@/components/common/WineColorBadge';

const PRESET_COUNTRIES = ['프랑스', '이탈리아', '미국', '독일', '스페인', '호주', '뉴질랜드', '칠레', '아르헨티나', '포르투갈', '헝가리', '오스트리아'];
const PRESET_REGIONS_BY_COUNTRY: Record<string, string[]> = {
  프랑스: ['부르고뉴', '보르도', '상파뉴', '루아르', '론', '알자스', '보졸레', '랑그독', '프로방스', '프랑스'],
  이탈리아: ['토스카나', '피에몬테', '베네토', '풀리아', '시칠리아', '아브루쪼', '라찌오', '이탈리아'],
  미국: ['나파', '소노마', '오레곤', '캘리포니아', '워싱턴'],
  독일: ['모젤', '팔츠', '라인헤센', '라인가우'],
  스페인: ['리오하', '리베라 델 두에로', '프리오랏', '카바', '헤레스', '토로', '후미야'],
};
const PRESET_SUBREGIONS_BY_REGION: Record<string, string[]> = {
  부르고뉴: ['에세죠', '클로 드 부조', '본 로마네', '샹볼 뮈지니', '쥬브레 샹베르탱', '볼네', '뽀마르', '뫼르소', '샤샤뉴 몽라쉐', '샤블리', '마콩', '본', '옥세 뒤레스', '오뜨 꼬뜨 드 뉘'],
  보르도: ['뽀이약', '마고', '생줄리앙', '생테스테프', '페삭 레오냥', '생떼밀리옹', '소떼른', '바르삭', '오 메독'],
  토스카나: ['볼게리', '몬탈치노', '키안티 클라시코', '코르토나'],
  피에몬테: ['바롤로', '바르바레스코', '랑게', '알바', '아스티'],
  나파: ['오크빌', '스택스 립', '칼리스토가'],
  소노마: ['소노마 코스트', '카네로스', '페탈루마 갭'],
  오레곤: ['윌라멧 밸리'],
};

export function QuickAddModal() {
  const isOpen = useWineStore((s) => s.isQuickAddOpen);
  const presetWineId = useWineStore((s) => s.quickAddPresetWineId);
  const closeQuickAdd = useWineStore((s) => s.closeQuickAdd);
  const db = useWineStore((s) => s.db);
  const addBottles = useWineStore((s) => s.addBottles);

  const [name, setName] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [vintage, setVintage] = useState(String(new Date().getFullYear() - 3));
  const [vintageHintActive, setVintageHintActive] = useState(false);
  const vintageInputRef = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState<WineColor>('R');
  const [country, setCountry] = useState('프랑스');
  const [region, setRegion] = useState('부르고뉴');
  const [subRegion, setSubRegion] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [priceStr, setPriceStr] = useState('');
  const [locationId, setLocationId] = useState<string>('');
  const [purchaseDate, setPurchaseDate] = useState(getTodayIsoDate());
  const [purchaseSource, setPurchaseSource] = useState('');

  // Optional accordion
  const [showExtra, setShowExtra] = useState(false);
  const [bottleSizeMl, setBottleSizeMl] = useState(750);
  const [producer, setProducer] = useState('');
  const [fxNote, setFxNote] = useState('');
  const [memo, setMemo] = useState('');
  const [dwStartStr, setDwStartStr] = useState('');
  const [dwEndStr, setDwEndStr] = useState('');
  const [dwManualOverride, setDwManualOverride] = useState(false);
  const [includeTracking, setIncludeTracking] = useState(true);
  const [trackingManualOverride, setTrackingManualOverride] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const trackingSinceDate = db?.metadata.trackingSinceDate ?? '2023-02-18';

  // 기존 위치별 사용량 계산
  const locationOptions = useMemo(() => {
    if (!db) return [];
    const usedMap = new Map<string, number>();
    for (const b of db.bottles) {
      if (b.status === 'IN_STOCK' && b.locationId) {
        usedMap.set(b.locationId, (usedMap.get(b.locationId) ?? 0) + 1);
      }
    }
    return [...db.locations]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((loc) => {
        const used = usedMap.get(loc.id) ?? 0;
        return { ...loc, used, remain: loc.maxCapacity - used };
      });
  }, [db]);

  // 자주 사용한 구매처 Top 5
  const topSources = useMemo(() => {
    if (!db) return ['와인앤모어', '이마트', '코스트코', '직구'];
    const counts = new Map<string, number>();
    for (const b of db.bottles) {
      const s = b.purchaseSource.trim();
      if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    const sorted = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => k);
    return sorted.length > 0 ? sorted : ['와인앤모어', '이마트', '코스트코', '직구'];
  }, [db]);

  // 기존 국가 / 세부지역 자동완성 후보
  const countryCandidates = useMemo(() => {
    const set = new Set<string>(PRESET_COUNTRIES);
    db?.wines.forEach((w) => set.add(w.country));
    return [...set];
  }, [db]);

  const regionCandidates = useMemo(() => {
    const set = new Set<string>(PRESET_REGIONS_BY_COUNTRY[country] ?? []);
    db?.wines.forEach((w) => {
      if (w.country === country) set.add(w.region);
    });
    return [...set];
  }, [db, country]);

  const subRegionCandidates = useMemo(() => {
    const set = new Set<string>(PRESET_SUBREGIONS_BY_REGION[region] ?? []);
    db?.wines.forEach((w) => {
      if (w.region === region && w.subRegion) set.add(w.subRegion);
    });
    return [...set];
  }, [db, region]);

  // 와인명 자동완성 제안
  const wineSuggestions = useMemo(() => {
    if (!db || !name.trim()) return [];
    const q = name.trim().toLowerCase();
    return db.wines
      .filter((w) => w.name.toLowerCase().includes(q) || w.producer?.toLowerCase().includes(q))
      .slice(0, 6);
  }, [db, name]);

  // ④ 버그 수정: 모달이 열려 있는 동안 백그라운드 동기화로 db 참조가 갱신되어도
  // 사용자가 작성 중인 입력 폼이 초기화되지 않도록 최신 참조는 ref로만 읽고
  // isOpen 전환(false -> true) 또는 presetWineId 변경 시에만 초기화
  const latestInitRef = useRef({ db, trackingSinceDate, locationOptions });
  latestInitRef.current = { db, trackingSinceDate, locationOptions };

  useEffect(() => {
    if (!isOpen) return;
    const {
      db: currentDb,
      trackingSinceDate: currentTrackingDate,
      locationOptions: currentLocs,
    } = latestInitRef.current;

    setErrorMsg(null);
    setShowExtra(false);
    setTrackingManualOverride(false);
    const today = getTodayIsoDate();
    setPurchaseDate(today);
    setIncludeTracking(shouldIncludeInTrackingSince(today, currentTrackingDate));
    setQuantity(1);
    setPriceStr('');
    setFxNote('');
    setMemo('');
    setPurchaseSource('');
    setLocationId(currentLocs[0]?.id ?? '');

    if (presetWineId && currentDb) {
      const found = currentDb.wines.find((w) => w.id === presetWineId);
      if (found) {
        setName(found.name);
        setVintage(found.vintage);
        setColor(found.color);
        setCountry(found.country);
        setRegion(found.region);
        setSubRegion(found.subRegion ?? '');
        setBottleSizeMl(found.bottleSizeMl);
        setProducer(found.producer ?? '');
        const hasExistingDw =
          found.drinkingWindowStart != null || found.drinkingWindowEnd != null;
        setDwStartStr(found.drinkingWindowStart ? String(found.drinkingWindowStart) : '');
        setDwEndStr(found.drinkingWindowEnd ? String(found.drinkingWindowEnd) : '');
        setDwManualOverride(hasExistingDw);
        return;
      }
    }

    setName('');
    setVintage(String(new Date().getFullYear() - 3));
    setColor('R');
    setCountry('프랑스');
    setRegion('부르고뉴');
    setSubRegion('');
    setBottleSizeMl(750);
    setProducer('');
    setDwStartStr('');
    setDwEndStr('');
    setDwManualOverride(false);
  }, [isOpen, presetWineId]);

  const dwReferenceYear = /^\d{4}/.test(purchaseDate)
    ? Number(purchaseDate.slice(0, 4))
    : new Date().getFullYear();

  const dwEstimate = useMemo(
    () =>
      estimateDrinkingWindow({
        name,
        country,
        region,
        subRegion,
        color,
        vintage,
        referenceYear: dwReferenceYear,
      }),
    [name, country, region, subRegion, color, vintage, dwReferenceYear],
  );

  // 신규 입력 시 지역·등급·색상·빈티지 기반 시음적기 자동 입력 (사용자 수동 수정 전까지 자동 갱신)
  useEffect(() => {
    if (!isOpen || dwManualOverride) return;
    if (dwEstimate) {
      setDwStartStr(String(dwEstimate.start));
      setDwEndStr(String(dwEstimate.end));
    } else {
      setDwStartStr('');
      setDwEndStr('');
    }
  }, [isOpen, dwManualOverride, dwEstimate]);

  const handlePurchaseDateChange = (val: string) => {
    setPurchaseDate(val);
    if (!trackingManualOverride) {
      setIncludeTracking(shouldIncludeInTrackingSince(val || null, trackingSinceDate));
    }
  };

  const applySuggestion = (w: WineMaster) => {
    setName(w.name);
    setColor(w.color);
    setCountry(w.country);
    setRegion(w.region);
    setSubRegion(w.subRegion ?? '');
    setVintage(w.vintage);
    setBottleSizeMl(w.bottleSizeMl);
    setProducer(w.producer ?? '');
    const hasExistingDw = w.drinkingWindowStart != null || w.drinkingWindowEnd != null;
    setDwStartStr(w.drinkingWindowStart ? String(w.drinkingWindowStart) : '');
    setDwEndStr(w.drinkingWindowEnd ? String(w.drinkingWindowEnd) : '');
    setDwManualOverride(hasExistingDw);
    setShowSuggestions(false);
    // T4 보강: 자동완성 후 빈티지 오입력 방지를 위해 하이라이트 및 포커스·선택
    setVintageHintActive(true);
    setTimeout(() => {
      vintageInputRef.current?.focus();
      vintageInputRef.current?.select();
    }, 30);
    setTimeout(() => setVintageHintActive(false), 3500);
  };

  const addQuickPrice = (delta: number) => {
    const current = Number(priceStr.replace(/[^0-9]/g, '')) || 0;
    setPriceStr(String(current + delta));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmedName = name.trim();
    const cleanVintage = vintage.trim().toUpperCase();
    if (!trimmedName) {
      setErrorMsg('와인명을 입력해 주세요.');
      return;
    }
    if (!/^(\d{4}|NV)$/.test(cleanVintage)) {
      setErrorMsg('빈티지는 4자리 연도(예: 2020) 또는 NV로 입력해 주세요.');
      return;
    }
    if (!country.trim()) {
      setErrorMsg('국가를 입력해 주세요.');
      return;
    }

    const numericPrice = Number(priceStr.replace(/[^0-9]/g, '')) || 0;
    const parsedDwStart = /^\d{4}$/.test(dwStartStr.trim()) ? Number(dwStartStr.trim()) : null;
    const parsedDwEnd = /^\d{4}$/.test(dwEndStr.trim()) ? Number(dwEndStr.trim()) : null;
    setSubmitting(true);
    try {
      await addBottles({
        name: trimmedName,
        producer: producer.trim() || undefined,
        country: country.trim(),
        region: region.trim() || country.trim(),
        subRegion: subRegion.trim() || undefined,
        color,
        vintage: cleanVintage,
        bottleSizeMl,
        quantity,
        purchasePrice: numericPrice,
        locationId: locationId || null,
        purchaseDate: purchaseDate || null,
        purchaseSource,
        fxNote: fxNote.trim() || undefined,
        memo: memo.trim() || undefined,
        includeInTrackingSince: includeTracking,
        drinkingWindowStart: parsedDwStart,
        drinkingWindowEnd: parsedDwEnd,
      });
      closeQuickAdd();
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !db) return null;

  const groupedLocs = locationOptions.reduce<Record<string, typeof locationOptions>>((acc, loc) => {
    if (!acc[loc.zone]) acc[loc.zone] = [];
    acc[loc.zone].push(loc);
    return acc;
  }, {});

  return (
    <BottomSheet
      open={isOpen}
      onClose={closeQuickAdd}
      title="와인 초고속 입고"
      subtitle="기존 와인은 자동완성으로 5초 만에 재입고할 수 있습니다."
      maxWidthClass="md:max-w-2xl"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {errorMsg && (
          <div className="rounded-xl border border-[var(--status-danger)]/40 bg-[var(--status-danger)]/10 px-3.5 py-2.5 text-xs font-semibold text-[var(--status-danger)]">
            {errorMsg}
          </div>
        )}

        {/* 1. 와인명 + 자동완성 */}
        <div className="relative space-y-1.5">
          <label className="text-xs font-bold text-secondary" htmlFor="add-wine-name">
            와인명 *
          </label>
          <input
            id="add-wine-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 180)}
            placeholder="예: Domaine Leflaive Bourgogne Blanc"
            autoComplete="off"
            className="w-full rounded-xl border border-subtle bg-elevated px-3.5 py-2.5 text-sm font-medium text-primary focus:border-forest focus:outline-none"
          />
          {showSuggestions && wineSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-xl border border-subtle bg-surface shadow-card-hover">
              {wineSuggestions.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onMouseDown={() => applySuggestion(w)}
                  className="flex w-full items-center justify-between gap-2 border-b border-subtle/60 px-3.5 py-2 text-left text-xs last:border-none hover:bg-elevated"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-primary">
                      <Sparkles className="mr-1 inline h-3 w-3 text-gold" />
                      {w.name}
                    </div>
                    <div className="text-[11px] text-secondary">
                      {formatWineOrigin(w)} · {w.bottleSizeMl}ml
                    </div>
                  </div>
                  <span className="shrink-0 rounded bg-elevated px-1.5 py-0.5 font-bold tabular-nums text-primary">
                    {w.color} {w.vintage}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 2. 빈티지 + 색상 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
          <div className="space-y-1.5 sm:col-span-4">
            <label className="flex items-center justify-between text-xs font-bold text-secondary" htmlFor="add-vintage">
              <span>빈티지 *</span>
              {vintageHintActive && (
                <span className="text-[10px] font-bold text-gold">빈티지 확인!</span>
              )}
            </label>
            <div className="flex gap-1.5">
              <input
                ref={vintageInputRef}
                id="add-vintage"
                type="text"
                value={vintage}
                onChange={(e) => {
                  setVintage(e.target.value);
                  setVintageHintActive(false);
                }}
                placeholder="2020"
                maxLength={4}
                className={`w-full rounded-xl border bg-elevated px-3 py-2 text-sm font-bold tabular-nums text-primary transition-all focus:border-forest focus:outline-none ${
                  vintageHintActive
                    ? 'border-gold ring-2 ring-gold/40'
                    : 'border-subtle'
                }`}
              />
              <button
                type="button"
                onClick={() => setVintage('NV')}
                className={`shrink-0 rounded-xl border px-3 text-xs font-bold transition-colors ${
                  vintage.toUpperCase() === 'NV'
                    ? 'border-gold bg-gold text-white'
                    : 'border-subtle bg-surface text-secondary hover:text-primary'
                }`}
              >
                NV
              </button>
            </div>
          </div>

          <div className="space-y-1.5 sm:col-span-8">
            <span className="block text-xs font-bold text-secondary">색상 *</span>
            <div className="grid grid-cols-5 gap-1.5">
              {WINE_COLORS.map((c) => {
                const active = color === c;
                const borderVar = getWineColorBorderCssVar(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`rounded-xl border py-2 text-xs font-bold transition-all ${
                      active
                        ? 'shadow-sm'
                        : 'border-subtle bg-elevated text-secondary hover:text-primary'
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
                    title={WINE_COLOR_LABELS[c]}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 3. 3단계 산지: 국가 → 지역 → 세부지역(선택) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-secondary" htmlFor="add-country">
              국가 *
            </label>
            <input
              id="add-country"
              list="country-suggestions"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="프랑스"
              className="w-full rounded-xl border border-subtle bg-elevated px-3 py-2 text-sm text-primary focus:border-forest focus:outline-none"
            />
            <datalist id="country-suggestions">
              {countryCandidates.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-secondary" htmlFor="add-region">
              지역 *
            </label>
            <input
              id="add-region"
              list="region-suggestions"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="부르고뉴 (VDF는 프랑스)"
              className="w-full rounded-xl border border-subtle bg-elevated px-3 py-2 text-sm text-primary focus:border-forest focus:outline-none"
            />
            <datalist id="region-suggestions">
              {regionCandidates.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-secondary" htmlFor="add-subregion">
              세부지역 (마을·밭, 선택)
            </label>
            <input
              id="add-subregion"
              list="subregion-suggestions"
              value={subRegion}
              onChange={(e) => setSubRegion(e.target.value)}
              placeholder="에세죠, 생줄리앙 (없으면 공란)"
              className="w-full rounded-xl border border-subtle bg-elevated px-3 py-2 text-sm text-primary focus:border-forest focus:outline-none"
            />
            <datalist id="subregion-suggestions">
              {subRegionCandidates.map((sr) => (
                <option key={sr} value={sr} />
              ))}
            </datalist>
          </div>
        </div>

        {/* 4. 수량 & 병당 구매가 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
          <div className="space-y-1.5 sm:col-span-4">
            <span className="block text-xs font-bold text-secondary">수량 (일괄 등록) *</span>
            <div className="flex items-center justify-between rounded-xl border border-subtle bg-elevated px-2 py-1">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="rounded-lg p-1.5 text-secondary hover:bg-surface hover:text-primary"
                aria-label="수량 감소"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="text-base font-bold tabular-nums text-primary">{quantity}병</span>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(60, q + 1))}
                className="rounded-lg p-1.5 text-secondary hover:bg-surface hover:text-primary"
                aria-label="수량 증가"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="space-y-1.5 sm:col-span-8">
            <label className="text-xs font-bold text-secondary" htmlFor="add-price">
              병당 구매가 (원) *
            </label>
            <input
              id="add-price"
              type="text"
              inputMode="numeric"
              value={priceStr}
              onChange={(e) => setPriceStr(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="0"
              className="w-full rounded-xl border border-subtle bg-elevated px-3.5 py-2 text-sm font-bold tabular-nums text-primary focus:border-forest focus:outline-none"
            />
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: '+1만', val: 10_000 },
                { label: '+5만', val: 50_000 },
                { label: '+10만', val: 100_000 },
              ].map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => addQuickPrice(chip.val)}
                  className="rounded-full border border-subtle bg-surface px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-secondary hover:border-forest hover:text-forest"
                >
                  {chip.label}
                </button>
              ))}
              {priceStr && (
                <button
                  type="button"
                  onClick={() => setPriceStr('')}
                  className="rounded-full border border-subtle bg-surface px-2.5 py-0.5 text-[11px] text-secondary hover:text-primary"
                >
                  초기화
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 5. 보관 위치 */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-secondary" htmlFor="add-location">
            보관 위치 *
          </label>
          <select
            id="add-location"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="w-full rounded-xl border border-subtle bg-elevated px-3.5 py-2.5 text-sm text-primary tabular-nums focus:border-forest focus:outline-none"
          >
            <option value="">미지정</option>
            {Object.entries(groupedLocs).map(([zone, locs]) => (
              <optgroup key={zone} label={zone}>
                {locs.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.displayName} ({loc.remain >= 0 ? `여유 ${loc.remain}` : `초과 ${loc.remain}`})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* 6. 구입일 & 구매처 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-secondary" htmlFor="add-date">
              구입일
            </label>
            <input
              id="add-date"
              type="date"
              value={purchaseDate}
              onChange={(e) => handlePurchaseDateChange(e.target.value)}
              className="w-full rounded-xl border border-subtle bg-elevated px-3 py-2 text-sm tabular-nums text-primary focus:border-forest focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-secondary" htmlFor="add-source">
              구매처
            </label>
            <input
              id="add-source"
              type="text"
              value={purchaseSource}
              onChange={(e) => setPurchaseSource(e.target.value)}
              placeholder="예: 와인앤모어, 이마트, 직구"
              className="w-full rounded-xl border border-subtle bg-elevated px-3 py-2 text-sm text-primary focus:border-forest focus:outline-none"
            />
            <div className="flex flex-wrap gap-1.5">
              {topSources.map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setPurchaseSource(src)}
                  className="rounded-full border border-subtle bg-surface px-2.5 py-0.5 text-[11px] font-medium text-secondary hover:border-forest hover:text-forest"
                >
                  {src}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 7. 추가 정보 아코디언 */}
        <div className="rounded-xl border border-subtle bg-elevated/50">
          <button
            type="button"
            onClick={() => setShowExtra((v) => !v)}
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-xs font-bold text-secondary hover:text-primary"
          >
            <span>
              추가 정보 (용량 · 음용 적기{dwStartStr && dwEndStr ? ` ${dwStartStr}~${dwEndStr}` : ''} · 생산자 · 외화)
            </span>
            {showExtra ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showExtra && (
            <div className="space-y-3 border-t border-subtle px-3.5 py-3">
              <div className="space-y-1.5">
                <span className="block text-xs font-semibold text-secondary">용량 (ml)</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[250, 375, 500, 750, 1500].map((ml) => (
                    <button
                      key={ml}
                      type="button"
                      onClick={() => setBottleSizeMl(ml)}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold tabular-nums ${
                        bottleSizeMl === ml
                          ? 'border-forest bg-forest text-white'
                          : 'border-subtle bg-surface text-secondary'
                      }`}
                    >
                      {ml}ml
                    </button>
                  ))}
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={50}
                      max={18000}
                      step={5}
                      aria-label="용량 직접 입력 (ml)"
                      value={bottleSizeMl || ''}
                      onChange={(e) => {
                        const parsed = Number(e.target.value);
                        if (!Number.isNaN(parsed)) {
                          setBottleSizeMl(Math.max(0, Math.round(parsed)));
                        }
                      }}
                      onBlur={() => {
                        if (!bottleSizeMl || bottleSizeMl < 50) {
                          setBottleSizeMl(750);
                        }
                      }}
                      className="w-20 rounded-lg border border-subtle bg-surface px-2 py-1.5 text-xs font-bold tabular-nums text-primary focus:border-forest focus:outline-none"
                    />
                    <span className="text-[11px] font-semibold text-secondary">ml</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <input
                  type="text"
                  value={producer}
                  onChange={(e) => setProducer(e.target.value)}
                  placeholder="생산자 (선택)"
                  className="rounded-xl border border-subtle bg-surface px-3 py-2 text-xs text-primary focus:border-forest focus:outline-none"
                />
                <input
                  type="text"
                  value={fxNote}
                  onChange={(e) => setFxNote(e.target.value)}
                  placeholder="외화/직구 메모 (예: 95유로, 9715엔)"
                  className="rounded-xl border border-subtle bg-surface px-3 py-2 text-xs text-primary focus:border-forest focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                  <span className="font-semibold text-secondary">
                    음용 적기 (시작 ~ 종료연도)
                  </span>
                  {dwEstimate && (
                    <span className="text-forest">
                      {dwManualOverride ? (
                        <button
                          type="button"
                          onClick={() => {
                            setDwManualOverride(false);
                            setDwStartStr(String(dwEstimate.start));
                            setDwEndStr(String(dwEstimate.end));
                          }}
                          className="font-bold underline"
                        >
                          자동 추천({dwEstimate.start}~{dwEstimate.end}) 다시 적용
                        </button>
                      ) : (
                        <span>✨ 자동 입력: {dwEstimate.basis}</span>
                      )}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    type="number"
                    min={1900}
                    max={2150}
                    value={dwStartStr}
                    onChange={(e) => {
                      setDwStartStr(e.target.value);
                      setDwManualOverride(true);
                    }}
                    placeholder="음용 적기 시작연도 (예: 2026)"
                    className="rounded-xl border border-subtle bg-surface px-3 py-2 text-xs tabular-nums text-primary focus:border-forest focus:outline-none"
                  />
                  <input
                    type="number"
                    min={1900}
                    max={2150}
                    value={dwEndStr}
                    onChange={(e) => {
                      setDwEndStr(e.target.value);
                      setDwManualOverride(true);
                    }}
                    placeholder="음용 적기 종료연도 (예: 2032)"
                    className="rounded-xl border border-subtle bg-surface px-3 py-2 text-xs tabular-nums text-primary focus:border-forest focus:outline-none"
                  />
                </div>
              </div>

              <input
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="비고 / 메모"
                className="w-full rounded-xl border border-subtle bg-surface px-3 py-2 text-xs text-primary focus:border-forest focus:outline-none"
              />

              <label className="flex items-center gap-2 text-xs text-primary">
                <input
                  type="checkbox"
                  checked={includeTracking}
                  onChange={(e) => {
                    setIncludeTracking(e.target.checked);
                    setTrackingManualOverride(true);
                  }}
                  className="h-4 w-4 rounded accent-forest"
                />
                <span>
                  <strong className="tabular-nums">{trackingSinceDate}</strong> 이후 누적 지출 집계에 포함
                </span>
              </label>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-forest py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-forest-hover disabled:opacity-50"
        >
          {submitting ? '저장 중...' : `${quantity}병 셀러에 입고하기`}
        </button>
      </form>
    </BottomSheet>
  );
}
