import { Capacitor } from '@capacitor/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WineGroupItem } from '@/components/wines/WineGroupCard';
import { ShareListModal } from '@/components/wines/ShareListModal';
import { App } from '@/App';
import { SharedListPage } from '@/pages/SharedListPage';
import {
  base64UrlToUint8,
  buildSharedWinePayload,
  buildShareUrl,
  decodeSharedPayload,
  DEFAULT_PUBLIC_SHARE_BASE_URL,
  DEFAULT_SHARE_PRIVACY_OPTIONS,
  encodeSharedPayload,
  evaluateShareUrlLength,
  formatSharedListAsText,
  SHARE_MAX_DECOMPRESSED_BYTES,
  SHARE_MAX_TOKEN_CHARS,
  SHARE_URL_SAFE_MAX,
  SHARE_URL_WARN_MAX,
  uint8ToBase64Url,
} from '@/services/share/shareCodec';
import { useWineStore } from '@/store/useWineStore';

function makeSampleGroups(): WineGroupItem[] {
  const nowIso = '2026-11-26T00:00:00.000Z';
  return [
    {
      wine: {
        id: 'wine-secret-uuid-001',
        name: '도멘 아르노 샹볼 뮈지니',
        producer: 'Domaine Arnaud',
        country: '프랑스',
        region: '부르고뉴',
        subRegion: '샹볼 뮈지니',
        color: 'R',
        vintage: '2019',
        bottleSizeMl: 1500,
        labelImageFileId: 'drive_secret_label_999',
        drinkingWindowStart: 2025,
        drinkingWindowEnd: 2034,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      inStockBottles: [
        {
          id: 'bottle-secret-uuid-001',
          wineId: 'wine-secret-uuid-001',
          status: 'IN_STOCK',
          locationId: 'loc_samsung_1_1',
          purchaseDate: '2025-05-12',
          purchaseSource: '비밀와인샵',
          purchasePrice: 123456,
          fxNote: '9715엔',
          includeInTrackingSince: true,
          memo: '지인선물용비밀메모',
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        {
          id: 'bottle-secret-uuid-002',
          wineId: 'wine-secret-uuid-001',
          status: 'IN_STOCK',
          locationId: 'loc_samsung_1_1',
          purchaseDate: '2025-06-01',
          purchaseSource: '와인앤모어',
          purchasePrice: 150000,
          includeInTrackingSince: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
      allBottles: [
        {
          id: 'bottle-secret-uuid-001',
          wineId: 'wine-secret-uuid-001',
          status: 'IN_STOCK',
          locationId: 'loc_samsung_1_1',
          purchaseDate: '2025-05-12',
          purchaseSource: '비밀와인샵',
          purchasePrice: 123456,
          fxNote: '9715엔',
          includeInTrackingSince: true,
          memo: '지인선물용비밀메모',
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        {
          id: 'bottle-secret-uuid-002',
          wineId: 'wine-secret-uuid-001',
          status: 'IN_STOCK',
          locationId: 'loc_samsung_1_1',
          purchaseDate: '2025-06-01',
          purchaseSource: '와인앤모어',
          purchasePrice: 150000,
          includeInTrackingSince: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
      locationSummary: '삼성 1-1',
      latestPurchaseDate: '2025-06-01',
    },
    {
      wine: {
        id: 'wine-secret-uuid-002',
        name: '크룩 그랑 퀴베',
        country: '프랑스',
        region: '샴페인',
        color: 'SP',
        vintage: 'NV',
        bottleSizeMl: 750,
        drinkingWindowStart: null,
        drinkingWindowEnd: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      inStockBottles: [],
      allBottles: [
        {
          id: 'bottle-secret-uuid-003',
          wineId: 'wine-secret-uuid-002',
          status: 'CONSUMED',
          locationId: null,
          purchaseDate: '2024-12-20',
          purchaseSource: '이마트',
          purchasePrice: 0,
          includeInTrackingSince: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
      locationSummary: '보유 없음',
      latestPurchaseDate: '2024-12-20',
    },
  ];
}

async function rawJsonFromToken(token: string): Promise<string> {
  const bytes = base64UrlToUint8(token.slice(2));
  if (token.startsWith('u.')) {
    return new TextDecoder().decode(bytes);
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const writePromise = writer.write(new Uint8Array(bytes)).then(() => writer.close());
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  await writePromise;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

describe('Serverless Share Link — shareCodec, ShareListModal & SharedListPage', () => {
  beforeEach(() => {
    window.location.hash = '';
    useWineStore.setState({
      db: null,
      isHydrated: true,
      isPrivacyMode: false,
      toast: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('1. round-trips Korean wine metadata, NV vintage, non-750ml size, drinking window, and out-of-stock item via z. compression', async () => {
    const groups = makeSampleGroups();
    const payload = buildSharedWinePayload(groups, {
      title: '부르고뉴 & 샴페인 추천',
      filterSummary: '프랑스 · 품절 포함',
      options: DEFAULT_SHARE_PRIVACY_OPTIONS,
      expiry: 'none',
      now: new Date(2026, 10, 26),
    });

    const token = await encodeSharedPayload(payload);
    expect(token.startsWith('z.') || token.startsWith('u.')).toBe(true);

    const decoded = await decodeSharedPayload(token, new Date(2026, 10, 26));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    expect(decoded.isExpired).toBe(false);
    expect(decoded.payload.title).toBe('부르고뉴 & 샴페인 추천');
    expect(decoded.payload.generatedAt).toBe('2026-11-26');
    expect(decoded.payload.filterSummary).toBe('프랑스 · 품절 포함');
    expect(decoded.payload.items).toHaveLength(2);

    const [first, second] = decoded.payload.items;
    expect(first.name).toBe('도멘 아르노 샹볼 뮈지니');
    expect(first.producer).toBe('Domaine Arnaud');
    expect(first.country).toBe('프랑스');
    expect(first.region).toBe('부르고뉴');
    expect(first.subRegion).toBe('샹볼 뮈지니');
    expect(first.color).toBe('R');
    expect(first.vintage).toBe('2019');
    expect(first.bottleSizeMl).toBe(1500);
    expect(first.quantity).toBe(2);
    expect(first.drinkingWindowStart).toBe(2025);
    expect(first.drinkingWindowEnd).toBe(2034);

    expect(second.name).toBe('크룩 그랑 퀴베');
    expect(second.color).toBe('SP');
    expect(second.vintage).toBe('NV');
    expect(second.bottleSizeMl).toBe(750);
    expect(second.quantity).toBe(0);
  });

  it('2. falls back to uncompressed u. prefix when CompressionStream is unavailable and decodes cleanly', async () => {
    const origCS = globalThis.CompressionStream;
    Object.defineProperty(globalThis, 'CompressionStream', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      const payload = buildSharedWinePayload(makeSampleGroups(), {
        title: '무압축 폴백 테스트',
        options: DEFAULT_SHARE_PRIVACY_OPTIONS,
        expiry: 'none',
        now: new Date(2026, 10, 26),
      });
      const token = await encodeSharedPayload(payload);
      expect(token.startsWith('u.')).toBe(true);

      const decoded = await decodeSharedPayload(token, new Date(2026, 10, 26));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(decoded.payload.title).toBe('무압축 폴백 테스트');
      expect(decoded.payload.items).toHaveLength(2);
    } finally {
      Object.defineProperty(globalThis, 'CompressionStream', {
        value: origCS,
        configurable: true,
        writable: true,
      });
    }
  });

  it('3. strips all private fields at the raw JSON wire level when default privacy options are OFF', async () => {
    const payload = buildSharedWinePayload(makeSampleGroups(), {
      title: '공개 리스트',
      options: DEFAULT_SHARE_PRIVACY_OPTIONS,
      expiry: 'none',
      now: new Date(2026, 10, 26),
    });
    const token = await encodeSharedPayload(payload);
    const rawJson = await rawJsonFromToken(token);

    expect(rawJson).not.toContain('123456');
    expect(rawJson).not.toContain('150000');
    expect(rawJson).not.toContain('9715엔');
    expect(rawJson).not.toContain('비밀와인샵');
    expect(rawJson).not.toContain('와인앤모어');
    expect(rawJson).not.toContain('지인선물용비밀메모');
    expect(rawJson).not.toContain('삼성 1-1');
    expect(rawJson).not.toContain('drive_secret_label_999');
    expect(rawJson).not.toContain('wine-secret-uuid-001');
    expect(rawJson).not.toContain('bottle-secret-uuid-001');
  });

  it('4. preserves selected optional fields (including price range, 0 KRW price, fxNote, source, memo, location) when enabled', async () => {
    const payload = buildSharedWinePayload(makeSampleGroups(), {
      title: '전체 메타 포함',
      options: {
        includePrice: true,
        includeSourceAndDate: true,
        includeMemo: true,
        includeLocation: true,
      },
      expiry: 'none',
      now: new Date(2026, 10, 26),
    });
    const token = await encodeSharedPayload(payload);
    const decoded = await decodeSharedPayload(token, new Date(2026, 10, 26));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const [first, second] = decoded.payload.items;
    expect(first.avgPrice).toBe(136728);
    expect(first.minPrice).toBe(123456);
    expect(first.maxPrice).toBe(150000);
    expect(first.isPriceUniform).toBe(false);
    expect(first.fxNote).toBe('9715엔');
    expect(first.purchaseSource).toBe('비밀와인샵 · 와인앤모어');
    expect(first.latestPurchaseDate).toBe('2025-06-01');
    expect(first.memo).toBe('지인선물용비밀메모');
    expect(first.locationSummary).toBe('삼성 1-1');

    // 0원 가격도 includePrice ON일 때 정상 복원
    expect(second.avgPrice).toBe(0);
    expect(second.minPrice).toBe(0);
    expect(second.maxPrice).toBe(0);
    expect(second.isPriceUniform).toBe(true);
    expect(second.locationSummary).toBeUndefined();
  });

  it('5. ignores tampered optional tuple fields when option bitmask bits are OFF', async () => {
    const tamperedWire = {
      v: 1,
      t: '조작 테스트',
      g: '2026-11-26',
      o: 0, // 모든 선택 옵션 OFF
      c: ['프랑스'],
      r: ['부르고뉴'],
      w: [
        [
          '테스트 와인',
          '2020',
          0,
          1,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          999999,
          999999,
          0,
          '99유로',
          '비밀샵',
          '2025-01-01',
          '비밀메모',
          '삼성 1-1',
        ],
      ],
    };
    const token = `u.${uint8ToBase64Url(new TextEncoder().encode(JSON.stringify(tamperedWire)))}`;
    const decoded = await decodeSharedPayload(token, new Date(2026, 10, 26));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const item = decoded.payload.items[0];
    expect(item.avgPrice).toBeUndefined();
    expect(item.fxNote).toBeUndefined();
    expect(item.purchaseSource).toBeUndefined();
    expect(item.latestPurchaseDate).toBeUndefined();
    expect(item.memo).toBeUndefined();
    expect(item.locationSummary).toBeUndefined();
  });

  it('6. enforces soft expiry date boundaries (valid on expiry day, expired the next day) and renders expired view', async () => {
    const payload = buildSharedWinePayload(makeSampleGroups(), {
      title: '7일 한정 리스트',
      options: DEFAULT_SHARE_PRIVACY_OPTIONS,
      expiry: '7d',
      now: new Date(2026, 10, 26), // 2026-11-26 -> expiresAt 2026-12-03
    });
    expect(payload.expiresAt).toBe('2026-12-03');
    const token = await encodeSharedPayload(payload);

    const onDay = await decodeSharedPayload(token, new Date(2026, 11, 3));
    expect(onDay.ok).toBe(true);
    if (onDay.ok) expect(onDay.isExpired).toBe(false);

    const nextDay = await decodeSharedPayload(token, new Date(2026, 11, 4));
    expect(nextDay.ok).toBe(true);
    if (nextDay.ok) expect(nextDay.isExpired).toBe(true);

    // 실제 과거 만료일 토큰으로 SharedListPage 만료 UI 검증
    const pastPayload = buildSharedWinePayload(makeSampleGroups(), {
      title: '만료된 와인 목록',
      options: DEFAULT_SHARE_PRIVACY_OPTIONS,
      expiry: '7d',
      now: new Date(2020, 0, 1),
    });
    const pastToken = await encodeSharedPayload(pastPayload);

    render(
      <MemoryRouter initialEntries={[`/share?d=${encodeURIComponent(pastToken)}`]}>
        <Routes>
          <Route path="/share" element={<SharedListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('만료된 공유 리스트입니다')).toBeInTheDocument();
    expect(screen.getByText('만료된 와인 목록')).toBeInTheDocument();
  });

  it('7. safely rejects missing, oversized, corrupted, zip-bomb (>512KB), and invalid schema tokens', async () => {
    const rMissing = await decodeSharedPayload('');
    expect(rMissing.ok).toBe(false);
    if (!rMissing.ok) expect(rMissing.reason).toBe('missing');

    const rTooLong = await decodeSharedPayload(`u.${'A'.repeat(SHARE_MAX_TOKEN_CHARS + 10)}`);
    expect(rTooLong.ok).toBe(false);
    if (!rTooLong.ok) expect(rTooLong.reason).toBe('too_long');

    const rPrefix = await decodeSharedPayload('x.abcd');
    expect(rPrefix.ok).toBe(false);
    if (!rPrefix.ok) expect(rPrefix.reason).toBe('unsupported_prefix');

    const rCorrupt = await decodeSharedPayload('z.!!!not-valid-base64!!!');
    expect(rCorrupt.ok).toBe(false);
    if (!rCorrupt.ok) expect(rCorrupt.reason).toBe('corrupted_encoding');

    // Out-of-range countryIdx -> invalid_schema
    const badSchema = {
      v: 1,
      t: '깨진 인덱스',
      g: '2026-11-26',
      o: 0,
      c: ['프랑스'],
      r: ['부르고뉴'],
      w: [['와인', '2020', 0, 1, 99, 0]],
    };
    const badSchemaToken = `u.${uint8ToBase64Url(new TextEncoder().encode(JSON.stringify(badSchema)))}`;
    const rBadSchema = await decodeSharedPayload(badSchemaToken);
    expect(rBadSchema.ok).toBe(false);
    if (!rBadSchema.ok) expect(rBadSchema.reason).toBe('invalid_schema');

    // >512KB compressed payload -> decompression_limit (Zip-bomb 방어)
    if (typeof globalThis.CompressionStream === 'function') {
      const hugeBytes = new Uint8Array(SHARE_MAX_DECOMPRESSED_BYTES + 16_384);
      hugeBytes.fill(65); // highly compressible 'A's -> tiny compressed token, >512KB decompressed
      const cs = new CompressionStream('deflate-raw');
      const writer = cs.writable.getWriter();
      const writeP = writer.write(hugeBytes).then(() => writer.close());
      const reader = cs.readable.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.byteLength;
        }
      }
      await writeP;
      const compressed = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        compressed.set(c, off);
        off += c.byteLength;
      }
      const bombToken = `z.${uint8ToBase64Url(compressed)}`;
      expect(bombToken.length).toBeLessThan(SHARE_MAX_TOKEN_CHARS);

      const rBomb = await decodeSharedPayload(bombToken);
      expect(rBomb.ok).toBe(false);
      if (!rBomb.ok) expect(rBomb.reason).toBe('decompression_limit');
    }
  });

  it('8. builds public GitHub Pages URL on Capacitor native platform and evaluates URL length tiers', () => {
    const spy = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const nativeUrl = buildShareUrl('z.abc123');
    expect(nativeUrl).toBe(`${DEFAULT_PUBLIC_SHARE_BASE_URL}#/share?d=z.abc123`);
    spy.mockRestore();

    expect(evaluateShareUrlLength('a'.repeat(SHARE_URL_SAFE_MAX)).level).toBe('safe');
    expect(evaluateShareUrlLength('a'.repeat(SHARE_URL_SAFE_MAX + 1)).level).toBe('warning');
    expect(evaluateShareUrlLength('a'.repeat(SHARE_URL_WARN_MAX + 1)).level).toBe('too_long');
  });

  it('9. renders SharedListPage directly on #/share without login or local db, isolates filters, and ignores global isPrivacyMode', async () => {
    const payload = buildSharedWinePayload(makeSampleGroups(), {
      title: '게스트용 리스트',
      options: {
        includePrice: true,
        includeSourceAndDate: false,
        includeMemo: false,
        includeLocation: false,
      },
      expiry: 'none',
      now: new Date(2026, 10, 26),
    });
    const token = await encodeSharedPayload(payload);

    // 비로그인 + hydrate 미완료 + 전역 프라이버시 모드 ON 상태에서도 정상 열람 & 가격 표시 검증
    useWineStore.setState({
      db: null,
      isHydrated: false,
      isPrivacyMode: true,
      hydrate: vi.fn().mockResolvedValue(undefined),
    });
    window.location.hash = `#/share?d=${encodeURIComponent(token)}`;

    render(<App />);

    expect(await screen.findByText('게스트용 리스트')).toBeInTheDocument();
    expect(screen.getByText('도멘 아르노 샹볼 뮈지니')).toBeInTheDocument();
    expect(screen.getByText('크룩 그랑 퀴베')).toBeInTheDocument();
    // 전역 isPrivacyMode가 true여도 공유 페이지 로컬 hidePrice 기본값(false)에 따라 가격이 보임
    expect(screen.getByText('평균 ₩136,728')).toBeInTheDocument();

    // 로컬 금액 가리기 토글 동작 확인
    fireEvent.click(screen.getByRole('button', { name: '공유 금액 가리기' }));
    expect(screen.getByText('평균 ••••원')).toBeInTheDocument();

    // 수신자 검색 필터 동작 + 전역 useWineStore.filters 불간섭 확인
    const searchInput = screen.getByPlaceholderText(/와인명, 생산자/);
    fireEvent.change(searchInput, { target: { value: '크룩' } });
    await waitFor(() => {
      expect(screen.queryByText('도멘 아르노 샹볼 뮈지니')).not.toBeInTheDocument();
    });
    expect(screen.getByText('크룩 그랑 퀴베')).toBeInTheDocument();

    expect(useWineStore.getState().db).toBeNull();
    expect(useWineStore.getState().filters.query).toBe('');
  });

  it('10. ShareListModal defaults all 4 privacy checkboxes OFF, updates URL length dynamically, and formats private-safe text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    useWineStore.setState({ isPrivacyMode: true });
    const groups = makeSampleGroups();

    render(
      <MemoryRouter>
        <ShareListModal
          open
          onClose={vi.fn()}
          groups={groups}
          filterSummary="프랑스 · 레드"
        />
      </MemoryRouter>,
    );

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes).toHaveLength(4);
    for (const cb of checkboxes) {
      expect(cb.checked).toBe(false);
    }

    // 링크 인코딩 완료 대기
    const copyLinkBtn = await screen.findByRole('button', { name: '링크 복사' });
    await waitFor(() => expect(copyLinkBtn).not.toBeDisabled());

    // 기본 상태에서 텍스트 목록 복사 -> 비공개 정보 미포함 검증
    fireEvent.click(screen.getByRole('button', { name: '텍스트 목록 복사' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const plainText = String(writeText.mock.calls[0][0]);
    expect(plainText).toContain('도멘 아르노 샹볼 뮈지니');
    expect(plainText).not.toContain('136,728');
    expect(plainText).not.toContain('비밀와인샵');
    expect(plainText).not.toContain('지인선물용비밀메모');
    expect(plainText).not.toContain('삼성 1-1');

    // 가격 체크 시 전역 프라이버시 경고 노출 + 텍스트 출력에 가격 반영
    const priceCheckbox = screen.getByLabelText('구매 가격 · 환율 메모 포함');
    fireEvent.click(priceCheckbox);
    expect(
      screen.getByText(/현재 프라이버시 모드가 켜져 있지만, 체크된 상태에서는 공유 링크에 구매 가격이 포함됩니다/),
    ).toBeInTheDocument();

    const payloadWithPrice = buildSharedWinePayload(groups, {
      title: '가격 포함 텍스트',
      options: {
        includePrice: true,
        includeSourceAndDate: false,
        includeMemo: false,
        includeLocation: false,
      },
      expiry: 'none',
      now: new Date(2026, 10, 26),
    });
    const textWithPrice = formatSharedListAsText(payloadWithPrice);
    expect(textWithPrice).toContain('평균 ₩136,728 (9715엔)');
    expect(textWithPrice).not.toContain('지인선물용비밀메모');
  });
});
