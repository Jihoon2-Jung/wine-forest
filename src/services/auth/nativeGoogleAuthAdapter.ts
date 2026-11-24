import {
  GoogleDriveAuth,
  type GoogleDriveAuthPlugin,
  type NativeAuthSessionResult,
} from '@/plugins/googleDriveAuth';
import { AuthRequiredError } from '@/services/storage/types';
import {
  TOKEN_SAFETY_BUFFER_MS,
  type AuthAdapter,
  type AuthTokenResult,
} from './types';

export const DEFAULT_NATIVE_TTL_MS = 50 * 60 * 1000;

interface NativeAuthSession {
  accessToken: string | null;
  expiresAt: number;
  email: string | null;
}

export class NativeGoogleAuthAdapter implements AuthAdapter {
  readonly isNative = true;

  private session: NativeAuthSession = {
    accessToken: null,
    expiresAt: 0,
    email: null,
  };

  private inflightRefresh: Promise<string> | null = null;

  constructor(
    private readonly plugin: GoogleDriveAuthPlugin = GoogleDriveAuth,
    private readonly nowFn: () => number = () => Date.now(),
  ) {}

  isConfigured(): boolean {
    return true;
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
    return this.session.email;
  }

  private clearSessionState(): void {
    this.session = {
      accessToken: null,
      expiresAt: 0,
      email: null,
    };
  }

  private applySessionResult(res: NativeAuthSessionResult): AuthTokenResult | null {
    if (!res || res.signedIn === false || !res.accessToken) {
      return null;
    }
    const expiresAt =
      typeof res.expiresAt === 'number' && Number.isFinite(res.expiresAt) && res.expiresAt > 0
        ? res.expiresAt
        : this.nowFn() + DEFAULT_NATIVE_TTL_MS;
    const email = res.email?.trim() || this.session.email || undefined;
    this.session = {
      accessToken: res.accessToken,
      expiresAt,
      email: email ?? null,
    };
    return {
      accessToken: res.accessToken,
      expiresAt,
      email,
    };
  }

  private normalizeError(err: unknown, mode: 'interactive' | 'silent'): Error {
    const rawCode =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code ?? '')
        : '';
    const rawMsg =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message?: unknown }).message ?? '')
          : String(err ?? '');
    const combined = `${rawCode} ${rawMsg}`.toUpperCase();

    if (combined.includes('USER_CANCELLED')) {
      return new Error('구글 로그인을 취소했습니다.');
    }
    if (combined.includes('SCOPE_DENIED')) {
      this.clearSessionState();
      return new AuthRequiredError('Google Drive 접근 권한(drive.file)이 필요합니다. 다시 로그인해 주세요.');
    }
    if (combined.includes('SESSION_EXPIRED')) {
      this.clearSessionState();
      return new AuthRequiredError('구글 인증 세션이 만료되었습니다. 다시 로그인해 주세요.');
    }
    if (mode === 'silent') {
      this.clearSessionState();
      return new AuthRequiredError(rawMsg || '구글 인증 세션이 만료되었습니다. 다시 로그인해 주세요.');
    }
    return new Error(rawMsg || '구글 로그인 중 오류가 발생했습니다.');
  }

  async ensureAccessToken(options?: { forceRefresh?: boolean }): Promise<string> {
    const forceRefresh = Boolean(options?.forceRefresh);
    if (!forceRefresh && this.hasValidToken() && this.session.accessToken) {
      return this.session.accessToken;
    }

    if (this.inflightRefresh) {
      return this.inflightRefresh;
    }

    const task = (async (): Promise<string> => {
      try {
        const res = await this.plugin.getAccessToken({ forceRefresh });
        const applied = this.applySessionResult(res);
        if (!applied) {
          this.clearSessionState();
          throw new AuthRequiredError('구글 인증 세션이 만료되었습니다. 다시 로그인해 주세요.');
        }
        return applied.accessToken;
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          throw err;
        }
        throw this.normalizeError(err, 'silent');
      }
    })();

    this.inflightRefresh = task;
    try {
      return await task;
    } finally {
      if (this.inflightRefresh === task) {
        this.inflightRefresh = null;
      }
    }
  }

  async restoreSession(): Promise<AuthTokenResult | null> {
    try {
      const res = await this.plugin.restoreSession();
      const applied = this.applySessionResult(res);
      if (!applied) {
        this.clearSessionState();
        return null;
      }
      return applied;
    } catch {
      this.clearSessionState();
      return null;
    }
  }

  async signIn(): Promise<AuthTokenResult> {
    try {
      const res = await this.plugin.signIn();
      const applied = this.applySessionResult(res);
      if (!applied) {
        throw new Error('구글 로그인에 실패했습니다.');
      }
      return applied;
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        throw err;
      }
      throw this.normalizeError(err, 'interactive');
    }
  }

  async signOut(): Promise<void> {
    this.clearSessionState();
    this.inflightRefresh = null;
    try {
      await this.plugin.signOut();
    } catch {
      // ignore signOut cleanup failure
    }
  }
}
