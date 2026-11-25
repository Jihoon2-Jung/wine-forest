import {
  BarChart3,
  Eye,
  EyeOff,
  Grid3x3,
  History,
  Moon,
  Plus,
  Settings,
  Sun,
  Wine,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useWineStore } from '@/store/useWineStore';
import { SyncBadge } from '@/components/common/SyncBadge';

const SIDEBAR_ITEMS = [
  { to: '/', label: '와인 목록', icon: Wine, end: true },
  { to: '/cellar', label: '셀러 배치도', icon: Grid3x3, end: false },
  { to: '/history', label: '소비 · 선물 이력', icon: History, end: false },
  { to: '/stats', label: '통계 대시보드', icon: BarChart3, end: false },
  { to: '/settings', label: '설정 · 백업', icon: Settings, end: false },
] as const;

export function DesktopSidebar() {
  const isPrivacyMode = useWineStore((s) => s.isPrivacyMode);
  const togglePrivacyMode = useWineStore((s) => s.togglePrivacyMode);
  const theme = useWineStore((s) => s.theme);
  const toggleTheme = useWineStore((s) => s.toggleTheme);
  const openQuickAdd = useWineStore((s) => s.openQuickAdd);
  const lastSyncedModifiedTime = useWineStore((s) => s.lastSyncedModifiedTime);

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-subtle bg-surface lg:flex">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5">
        <img
          src={`${import.meta.env.BASE_URL}favicon.svg`}
          alt="JH Wine Forest"
          className="h-9 w-9 rounded-xl shadow-sm"
        />
        <div className="min-w-0">
          <h1 className="truncate font-serif text-base font-bold tracking-tight text-primary">
            JH Wine Forest
          </h1>
          <p className="text-[11px] font-medium text-secondary">Personal Cellar Manager</p>
        </div>
      </div>

      {/* Primary Quick Add CTA */}
      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={() => openQuickAdd(null)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-forest-hover"
        >
          <Plus className="h-4 w-4" />
          <span>와인 입고</span>
        </button>
      </div>

      {/* Nav Links */}
      <nav className="flex-1 space-y-1 px-3" aria-label="사이드바 내비게이션">
        {SIDEBAR_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors ${
                isActive
                  ? 'bg-forest/[0.12] text-forest'
                  : 'text-secondary hover:bg-elevated hover:text-primary'
              }`
            }
          >
            <Icon className="h-[18px] w-[18px]" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Bottom Controls + Sync Card */}
      <div className="space-y-3 border-t border-subtle p-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={togglePrivacyMode}
            className={`flex items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-semibold transition-colors ${
              isPrivacyMode
                ? 'border-burgundy/40 bg-burgundy/[0.12] text-burgundy'
                : 'border-subtle bg-elevated text-secondary hover:text-primary'
            }`}
          >
            {isPrivacyMode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            <span>{isPrivacyMode ? '가격 숨김' : '가격 표시'}</span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-subtle bg-elevated px-2.5 py-2 text-xs font-semibold text-secondary transition-colors hover:text-primary"
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            <span>{theme === 'dark' ? '라이트' : '다크'}</span>
          </button>
        </div>

        <div className="rounded-xl border border-subtle bg-elevated/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <SyncBadge />
          </div>
          {lastSyncedModifiedTime && (
            <p className="mt-1.5 truncate text-[11px] text-secondary tabular-nums">
              마지막 저장: {new Date(lastSyncedModifiedTime).toLocaleTimeString('ko-KR')}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
