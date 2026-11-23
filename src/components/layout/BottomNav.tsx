import { BarChart3, Grid3x3, History, Wine } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: '목록', icon: Wine, end: true },
  { to: '/cellar', label: '셀러', icon: Grid3x3, end: false },
  { to: '/history', label: '이력', icon: History, end: false },
  { to: '/stats', label: '통계', icon: BarChart3, end: false },
] as const;

export function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-subtle bg-surface/95 backdrop-blur-md pb-safe lg:hidden"
      aria-label="하단 내비게이션"
    >
      <div className="grid h-16 grid-cols-4">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                isActive ? 'text-forest' : 'text-secondary hover:text-primary'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
                    isActive ? 'bg-forest/15' : ''
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
