import type { GoogleTokenClient, GoogleTokenError, GoogleTokenResponse } from '@/types/gis';

export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_SAFETY_BUFFER_MS = 60_000;

interface AuthSession {
  accessToken: string | null;
  expiresAt: number;
}

const session: AuthSession = {
  accessToken: null,
  expiresAt: 0,
};

let tokenClient: GoogleTokenClient | null = null;
let pendingResolve: ((token: string) => void) | null = null;
let pendingReject: ((err: Error) => void) | null = null;

export function getGoogleClientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';
}

export function hasGoogleClientId(): boolean {
  const id = getGoogleClientId();
  return id.length > 0 && !id.startsWith('your-client-id');
}

export function isGisScriptLoaded(): boolean {
  return Boolean(typeof window !== 'undefined' && window.google?.accounts?.oauth2?.initTokenClient);
}

export function isTokenValid(): boolean {
  return Boolean(session.accessToken && Date.now() < session.expiresAt - TOKEN_SAFETY_BUFFER_MS);
}

export function getAccessToken(): string | null {
  return isTokenValid() ? session.accessToken : null;
}

export function getTokenExpiresAt(): number | null {
  return isTokenValid() ? session.expiresAt : null;
}

export function clearAccessToken(): void {
  const token = session.accessToken;
  session.accessToken = null;
  session.expiresAt = 0;
  if (token && typeof window !== 'undefined' && window.google?.accounts?.oauth2?.revoke) {
    try {
      window.google.accounts.oauth2.revoke(token);
    } catch {
      // ignore revoke network failure
    }
  }
}

function ensureTokenClient(): GoogleTokenClient {
  const clientId = getGoogleClientId();
  if (!hasGoogleClientId()) {
    throw new Error(
      'VITE_GOOGLE_CLIENT_ID가 설정되지 않았습니다. .env.local 또는 GitHub Secrets를 확인하거나 로컬 테스트 모드를 사용해 주세요.',
    );
  }
  if (!isGisScriptLoaded() || !window.google?.accounts?.oauth2) {
    throw new Error(
      'Google 인증 스크립트가 아직 로드되지 않았습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
    );
  }
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_SCOPE,
      callback: (response: GoogleTokenResponse) => {
        if (response.error || !response.access_token) {
          const err = new Error(response.error_description || response.error || '구글 인증에 실패했습니다.');
          pendingReject?.(err);
        } else {
          session.accessToken = response.access_token;
          session.expiresAt = Date.now() + (response.expires_in || 3600) * 1000;
          pendingResolve?.(response.access_token);
        }
        pendingResolve = null;
        pendingReject = null;
      },
      error_callback: (error: GoogleTokenError) => {
        const message =
          error.type === 'popup_failed_to_open'
            ? '브라우저 팝업이 차단되었습니다. 팝업 허용 후 [구글 재인증] 버튼을 다시 눌러 주세요. (iOS 홈 화면 앱에서 차단 시 Safari 브라우저에서 열어 주세요.)'
            : error.type === 'popup_closed'
              ? '구글 로그인 창이 닫혔습니다.'
              : error.message || '구글 로그인 중 오류가 발생했습니다.';
        pendingReject?.(new Error(message));
        pendingResolve = null;
        pendingReject = null;
      },
    });
  }
  return tokenClient;
}

/**
 * 반드시 사용자의 직접 클릭 이벤트 핸들러(동기 콜스택) 안에서 호출해야
 * Safari / Chrome / 모바일 팝업 차단기를 우회할 수 있습니다.
 */
export function requestAccessToken(prompt: '' | 'consent' | 'select_account' = ''): Promise<string> {
  const client = ensureTokenClient();
  return new Promise<string>((resolve, reject) => {
    if (pendingReject) {
      pendingReject(new Error('새로운 인증 요청으로 이전 요청이 취소되었습니다.'));
    }
    pendingResolve = resolve;
    pendingReject = reject;
    client.requestAccessToken({ prompt });
  });
}
