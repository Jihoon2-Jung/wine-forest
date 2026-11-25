import { Capacitor } from '@capacitor/core';
import { NativeGoogleAuthAdapter } from './nativeGoogleAuthAdapter';
import {
  GOOGLE_DRIVE_SCOPE,
  type AuthAdapter,
  type AuthTokenResult,
} from './types';
import {
  WebGisAuthAdapter,
  getGoogleClientId,
  hasGoogleClientId,
  isGisScriptLoaded,
} from './webGisAuthAdapter';

export { GOOGLE_DRIVE_SCOPE, getGoogleClientId, hasGoogleClientId, isGisScriptLoaded };

const webGisAuthAdapter = new WebGisAuthAdapter();
const nativeGoogleAuthAdapter = new NativeGoogleAuthAdapter();

let testAdapterOverride: AuthAdapter | null = null;

export function __setAuthAdapterForTesting(adapter: AuthAdapter | null): void {
  testAdapterOverride = adapter;
}

export function getAuthAdapter(): AuthAdapter {
  if (testAdapterOverride) {
    return testAdapterOverride;
  }
  return Capacitor.isNativePlatform() ? nativeGoogleAuthAdapter : webGisAuthAdapter;
}

export function isNativeAuth(): boolean {
  return getAuthAdapter().isNative;
}

export function isGoogleAuthConfigured(): boolean {
  return getAuthAdapter().isConfigured();
}

export function isTokenValid(): boolean {
  return getAuthAdapter().hasValidToken();
}

export function getAccessToken(): string | null {
  return getAuthAdapter().getAccessToken();
}

export function getTokenExpiresAt(): number | null {
  return getAuthAdapter().getTokenExpiresAt();
}

export function getAuthUserEmail(): string | null {
  return getAuthAdapter().getUserEmail();
}

export function ensureAccessToken(options?: { forceRefresh?: boolean }): Promise<string> {
  return getAuthAdapter().ensureAccessToken(options);
}

export function restoreAuthSession(): Promise<AuthTokenResult | null> {
  return getAuthAdapter().restoreSession();
}

export function invalidateAuthToken(): void {
  getAuthAdapter().invalidateToken();
}

export async function clearAccessToken(): Promise<void> {
  await getAuthAdapter().signOut();
}

export async function requestAccessToken(
  prompt: '' | 'consent' | 'select_account' = '',
): Promise<string> {
  const result = await getAuthAdapter().signIn(prompt);
  return result.accessToken;
}
