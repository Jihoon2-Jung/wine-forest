import { MapPin, Wine } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BottleInstance, CellarLocation, WineMaster } from '@/types/schema';
import { formatWineOrigin } from '@/services/domain/wineHelpers';
import { useWineStore } from '@/store/useWineStore';
import { BottomSheet } from '@/components/common/BottomSheet';
import { PriceText } from '@/components/common/PriceText';
import { WineColorBadge } from '@/components/common/WineColorBadge';
import { QuickConsumeModal } from '@/components/wines/QuickConsumeModal';
import { MoveBottlePicker } from './MoveBottlePicker';

interface ShelfDetailDrawerProps {
  location: CellarLocation | null;
  unassignedMode?: boolean;
  onClose: () => void;
}

export function ShelfDetailDrawer({
  location,
  unassignedMode = false,
  onClose,
}: ShelfDetailDrawerProps) {
  const db = useWineStore((s) => s.db);

  const [consumeTarget, setConsumeTarget] = useState<{
    wine: WineMaster;
    bottle: BottleInstance;
  } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{
    bottle: BottleInstance;
    wineLabel: string;
  } | null>(null);

  const items = useMemo(() => {
    if (!db || (!location && !unassignedMode)) return [];
    const wineMap = new Map(db.wines.map((w) => [w.id, w]));
    return db.bottles
      .filter((b) => {
        if (b.status !== 'IN_STOCK') return false;
        return unassignedMode ? b.locationId === null : b.locationId === location?.id;
      })
      .map((bottle) => ({ bottle, wine: wineMap.get(bottle.wineId) }))
      .filter((x): x is { bottle: BottleInstance; wine: WineMaster } => Boolean(x.wine))
      .sort((a, b) => a.wine.name.localeCompare(b.wine.name, 'ko'));
  }, [db, location, unassignedMode]);

  const open = Boolean(location || unassignedMode);
  if (!open) return null;

  const title = unassignedMode ? '미지정 보관 와인' : location!.displayName;
  const subtitle = unassignedMode
    ? `${items.length}병 · 선반을 지정해 정리해 보세요`
    : `${items.length} / ${location!.maxCapacity}병 보관 중`;

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title={title} subtitle={subtitle}>
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-subtle py-12 text-center text-xs text-secondary">
            이 선반에는 현재 보관 중인 와인이 없습니다.
          </div>
        ) : (
          <div className="space-y-2.5">
            {items.map(({ bottle, wine }) => (
              <div
                key={bottle.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-subtle bg-elevated/45 p-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <WineColorBadge color={wine.color} />
                    <span className="font-serif text-xs font-bold tabular-nums text-gold">
                      {wine.vintage}
                    </span>
                    <span className="truncate text-sm font-bold text-primary">{wine.name}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-secondary">
                    <span>{formatWineOrigin(wine)}</span>
                    <span>·</span>
                    <span className="tabular-nums">{bottle.purchaseDate ?? '구입일 미상'}</span>
                    <span>·</span>
                    <PriceText value={bottle.purchasePrice} className="font-semibold text-primary" />
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setConsumeTarget({ wine, bottle })}
                    className="inline-flex items-center gap-1 rounded-lg bg-burgundy/12 px-2.5 py-1.5 text-xs font-bold text-burgundy hover:bg-burgundy hover:text-white"
                  >
                    <Wine className="h-3.5 w-3.5" />
                    <span>소비</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setMoveTarget({
                        bottle,
                        wineLabel: `${wine.name} (${wine.vintage})`,
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-subtle bg-surface px-2.5 py-1.5 text-xs font-semibold text-secondary hover:border-forest hover:text-forest"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    <span>이동</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </BottomSheet>

      <QuickConsumeModal
        open={Boolean(consumeTarget)}
        wine={consumeTarget?.wine ?? null}
        bottles={consumeTarget ? [consumeTarget.bottle] : []}
        initialBottleId={consumeTarget?.bottle.id ?? null}
        onClose={() => setConsumeTarget(null)}
      />

      <MoveBottlePicker
        open={Boolean(moveTarget)}
        bottleId={moveTarget?.bottle.id ?? null}
        currentLocationId={moveTarget?.bottle.locationId ?? null}
        wineLabel={moveTarget?.wineLabel}
        onClose={() => setMoveTarget(null)}
      />
    </>
  );
}
