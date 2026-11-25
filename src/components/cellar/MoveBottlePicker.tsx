import { Check, MapPin } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useWineStore } from '@/store/useWineStore';
import { BottomSheet } from '@/components/common/BottomSheet';

interface MoveBottlePickerProps {
  open: boolean;
  bottleId: string | null;
  currentLocationId: string | null;
  wineLabel?: string;
  onClose: () => void;
}

export function MoveBottlePicker({
  open,
  bottleId,
  currentLocationId,
  wineLabel,
  onClose,
}: MoveBottlePickerProps) {
  const db = useWineStore((s) => s.db);
  const moveBottle = useWineStore((s) => s.moveBottle);
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => {
    if (!db) return [];
    const counts = new Map<string, number>();
    for (const b of db.bottles) {
      if (b.status === 'IN_STOCK' && b.locationId) {
        counts.set(b.locationId, (counts.get(b.locationId) ?? 0) + 1);
      }
    }

    const zonePriority = (zone: string) => {
      if (zone === '삼성') return 1;
      if (zone.toUpperCase() === 'LG') return 2;
      if (zone.includes('냉장고')) return 3;
      if (zone === '거실') return 4;
      return 99;
    };

    const sorted = [...db.locations].sort((a, b) => {
      const zp = zonePriority(a.zone) - zonePriority(b.zone);
      if (zp !== 0) return zp;
      return a.sortOrder - b.sortOrder;
    });
    const byZone = new Map<string, Array<(typeof sorted)[number] & { used: number }>>();
    for (const loc of sorted) {
      const list = byZone.get(loc.zone) ?? [];
      list.push({ ...loc, used: counts.get(loc.id) ?? 0 });
      byZone.set(loc.zone, list);
    }
    return [...byZone.entries()];
  }, [db]);

  if (!open || !bottleId) return null;

  const handleSelect = async (locationId: string | null) => {
    if (busy) return;
    setBusy(true);
    try {
      await moveBottle(bottleId, locationId);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="보관 위치 이동"
      subtitle={wineLabel ? `${wineLabel} — 이동할 선반을 1탭 선택하세요` : '이동할 선반을 선택하세요'}
    >
      <div className="space-y-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleSelect(null)}
          className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-sm transition-colors disabled:opacity-50 ${
            currentLocationId === null
              ? 'border-forest bg-forest/10 font-bold text-forest'
              : 'border-subtle bg-elevated text-secondary hover:text-primary'
          }`}
        >
          <span className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            미지정
          </span>
          {currentLocationId === null && <Check className="h-4 w-4" />}
        </button>

        {grouped.map(([zone, shelves]) => (
          <div key={zone} className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-secondary">{zone}</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {shelves.map((loc) => {
                const remain = loc.maxCapacity - loc.used;
                const isCurrent = loc.id === currentLocationId;
                const statusColor =
                  remain < 0
                    ? 'text-status-danger'
                    : remain === 0
                      ? 'text-secondary'
                      : 'text-status-ok';

                return (
                  <button
                    key={loc.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSelect(loc.id)}
                    className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                      isCurrent
                        ? 'border-forest bg-forest/10 ring-1 ring-forest/30'
                        : 'border-subtle bg-surface hover:border-forest/50 hover:bg-elevated'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-1">
                      <span className="truncate text-sm font-semibold text-primary">
                        {loc.displayName}
                      </span>
                      {isCurrent && <Check className="h-3.5 w-3.5 shrink-0 text-forest" />}
                    </div>
                    <span className={`mt-0.5 text-[11px] font-medium tabular-nums ${statusColor}`}>
                      {loc.used}/{loc.maxCapacity} ({remain >= 0 ? `여유 ${remain}` : `초과 +${Math.abs(remain)}`})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}
