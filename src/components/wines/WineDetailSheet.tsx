import { ChevronDown, ChevronUp, Pencil, Plus, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { WINE_COLORS, type WineColor, type WineMaster } from '@/types/schema';
import {
  buildWineMasterKey,
  formatBottleSizeBadge,
  formatWineOrigin,
  sortBottlesFifo,
} from '@/services/domain/wineHelpers';
import { useWineStore } from '@/store/useWineStore';
import { BottomSheet } from '@/components/common/BottomSheet';
import { MemoText, PriceText } from '@/components/common/PriceText';
import { WineColorBadge } from '@/components/common/WineColorBadge';
import { WineThumbnail } from '@/components/common/WineThumbnail';
import { MoveBottlePicker } from '@/components/cellar/MoveBottlePicker';
import { BottleRow } from './BottleRow';
import { QuickConsumeModal } from './QuickConsumeModal';

interface WineDetailSheetProps {
  wineId: string | null;
  onClose: () => void;
}

export function WineDetailSheet({ wineId, onClose }: WineDetailSheetProps) {
  const db = useWineStore((s) => s.db);
  const openQuickAdd = useWineStore((s) => s.openQuickAdd);
  const updateWineMaster = useWineStore((s) => s.updateWineMaster);
  const restoreBottleToStock = useWineStore((s) => s.restoreBottleToStock);

  const [consumeBottleId, setConsumeBottleId] = useState<string | null>(null);
  const [moveBottleId, setMoveBottleId] = useState<string | null>(null);
  const [showPastHistory, setShowPastHistory] = useState(false);
  const [editingMaster, setEditingMaster] = useState(false);

  const wine = useMemo<WineMaster | null>(
    () => (db && wineId ? db.wines.find((w) => w.id === wineId) ?? null : null),
    [db, wineId],
  );

  const [draftName, setDraftName] = useState('');
  const [draftProducer, setDraftProducer] = useState('');
  const [draftCountry, setDraftCountry] = useState('');
  const [draftRegion, setDraftRegion] = useState('');
  const [draftSubRegion, setDraftSubRegion] = useState('');
  const [draftVintage, setDraftVintage] = useState('');
  const [draftColor, setDraftColor] = useState<WineColor>('R');
  const [draftSizeMl, setDraftSizeMl] = useState(750);

  const locationMap = useMemo(
    () => new Map(db?.locations.map((l) => [l.id, l.displayName]) ?? []),
    [db],
  );

  const { inStockBottles, pastRecords } = useMemo(() => {
    if (!db || !wineId) return { inStockBottles: [], pastRecords: [] };
    const allForWine = db.bottles.filter((b) => b.wineId === wineId);
    const inStock = sortBottlesFifo(allForWine.filter((b) => b.status === 'IN_STOCK'));
    const tastingByBottle = new Map(db.tastings.map((t) => [t.bottleId, t]));
    const past = allForWine
      .filter((b) => b.status !== 'IN_STOCK')
      .map((b) => ({ bottle: b, tasting: tastingByBottle.get(b.id) }))
      .sort((a, b) =>
        (b.tasting?.eventDate ?? '0000-00-00').localeCompare(a.tasting?.eventDate ?? '0000-00-00'),
      );
    return { inStockBottles: inStock, pastRecords: past };
  }, [db, wineId]);

  if (!wineId || !wine) return null;

  const startEditMaster = () => {
    setDraftName(wine.name);
    setDraftProducer(wine.producer ?? '');
    setDraftCountry(wine.country);
    setDraftRegion(wine.region);
    setDraftSubRegion(wine.subRegion ?? '');
    setDraftVintage(wine.vintage);
    setDraftColor(wine.color);
    setDraftSizeMl(wine.bottleSizeMl);
    setEditingMaster(true);
  };

  const saveEditMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftName.trim() || !/^(\d{4}|NV)$/i.test(draftVintage.trim())) return;
    const nextPatch = {
      name: draftName.trim(),
      producer: draftProducer.trim() || undefined,
      country: draftCountry.trim() || '미분류',
      region: draftRegion.trim() || draftCountry.trim() || '미분류',
      subRegion: draftSubRegion.trim() || undefined,
      vintage: draftVintage.trim().toUpperCase(),
      color: draftColor,
      bottleSizeMl: draftSizeMl,
    };

    // ⑤ 보강: 수정 결과 기존 다른 마스터와 4중 키가 겹치면 확인 후 병합
    const nextKey = buildWineMasterKey(nextPatch);
    const duplicateMaster = db?.wines.find(
      (w) => w.id !== wine.id && buildWineMasterKey(w) === nextKey,
    );

    if (duplicateMaster) {
      const shouldMerge = window.confirm(
        `동일한 와인('${duplicateMaster.name} ${duplicateMaster.vintage}')이 이미 존재합니다.\n두 항목을 하나로 병합할까요?`,
      );
      if (shouldMerge) {
        await updateWineMaster(wine.id, nextPatch, duplicateMaster.id);
        setEditingMaster(false);
        onClose();
        return;
      }
    }

    await updateWineMaster(wine.id, nextPatch);
    setEditingMaster(false);
  };

  const moveTargetBottle = inStockBottles.find((b) => b.id === moveBottleId) ?? null;
  const sizeBadge = formatBottleSizeBadge(wine.bottleSizeMl);

  return (
    <>
      <BottomSheet
        open={Boolean(wineId)}
        onClose={onClose}
        title={wine.name}
        subtitle={`${wine.vintage} · ${formatWineOrigin(wine)}${sizeBadge ? ` · ${sizeBadge}` : ''}`}
        maxWidthClass="md:max-w-2xl"
      >
        <div className="space-y-4">
          {/* 상단 마스터 요약 */}
          <div className="flex items-start gap-3.5 rounded-2xl border border-subtle bg-elevated/45 p-3.5">
            <WineThumbnail
              color={wine.color}
              vintage={wine.vintage}
              labelImageFileId={wine.labelImageFileId}
              size="lg"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <WineColorBadge color={wine.color} showLabel />
                <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-bold tabular-nums text-gold border border-subtle">
                  {wine.vintage}
                </span>
                {sizeBadge && (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-secondary border border-subtle">
                    {sizeBadge}
                  </span>
                )}
              </div>

              <div className="text-xs text-secondary">
                {formatWineOrigin(wine)}
                {wine.producer ? ` · ${wine.producer}` : ''}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    openQuickAdd(wine.id);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-forest px-3 py-1.5 text-xs font-bold text-white hover:bg-forest-hover"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>같은 와인 추가 입고</span>
                </button>
                <button
                  type="button"
                  onClick={startEditMaster}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-subtle bg-surface px-3 py-1.5 text-xs font-semibold text-secondary hover:text-primary"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span>와인 정보 수정</span>
                </button>
              </div>
            </div>
          </div>

          {/* 와인 마스터 편집 폼 */}
          {editingMaster && (
            <form
              onSubmit={(e) => void saveEditMaster(e)}
              className="space-y-3 rounded-2xl border border-forest/40 bg-elevated/60 p-3.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-primary">와인 마스터 정보 편집</span>
                <span className="text-[11px] text-secondary">과거 소비 이력에도 함께 반영됩니다</span>
              </div>
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="와인명"
                className="w-full rounded-xl border border-subtle bg-surface px-3 py-2 text-xs font-semibold text-primary"
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  value={draftCountry}
                  onChange={(e) => setDraftCountry(e.target.value)}
                  placeholder="국가"
                  className="rounded-xl border border-subtle bg-surface px-3 py-2 text-xs text-primary"
                />
                <input
                  type="text"
                  value={draftRegion}
                  onChange={(e) => setDraftRegion(e.target.value)}
                  placeholder="지역 (예: 부르고뉴)"
                  className="rounded-xl border border-subtle bg-surface px-3 py-2 text-xs text-primary"
                />
                <input
                  type="text"
                  value={draftSubRegion}
                  onChange={(e) => setDraftSubRegion(e.target.value)}
                  placeholder="세부지역 (선택)"
                  className="rounded-xl border border-subtle bg-surface px-3 py-2 text-xs text-primary"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  value={draftVintage}
                  onChange={(e) => setDraftVintage(e.target.value)}
                  placeholder="빈티지 / NV"
                  className="rounded-xl border border-subtle bg-surface px-3 py-2 text-xs font-bold tabular-nums text-primary"
                />
                <select
                  value={draftColor}
                  onChange={(e) => setDraftColor(e.target.value as WineColor)}
                  className="rounded-xl border border-subtle bg-surface px-2.5 py-2 text-xs font-bold text-primary"
                >
                  {WINE_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={draftSizeMl}
                  onChange={(e) => setDraftSizeMl(Number(e.target.value) || 750)}
                  placeholder="용량 ml"
                  className="rounded-xl border border-subtle bg-surface px-3 py-2 text-xs tabular-nums text-primary"
                />
              </div>
              <input
                type="text"
                value={draftProducer}
                onChange={(e) => setDraftProducer(e.target.value)}
                placeholder="생산자 (선택)"
                className="w-full rounded-xl border border-subtle bg-surface px-3 py-2 text-xs text-primary"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingMaster(false)}
                  className="rounded-lg border border-subtle bg-surface px-3 py-1.5 text-xs font-semibold text-secondary"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-forest px-3.5 py-1.5 text-xs font-bold text-white"
                >
                  변경 저장
                </button>
              </div>
            </form>
          )}

          {/* 보유 중인 개별 병 리스트 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-secondary">
                보유 중인 병 ({inStockBottles.length}병)
              </h3>
            </div>
            {inStockBottles.length === 0 ? (
              <div className="rounded-xl border border-dashed border-subtle py-6 text-center text-xs text-secondary">
                현재 보유 중인 병이 없습니다.
              </div>
            ) : (
              <div className="space-y-2">
                {inStockBottles.map((b) => (
                  <BottleRow
                    key={b.id}
                    bottle={b}
                    locationName={b.locationId ? locationMap.get(b.locationId) ?? '미지정' : '미지정'}
                    onConsume={(id) => setConsumeBottleId(id)}
                    onMove={(id) => setMoveBottleId(id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 과거 소비 / 선물 이력 접이식 섹션 */}
          {pastRecords.length > 0 && (
            <div className="rounded-xl border border-subtle bg-elevated/35">
              <button
                type="button"
                onClick={() => setShowPastHistory((v) => !v)}
                className="flex w-full items-center justify-between px-3.5 py-2.5 text-xs font-bold text-secondary hover:text-primary"
              >
                <span>과거 소비 · 선물 이력 ({pastRecords.length}병)</span>
                {showPastHistory ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
              {showPastHistory && (
                <div className="space-y-2 border-t border-subtle px-3.5 py-3">
                  {pastRecords.map(({ bottle, tasting }) => {
                    const validPrevLocId =
                      bottle.locationId && locationMap.has(bottle.locationId) ? bottle.locationId : null;
                    const restoreTargetName = validPrevLocId
                      ? locationMap.get(validPrevLocId) ?? '미지정'
                      : '미지정';
                    return (
                      <div
                        key={bottle.id}
                        className="space-y-1.5 rounded-lg border border-subtle/60 bg-surface px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span
                              className={`mr-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
                                bottle.status === 'GIFTED' ? 'bg-gold' : 'bg-burgundy'
                              }`}
                            >
                              {bottle.status === 'GIFTED' ? '선물' : '소비'}
                            </span>
                            <span className="tabular-nums font-medium text-primary">
                              {tasting?.eventDate ?? '날짜 미상'}
                            </span>
                            {tasting?.occasion && (
                              <span className="ml-1.5 text-secondary">· {tasting.occasion}</span>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <PriceText value={bottle.purchasePrice} className="font-semibold text-secondary" />
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `이 병을 '${restoreTargetName}' 위치로 보유 복원할까요?\n(연결된 소비·선물 이력은 삭제됩니다.)`,
                                  )
                                ) {
                                  void restoreBottleToStock(bottle.id, validPrevLocId);
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-subtle bg-elevated px-2 py-0.5 text-[11px] font-semibold text-secondary hover:border-forest hover:text-forest"
                              title="보유 상태로 복원"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>복원</span>
                            </button>
                          </div>
                        </div>
                        {tasting?.memo && (
                          <div className="text-[11px] text-secondary">
                            <MemoText text={tasting.memo} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </BottomSheet>

      <QuickConsumeModal
        open={Boolean(consumeBottleId)}
        wine={wine}
        bottles={inStockBottles}
        initialBottleId={consumeBottleId}
        onClose={() => setConsumeBottleId(null)}
      />

      <MoveBottlePicker
        open={Boolean(moveBottleId)}
        bottleId={moveBottleId}
        currentLocationId={moveTargetBottle?.locationId ?? null}
        wineLabel={`${wine.name} (${wine.vintage})`}
        onClose={() => setMoveBottleId(null)}
      />
    </>
  );
}
