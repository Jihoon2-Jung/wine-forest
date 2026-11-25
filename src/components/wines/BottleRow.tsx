import { Check, MapPin, Pencil, Trash2, Wine, X } from 'lucide-react';
import { useState } from 'react';
import type { BottleInstance } from '@/types/schema';
import { useWineStore } from '@/store/useWineStore';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { FxNoteText, MemoText, PriceText } from '@/components/common/PriceText';

interface BottleRowProps {
  bottle: BottleInstance;
  locationName: string;
  onConsume: (bottleId: string) => void;
  onMove: (bottleId: string) => void;
}

export function BottleRow({ bottle, locationName, onConsume, onMove }: BottleRowProps) {
  const updateBottle = useWineStore((s) => s.updateBottle);
  const deleteBottle = useWineStore((s) => s.deleteBottle);

  const [editing, setEditing] = useState(false);
  const [purchaseDate, setPurchaseDate] = useState(bottle.purchaseDate ?? '');
  const [purchaseSource, setPurchaseSource] = useState(bottle.purchaseSource);
  const [purchasePrice, setPurchasePrice] = useState(String(bottle.purchasePrice));
  const [fxNote, setFxNote] = useState(bottle.fxNote ?? '');
  const [memo, setMemo] = useState(bottle.memo ?? '');
  const [includeTracking, setIncludeTracking] = useState(bottle.includeInTrackingSince);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleOpenEdit = () => {
    setPurchaseDate(bottle.purchaseDate ?? '');
    setPurchaseSource(bottle.purchaseSource);
    setPurchasePrice(String(bottle.purchasePrice));
    setFxNote(bottle.fxNote ?? '');
    setMemo(bottle.memo ?? '');
    setIncludeTracking(bottle.includeInTrackingSince);
    setEditing(true);
  };

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await updateBottle(bottle.id, {
        purchaseDate: purchaseDate || null,
        purchaseSource: purchaseSource.trim(),
        purchasePrice: Number(purchasePrice.replace(/[^0-9]/g, '')) || 0,
        fxNote: fxNote.trim() || undefined,
        memo: memo.trim() || undefined,
        includeInTrackingSince: includeTracking,
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteBottle(bottle.id);
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="space-y-2.5 rounded-xl border border-forest/40 bg-elevated/70 p-3">
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
            className="rounded-lg border border-subtle bg-surface px-2.5 py-1.5 text-xs tabular-nums text-primary"
          />
          <input
            type="text"
            inputMode="numeric"
            value={purchasePrice}
            onChange={(e) => setPurchasePrice(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="구매가 (원)"
            className="rounded-lg border border-subtle bg-surface px-2.5 py-1.5 text-xs font-bold tabular-nums text-primary"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            value={purchaseSource}
            onChange={(e) => setPurchaseSource(e.target.value)}
            placeholder="구매처"
            className="rounded-lg border border-subtle bg-surface px-2.5 py-1.5 text-xs text-primary"
          />
          <input
            type="text"
            value={fxNote}
            onChange={(e) => setFxNote(e.target.value)}
            placeholder="외화 메모"
            className="rounded-lg border border-subtle bg-surface px-2.5 py-1.5 text-xs text-primary"
          />
        </div>
        <input
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="비고 / 메모"
          className="w-full rounded-lg border border-subtle bg-surface px-2.5 py-1.5 text-xs text-primary"
        />
        <div className="flex items-center justify-between gap-2 pt-1">
          <label className="flex items-center gap-1.5 text-[11px] text-secondary">
            <input
              type="checkbox"
              checked={includeTracking}
              onChange={(e) => setIncludeTracking(e.target.checked)}
              className="accent-forest"
            />
            누적 지출 집계 포함
          </label>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
              className="inline-flex items-center gap-1 rounded-lg border border-subtle bg-surface px-2.5 py-1 text-xs font-semibold text-secondary disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              취소
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1 rounded-lg bg-forest px-2.5 py-1 text-xs font-bold text-white disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              저장
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2 rounded-xl border border-subtle bg-elevated/45 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="inline-flex items-center gap-1 rounded-md bg-forest/[0.12] px-2 py-0.5 font-bold text-forest">
              <MapPin className="h-3 w-3" />
              {locationName}
            </span>
            <span className="tabular-nums text-secondary">
              {bottle.purchaseDate ?? '구입일 미상'}
              {bottle.purchaseDateUncertain ? ' (?)' : ''}
            </span>
            {bottle.purchaseSource && (
              <span className="text-secondary">· {bottle.purchaseSource}</span>
            )}
            <PriceText value={bottle.purchasePrice} className="font-bold text-primary" />
          </div>

          {(bottle.fxNote || bottle.memo) && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-secondary">
              {bottle.fxNote && (
                <span className="rounded bg-surface px-1.5 py-0.5 border border-subtle">
                  <FxNoteText note={bottle.fxNote} />
                </span>
              )}
              {bottle.memo && <MemoText text={bottle.memo} className="truncate" />}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onConsume(bottle.id)}
            className="inline-flex items-center gap-1 rounded-lg bg-burgundy/[0.12] px-2.5 py-1.5 text-xs font-bold text-burgundy transition-colors hover:bg-burgundy hover:text-white"
            title="소비 / 선물"
          >
            <Wine className="h-3.5 w-3.5" />
            <span>소비</span>
          </button>
          <button
            type="button"
            onClick={() => onMove(bottle.id)}
            className="inline-flex items-center gap-1 rounded-lg border border-subtle bg-surface px-2 py-1.5 text-xs font-semibold text-secondary hover:border-forest hover:text-forest"
            title="위치 이동"
          >
            <MapPin className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">이동</span>
          </button>
          <button
            type="button"
            onClick={handleOpenEdit}
            className="rounded-lg border border-subtle bg-surface p-1.5 text-secondary hover:text-primary"
            title="수정"
            aria-label="병 정보 수정"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded-lg border border-subtle bg-surface p-1.5 text-secondary hover:border-status-danger hover:text-status-danger"
            title="삭제"
            aria-label="병 삭제"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="병 기록 삭제"
        message="이 병 기록을 완전히 삭제할까요? (복구 불가)"
        confirmLabel="삭제"
        tone="danger"
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
