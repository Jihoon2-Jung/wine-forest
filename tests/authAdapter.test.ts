import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoogleDriveAuthPlugin } from '@/plugins/googleDriveAuth';
import { __setAuthAdapterForTesting } from '@/services/auth/googleAuth';
import {
  DEFAULT_NATIVE_TTL_MS,
  NativeGoogleAuthAdapter,
} from '@/services/auth/nativeGoogleAuthAdapter';
import { TOKEN_SAFETY_BUFFER_MS } from '@/services/auth/types';
import { WebGisAuthAdapter } from '@/services/auth/webGisAuthAdapter';
import { GoogleDriveAdapter } from '@/services/storage/googleDriveAdapter';
import { AuthRequiredError } from '@/services/storage/types';

function createMockPlugin(
  overrides: Partial<GoogleDriveAuthPlugin> = {},
): GoogleDriveAuthPlugin {
  return {
    signIn: vi.fn(async () => ({
      signedIn: true,
      accessToken: 'native-signin-tok',
      email: 'cellar@gmail.com',
    })),
    restoreSession: vi.fn(async () => ({ signedIn: false })),
    getAccessToken: vi.fn(async () => ({
      signedIn: true,
      accessToken: 'native-refreshed-tok',
      email: 'cellar@gmail.com',
    })),
    signOut: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('AuthAdapter — Web GIS Backward Compatibility & Native Silent Refresh', () => {
  afterEach(() => {
    __setAuthAdapterForTesting(null);
    vi.restoreAllMocks();
  });

  it('keeps web GIS compatibility: expired ensureAccessToken throws AuthRequiredError without popup and restoreSession returns null', async () => {
    const now = 1_700_000_000_000;
    const webAdapter = new WebGisAuthAdapter(() => now);

    expect(webAdapter.isNative).toBe(false);
    expect(webAdapter.hasValidToken()).toBe(false);
    expect(await webAdapter.restoreSession()).toBeNull();
    await expect(webAdapter.ensureAccessToken()).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('restores native session silently and respects 50-minute default TTL + 60s safety buffer boundary', async () => {
    let now = 1_700_000_000_000;
    const plugin = createMockPlugin({
      restoreSession: vi.fn(async () => ({
        signedIn: true,
        accessToken: 'restored-tok',
        email: 'wine@gmail.com',
      })),
    });
    const nativeAdapter = new NativeGoogleAuthAdapter(plugin, () => now);

    const restored = await nativeAdapter.restoreSession();
    expect(restored).toEqual({
      accessToken: 'restored-tok',
      expiresAt: now + DEFAULT_NATIVE_TTL_MS,
      email: 'wine@gmail.com',
    });
    expect(nativeAdapter.hasValidToken()).toBe(true);
    expect(nativeAdapter.getUserEmail()).toBe('wine@gmail.com');
    expect(await nativeAdapter.ensureAccessToken()).toBe('restored-tok');
    expect(plugin.getAccessToken).not.toHaveBeenCalled();

    // 1ms before the 60s safety buffer -> still valid
    now = 1_700_000_000_000 + DEFAULT_NATIVE_TTL_MS - TOKEN_SAFETY_BUFFER_MS - 1;
    expect(nativeAdapter.hasValidToken()).toBe(true);

    // At exactly 60s before expiry -> expired and triggers refresh
    now = 1_700_000_000_000 + DEFAULT_NATIVE_TTL_MS - TOKEN_SAFETY_BUFFER_MS;
    expect(nativeAdapter.hasValidToken()).toBe(false);

    // Explicitly unauthenticated session resolves cleanly to null
    const emptyPlugin = createMockPlugin({
      restoreSession: vi.fn(async () => ({ signedIn: false })),
    });
    const emptyAdapter = new NativeGoogleAuthAdapter(emptyPlugin, () => now);
    expect(await emptyAdapter.restoreSession()).toBeNull();
    expect(emptyAdapter.hasValidToken()).toBe(false);
  });

  it('deduplicates concurrent native ensureAccessToken calls (single-flight)', async () => {
    let resolveBridge!: (value: { signedIn: boolean; accessToken: string }) => void;
    const getTokenSpy = vi.fn(
      () =>
        new Promise<{ signedIn: boolean; accessToken: string }>((resolve) => {
          resolveBridge = resolve;
        }),
    );
    const nativeAdapter = new NativeGoogleAuthAdapter(
      createMockPlugin({ getAccessToken: getTokenSpy }),
    );

    const pending = Promise.all([
      nativeAdapter.ensureAccessToken(),
      nativeAdapter.ensureAccessToken(),
      nativeAdapter.ensureAccessToken(),
      nativeAdapter.ensureAccessToken(),
      nativeAdapter.ensureAccessToken(),
    ]);

    expect(getTokenSpy).toHaveBeenCalledTimes(1);
    resolveBridge({ signedIn: true, accessToken: 'single-flight-tok' });

    const tokens = await pending;
    expect(tokens).toEqual([
      'single-flight-tok',
      'single-flight-tok',
      'single-flight-tok',
      'single-flight-tok',
      'single-flight-tok',
    ]);
  });

  it('GoogleDriveAdapter retries HTTP 401 once on native with forceRefresh=true and never retries infinitely or on web', async () => {
    const now = 1_700_000_000_000;
    const getAccessTokenSpy = vi.fn(async () => ({
      signedIn: true,
      accessToken: 'fresh-tok-after-401',
      expiresAt: now + 3_600_000,
    }));
    const nativeAdapter = new NativeGoogleAuthAdapter(
      createMockPlugin({
        restoreSession: vi.fn(async () => ({
          signedIn: true,
          accessToken: 'stale-tok',
          expiresAt: now + 3_600_000,
        })),
        getAccessToken: getAccessTokenSpy,
      }),
      () => now,
    );
    await nativeAdapter.restoreSession();
    __setAuthAdapterForTesting(nativeAdapter);

    const drive = new GoogleDriveAdapter();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ modifiedTime: '2026-11-24T12:00:00.000Z' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const modTime = await drive.getFileModifiedTime('file-1');
    expect(modTime).toBe('2026-11-24T12:00:00.000Z');
    expect(getAccessTokenSpy).toHaveBeenCalledWith({ forceRefresh: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondHeaders = fetchSpy.mock.calls[1]?.[1]?.headers as Headers;
    expect(secondHeaders.get('Authorization')).toBe('Bearer fresh-tok-after-401');

    // Consecutive 401 -> stops after 1 retry (total 2 fetches) and throws AuthRequiredError
    fetchSpy.mockReset();
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }));

    await expect(drive.getFileModifiedTime('file-1')).rejects.toBeInstanceOf(AuthRequiredError);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Web adapter: 401 does NOT retry
    const webAdapter = new WebGisAuthAdapter(() => now);
    vi.spyOn(webAdapter, 'ensureAccessToken').mockResolvedValue('web-tok');
    __setAuthAdapterForTesting(webAdapter);
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));

    await expect(drive.getFileModifiedTime('file-1')).rejects.toBeInstanceOf(AuthRequiredError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('normalizes USER_CANCELLED without clearing session, and clears session + throws AuthRequiredError on SCOPE_DENIED/SESSION_EXPIRED', async () => {
    const now = 1_700_000_000_000;
    const plugin = createMockPlugin({
      restoreSession: vi.fn(async () => ({
        signedIn: true,
        accessToken: 'existing-valid-tok',
        expiresAt: now + 3_600_000,
      })),
      signIn: vi.fn(async () => {
        throw Object.assign(new Error('USER_CANCELLED'), { code: 'USER_CANCELLED' });
      }),
      getAccessToken: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('SCOPE_DENIED'), { code: 'SCOPE_DENIED' }))
        .mockRejectedValueOnce(
          Object.assign(new Error('SESSION_EXPIRED'), { code: 'SESSION_EXPIRED' }),
        ),
    });

    const adapter = new NativeGoogleAuthAdapter(plugin, () => now);
    await adapter.restoreSession();

    // User cancellation throws friendly message without wiping valid session
    await expect(adapter.signIn()).rejects.toThrow('구글 로그인을 취소했습니다.');
    expect(adapter.hasValidToken()).toBe(true);

    // SCOPE_DENIED clears session & throws AuthRequiredError
    await expect(adapter.ensureAccessToken({ forceRefresh: true })).rejects.toBeInstanceOf(
      AuthRequiredError,
    );
    expect(adapter.hasValidToken()).toBe(false);

    // SESSION_EXPIRED clears session & throws AuthRequiredError
    await expect(adapter.ensureAccessToken()).rejects.toBeInstanceOf(AuthRequiredError);
    expect(adapter.hasValidToken()).toBe(false);
  });
});
