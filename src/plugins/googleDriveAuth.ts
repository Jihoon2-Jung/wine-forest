import { registerPlugin } from '@capacitor/core';

export interface NativeAuthSessionResult {
  signedIn?: boolean;
  accessToken?: string;
  expiresAt?: number; // Unix epoch ms (iOS GIDSignIn provides exact expiration)
  email?: string;
}

export interface GoogleDriveAuthPlugin {
  /** 사용자 상호작용 기반 최초 로그인 + drive.file 권한 동의 */
  signIn(): Promise<NativeAuthSessionResult>;
  /** 앱 부팅 시 이전 로그인 세션 무음 복원 (미로그인/미동의 시 signedIn: false) */
  restoreSession(): Promise<NativeAuthSessionResult>;
  /** 유효 토큰 반환 또는 백그라운드 무음 갱신 */
  getAccessToken(options?: { forceRefresh?: boolean }): Promise<NativeAuthSessionResult>;
  /** 연결 해제 및 OS/SDK 토큰 캐시 정리 */
  signOut(): Promise<void>;
}

export const GoogleDriveAuth = registerPlugin<GoogleDriveAuthPlugin>('GoogleDriveAuth');
