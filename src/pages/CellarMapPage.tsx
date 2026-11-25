import { AlertCircle, ArrowUp, Plus, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { type CellarLocation, type WineColor } from '@/types/schema';
import { useWineStore } from '@/store/useWineStore';
import { ShelfCard } from '@/components/cellar/ShelfCard';
import { ShelfConfigModal } from '@/components/cellar/ShelfConfigModal';
import { ShelfDetailDrawer } from '@/components/cellar/ShelfDetailDrawer';

function emptyColorCounts(): Record<WineColor, number> {
  return { R: 0, W: 0, SP: 0, SW: 0, RO: 0 };
}

/**
 * 물리적 셀러 우선 순서: 삼성 -> LG -> 냉장고 신선 -> 거실 -> 기타
 */
function getZonePriority(zone: string): number {
  const z = zone.trim();
  if (z === '삼성') return 1;
  if (z.toUpperCase() === 'LG') return 2;
  if (z.includes('냉장고')) return 3;
  if (z === '거실') return 4;
  return 99;
}

/**
 * 선반 번호 자연 파싱 (예: "1-1" -> [1, 1], "2-7" -> [2, 7], "3-2" -> [3, 2])
 */
function parseShelfNumbers(shelf: string): [number, number] | null {
  const m = shelf.trim().match(/^(\d+)\s*[-_]\s*(\d+)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

/**
 * 셀러 내 선반을 아래(1-1) -> 위(1-2 ... 2-1 ... 2-7 / 3-2) 순으로 쌓이도록
 * 화면 렌더링(위 -> 아래)용 내림차순 정렬: 높은 칸(2-7, 3-2)이 위, 1-1이 맨 아래
 */
function compareShelfTopToBottom(a: CellarLocation, b: CellarLocation): number {
  const pa = parseShelfNumbers(a.shelf);
  const pb = parseShelfNumbers(b.shelf);
  if (pa && pb) {
    if (pa[0] !== pb[0]) return pb[0] - pa[0]; // 상위 섹션(2, 3)이 위로
    return pb[1] - pa[1]; // 섹션 내 높은 번호가 위로 (1-1이 맨 아래)
  }
  if (pa && !pb) return -1;
  if (!pa && pb) return 1;
  return b.sortOrder - a.sortOrder;
}

interface ShelfStat {
  location: CellarLocation;
  colorCounts: Record<WineColor, number>;
  totalCount: number;
}

interface CabinetGroup {
  zone: string;
  shelvesTopDown: ShelfStat[];
  usedCount: number;
  capacityCount: number;
  hasMultiTiers: boolean;
}

export function CellarMapPage() {
  const db = useWineStore((s) => s.db);
  const [selectedZone, setSelectedZone] = useState<string>('ALL');
  const [selectedShelfId, setSelectedShelfId] = useState<string | null>(null);
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  const { cabinets, totalUsed, totalCapacity, unassignedCount } = useMemo(() => {
    if (!db) {
      return {
        cabinets: [] as CabinetGroup[],
        totalUsed: 0,
        totalCapacity: 0,
        unassignedCount: 0,
      };
    }

    const wineMap = new Map(db.wines.map((w) => [w.id, w]));
    const byShelf = new Map<
      string,
      { colorCounts: Record<WineColor, number>; totalCount: number }
    >();

    let unassigned = 0;
    let inStockAll = 0;

    for (const b of db.bottles) {
      if (b.status !== 'IN_STOCK') continue;
      inStockAll += 1;
      if (!b.locationId) {
        unassigned += 1;
        continue;
      }
      const wine = wineMap.get(b.wineId);
      const entry = byShelf.get(b.locationId) ?? {
        colorCounts: emptyColorCounts(),
        totalCount: 0,
      };
      entry.totalCount += 1;
      if (wine) {
        entry.colorCounts[wine.color] += 1;
      }
      byShelf.set(b.locationId, entry);
    }

    const byZone = new Map<string, ShelfStat[]>();
    let cap = 0;

    for (const location of db.locations) {
      cap += location.maxCapacity;
      const entry = byShelf.get(location.id) ?? {
        colorCounts: emptyColorCounts(),
        totalCount: 0,
      };
      const list = byZone.get(location.zone) ?? [];
      list.push({ location, ...entry });
      byZone.set(location.zone, list);
    }

    const sortedZones = [...byZone.keys()].sort((a, b) => {
      const pa = getZonePriority(a);
      const pb = getZonePriority(b);
      if (pa !== pb) return pa - pb;
      return a.localeCompare(b, 'ko');
    });

    const groups: CabinetGroup[] = sortedZones.map((zone) => {
      const shelvesTopDown = [...(byZone.get(zone) ?? [])].sort((a, b) =>
        compareShelfTopToBottom(a.location, b.location),
      );
      const usedCount = shelvesTopDown.reduce((acc, s) => acc + s.totalCount, 0);
      const capacityCount = shelvesTopDown.reduce((acc, s) => acc + s.location.maxCapacity, 0);
      const tiers = new Set(
        shelvesTopDown
          .map((s) => parseShelfNumbers(s.location.shelf)?.[0])
          .filter((n): n is number => n !== undefined),
      );
      return {
        zone,
        shelvesTopDown,
        usedCount,
        capacityCount,
        hasMultiTiers: tiers.size >= 2,
      };
    });

    return {
      cabinets: groups,
      totalUsed: inStockAll,
      totalCapacity: cap,
      unassignedCount: unassigned,
    };
  }, [db]);

  useEffect(() => {
    if (selectedZone !== 'ALL' && !cabinets.some((c) => c.zone === selectedZone)) {
      setSelectedZone('ALL');
    }
  }, [cabinets, selectedZone]);

  const selectedShelf = useMemo(
    () => (db && selectedShelfId ? db.locations.find((l) => l.id === selectedShelfId) ?? null : null),
    [db, selectedShelfId],
  );

  if (!db) return null;

  const visibleCabinets =
    selectedZone === 'ALL'
      ? cabinets
      : cabinets.filter((c) => c.zone === selectedZone);

  const occupancyPct = totalCapacity > 0 ? Math.round((totalUsed / totalCapacity) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* 상단 셀러 요약 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-subtle bg-surface p-4 shadow-card">
        <div>
          <h2 className="text-base font-bold text-primary">셀러 배치도</h2>
          <p className="mt-0.5 text-xs text-secondary tabular-nums">
            전체 보유 <strong className="text-forest">{totalUsed}병</strong> / 총 정원{' '}
            {totalCapacity}병 ({occupancyPct}%) · 아래 <strong>1-1</strong>부터 위로 적층
          </p>
        </div>

        <button
          type="button"
          onClick={() => setConfigOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-subtle bg-elevated px-3 py-2 text-xs font-bold text-primary hover:border-forest hover:text-forest"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>선반 관리</span>
        </button>
      </div>

      {/* 셀러/보관처 세그먼트 탭 (삼성 → LG → 냉장고 신선 → 거실 순) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
        <button
          type="button"
          onClick={() => setSelectedZone('ALL')}
          className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${
            selectedZone === 'ALL'
              ? 'border-forest bg-forest text-white'
              : 'border-subtle bg-surface text-secondary hover:text-primary'
          }`}
        >
          전체 보기
        </button>
        {cabinets.map((cab) => (
          <button
            key={cab.zone}
            type="button"
            onClick={() => setSelectedZone(cab.zone)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-bold tabular-nums transition-colors ${
              selectedZone === cab.zone
                ? 'border-forest bg-forest text-white'
                : 'border-subtle bg-surface text-secondary hover:text-primary'
            }`}
          >
            {cab.zone} <span className="opacity-75">({cab.usedCount})</span>
          </button>
        ))}
      </div>

      {/* 미지정 보관 와인 알림 카드 */}
      {unassignedCount > 0 && (
        <button
          type="button"
          onClick={() => setShowUnassigned(true)}
          className="flex w-full items-center justify-between rounded-2xl border border-status-warn/40 bg-status-warn/10 px-4 py-3 text-left text-xs transition-colors hover:bg-status-warn/15"
        >
          <span className="flex items-center gap-2 font-bold text-primary">
            <AlertCircle className="h-4 w-4 text-status-warn" />
            보관 위치가 미지정된 와인이 {unassignedCount}병 있습니다
          </span>
          <span className="font-bold text-forest">정리하기 →</span>
        </button>
      )}

      {/* 물리적 셀러 캐비닛 수직 적층 뷰 (삼성 → LG → 냉장고 신선 → 거실) */}
      {visibleCabinets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-subtle bg-surface/60 px-6 py-16 text-center">
          <p className="text-sm font-bold text-primary">등록된 셀러·선반이 없습니다</p>
          <p className="mt-1 text-xs text-secondary">
            선반 관리에서 와인 셀러나 보관 공간을 추가해 배치도를 구성해 보세요.
          </p>
          <button
            type="button"
            onClick={() => setConfigOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-forest px-4 py-2 text-xs font-bold text-white hover:bg-forest-hover"
          >
            <Plus className="h-4 w-4" />
            <span>선반 추가하기</span>
          </button>
        </div>
      ) : (
        <div
          className={
            selectedZone === 'ALL'
              ? 'grid grid-cols-1 items-start gap-5 lg:grid-cols-2 xl:grid-cols-3'
              : 'mx-auto max-w-2xl'
          }
        >
          {visibleCabinets.map((cab) => {
            const cabRemain = cab.capacityCount - cab.usedCount;
            const isSingleShelf = cab.shelvesTopDown.length <= 1;

            return (
              <section
                key={cab.zone}
                className="overflow-hidden rounded-3xl border-2 border-subtle bg-elevated/55 shadow-card"
              >
                {/* 캐비닛 상단 헤더 */}
                <div className="flex items-center justify-between border-b border-subtle bg-surface px-4 py-3">
                  <div>
                    <h3 className="text-sm font-extrabold text-primary">{cab.zone}</h3>
                    <p className="text-[11px] text-secondary tabular-nums">
                      보유 <strong className="text-forest">{cab.usedCount}</strong> / {cab.capacityCount}병
                      {cabRemain < 0
                        ? ` (초과 +${Math.abs(cabRemain)})`
                        : ` (여유 +${cabRemain})`}
                    </p>
                  </div>

                  {!isSingleShelf && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-elevated px-2.5 py-1 text-[10px] font-semibold text-secondary">
                      <ArrowUp className="h-3 w-3 text-forest" />
                      아래 1-1 → 위
                    </span>
                  )}
                </div>

                {/* 선반 수직 적층 (맨 위 = 최고층, 맨 아래 = 1-1) */}
                <div className="space-y-1.5 p-3">
                  {cab.shelvesTopDown.map((shelfStat, idx) => {
                    const currentTier = parseShelfNumbers(shelfStat.location.shelf)?.[0];
                    const prevTier =
                      idx > 0
                        ? parseShelfNumbers(cab.shelvesTopDown[idx - 1].location.shelf)?.[0]
                        : undefined;
                    const showTierHeader =
                      cab.hasMultiTiers && currentTier !== undefined && currentTier !== prevTier;

                    return (
                      <div key={shelfStat.location.id} className="space-y-1.5">
                        {showTierHeader && (
                          <div className="flex items-center gap-2 px-1 pt-1.5 pb-0.5">
                            <span className="text-[10px] font-extrabold tracking-wider text-forest">
                              {currentTier}단 ({currentTier}-x)
                            </span>
                            <div className="h-px flex-1 bg-subtle" />
                          </div>
                        )}
                        <ShelfCard
                          location={shelfStat.location}
                          colorCounts={shelfStat.colorCounts}
                          totalCount={shelfStat.totalCount}
                          compactRack={!isSingleShelf}
                          onSelect={(loc) => setSelectedShelfId(loc.id)}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* 캐비닛 바닥 바 표시 */}
                {!isSingleShelf && (
                  <div className="flex items-center justify-between border-t border-subtle bg-surface/70 px-4 py-1.5 text-[10px] font-semibold text-secondary">
                    <span>▲ 상단 선반</span>
                    <span>▼ 바닥 (1-1 시작)</span>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* 선반 상세 드로어 */}
      <ShelfDetailDrawer
        location={selectedShelf}
        unassignedMode={showUnassigned}
        onClose={() => {
          setSelectedShelfId(null);
          setShowUnassigned(false);
        }}
      />

      {/* 선반 설정 모달 */}
      <ShelfConfigModal open={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  );
}
