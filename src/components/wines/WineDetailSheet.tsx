import { Camera, ChevronDown, ChevronUp, Pencil, Plus, RotateCcw, Trash2, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { WINE_COLORS, type WineColor, type WineMaster } from '@/types/schema';
import {
  buildWineMasterKey,
  DRINKING_WINDOW_BADGE_META,
  formatBottleSizeBadge,
  formatDrinkingWindowRange,
  formatWineOrigin,
  getDrinkingWindowStatus,
  sortBottlesFifo,
} from '@/services/domain/wineHelpers';
import { estimateDrinkingWindow } from '@/services/domain/drinkingWindowEstimator';
import { pickImageFile } from '@/services/media/photoPicker';
import { useWineStore } from '@/store/useWineStore';
import { BottomSheet } from '@/components/common/BottomSheet';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PhotoLightbox, TastingPhotoThumb } from '@/components/common/PhotoLightbox';
import { MemoText, PriceText } from '@/components/common/PriceText';
import { StarRatingBadge } from '@/components/common/StarRating';
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
  const uploadWineLabelPhoto = useWineStore((s) => s.uploadWineLabelPhoto);
  const removeWineLabelPhoto = useWineStore((s) => s.removeWineLabelPhoto);

  const [uploadingLabel, setUploadingLabel] = useState(false);
  const [lightboxFileId, setLightboxFileId] = useState<string | null>(null);
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
  const [draftSizeMlStr, setDraftSizeMlStr] = useState('750');
  const [draftDwStart, setDraftDwStart] = useState('');
  const [draftDwEnd, setDraftDwEnd] = useState('');
  const [masterError, setMasterError] = useState<string | null>(null);
  const [savingMaster, setSavingMaster] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    tone?: 'primary' | 'danger';
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // 와인 전환 시 이전 와인의 편집 상태·드래프트·서브모달·라이트박스 잔존 방지 (C7)
  useEffect(() => {
    setEditingMaster(false);
    setShowPastHistory(false);
    setConsumeBottleId(null);
    setMoveBottleId(null);
    setLightboxFileId(null);
    setMasterError(null);
    setConfirmState(null);
  }, [wineId]);

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
    setDraftSizeMlStr(String(wine.bottleSizeMl));
    setDraftDwStart(wine.drinkingWindowStart ? String(wine.drinkingWindowStart) : '');
    setDraftDwEnd(wine.drinkingWindowEnd ? String(wine.drinkingWindowEnd) : '');
    setMasterError(null);
    setEditingMaster(true);
  };

  const saveEditMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingMaster) return;
    setMasterError(null);
    if (!draftName.trim()) {
      setMasterError('와인명을 입력해 주세요.');
      return;
    }
    if (!/^(\d{4}|NV)$/i.test(draftVintage.trim())) {
      setMasterError('빈티지는 4자리 연도 또는 NV로 입력해 주세요.');
      return;
    }
    const parsedSizeMl = Number(draftSizeMlStr.trim());
    if (!Number.isInteger(parsedSizeMl) || parsedSizeMl < 50 || parsedSizeMl > 18000) {
      setMasterError('용량은 50~18000 사이의 정수(ml)로 입력해 주세요.');
      return;
    }
    const parsedStart = /^\d{4}$/.test(draftDwStart.trim()) ? Number(draftDwStart.trim()) : null;
    const parsedEnd = /^\d{4}$/.test(draftDwEnd.trim()) ? Number(draftDwEnd.trim()) : null;
    if (parsedStart !== null && parsedEnd !== null && parsedStart > parsedEnd) {
      setMasterError('음용 적기 시작 연도는 종료 연도보다 클 수 없습니다.');
      return;
    }
    const nextPatch = {
      name: draftName.trim(),
      producer: draftProducer.trim() || undefined,
      country: draftCountry.trim() || '미분류',
      region: draftRegion.trim() || draftCountry.trim() || '미분류',
      subRegion: draftSubRegion.trim() || undefined,
      vintage: draftVintage.trim().toUpperCase(),
      color: draftColor,
      bottleSizeMl: parsedSizeMl,
      drinkingWindowStart: parsedStart,
      drinkingWindowEnd: parsedEnd,
    };

    // ⑤ 보강: 수정 결과 기존 다른 마스터와 4중 키가 겹치면 React 다이얼로그로 확인 후 병합
    const nextKey = buildWineMasterKey(nextPatch);
    const duplicateMaster = db?.wines.find(
      (w) => w.id !== wine.id && buildWineMasterKey(w) === nextKey,
    );

    if (duplicateMaster) {
      setConfirmState({
        title: '동일한 와인 병합',
        message: `동일한 와인('${duplicateMaster.name} ${duplicateMaster.vintage}')이 이미 존재합니다.\n두 항목을 하나로 병합할까요?`,
        confirmLabel: '병합하고 저장',
        tone: 'primary',
        onConfirm: async () => {
          await updateWineMaster(wine.id, nextPatch, duplicateMaster.id);
          setEditingMaster(false);
          onClose();
        },
      });
      return;
    }

    setSavingMaster(true);
    try {
      await updateWineMaster(wine.id, nextPatch);
      setEditingMaster(false);
    } finally {
      setSavingMaster(false);
    }
  };

  const moveTargetBottle = inStockBottles.find((b) => b.id === moveBottleId) ?? null;
  const sizeBadge = formatBottleSizeBadge(wine.bottleSizeMl);
  const dwStatus = getDrinkingWindowStatus(wine);
  const dwRange = formatDrinkingWindowRange(wine);
  const dwMeta = dwStatus !== 'unset' ? DRINKING_WINDOW_BADGE_META[dwStatus] : null;
  const ratedValues = pastRecords
    .map((r) => r.tasting?.rating)
    .filter((v): v is number => typeof v === 'number');
  const avgRating =
    ratedValues.length > 0
      ? Math.round((ratedValues.reduce((acc, v) => acc + v, 0) / ratedValues.length) * 10) / 10
      : null;

  const handlePickLabelPhoto = async () => {
    if (uploadingLabel) return;
    setUploadingLabel(true);
    try {
      const blob = await pickImageFile({ preset: 'label' });
      if (!blob) return;
      await uploadWineLabelPhoto(wine.id, blob);
    } finally {
      setUploadingLabel(false);
    }
  };

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
            <div className="flex shrink-0 flex-col items-center gap-1.5">
              <WineThumbnail
                color={wine.color}
                vintage={wine.vintage}
                labelImageFileId={wine.labelImageFileId}
                size="lg"
                onClick={
                  wine.labelImageFileId
                    ? () => setLightboxFileId(wine.labelImageFileId ?? null)
                    : () => void handlePickLabelPhoto()
                }
              />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={uploadingLabel}
                  onClick={() => void handlePickLabelPhoto()}
                  className="inline-flex items-center gap-1 rounded-lg border border-subtle bg-surface px-2 py-1 text-[10px] font-bold text-secondary hover:border-forest hover:text-forest disabled:opacity-50"
                  title="라벨 사진 촬영 또는 선택"
                >
                  <Camera className="h-3 w-3" />
                  <span>{uploadingLabel ? '업로드...' : wine.labelImageFileId ? '교체' : '라벨'}</span>
                </button>
                {wine.labelImageFileId && (
                  <button
                    type="button"
                    disabled={uploadingLabel}
                    onClick={() =>
                      setConfirmState({
                        title: '라벨 사진 삭제',
                        message: '등록된 라벨 사진을 삭제할까요?',
                        confirmLabel: '삭제',
                        tone: 'danger',
                        onConfirm: async () => {
                          await removeWineLabelPhoto(wine.id);
                        },
                      })
                    }
                    className="rounded-lg border border-subtle bg-surface p-1 text-secondary hover:border-status-danger hover:text-status-danger"
                    title="라벨 사진 삭제"
                    aria-label="라벨 사진 삭제"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
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
                {dwMeta && (
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums ${dwMeta.className}`}
                  >
                    {dwMeta.label}
                    {dwRange ? ` (${dwRange})` : ''}
                  </span>
                )}
                <StarRatingBadge rating={avgRating} count={ratedValues.length || undefined} size="sm" />
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
                  min={50}
                  max={18000}
                  step={1}
                  value={draftSizeMlStr}
                  onChange={(e) => setDraftSizeMlStr(e.target.value)}
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
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-secondary">음용 적기 (시작 ~ 종료연도)</span>
                  <button
                    type="button"
                    onClick={() => {
                      const est = estimateDrinkingWindow({
                        name: draftName,
                        country: draftCountry,
                        region: draftRegion,
                        subRegion: draftSubRegion,
                        color: draftColor,
                        vintage: draftVintage,
                      });
                      if (est) {
                        setDraftDwStart(String(est.start));
                        setDraftDwEnd(String(est.end));
                      }
                    }}
                    className="font-bold text-forest hover:underline"
                  >
                    ✨ 지역·빈티지 추천값 채우기
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={1900}
                    max={2150}
                    value={draftDwStart}
                    onChange={(e) => setDraftDwStart(e.target.value)}
                    placeholder="음용 적기 시작연도 (예: 2026)"
                    className="rounded-xl border border-subtle bg-surface px-3 py-2 text-xs tabular-nums text-primary"
                  />
                  <input
                    type="number"
                    min={1900}
                    max={2150}
                    value={draftDwEnd}
                    onChange={(e) => setDraftDwEnd(e.target.value)}
                    placeholder="음용 적기 종료연도 (예: 2032)"
                    className="rounded-xl border border-subtle bg-surface px-3 py-2 text-xs tabular-nums text-primary"
                  />
                </div>
              </div>
              {masterError && (
                <p className="rounded-lg border border-status-danger/35 bg-status-danger/10 px-2.5 py-1.5 text-[11px] font-semibold text-status-danger">
                  {masterError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={savingMaster}
                  onClick={() => setEditingMaster(false)}
                  className="rounded-lg border border-subtle bg-surface px-3 py-1.5 text-xs font-semibold text-secondary disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={savingMaster}
                  className="rounded-lg bg-forest px-3.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                >
                  {savingMaster ? '저장 중...' : '변경 저장'}
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
                            {tasting?.rating !== null && tasting?.rating !== undefined && (
                              <span className="ml-1.5 inline-flex align-middle">
                                <StarRatingBadge rating={tasting.rating} />
                              </span>
                            )}
                            {tasting?.occasion && (
                              <span className="ml-1.5 text-secondary">· {tasting.occasion}</span>
                            )}
                            {tasting?.companions && (
                              <span className="ml-1.5 inline-flex items-center gap-0.5 text-secondary">
                                · <Users className="h-3 w-3 text-forest" /> {tasting.companions}
                              </span>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <PriceText value={bottle.purchasePrice} className="font-semibold text-secondary" />
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmState({
                                  title: '보유 상태로 복원',
                                  message: `이 병을 '${restoreTargetName}' 위치로 보유 복원할까요?\n(연결된 소비·선물 이력은 삭제됩니다.)`,
                                  confirmLabel: '복원',
                                  tone: 'primary',
                                  onConfirm: async () => {
                                    await restoreBottleToStock(bottle.id, validPrevLocId);
                                  },
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-subtle bg-elevated px-2 py-0.5 text-[11px] font-semibold text-secondary hover:border-forest hover:text-forest"
                              title="보유 상태로 복원"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>복원</span>
                            </button>
                          </div>
                        </div>
                        {tasting?.tastingNote && (
                          <p className="whitespace-pre-line rounded-md bg-elevated/55 px-2 py-1 text-[11px] leading-relaxed text-primary">
                            {tasting.tastingNote}
                          </p>
                        )}
                        {tasting?.memo && (
                          <div className="text-[11px] text-secondary">
                            <MemoText text={tasting.memo} />
                          </div>
                        )}
                        {tasting?.photoFileIds && tasting.photoFileIds.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {tasting.photoFileIds.map((pid) => (
                              <TastingPhotoThumb
                                key={pid}
                                fileId={pid}
                                alt={`${wine.name} 시음 사진`}
                                onClick={() => setLightboxFileId(pid)}
                              />
                            ))}
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

      <PhotoLightbox
        fileId={lightboxFileId}
        alt={`${wine.name} 사진`}
        onClose={() => setLightboxFileId(null)}
      />

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel={confirmState?.confirmLabel}
        tone={confirmState?.tone}
        busy={confirmBusy}
        onCancel={() => setConfirmState(null)}
        onConfirm={async () => {
          if (!confirmState || confirmBusy) return;
          setConfirmBusy(true);
          try {
            await confirmState.onConfirm();
            setConfirmState(null);
          } finally {
            setConfirmBusy(false);
          }
        }}
      />
    </>
  );
}
