import {
  Cloud,
  FileUp,
  FlaskConical,
  Info,
  Moon,
  Sparkles,
  Sprout,
  Sun,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { isGoogleAuthConfigured } from '@/services/auth/googleAuth';
import { useWineStore } from '@/store/useWineStore';
import { ToastBar } from '@/components/common/ToastBar';

export function OnboardingView() {
  const connectGoogleAndLoad = useWineStore((s) => s.connectGoogleAndLoad);
  const startLocalTestMode = useWineStore((s) => s.startLocalTestMode);
  const initEmptyCellar = useWineStore((s) => s.initEmptyCellar);
  const importJsonDatabase = useWineStore((s) => s.importJsonDatabase);
  const googleConnected = useWineStore((s) => s.googleConnected);
  const theme = useWineStore((s) => s.theme);
  const toggleTheme = useWineStore((s) => s.toggleTheme);
  const showToast = useWineStore((s) => s.showToast);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [importTargetMode, setImportTargetMode] = useState<'google_drive' | 'local_test'>('google_drive');
  const clientIdReady = isGoogleAuthConfigured();

  const handleGoogleStart = async () => {
    setBusy(true);
    try {
      await connectGoogleAndLoad();
    } finally {
      setBusy(false);
    }
  };

  const triggerJsonImport = (mode: 'google_drive' | 'local_test') => {
    setImportTargetMode(mode);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      if (importTargetMode === 'local_test') {
        useWineStore.setState({ storageMode: 'local_test' });
      }
      await importJsonDatabase(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '유효하지 않은 wine_db.json 파일입니다.';
      showToast(`JSON 검증 실패: ${msg}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10 text-primary">
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute right-5 top-5 rounded-full border border-subtle bg-surface p-2.5 text-secondary shadow-card hover:text-primary"
        aria-label="테마 전환"
      >
        {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </button>

      <div className="w-full max-w-lg space-y-6">
        {/* Hero */}
        <div className="text-center">
          <img
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            alt="JH Wine Forest"
            className="mx-auto h-16 w-16 rounded-2xl shadow-card-hover"
          />
          <h1 className="mt-4 font-serif text-3xl font-bold tracking-tight text-primary">
            JH Wine Forest
          </h1>
          <p className="mt-1.5 text-sm text-secondary">
            개인용 와인 셀러 재고 · 배치도 · 소비 이력 · 통계 관리
          </p>
        </div>

        {/* Google Drive 연결 카드 */}
        <div className="space-y-4 rounded-3xl border border-subtle bg-surface p-6 shadow-card">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-forest/12 text-forest">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-primary">Google Drive 동기화로 시작</h2>
              <p className="text-xs text-secondary">
                본인 구글 드라이브(<code>JH_Wine_Forest/</code>)에 안전하게 저장됩니다.
              </p>
            </div>
          </div>

          {!googleConnected ? (
            <div className="space-y-2.5">
              <button
                type="button"
                disabled={busy || !clientIdReady}
                onClick={() => void handleGoogleStart()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-forest-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Cloud className="h-4 w-4" />
                <span>{busy ? '연결 확인 중...' : 'Google 계정으로 시작하기'}</span>
              </button>

              {!clientIdReady && (
                <p className="rounded-xl bg-elevated px-3 py-2 text-[11px] leading-relaxed text-secondary">
                  현재 <code>VITE_GOOGLE_CLIENT_ID</code> 환경변수가 설정되지 않았습니다. 아래{' '}
                  <strong>로컬 테스트 모드</strong>로 모든 기능을 즉시 사용해 보실 수 있습니다.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2.5 pt-1">
              <p className="rounded-xl bg-forest/10 px-3 py-2 text-xs font-medium text-forest">
                Google 계정이 연결되었습니다. 기존 드라이브 DB가 없으므로 시작 방식을 선택해 주세요.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => triggerJsonImport('google_drive')}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-4 py-3 text-sm font-bold text-white hover:bg-forest-hover"
              >
                <FileUp className="h-4 w-4" />
                <span>기존 wine_db.json 가져오기 (마이그레이션 결과)</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void initEmptyCellar()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-subtle bg-elevated px-4 py-3 text-sm font-bold text-primary hover:bg-surface"
              >
                <Sprout className="h-4 w-4 text-forest" />
                <span>빈 셀러로 새로 시작하기 (기본 선반 템플릿)</span>
              </button>
            </div>
          )}

          {/* R5 보강: drive.file 스코프 수동 업로드 불가 안내 */}
          <div className="flex items-start gap-2 rounded-xl border border-subtle bg-elevated/60 p-3 text-[11px] leading-relaxed text-secondary">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
            <span>
              최소 권한(<code>drive.file</code>) 보안 정책상, <code>기존 백업 도구</code>로 만든{' '}
              <code>wine_db.json</code>은 Google Drive 웹에서 직접 올리지 말고 반드시{' '}
              <strong className="text-primary">이 앱의 [JSON 가져오기] 버튼</strong>으로 업로드해 주세요.
            </span>
          </div>
        </div>

        {/* 로컬 테스트 모드 카드 (사용자 요청: 병행 지원) */}
        <div className="space-y-3 rounded-3xl border border-gold/35 bg-surface p-5 shadow-card">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold/15 text-gold">
              <FlaskConical className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-primary">로컬 테스트 모드 (OAuth 없이 즉시 체험)</h2>
              <p className="text-xs text-secondary">
                이 브라우저의 IndexedDB에 저장되며 설정에서 언제든 Google Drive 모드로 전환할 수 있습니다.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void startLocalTestMode(true)}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-gold px-3.5 py-2.5 text-xs font-bold text-white transition-opacity hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" />
              <span>데모 와인 6종으로 체험</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void startLocalTestMode(false)}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-subtle bg-elevated px-3.5 py-2.5 text-xs font-bold text-primary hover:bg-surface"
            >
              <Sprout className="h-4 w-4 text-forest" />
              <span>빈 셀러로 로컬 시작</span>
            </button>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => triggerJsonImport('local_test')}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-subtle py-2 text-xs font-semibold text-secondary hover:border-forest hover:text-forest"
          >
            <FileUp className="h-3.5 w-3.5" />
            <span>로컬 모드에서 wine_db.json 불러오기</span>
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void handleFileSelected(e)}
      />

      <ToastBar />
    </div>
  );
}
