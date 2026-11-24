import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CellarLocation } from '@/types/schema';
import { useWineStore } from '@/store/useWineStore';
import { BottomSheet } from '@/components/common/BottomSheet';

interface ShelfConfigModalProps {
  open: boolean;
  onClose: () => void;
}

export function ShelfConfigModal({ open, onClose }: ShelfConfigModalProps) {
  const db = useWineStore((s) => s.db);
  const addLocation = useWineStore((s) => s.addLocation);
  const updateLocation = useWineStore((s) => s.updateLocation);
  const deleteLocation = useWineStore((s) => s.deleteLocation);

  const [zone, setZone] = useState('삼성');
  const [shelf, setShelf] = useState('');
  const [maxCapacity, setMaxCapacity] = useState('8');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editZone, setEditZone] = useState('');
  const [editShelf, setEditShelf] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [displayNameEdited, setDisplayNameEdited] = useState(false);

  const { sortedLocations, inStockCountMap } = useMemo(() => {
    if (!db) return { sortedLocations: [], inStockCountMap: new Map<string, number>() };
    const map = new Map<string, number>();
    for (const b of db.bottles) {
      if (b.status === 'IN_STOCK' && b.locationId) {
        map.set(b.locationId, (map.get(b.locationId) ?? 0) + 1);
      }
    }
    return {
      sortedLocations: [...db.locations].sort((a, b) => a.sortOrder - b.sortOrder),
      inStockCountMap: map,
    };
  }, [db]);

  if (!open || !db) return null;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const z = zone.trim();
    const s = shelf.trim() || '기본';
    if (!z) return;
    const displayName = s === '기본' ? z : `${z} ${s}`;
    const maxOrder = sortedLocations.reduce((m, l) => Math.max(m, l.sortOrder), 0);
    await addLocation({
      zone: z,
      shelf: s,
      displayName,
      maxCapacity: Math.max(0, Number(maxCapacity) || 0),
      sortOrder: maxOrder + 1,
    });
    setShelf('');
  };

  const handleMoveOrder = async (index: number, delta: -1 | 1) => {
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= sortedLocations.length) return;
    const current = sortedLocations[index];
    const swap = sortedLocations[targetIdx];
    await updateLocation(current.id, { sortOrder: swap.sortOrder });
    await updateLocation(swap.id, { sortOrder: current.sortOrder });
  };

  const startRename = (loc: CellarLocation) => {
    setEditingId(loc.id);
    setEditZone(loc.zone);
    setEditShelf(loc.shelf);
    setEditDisplayName(loc.displayName);
    setDisplayNameEdited(false);
  };

  const handleSaveRename = async (locId: string) => {
    const z = editZone.trim();
    const s = editShelf.trim() || '기본';
    if (!z) return;
    const display = editDisplayName.trim() || (s === '기본' ? z : `${z} ${s}`);
    await updateLocation(locId, {
      zone: z,
      shelf: s,
      displayName: display,
    });
    setEditingId(null);
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="셀러 · 선반 관리"
      subtitle="새 선반 추가, 정원 수정, 순서 변경 및 빈 선반 삭제"
      maxWidthClass="md:max-w-2xl"
    >
      <div className="space-y-5">
        {/* 새 선반 추가 폼 */}
        <form
          onSubmit={(e) => void handleAdd(e)}
          className="grid grid-cols-1 gap-2 rounded-2xl border border-subtle bg-elevated/60 p-3.5 sm:grid-cols-12"
        >
          <input
            type="text"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            placeholder="보관처 (예: 삼성, LG, 거실)"
            className="rounded-xl border border-subtle bg-surface px-3 py-2 text-xs text-primary sm:col-span-4"
          />
          <input
            type="text"
            value={shelf}
            onChange={(e) => setShelf(e.target.value)}
            placeholder="선반 (예: 3-1, 기본)"
            className="rounded-xl border border-subtle bg-surface px-3 py-2 text-xs text-primary sm:col-span-3"
          />
          <input
            type="number"
            min={0}
            value={maxCapacity}
            onChange={(e) => setMaxCapacity(e.target.value)}
            placeholder="정원"
            className="rounded-xl border border-subtle bg-surface px-3 py-2 text-xs tabular-nums text-primary sm:col-span-2"
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1 rounded-xl bg-forest px-3 py-2 text-xs font-bold text-white hover:bg-forest-hover sm:col-span-3"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>선반 추가</span>
          </button>
        </form>

        {/* 기존 선반 목록 */}
        <div className="space-y-2">
          {sortedLocations.map((loc, idx) => {
            const count = inStockCountMap.get(loc.id) ?? 0;
            const isEditing = editingId === loc.id;
            return (
              <div
                key={loc.id}
                className="space-y-2 rounded-xl border border-subtle bg-surface px-3 py-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => void handleMoveOrder(idx, -1)}
                        className="text-secondary hover:text-primary disabled:opacity-30"
                        aria-label="위로 이동"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === sortedLocations.length - 1}
                        onClick={() => void handleMoveOrder(idx, 1)}
                        className="text-secondary hover:text-primary disabled:opacity-30"
                        aria-label="아래로 이동"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div>
                      <div className="font-bold text-primary">{loc.displayName}</div>
                      <div className="text-[11px] text-secondary tabular-nums">
                        보관처: {loc.zone} · 선반: {loc.shelf} · 현재 {count}병
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <label className="flex items-center gap-1 text-[11px] text-secondary">
                      <span>정원</span>
                      <input
                        type="number"
                        min={0}
                        defaultValue={loc.maxCapacity}
                        onBlur={(e) => {
                          const val = Math.max(0, Number(e.target.value) || 0);
                          if (val !== loc.maxCapacity) {
                            void updateLocation(loc.id, { maxCapacity: val });
                          }
                        }}
                        className="w-16 rounded-lg border border-subtle bg-elevated px-2 py-1 text-right text-xs font-bold tabular-nums text-primary"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => (isEditing ? setEditingId(null) : startRename(loc))}
                      className="rounded-lg border border-subtle p-1.5 text-secondary hover:border-forest hover:text-forest"
                      title="선반 이름 수정"
                      aria-label="선반 이름 수정"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => void deleteLocation(loc.id)}
                      disabled={count > 0}
                      className="rounded-lg border border-subtle p-1.5 text-secondary hover:border-[var(--status-danger)] hover:text-[var(--status-danger)] disabled:cursor-not-allowed disabled:opacity-35"
                      title={count > 0 ? '보유 병이 있어 삭제 불가' : '선반 삭제'}
                      aria-label="선반 삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="grid grid-cols-1 gap-2 border-t border-subtle pt-2.5 sm:grid-cols-12">
                    <input
                      type="text"
                      value={editZone}
                      onChange={(e) => {
                        const nextZ = e.target.value;
                        setEditZone(nextZ);
                        if (!displayNameEdited) {
                          const s = editShelf.trim() || '기본';
                          setEditDisplayName(s === '기본' ? nextZ.trim() : `${nextZ.trim()} ${s}`);
                        }
                      }}
                      placeholder="보관처 (예: 삼성, LG)"
                      aria-label="보관처 이름"
                      className="rounded-lg border border-subtle bg-elevated px-2.5 py-1.5 text-xs text-primary sm:col-span-3"
                    />
                    <input
                      type="text"
                      value={editShelf}
                      onChange={(e) => {
                        const nextS = e.target.value;
                        setEditShelf(nextS);
                        if (!displayNameEdited) {
                          const s = nextS.trim() || '기본';
                          setEditDisplayName(s === '기본' ? editZone.trim() : `${editZone.trim()} ${s}`);
                        }
                      }}
                      placeholder="선반 (예: 1-1, 기본)"
                      aria-label="선반 번호"
                      className="rounded-lg border border-subtle bg-elevated px-2.5 py-1.5 text-xs text-primary sm:col-span-3"
                    />
                    <input
                      type="text"
                      value={editDisplayName}
                      onChange={(e) => {
                        setEditDisplayName(e.target.value);
                        setDisplayNameEdited(true);
                      }}
                      placeholder="표시명 (예: 삼성 1-1)"
                      aria-label="선반 표시명"
                      className="rounded-lg border border-subtle bg-elevated px-2.5 py-1.5 text-xs font-semibold text-primary sm:col-span-4"
                    />
                    <div className="flex items-center justify-end gap-1 sm:col-span-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-subtle bg-elevated p-1.5 text-secondary hover:text-primary"
                        aria-label="취소"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveRename(loc.id)}
                        className="rounded-lg bg-forest p-1.5 text-white hover:bg-forest-hover"
                        aria-label="이름 저장"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </BottomSheet>
  );
}
