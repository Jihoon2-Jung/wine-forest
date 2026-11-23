import { Gift, Wine } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { BottleInstance, WineMaster } from '@/types/schema';
import { getTodayIsoDate, sortBottlesFifo } from '@/services/domain/wineHelpers';
import { useWineStore } from '@/store/useWineStore';
import { BottomSheet } from '@/components/common/BottomSheet';
import { PriceText } from '@/components/common/PriceText';

interface QuickConsumeModalProps {
  open: boolean;
  wine: WineMaster | null;
  bottles: BottleInstance[];
  initialBottleId?: string | null;
  onClose: () => void;
}

const QUICK_OCCASIONS = ['홈파티', '와인모임', '가족식사', '지인 선물', '기념일'];

export function QuickConsumeModal({
  open,
  wine,
  bottles,
  initialBottleId = null,
  onClose,
}: QuickConsumeModalProps) {
  const db = useWineStore((s) => s.db);
  const consumeOrGiftBottle = useWineStore((s) => s.consumeOrGiftBottle);

  const fifoBottles = useMemo(() => sortBottlesFifo(bottles), [bottles]);
  const [selectedBottleId, setSelectedBottleId] = useState<string>('');
  const [eventType, setEventType] = useState<'CONSUMED' | 'GIFTED'>('CONSUMED');
  const [eventDate, setEventDate] = useState<string>(getTodayIsoDate());
  const [occasion, setOccasion] = useState('');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedBottleId(initialBottleId ?? fifoBottles[0]?.id ?? '');
    setEventType('CONSUMED');
    setEventDate(getTodayIsoDate());
    setOccasion('');
    setMemo('');
  }, [open, initialBottleId, fifoBottles]);

  const locationMap = useMemo(
    () => new Map(db?.locations.map((l) => [l.id, l.displayName]) ?? []),
    [db],
  );

  if (!open || !wine || fifoBottles.length === 0) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBottleId) return;
    setSubmitting(true);
    try {
      await consumeOrGiftBottle({
        bottleId: selectedBottleId,
        type: eventType,
        eventDate: eventDate || getTodayIsoDate(),
        occasion,
        memo,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={eventType === 'CONSUMED' ? '와인 소비 완료' : '선물 · 양도 기록'}
      subtitle={`${wine.name} (${wine.vintage})`}
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {/* 출고 유형 토글 */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setEventType('CONSUMED')}
            className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-bold transition-colors ${
              eventType === 'CONSUMED'
                ? 'border-burgundy bg-burgundy text-white'
                : 'border-subtle bg-elevated text-secondary hover:text-primary'
            }`}
          >
            <Wine className="h-4 w-4" />
            <span>소비완료</span>
          </button>
          <button
            type="button"
            onClick={() => setEventType('GIFTED')}
            className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-bold transition-colors ${
              eventType === 'GIFTED'
                ? 'border-gold bg-gold text-white'
                : 'border-subtle bg-elevated text-secondary hover:text-primary'
            }`}
          >
            <Gift className="h-4 w-4" />
            <span>선물 · 양도</span>
          </button>
        </div>

        {/* 다수량일 때 개별 병 선택 (FIFO 기본 선택) */}
        {fifoBottles.length > 1 && (
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-secondary">
              꺼낼 병 선택 (기본: 가장 오래된 구입일 순)
            </label>
            <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
              {fifoBottles.map((b) => {
                const shelf = b.locationId ? locationMap.get(b.locationId) ?? '미지정' : '미지정';
                const checked = selectedBottleId === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedBottleId(b.id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                      checked
                        ? 'border-forest bg-forest/10 font-semibold text-primary'
                        : 'border-subtle bg-elevated/60 text-secondary hover:bg-elevated'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-surface px-1.5 py-0.5 font-semibold text-primary">
                        {shelf}
                      </span>
                      <span className="tabular-nums">{b.purchaseDate ?? '구입일 미상'}</span>
                      {b.purchaseSource && <span>· {b.purchaseSource}</span>}
                    </div>
                    <PriceText value={b.purchasePrice} className="font-bold text-primary" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 날짜 */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-secondary" htmlFor="consume-date">
            {eventType === 'CONSUMED' ? '소비일' : '선물 · 양도일'}
          </label>
          <input
            id="consume-date"
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="w-full rounded-xl border border-subtle bg-elevated px-3.5 py-2.5 text-sm text-primary tabular-nums focus:border-forest focus:outline-none"
          />
        </div>

        {/* 모임 / 대상 */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-secondary" htmlFor="consume-occasion">
            {eventType === 'CONSUMED' ? '모임 / 장소' : '선물 대상'}
          </label>
          <input
            id="consume-occasion"
            type="text"
            value={occasion}
            onChange={(e) => setOccasion(e.target.value)}
            placeholder={eventType === 'CONSUMED' ? '예: 와인모임, 집들이, 저녁 식사' : '예: 지인 생일 선물'}
            className="w-full rounded-xl border border-subtle bg-elevated px-3.5 py-2.5 text-sm text-primary focus:border-forest focus:outline-none"
          />
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {QUICK_OCCASIONS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setOccasion(chip)}
                className="rounded-full border border-subtle bg-surface px-2.5 py-1 text-[11px] font-medium text-secondary hover:border-forest hover:text-forest"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>

        {/* 간단 메모 */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-secondary" htmlFor="consume-memo">
            간단 메모 (선택)
          </label>
          <input
            id="consume-memo"
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="간단한 한 줄 인상"
            className="w-full rounded-xl border border-subtle bg-elevated px-3.5 py-2.5 text-sm text-primary focus:border-forest focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className={`w-full rounded-xl py-3 text-sm font-bold text-white shadow-sm transition-colors disabled:opacity-50 ${
            eventType === 'CONSUMED'
              ? 'bg-burgundy hover:opacity-90'
              : 'bg-gold hover:opacity-90'
          }`}
        >
          {submitting
            ? '기록 중...'
            : eventType === 'CONSUMED'
              ? '🍷 소비 완료 저장'
              : '🎁 선물 · 양도 저장'}
        </button>
      </form>
    </BottomSheet>
  );
}
