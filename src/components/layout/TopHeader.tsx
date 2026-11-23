import { Eye, EyeOff, Moon, Settings, Sun } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useWineStore } from '@/store/useWineStore';
import { SyncBadge } from '@/components/common/SyncBadge';

export function TopHeader() {
  const isPrivacyMode = useWineStore((s) => s.isPrivacyMode);
  const togglePrivacyMode = useWineStore((s) => s.togglePrivacyMode);
  const theme = useWineStore((s) => s.theme);
  const toggleTheme = useWineStore((s) => s.toggleTheme);
  const location = useLocation();
  const isSettings = location.pathname === '/settings';

  return (
    <header className="sticky top-0 z-30 border-b border-subtle bg-surface/90 backdrop-blur-md pt-safe lg:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2.5">
          <img
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            alt="JH Wine Forest"
            className="h-8 w-8 rounded-lg shadow-sm"
          />
          <div className="leading-tight">
            <span className="block font-serif text-sm font-bold tracking-tight text-primary">
              JH Wine Forest
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-1.5">
          <SyncBadge compact />

          <button
            type="button"
            onClick={togglePrivacyMode}
            className={`rounded-full p-2 transition-colors ${
              isPrivacyMode
                ? 'bg-burgundy/15 text-burgundy'
                : 'text-secondary hover:bg-elevated hover:text-primary'
            }`}
            aria-label={isPrivacyMode ? '가격 표시하기' : '가격 숨기기'}
            title={isPrivacyMode ? '가격 숨김 켜짐 (클릭하여 해제)' : '가격 숨김 끄기 (클릭하여 숨김)'}
          >
            {isPrivacyMode ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-full p-2 text-secondary transition-colors hover:bg-elevated hover:text-primary"
            aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
            title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
          >
            {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>

          <Link
            to="/settings"
            className={`rounded-full p-2 transition-colors ${
              isSettings
                ? 'bg-forest/15 text-forest'
                : 'text-secondary hover:bg-elevated hover:text-primary'
            }`}
            aria-label="설정"
            title="설정"
          >
            <Settings className="h-[18px] w-[18px]" />
          </Link>
        </div>
      </div>
    </header>
  );
}
