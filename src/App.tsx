import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useWineStore } from '@/store/useWineStore';
import { AppShell } from '@/components/layout/AppShell';
import { CellarMapPage } from '@/pages/CellarMapPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { OnboardingView } from '@/pages/OnboardingView';
import { SettingsPage } from '@/pages/SettingsPage';

const StatsPage = lazy(() => import('@/pages/StatsPage'));
const SharedListPage = lazy(() =>
  import('@/pages/SharedListPage').then((m) => ({ default: m.SharedListPage })),
);

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center text-xs font-semibold text-secondary">
      화면을 불러오는 중...
    </div>
  );
}

function PrivateAppRoutes() {
  const isHydrated = useWineStore((s) => s.isHydrated);
  const db = useWineStore((s) => s.db);

  if (!isHydrated) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas text-primary">
        <img
          src={`${import.meta.env.BASE_URL}favicon.svg`}
          alt="JH Wine Forest"
          className="h-14 w-14 animate-pulse rounded-2xl"
        />
        <p className="mt-3 font-serif text-sm font-bold text-secondary">JH Wine Forest</p>
      </div>
    );
  }

  if (!db) {
    return <OnboardingView />;
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<InventoryPage />} />
        <Route path="/cellar" element={<CellarMapPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route
          path="/stats"
          element={
            <Suspense fallback={<PageLoader />}>
              <StatsPage />
            </Suspense>
          }
        />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  const hydrate = useWineStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <HashRouter>
      <Routes>
        <Route
          path="/share"
          element={
            <Suspense fallback={<PageLoader />}>
              <SharedListPage />
            </Suspense>
          }
        />
        <Route path="/*" element={<PrivateAppRoutes />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
