import { useEffect, useRef, type ReactNode } from 'react';
import { KeyRound } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isNativeAuth } from '@/services/auth/googleAuth';
import { initAndroidBackButton } from '@/services/native/nativeBridge';
import { useWineStore } from '@/store/useWineStore';
import { ConflictModal } from '@/components/common/ConflictModal';
import { ToastBar } from '@/components/common/ToastBar';
import { QuickAddModal } from '@/components/wines/QuickAddModal';
import { BottomNav } from './BottomNav';
import { DesktopSidebar } from './DesktopSidebar';
import { FabButton } from './FabButton';
import { TopHeader } from './TopHeader';

export function AppShell({ children }: { children: ReactNode }) {
  const syncStatus = useWineStore((s) => s.syncStatus);
  const hasUnsyncedChanges = useWineStore((s) => s.hasUnsyncedChanges);
  const storageMode = useWineStore((s) => s.storageMode);
  const reauthenticateAndSync = useWineStore((s) => s.reauthenticateAndSync);
  const showToast = useWineStore((s) => s.showToast);

  const location = useLocation();
  const navigate = useNavigate();
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;
    void initAndroidBackButton({
      getPathname: () => pathnameRef.current,
      navigateBack: () => navigate(-1),
      navigateHome: () => navigate('/', { replace: true }),
      showExitHint: () => showToast('한 번 더 누르면 앱이 종료됩니다.', 'info'),
    }).then((fn) => {
      if (active) {
        cleanup = fn;
      } else {
        fn();
      }
    });
    return () => {
      active = false;
      cleanup?.();
    };
  }, [navigate, showToast]);

  const showReauthBanner =
    storageMode === 'google_drive' && (syncStatus === 'auth_required' || hasUnsyncedChanges);
  const nativeAuth = isNativeAuth();

  return (
    <div className="min-h-dvh bg-canvas text-primary">
      <DesktopSidebar />
      <TopHeader />

      <div className="lg:pl-60">
        {/* R2 보강: 팝업 차단 없이 동기 클릭 제스처로 즉시 Google 재인증 + 대기 변경사항 업로드 */}
        {showReauthBanner && (
          <div className="border-b border-[var(--status-warn)]/30 bg-[var(--status-warn)]/12 px-4 py-2.5">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-medium text-primary">
                {hasUnsyncedChanges
                  ? '기기에 임시 저장된 변경사항이 있습니다. 1클릭 재인증으로 Google Drive에 동기화하세요.'
                  : nativeAuth
                    ? 'Google 인증 연결이 만료되었습니다. 버튼 1탭으로 다시 연결해 동기화하세요.'
                    : 'Google 인증 세션(1시간)이 만료되었습니다. 조회는 계속 가능하며 쓰기 전 재인증이 필요합니다.'}
              </span>
              <button
                type="button"
                onClick={() => void reauthenticateAndSync()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-forest px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-forest-hover"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>구글 재인증 후 동기화</span>
              </button>
            </div>
          </div>
        )}

        <main className="mx-auto max-w-7xl px-4 pt-4 pb-24 lg:px-8 lg:py-7">{children}</main>
      </div>

      <FabButton />
      <BottomNav />
      <QuickAddModal />
      <ConflictModal />
      <ToastBar />
    </div>
  );
}
