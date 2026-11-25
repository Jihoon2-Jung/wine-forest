import { Plus } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useWineStore } from '@/store/useWineStore';

export function FabButton() {
  const openQuickAdd = useWineStore((s) => s.openQuickAdd);
  const { pathname } = useLocation();

  // 목록(`/`) 및 셀러(`/cellar`) 화면에서 모바일 우측 하단 FAB 노출
  if (pathname !== '/' && pathname !== '/cellar') {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => openQuickAdd(null)}
      className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] z-30 flex h-14 items-center gap-1.5 rounded-full bg-forest px-5 text-sm font-bold text-white shadow-card-hover transition-transform active:scale-95 hover:bg-forest-hover lg:hidden"
      aria-label="와인 입고"
    >
      <Plus className="h-5 w-5" />
      <span>입고</span>
    </button>
  );
}
