import type { GoogleTokenClient, GoogleTokenError, GoogleTokenResponse } from '@/types/gis';
import { AuthRequiredError } from '@/services/storage/types';
import {
  GOOGLE_DRIVE_SCOPE,
  TOKEN_SAFETY_BUFFER_MS,
  type AuthAdapter,
  type AuthTokenResult,
} from './types';

interface WebAuthSession {
  accessToken: string | null;
  expiresAt: number;
}

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

export class WebGisAuthAdapter implements AuthAdapter {
  readonly isNative = false;

  private session: WebAuthSession = {
    accessToken: null,
    expiresAt: 0,
  };

  private tokenClient: GoogleTokenClient | null = null;
  private pendingResolve: ((res: AuthTokenResult) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private signInSeq = 0;
  private activeSeq = 0;

  constructor(private readonly nowFn: () => number = () => Date.now()) {}

  isConfigured(): boolean {
    return hasGoogleClientId();
  }

  hasValidToken(): boolean {
    return Boolean(
      this.session.accessToken && this.nowFn() < this.session.expiresAt - TOKEN_SAFETY_BUFFER_MS,
    );
  }

  getAccessToken(): string | null {
    return this.hasValidToken() ? this.session.accessToken : null;
  }

  getTokenExpiresAt(): number | null {
    return this.hasValidToken() ? this.session.expiresAt : null;
  }

  getUserEmail(): string | null {
    return null;
  }

  async ensureAccessToken(): Promise<string> {
    const token = this.getAccessToken();
    if (!token) {
      throw new AuthRequiredError('구글 인증이 만료되었습니다. 1클릭 재인증을 진행해 주세요.');
    }
    return token;
  }

  invalidateToken(): void {
    this.session.accessToken = null;
    this.session.expiresAt = 0;
  }

  async restoreSession(): Promise<AuthTokenResult | null> {
    return null;
  }

  private ensureTokenClient(): GoogleTokenClient {
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
    if (!this.tokenClient) {
      this.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_DRIVE_SCOPE,
        callback: (response: GoogleTokenResponse) => {
          if (this.activeSeq === 0) return;
          const resolve = this.pendingResolve;
          const reject = this.pendingReject;
          this.pendingResolve = null;
          this.pendingReject = null;
          this.activeSeq = 0;

          if (response.error || !response.access_token) {
            const err = new Error(
              response.error_description || response.error || '구글 인증에 실패했습니다.',
            );
            reject?.(err);
            return;
          }

          // Google 세분화 동의 화면에서 drive.file 권한 체크를 해제한 경우 차단
          const grantedScopes = (response.scope ?? '').split(/\s+/).filter(Boolean);
          if (grantedScopes.length > 0 && !grantedScopes.includes(GOOGLE_DRIVE_SCOPE)) {
            this.invalidateToken();
            reject?.(
              new AuthRequiredError(
                'Google Drive 접근 권한(drive.file)에 동의해야 셀러를 동기화할 수 있습니다. 다시 로그인하여 권한을 체크해 주세요.',
              ),
            );
            return;
          }

          const expiresAt = this.nowFn() + (response.expires_in || 3600) * 1000;
          this.session.accessToken = response.access_token;
          this.session.expiresAt = expiresAt;
          resolve?.({
            accessToken: response.access_token,
            expiresAt,
          });
        },
        error_callback: (error: GoogleTokenError) => {
          if (this.activeSeq === 0) return;
          const reject = this.pendingReject;
          this.pendingResolve = null;
          this.pendingReject = null;
          this.activeSeq = 0;

          const message =
            error.type === 'popup_failed_to_open'
              ? '브라우저 팝업이 차단되었습니다. 팝업 허용 후 [구글 재인증] 버튼을 다시 눌러 주세요. (iOS 홈 화면 앱에서 차단 시 Safari 브라우저에서 열어 주세요.)'
              : error.type === 'popup_closed'
                ? '구글 로그인 창이 닫혔습니다.'
                : error.message || '구글 로그인 중 오류가 발생했습니다.';
          reject?.(new Error(message));
        },
      });
    }
    return this.tokenClient;
  }

  /**
   * 반드시 사용자의 직접 클릭 이벤트 핸들러(동기 콜스택) 안에서 호출해야
   * Safari / Chrome / 모바일 팝업 차단기를 우회할 수 있습니다.
   */
  signIn(prompt: '' | 'consent' | 'select_account' = ''): Promise<AuthTokenResult> {
    const client = this.ensureTokenClient();
    return new Promise<AuthTokenResult>((resolve, reject) => {
      if (this.pendingReject) {
        const prevReject = this.pendingReject;
        this.pendingResolve = null;
        this.pendingReject = null;
        prevReject(new Error('새로운 인증 요청으로 이전 요청이 취소되었습니다.'));
      }
      this.signInSeq += 1;
      this.activeSeq = this.signInSeq;
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      client.requestAccessToken({ prompt });
    });
  }

  async signOut(): Promise<void> {
    const token = this.session.accessToken;
    this.invalidateToken();
    if (this.pendingReject) {
      const prevReject = this.pendingReject;
      this.pendingResolve = null;
      this.pendingReject = null;
      this.activeSeq = 0;
      prevReject(new Error('로그아웃으로 인증 요청이 취소되었습니다.'));
    }
    if (token && typeof window !== 'undefined' && window.google?.accounts?.oauth2?.revoke) {
      try {
        window.google.accounts.oauth2.revoke(token);
      } catch {
        // ignore revoke network failure
      }
    }
  }
}
