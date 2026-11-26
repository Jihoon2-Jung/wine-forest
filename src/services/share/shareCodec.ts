import { Capacitor } from '@capacitor/core';
import { z } from 'zod';
import { WINE_COLOR_LABELS, type WineColor } from '@/types/schema';
import type { WineGroupItem } from '@/components/wines/WineGroupCard';
import { calculateWineGroupPrice } from '@/services/analytics/statsCalculator';
import {
  formatBottleSizeBadge,
  formatDrinkingWindowRange,
  formatKrw,
  formatWineOrigin,
} from '@/services/domain/wineHelpers';

export const DEFAULT_PUBLIC_SHARE_BASE_URL = 'https://jihoon2-jung.github.io/wine-forest/';
export const SHARE_MAX_TOKEN_CHARS = 65_536;
export const SHARE_MAX_DECOMPRESSED_BYTES = 512 * 1024; // 512KB (Zip-bomb 방어)
export const SHARE_MAX_ITEMS = 2_000;
export const SHARE_URL_SAFE_MAX = 3_500;
export const SHARE_URL_WARN_MAX = 8_000;

export interface SharePrivacyOptions {
  includePrice: boolean;
  includeSourceAndDate: boolean;
  includeMemo: boolean;
  includeLocation: boolean;
}

export const DEFAULT_SHARE_PRIVACY_OPTIONS: SharePrivacyOptions = {
  includePrice: false,
  includeSourceAndDate: false,
  includeMemo: false,
  includeLocation: false,
};

export type ShareSoftExpiryOption = 'none' | '7d' | '30d';

export interface SharedWineItem {
  name: string;
  producer?: string;
  country: string;
  region: string;
  subRegion?: string;
  color: WineColor;
  vintage: string;
  bottleSizeMl: number;
  quantity: number;
  drinkingWindowStart?: number | null;
  drinkingWindowEnd?: number | null;
  avgPrice?: number;
  minPrice?: number;
  maxPrice?: number;
  isPriceUniform?: boolean;
  fxNote?: string;
  purchaseSource?: string;
  latestPurchaseDate?: string;
  memo?: string;
  locationSummary?: string;
}

export interface SharedWineListPayload {
  schemaVersion: 1;
  title: string;
  generatedAt: string; // 'YYYY-MM-DD'
  expiresAt?: string; // 'YYYY-MM-DD'
  filterSummary?: string;
  options: SharePrivacyOptions;
  items: SharedWineItem[];
}

export type ShareUrlLengthLevel = 'safe' | 'warning' | 'too_long';

export interface ShareUrlLengthEvaluation {
  length: number;
  level: ShareUrlLengthLevel;
  message: string;
}

export type DecodeShareErrorReason =
  | 'missing'
  | 'too_long'
  | 'unsupported_prefix'
  | 'corrupted_encoding'
  | 'decompression_limit'
  | 'invalid_schema';

export type DecodeShareResult =
  | {
      ok: true;
      payload: SharedWineListPayload;
      isExpired: boolean;
    }
  | {
      ok: false;
      reason: DecodeShareErrorReason;
      message: string;
    };

const FLAG_PRICE = 1 << 0;
const FLAG_SOURCE_DATE = 1 << 1;
const FLAG_MEMO = 1 << 2;
const FLAG_LOCATION = 1 << 3;

const COLOR_TO_IDX: Record<WineColor, number> = {
  R: 0,
  W: 1,
  SP: 2,
  SW: 3,
  RO: 4,
};

const IDX_TO_COLOR: readonly WineColor[] = ['R', 'W', 'SP', 'SW', 'RO'];

type WireWineTuple = Array<string | number>;

interface WirePayloadV1 {
  v: 1;
  t: string;
  g: string;
  e?: string;
  f?: string;
  o: number;
  c: string[];
  r: string[];
  w: WireWineTuple[];
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BASE64URL_RE = /^[A-Za-z0-9\-_]+$/;

function isValidIsoCalendarDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const isoDateOnlySchema = z
  .string()
  .regex(ISO_DATE_RE)
  .refine(isValidIsoCalendarDate);

const wirePayloadV1Schema = z.object({
  v: z.literal(1),
  t: z.string().min(1).max(120),
  g: isoDateOnlySchema,
  e: isoDateOnlySchema.optional(),
  f: z.string().max(200).optional(),
  o: z.number().int().min(0).max(15),
  c: z.array(z.string().min(1)).max(300),
  r: z.array(z.string().min(1)).max(500),
  w: z.array(z.array(z.union([z.string(), z.number()])).min(6).max(19)).max(SHARE_MAX_ITEMS),
});

export function formatLocalIsoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysLocal(base: Date, days: number): Date {
  const next = new Date(base.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function uniqueNonEmptyStrings(values: Array<string | undefined | null>, maxItems?: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const trimmed = raw?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (maxItems && out.length >= maxItems) break;
  }
  return out;
}

export function buildSharedWinePayload(
  groups: WineGroupItem[],
  params: {
    title: string;
    filterSummary?: string;
    options: SharePrivacyOptions;
    expiry: ShareSoftExpiryOption;
    now?: Date;
  },
): SharedWineListPayload {
  const now = params.now ?? new Date();
  const generatedAt = formatLocalIsoDate(now);
  const expiresAt =
    params.expiry === '7d'
      ? formatLocalIsoDate(addDaysLocal(now, 7))
      : params.expiry === '30d'
        ? formatLocalIsoDate(addDaysLocal(now, 30))
        : undefined;

  const title = params.title.trim().slice(0, 80) || 'JH Wine Forest 추천 리스트';
  const filterSummary = params.filterSummary?.trim().slice(0, 120) || undefined;

  const options: SharePrivacyOptions = {
    includePrice: Boolean(params.options.includePrice),
    includeSourceAndDate: Boolean(params.options.includeSourceAndDate),
    includeMemo: Boolean(params.options.includeMemo),
    includeLocation: Boolean(params.options.includeLocation),
  };

  const items: SharedWineItem[] = groups.slice(0, SHARE_MAX_ITEMS).map((group) => {
    const { wine, inStockBottles, allBottles } = group;
    const targetBottles = inStockBottles.length > 0 ? inStockBottles : allBottles;

    const item: SharedWineItem = {
      name: wine.name.trim(),
      country: wine.country.trim() || '미분류',
      region: wine.region.trim() || wine.country.trim() || '미분류',
      color: wine.color,
      vintage: wine.vintage.trim() || 'NV',
      bottleSizeMl: wine.bottleSizeMl || 750,
      quantity: inStockBottles.length,
    };

    const producer = wine.producer?.trim();
    if (producer) {
      item.producer = producer;
    }
    const subRegion = wine.subRegion?.trim();
    if (subRegion) {
      item.subRegion = subRegion;
    }
    if (wine.drinkingWindowStart != null) {
      item.drinkingWindowStart = wine.drinkingWindowStart;
    }
    if (wine.drinkingWindowEnd != null) {
      item.drinkingWindowEnd = wine.drinkingWindowEnd;
    }

    if (options.includePrice && targetBottles.length > 0) {
      const priceStats = calculateWineGroupPrice(targetBottles);
      item.avgPrice = priceStats.avgPrice;
      item.minPrice = priceStats.minPrice;
      item.maxPrice = priceStats.maxPrice;
      item.isPriceUniform = priceStats.isUniform;

      const fxNotes = uniqueNonEmptyStrings(
        targetBottles.map((b) => b.fxNote),
        3,
      );
      if (fxNotes.length > 0) {
        item.fxNote = fxNotes.join(' · ').slice(0, 80);
      }
    }

    if (options.includeSourceAndDate) {
      const sources = uniqueNonEmptyStrings(
        targetBottles.map((b) => b.purchaseSource),
        3,
      );
      if (sources.length > 0) {
        item.purchaseSource = sources.join(' · ').slice(0, 80);
      }
      if (
        group.latestPurchaseDate &&
        group.latestPurchaseDate !== '0000-00-00' &&
        isValidIsoCalendarDate(group.latestPurchaseDate)
      ) {
        item.latestPurchaseDate = group.latestPurchaseDate;
      }
    }

    if (options.includeMemo) {
      const memos = uniqueNonEmptyStrings(targetBottles.map((b) => b.memo));
      if (memos.length > 0) {
        item.memo = memos.join(' / ').slice(0, 200);
      }
    }

    if (options.includeLocation) {
      const loc = group.locationSummary?.trim();
      if (loc && loc !== '보유 없음') {
        item.locationSummary = loc.slice(0, 80);
      }
    }

    return item;
  });

  const payload: SharedWineListPayload = {
    schemaVersion: 1,
    title,
    generatedAt,
    options,
    items,
  };
  if (expiresAt) {
    payload.expiresAt = expiresAt;
  }
  if (filterSummary) {
    payload.filterSummary = filterSummary;
  }
  return payload;
}

function optionsToMask(options: SharePrivacyOptions): number {
  let mask = 0;
  if (options.includePrice) mask |= FLAG_PRICE;
  if (options.includeSourceAndDate) mask |= FLAG_SOURCE_DATE;
  if (options.includeMemo) mask |= FLAG_MEMO;
  if (options.includeLocation) mask |= FLAG_LOCATION;
  return mask;
}

function maskToOptions(mask: number): SharePrivacyOptions {
  return {
    includePrice: Boolean(mask & FLAG_PRICE),
    includeSourceAndDate: Boolean(mask & FLAG_SOURCE_DATE),
    includeMemo: Boolean(mask & FLAG_MEMO),
    includeLocation: Boolean(mask & FLAG_LOCATION),
  };
}

function toWirePayloadV1(payload: SharedWineListPayload): WirePayloadV1 {
  const mask = optionsToMask(payload.options);
  const countries: string[] = [];
  const countryIdxMap = new Map<string, number>();
  const regions: string[] = [];
  const regionIdxMap = new Map<string, number>();

  const getIndex = (arr: string[], map: Map<string, number>, val: string): number => {
    const key = val.trim() || '미분류';
    const existing = map.get(key);
    if (existing !== undefined) return existing;
    const idx = arr.length;
    arr.push(key);
    map.set(key, idx);
    return idx;
  };

  const w: WireWineTuple[] = payload.items.slice(0, SHARE_MAX_ITEMS).map((item) => {
    const cIdx = getIndex(countries, countryIdxMap, item.country);
    const rIdx = getIndex(regions, regionIdxMap, item.region);

    const includePrice = Boolean(mask & FLAG_PRICE);
    const includeSourceDate = Boolean(mask & FLAG_SOURCE_DATE);
    const includeMemo = Boolean(mask & FLAG_MEMO);
    const includeLocation = Boolean(mask & FLAG_LOCATION);

    const avgPrice = includePrice && typeof item.avgPrice === 'number' ? Math.max(0, Math.round(item.avgPrice)) : 0;
    const minPrice = includePrice && typeof item.minPrice === 'number' ? Math.max(0, Math.round(item.minPrice)) : 0;
    const maxPrice = includePrice && typeof item.maxPrice === 'number' ? Math.max(0, Math.round(item.maxPrice)) : 0;
    const isUniform = item.isPriceUniform ?? minPrice === maxPrice;

    const tuple: WireWineTuple = [
      item.name,
      item.vintage,
      COLOR_TO_IDX[item.color],
      Math.max(0, Math.round(item.quantity)),
      cIdx,
      rIdx,
      item.subRegion?.trim() || 0,
      item.producer?.trim() || 0,
      item.bottleSizeMl && item.bottleSizeMl !== 750 ? Math.round(item.bottleSizeMl) : 0,
      item.drinkingWindowStart != null ? Math.round(item.drinkingWindowStart) : 0,
      item.drinkingWindowEnd != null ? Math.round(item.drinkingWindowEnd) : 0,
      includePrice ? avgPrice : 0,
      includePrice ? minPrice : 0,
      includePrice && !isUniform ? maxPrice : 0,
      includePrice && item.fxNote?.trim() ? item.fxNote.trim() : 0,
      includeSourceDate && item.purchaseSource?.trim() ? item.purchaseSource.trim() : 0,
      includeSourceDate && item.latestPurchaseDate?.trim() ? item.latestPurchaseDate.trim() : 0,
      includeMemo && item.memo?.trim() ? item.memo.trim() : 0,
      includeLocation && item.locationSummary?.trim() ? item.locationSummary.trim() : 0,
    ];

    while (tuple.length > 6 && tuple[tuple.length - 1] === 0) {
      tuple.pop();
    }
    return tuple;
  });

  const wire: WirePayloadV1 = {
    v: 1,
    t: payload.title,
    g: payload.generatedAt,
    o: mask,
    c: countries,
    r: regions,
    w,
  };
  if (payload.expiresAt) {
    wire.e = payload.expiresAt;
  }
  if (payload.filterSummary) {
    wire.f = payload.filterSummary;
  }
  return wire;
}

function fromWirePayloadV1(wire: WirePayloadV1): SharedWineListPayload | null {
  const options = maskToOptions(wire.o);
  const items: SharedWineItem[] = [];

  for (const row of wire.w) {
    const name = row[0];
    const vintage = row[1];
    const colorIdx = row[2];
    const quantity = row[3];
    const countryIdx = row[4];
    const regionIdx = row[5];

    if (
      typeof name !== 'string' ||
      !name.trim() ||
      typeof vintage !== 'string' ||
      !vintage.trim() ||
      typeof colorIdx !== 'number' ||
      !Number.isInteger(colorIdx) ||
      colorIdx < 0 ||
      colorIdx >= IDX_TO_COLOR.length ||
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 0 ||
      typeof countryIdx !== 'number' ||
      !Number.isInteger(countryIdx) ||
      countryIdx < 0 ||
      countryIdx >= wire.c.length ||
      typeof regionIdx !== 'number' ||
      !Number.isInteger(regionIdx) ||
      regionIdx < 0 ||
      regionIdx >= wire.r.length
    ) {
      return null;
    }

    const rawSize = row[8];
    const bottleSizeMl =
      typeof rawSize === 'number' && Number.isInteger(rawSize) && rawSize > 0 ? rawSize : 750;

    const item: SharedWineItem = {
      name: name.trim(),
      vintage: vintage.trim(),
      color: IDX_TO_COLOR[colorIdx],
      quantity,
      country: wire.c[countryIdx],
      region: wire.r[regionIdx],
      bottleSizeMl,
    };

    if (typeof row[6] === 'string' && row[6].trim()) {
      item.subRegion = row[6].trim();
    }
    if (typeof row[7] === 'string' && row[7].trim()) {
      item.producer = row[7].trim();
    }
    if (typeof row[9] === 'number' && Number.isInteger(row[9]) && row[9] > 0) {
      item.drinkingWindowStart = row[9];
    }
    if (typeof row[10] === 'number' && Number.isInteger(row[10]) && row[10] > 0) {
      item.drinkingWindowEnd = row[10];
    }

    // 비트마스크 이중 검증: OFF인 비트의 선택 필드는 튜플에 값이 있어도 강제 무시
    if (options.includePrice) {
      const avgPrice =
        typeof row[11] === 'number' && Number.isFinite(row[11]) && row[11] >= 0
          ? Math.round(row[11])
          : 0;
      const minPrice =
        typeof row[12] === 'number' && Number.isFinite(row[12]) && row[12] >= 0
          ? Math.round(row[12])
          : avgPrice;
      const rawMax = row[13];
      const maxPrice =
        typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax > 0
          ? Math.round(rawMax)
          : minPrice;
      item.avgPrice = avgPrice;
      item.minPrice = minPrice;
      item.maxPrice = Math.max(minPrice, maxPrice);
      item.isPriceUniform = item.minPrice === item.maxPrice;

      if (typeof row[14] === 'string' && row[14].trim()) {
        item.fxNote = row[14].trim();
      }
    }

    if (options.includeSourceAndDate) {
      if (typeof row[15] === 'string' && row[15].trim()) {
        item.purchaseSource = row[15].trim();
      }
      if (typeof row[16] === 'string' && isValidIsoCalendarDate(row[16].trim())) {
        item.latestPurchaseDate = row[16].trim();
      }
    }

    if (options.includeMemo && typeof row[17] === 'string' && row[17].trim()) {
      item.memo = row[17].trim();
    }

    if (options.includeLocation && typeof row[18] === 'string' && row[18].trim()) {
      item.locationSummary = row[18].trim();
    }

    items.push(item);
  }

  const payload: SharedWineListPayload = {
    schemaVersion: 1,
    title: wire.t,
    generatedAt: wire.g,
    options,
    items,
  };
  if (wire.e) {
    payload.expiresAt = wire.e;
  }
  if (wire.f) {
    payload.filterSummary = wire.f;
  }
  return payload;
}

export function uint8ToBase64Url(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const slice = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToUint8(b64u: string): Uint8Array {
  if (!b64u || !BASE64URL_RE.test(b64u)) {
    throw new Error('INVALID_BASE64URL');
  }
  const base64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + '='.repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

class DecompressionLimitError extends Error {
  constructor() {
    super('DECOMPRESSION_LIMIT');
    this.name = 'DecompressionLimitError';
  }
}

async function readStreamBytes(
  readable: ReadableStream<Uint8Array>,
  maxBytes: number | null,
): Promise<Uint8Array> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        total += value.byteLength;
        if (maxBytes !== null && total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new DecompressionLimitError();
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function compressDeflateRaw(input: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  const writePromise = writer
    .write(new Uint8Array(input))
    .then(() => writer.close());
  const readPromise = readStreamBytes(cs.readable, null);
  const [, compressed] = await Promise.all([writePromise, readPromise]);
  return compressed;
}

async function decompressDeflateRawWithLimit(
  input: Uint8Array,
  maxBytes: number,
): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  // reader.cancel() 발생 시 writer reject가 unhandledRejection으로 새지 않도록 보호
  const writePromise = writer
    .write(new Uint8Array(input))
    .then(() => writer.close())
    .catch(() => undefined);
  const readPromise = readStreamBytes(ds.readable, maxBytes);
  const [decompressed] = await Promise.all([readPromise, writePromise]);
  return decompressed;
}

export async function encodeSharedPayload(payload: SharedWineListPayload): Promise<string> {
  const wire = toWirePayloadV1(payload);
  const utf8Bytes = new TextEncoder().encode(JSON.stringify(wire));

  if (typeof globalThis.CompressionStream === 'function') {
    try {
      const compressed = await compressDeflateRaw(utf8Bytes);
      return `z.${uint8ToBase64Url(compressed)}`;
    } catch {
      // fallback to uncompressed encoding when deflate-raw is unavailable
    }
  }

  return `u.${uint8ToBase64Url(utf8Bytes)}`;
}

export async function decodeSharedPayload(
  rawToken: string | null | undefined,
  now: Date = new Date(),
): Promise<DecodeShareResult> {
  const token = rawToken?.trim() ?? '';
  if (!token) {
    return {
      ok: false,
      reason: 'missing',
      message: '공유 데이터가 링크에 포함되어 있지 않습니다.',
    };
  }
  if (token.length > SHARE_MAX_TOKEN_CHARS) {
    return {
      ok: false,
      reason: 'too_long',
      message: '지원되는 최대 공유 링크 크기를 초과했습니다.',
    };
  }

  const isCompressed = token.startsWith('z.');
  const isUncompressed = token.startsWith('u.');
  if (!isCompressed && !isUncompressed) {
    return {
      ok: false,
      reason: 'unsupported_prefix',
      message: '지원하지 않는 형식의 공유 링크입니다.',
    };
  }

  const encodedBody = token.slice(2);
  let utf8Bytes: Uint8Array;

  try {
    const rawBytes = base64UrlToUint8(encodedBody);
    if (isCompressed) {
      if (typeof globalThis.DecompressionStream !== 'function') {
        return {
          ok: false,
          reason: 'corrupted_encoding',
          message: '현재 브라우저에서는 압축된 공유 링크 해제를 지원하지 않습니다.',
        };
      }
      utf8Bytes = await decompressDeflateRawWithLimit(rawBytes, SHARE_MAX_DECOMPRESSED_BYTES);
    } else {
      if (rawBytes.byteLength > SHARE_MAX_DECOMPRESSED_BYTES) {
        return {
          ok: false,
          reason: 'decompression_limit',
          message: '지원되는 최대 공유 링크 크기를 초과했습니다.',
        };
      }
      utf8Bytes = rawBytes;
    }
  } catch (err) {
    if (err instanceof DecompressionLimitError) {
      return {
        ok: false,
        reason: 'decompression_limit',
        message: '지원되는 최대 공유 링크 크기를 초과했습니다.',
      };
    }
    return {
      ok: false,
      reason: 'corrupted_encoding',
      message: '공유 링크가 손상되었거나 메신저 전송 중 일부가 잘렸습니다.',
    };
  }

  let parsedJson: unknown;
  try {
    const jsonText = new TextDecoder('utf-8', { fatal: true }).decode(utf8Bytes);
    parsedJson = JSON.parse(jsonText);
  } catch {
    return {
      ok: false,
      reason: 'corrupted_encoding',
      message: '공유 링크 데이터를 해석할 수 없습니다. 링크가 일부 잘렸을 수 있습니다.',
    };
  }

  const validated = wirePayloadV1Schema.safeParse(parsedJson);
  if (!validated.success) {
    return {
      ok: false,
      reason: 'invalid_schema',
      message: '공유 리스트 형식이 올바르지 않습니다.',
    };
  }

  const payload = fromWirePayloadV1(validated.data);
  if (!payload) {
    return {
      ok: false,
      reason: 'invalid_schema',
      message: '공유 리스트 항목 데이터가 올바르지 않습니다.',
    };
  }

  const todayIso = formatLocalIsoDate(now);
  const isExpired = Boolean(payload.expiresAt && todayIso > payload.expiresAt);
  return {
    ok: true,
    payload,
    isExpired,
  };
}

export function getShareBaseUrl(): string {
  const configured = (import.meta.env.VITE_PUBLIC_SHARE_URL as string | undefined)?.trim();
  if (configured) {
    return configured.endsWith('/') ? configured : `${configured}/`;
  }
  if (
    !Capacitor.isNativePlatform() &&
    typeof window !== 'undefined' &&
    (window.location.protocol === 'https:' || window.location.protocol === 'http:')
  ) {
    const base = import.meta.env.BASE_URL || '/';
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    return `${window.location.origin}${normalizedBase}`;
  }
  return DEFAULT_PUBLIC_SHARE_BASE_URL;
}

export function buildShareUrl(token: string, baseUrl: string = getShareBaseUrl()): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalized}#/share?d=${encodeURIComponent(token)}`;
}

export function evaluateShareUrlLength(url: string): ShareUrlLengthEvaluation {
  const length = url.length;
  if (length <= SHARE_URL_SAFE_MAX) {
    return {
      length,
      level: 'safe',
      message: '카카오톡 · 문자 · 브라우저 어디서나 안정적으로 공유할 수 있는 길이입니다.',
    };
  }
  if (length <= SHARE_URL_WARN_MAX) {
    return {
      length,
      level: 'warning',
      message:
        '링크가 다소 깁니다. 일부 메신저에서 잘릴 수 있으니 필터를 좁히거나 [텍스트 복사]를 권장합니다.',
    };
  }
  return {
    length,
    level: 'too_long',
    message:
      '종수가 많아 링크가 매우 깁니다. 메신저 전송 시 잘릴 가능성이 높으니 [텍스트 목록 복사]를 사용해 주세요.',
  };
}

export function formatSharedListAsText(payload: SharedWineListPayload): string {
  const totalBottles = payload.items.reduce((sum, item) => sum + item.quantity, 0);
  const lines: string[] = [
    `🍷 ${payload.title} (${payload.items.length}종 · ${totalBottles}병, ${payload.generatedAt})`,
  ];
  if (payload.filterSummary) {
    lines.push(`필터: ${payload.filterSummary}`);
  }
  if (payload.expiresAt) {
    lines.push(`열람 기한: ~ ${payload.expiresAt}`);
  }

  payload.items.forEach((item, idx) => {
    const sizeBadge = formatBottleSizeBadge(item.bottleSizeMl);
    const sizeStr = sizeBadge ? ` (${sizeBadge})` : '';
    const qtyStr = item.quantity > 0 ? `${item.quantity}병` : '품절';
    const dwRange = formatDrinkingWindowRange({
      drinkingWindowStart: item.drinkingWindowStart ?? null,
      drinkingWindowEnd: item.drinkingWindowEnd ?? null,
    });

    const segments: string[] = [
      `${idx + 1}. [${WINE_COLOR_LABELS[item.color]}] ${item.vintage} ${item.name}${sizeStr}`,
      formatWineOrigin(item),
      qtyStr,
    ];

    if (dwRange) {
      segments.push(`적기 ${dwRange}`);
    }
    if (payload.options.includeLocation && item.locationSummary) {
      segments.push(`보관: ${item.locationSummary}`);
    }
    if (payload.options.includePrice && item.avgPrice !== undefined) {
      const pricePrefix = item.isPriceUniform === false ? '평균 ' : '';
      const fxSuffix = item.fxNote ? ` (${item.fxNote})` : '';
      segments.push(`${pricePrefix}${formatKrw(item.avgPrice)}${fxSuffix}`);
    }
    if (payload.options.includeSourceAndDate && (item.purchaseSource || item.latestPurchaseDate)) {
      const srcParts = [item.purchaseSource, item.latestPurchaseDate].filter(Boolean);
      segments.push(`구입: ${srcParts.join(' / ')}`);
    }
    if (payload.options.includeMemo && item.memo) {
      segments.push(`메모: ${item.memo}`);
    }

    lines.push(segments.join(' · '));
  });

  return lines.join('\n');
}
