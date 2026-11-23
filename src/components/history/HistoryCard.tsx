import { Check, Gift, Pencil, RotateCcw, Wine, X } from 'lucide-react';
import { useState } from 'react';
import type { BottleInstance, CellarLocation, TastingRecord, WineMaster } from '@/types/schema';
import { formatWineOrigin } from '@/services/domain/wineHelpers';
import { useWineStore } from '@/store/useWineStore';
import { MemoText, PriceText } from '@/components/common/PriceText';
import { WineColorBadge } from '@/components/common/WineColorBadge';

interface HistoryCardProps {
  tasting: TastingRecord;
  bottle: BottleInstance;
  wine: WineMaster;
  locations: CellarLocation[];
}

export function HistoryCard({ tasting, bottle, wine, locations }: HistoryCardProps) {
  const restoreBottleToStock = useWineStore((s) => s.restoreBottleToStock);
  const updateTastingRecord = useWineStore((s) => s.updateTastingRecord);

  const [restoring, setRestoring] = useState(false);
  const [restoreLocId, setRestoreLocId] = useState<string>(
    bottle.locationId && locations.some((l) => l.id === bottle.locationId)
      ? bottle.locationId
      : locations[0]?.id ?? '',
  );

  // M7 보강: 소비/선물 이력 간단 수정
  const [editing, setEditing] = useState(false);
  const [draftType, setDraftType] = useState<'CONSUMED' | 'GIFTED'>(tasting.type);
  const [draftDate, setDraftDate] = useState(tasting.eventDate ?? '');
  const [draftOccasion, setDraftOccasion] = useState(tasting.occasion ?? '');
  const [draftMemo, setDraftMemo] = useState(tasting.memo ?? '');

  const isGift = tasting.type === 'GIFTED';

  const handleConfirmRestore = async () => {
    await restoreBottleToStock(bottle.id, restoreLocId || null);
    setRestoring(false);
  };

  const handleSaveEdit = async () => {
    await updateTastingRecord(tasting.id, {
      type: draftType,
      eventDate: draftDate || null,
      occasion: draftOccasion,
      memo: draftMemo,
    });
    setEditing(false);
  };

  return (
    <div className="rounded-2xl border border-subtle bg-surface p-3.5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold text-white ${
                isGift ? 'bg-gold' : 'bg-burgundy'
              }`}
            >
              {isGift ? <Gift className="h-3 w-3" /> : <Wine className="h-3 w-3" />}
              {isGift ? '선물·양도' : '소비'}
            </span>
            <span className="text-xs font-bold tabular-nums text-secondary">
              {tasting.eventDate ?? '날짜 미상'}
            </span>
            <WineColorBadge color={wine.color} />
            <span className="font-serif text-xs font-bold tabular-nums text-gold">
              {wine.vintage}
            </span>
          </div>

          <h3 className="text-sm font-bold text-primary">{wine.name}</h3>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-secondary">
            <span>{formatWineOrigin(wine)}</span>
            {tasting.occasion && (
              <>
                <span>·</span>
                <span className="font-semibold text-primary">{tasting.occasion}</span>
              </>
            )}
          </div>

          {tasting.memo && (
            <p className="text-xs text-secondary">
              <MemoText text={tasting.memo} />
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <PriceText value={bottle.purchasePrice} className="text-xs font-bold text-primary" />

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setEditing((v) => !v);
                setRestoring(false);
              }}
              className="rounded-lg border border-subtle bg-elevated p-1.5 text-secondary hover:text-primary"
              title="이력 수정"
              aria-label="이력 수정"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setRestoring((v) => !v);
                setEditing(false);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-subtle bg-elevated px-2.5 py-1.5 text-[11px] font-bold text-secondary hover:border-forest hover:text-forest"
            >
              <RotateCcw className="h-3 w-3" />
              <span>보유 복원</span>
            </button>
          </div>
        </div>
      </div>

      {/* 보유 복원 패널 */}
      {restoring && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-forest/35 bg-forest/8 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-forest">복원할 선반:</span>
            <select
              value={restoreLocId}
              onChange={(e) => setRestoreLocId(e.target.value)}
              className="rounded-lg border border-subtle bg-surface px-2.5 py-1 text-xs text-primary"
            >
              <option value="">미지정</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setRestoring(false)}
              className="rounded-lg border border-subtle bg-surface px-2.5 py-1 text-xs font-semibold text-secondary"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmRestore()}
              className="rounded-lg bg-forest px-3 py-1 text-xs font-bold text-white"
            >
              보유로 복원 확인
            </button>
          </div>
        </div>
      )}

      {/* 이력 수정 패널 */}
      {editing && (
        <div className="mt-3 space-y-2 rounded-xl border border-subtle bg-elevated/60 p-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={draftType}
              onChange={(e) => setDraftType(e.target.value as 'CONSUMED' | 'GIFTED')}
              className="rounded-lg border border-subtle bg-surface px-2.5 py-1.5 text-xs font-bold text-primary"
            >
              <option value="CONSUMED">소비완료</option>
              <option value="GIFTED">선물 · 양도</option>
            </select>
            <input
              type="date"
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
              className="rounded-lg border border-subtle bg-surface px-2.5 py-1.5 text-xs tabular-nums text-primary"
            />
          </div>
          <input
            type="text"
            value={draftOccasion}
            onChange={(e) => setDraftOccasion(e.target.value)}
            placeholder="모임 / 대상"
            className="w-full rounded-lg border border-subtle bg-surface px-2.5 py-1.5 text-xs text-primary"
          />
          <input
            type="text"
            value={draftMemo}
            onChange={(e) => setDraftMemo(e.target.value)}
            placeholder="메모"
            className="w-full rounded-lg border border-subtle bg-surface px-2.5 py-1.5 text-xs text-primary"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="inline-flex items-center gap-1 rounded-lg border border-subtle bg-surface px-2.5 py-1 text-xs font-semibold text-secondary"
            >
              <X className="h-3.5 w-3.5" />
              취소
            </button>
            <button
              type="button"
              onClick={() => void handleSaveEdit()}
              className="inline-flex items-center gap-1 rounded-lg bg-forest px-2.5 py-1 text-xs font-bold text-white"
            >
              <Check className="h-3.5 w-3.5" />
              저장
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
