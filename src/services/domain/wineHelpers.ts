import type { BottleInstance, WineColor, WineMaster } from '@/types/schema';

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * R6 보강: 와인 마스터 중복 병합 키에 color를 포함해
 * 동일 명칭·빈티지의 레드/화이트가 잘못 합쳐지는 오류 방지
 */
export function buildWineMasterKey(params: {
  name: string;
  vintage: string;
  bottleSizeMl: number;
  color: WineColor;
}): string {
  return [
    params.name.trim().toLowerCase(),
    params.vintage.trim().toUpperCase(),
    String(params.bottleSizeMl),
    params.color,
  ].join('|');
}

export function findMatchingWineMaster(
  wines: WineMaster[],
  params: {
    name: string;
    vintage: string;
    bottleSizeMl: number;
    color: WineColor;
  },
): WineMaster | undefined {
  const targetKey = buildWineMasterKey(params);
  return wines.find((w) => buildWineMasterKey(w) === targetKey);
}

export function getTodayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shouldIncludeInTrackingSince(
  purchaseDate: string | null,
  trackingSinceDate: string,
): boolean {
  if (!purchaseDate) return false;
  return purchaseDate >= trackingSinceDate;
}

export function formatKrw(value: number): string {
  return `₩${Math.round(value).toLocaleString('ko-KR')}`;
}

export function formatCompactKrw(value: number): string {
  if (Math.abs(value) >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(1)}억`;
  }
  if (Math.abs(value) >= 10_000) {
    return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만`;
  }
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

/**
 * 빈티지 비교: NV는 항상 뒤로 배치
 */
export function compareVintage(a: string, b: string, direction: 'asc' | 'desc' = 'asc'): number {
  const aIsNv = a.toUpperCase() === 'NV';
  const bIsNv = b.toUpperCase() === 'NV';
  if (aIsNv && bIsNv) return 0;
  if (aIsNv) return 1;
  if (bIsNv) return -1;
  const numA = Number(a);
  const numB = Number(b);
  return direction === 'asc' ? numA - numB : numB - numA;
}

/**
 * M5 보강: 다수량 보유 병 소비 시 기본 선택 기준 = 오래된 구입일 순(FIFO)
 */
export function sortBottlesFifo(bottles: BottleInstance[]): BottleInstance[] {
  return [...bottles].sort((a, b) => {
    const dateA = a.purchaseDate ?? '9999-12-31';
    const dateB = b.purchaseDate ?? '9999-12-31';
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function formatBackupDateStamp(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function formatBackupDateTimeStamp(date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${formatBackupDateStamp(date)}_${hh}${mm}${ss}`;
}

export function formatBottleSizeBadge(ml: number): string | null {
  if (ml === 750) return null;
  if (ml === 375) return '375ml HB';
  if (ml === 1500) return '1.5L Mag';
  return `${ml}ml`;
}

/**
 * 3단계 산지 표기: 국가 · 지역 · 세부지역 (상위에서 끝나면 중복 없이 간결히 표시)
 */
export function formatWineOrigin(wine: Pick<WineMaster, 'country' | 'region' | 'subRegion'>): string {
  const parts: string[] = [wine.country];
  if (wine.region && wine.region !== wine.country) {
    parts.push(wine.region);
  }
  if (wine.subRegion && wine.subRegion !== wine.region && wine.subRegion !== wine.country) {
    parts.push(wine.subRegion);
  }
  return parts.join(' · ');
}

/**
 * Phase 2-1: 적정 음용 시기(Drinking Window) 상태 판정 순수 함수
 */
export type DrinkingWindowStatus = 'unset' | 'too_young' | 'ready' | 'closing_soon' | 'past_peak';

export function getDrinkingWindowStatus(
  wine: Pick<WineMaster, 'drinkingWindowStart' | 'drinkingWindowEnd'>,
  currentYear: number = new Date().getFullYear(),
): DrinkingWindowStatus {
  const start = wine.drinkingWindowStart ?? null;
  const end = wine.drinkingWindowEnd ?? null;
  if (start === null && end === null) return 'unset';
  if (end !== null && currentYear > end) return 'past_peak';
  if (start !== null && currentYear < start) return 'too_young';
  if (end !== null && end - currentYear <= 1) return 'closing_soon';
  return 'ready';
}

export function formatDrinkingWindowRange(
  wine: Pick<WineMaster, 'drinkingWindowStart' | 'drinkingWindowEnd'>,
): string | null {
  const start = wine.drinkingWindowStart ?? null;
  const end = wine.drinkingWindowEnd ?? null;
  if (start === null && end === null) return null;
  if (start !== null && end !== null) return `${start}~${end}`;
  if (start !== null) return `${start}~`;
  return `~${end}`;
}

export const DRINKING_WINDOW_BADGE_META: Record<
  Exclude<DrinkingWindowStatus, 'unset'>,
  { label: string; shortLabel: string; className: string }
> = {
  ready: {
    label: '지금 적기',
    shortLabel: '적기',
    className: 'bg-[var(--status-ok)]/15 text-[var(--status-ok)] border-[var(--status-ok)]/30',
  },
  closing_soon: {
    label: '마감 임박',
    shortLabel: '마감임박',
    className: 'bg-[var(--status-warn)]/15 text-[var(--status-warn)] border-[var(--status-warn)]/35',
  },
  past_peak: {
    label: '적기 경과',
    shortLabel: '경과',
    className: 'bg-[var(--status-danger)]/12 text-[var(--status-danger)] border-[var(--status-danger)]/30',
  },
  too_young: {
    label: '숙성 중',
    shortLabel: '숙성중',
    className: 'bg-elevated text-secondary border-subtle',
  },
};
