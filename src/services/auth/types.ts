export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const TOKEN_SAFETY_BUFFER_MS = 60_000;

export interface AuthTokenResult {
  accessToken: string;
  expiresAt: number; // Unix epoch ms
  email?: string;
}

export interface AuthAdapter {
  readonly isNative: boolean;
  /** 현재 플랫폼에서 Google 로그인을 시작할 수 있는 환경인지 여부 */
  isConfigured(): boolean;
  /** 메모리에 만료 전 유효 토큰이 즉시 존재하는지 여부 */
  hasValidToken(): boolean;
  /** 동기식 현재 토큰 조회 (만료 시 null) */
  getAccessToken(): string | null;
  getTokenExpiresAt(): number | null;
  getUserEmail(): string | null;
  /**
   * 필요 시 백그라운드 무음 갱신 수행.
   * - 웹(GIS): 유효 토큰이 있으면 즉시 반환, 없으면 AuthRequiredError throw (팝업 차단 방지)
   * - 네이티브: 유효 토큰이 있으면 반환, 없거나 forceRefresh=true면 OS/SDK 무음 갱신 시도
   */
  ensureAccessToken(options?: { forceRefresh?: boolean }): Promise<string>;
  /** 앱 부팅 시 이전 세션 무음 복원 (웹은 no-op null 반환) */
  restoreSession(): Promise<AuthTokenResult | null>;
  /** 사용자 클릭 기반 명시적 로그인 */
  signIn(prompt?: '' | 'consent' | 'select_account'): Promise<AuthTokenResult>;
  /** 로그아웃 / 토큰 폐기 */
  signOut(): Promise<void>;
}
