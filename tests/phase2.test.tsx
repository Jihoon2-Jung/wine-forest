import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BottleInstance, TastingRecord, WineMaster } from '@/types/schema';
import { parseWineDatabase } from '@/types/validation';
import { calculateDrinkingWindowSummary } from '@/services/analytics/statsCalculator';
import {
  formatDrinkingWindowRange,
  getDrinkingWindowStatus,
} from '@/services/domain/wineHelpers';
import { computeScaledDimensions } from '@/services/media/imageProcessor';
import { createDemoDatabase } from '@/services/storage/defaultTemplates';

vi.mock('@/services/storage/localCache', () => ({
  loadCachedState: vi.fn(async () => null),
  saveCachedState: vi.fn(async () => undefined),
  clearCachedState: vi.fn(async () => undefined),
  saveLocalBackup: vi.fn(async () => undefined),
  listLocalBackups: vi.fn(async () => []),
  loadLocalBackup: vi.fn(async () => null),
  getCachedPhoto: vi.fn(async () => null),
  putCachedPhoto: vi.fn(async () => undefined),
  deleteCachedPhoto: vi.fn(async () => undefined),
}));

import { useWineStore } from '@/store/useWineStore';
import { HistoryCard } from '@/components/history/HistoryCard';

describe('Phase 2-1 — Drinking Window Logic & Stats', () => {
  it('classifies drinking window status accurately across boundary years', () => {
    expect(getDrinkingWindowStatus({ drinkingWindowStart: null, drinkingWindowEnd: null }, 2026)).toBe('unset');
    expect(getDrinkingWindowStatus({ drinkingWindowStart: 2028, drinkingWindowEnd: 2035 }, 2026)).toBe('too_young');
    expect(getDrinkingWindowStatus({ drinkingWindowStart: 2024, drinkingWindowEnd: 2030 }, 2026)).toBe('ready');
    expect(getDrinkingWindowStatus({ drinkingWindowStart: 2024, drinkingWindowEnd: 2027 }, 2026)).toBe('closing_soon');
    expect(getDrinkingWindowStatus({ drinkingWindowStart: 2024, drinkingWindowEnd: 2026 }, 2026)).toBe('closing_soon');
    expect(getDrinkingWindowStatus({ drinkingWindowStart: 2020, drinkingWindowEnd: 2025 }, 2026)).toBe('past_peak');
    expect(getDrinkingWindowStatus({ drinkingWindowStart: 2025, drinkingWindowEnd: null }, 2026)).toBe('ready');
    expect(getDrinkingWindowStatus({ drinkingWindowStart: null, drinkingWindowEnd: 2027 }, 2026)).toBe('closing_soon');

    expect(formatDrinkingWindowRange({ drinkingWindowStart: 2026, drinkingWindowEnd: 2032 })).toBe('2026~2032');
    expect(formatDrinkingWindowRange({ drinkingWindowStart: 2026, drinkingWindowEnd: null })).toBe('2026~');
    expect(formatDrinkingWindowRange({ drinkingWindowStart: null, drinkingWindowEnd: 2030 })).toBe('~2030');
    expect(formatDrinkingWindowRange({ drinkingWindowStart: null, drinkingWindowEnd: null })).toBeNull();
  });

  it('aggregates in-stock drinking window summary counts without including consumed bottles', () => {
    const db = createDemoDatabase();
    db.wines[0].drinkingWindowStart = 2024;
    db.wines[0].drinkingWindowEnd = 2030; // ready
    db.wines[1].drinkingWindowStart = 2024;
    db.wines[1].drinkingWindowEnd = 2027; // closing_soon
    db.wines[2].drinkingWindowStart = 2020;
    db.wines[2].drinkingWindowEnd = 2024; // past_peak
    db.wines[3].drinkingWindowStart = 2029;
    db.wines[3].drinkingWindowEnd = 2038; // too_young

    const summary = calculateDrinkingWindowSummary(db, 2026);
    expect(summary.readyWines).toBe(1);
    expect(summary.closingSoonWines).toBe(1);
    expect(summary.pastPeakWines).toBe(1);
    expect(summary.tooYoungWines).toBe(1);
    expect(summary.configuredBottles).toBe(
      summary.readyBottles + summary.closingSoonBottles + summary.pastPeakBottles + summary.tooYoungBottles,
    );
  });
});

describe('Phase 2-2 — 5-Star Ratings, Structured Tasting Notes & Privacy 2-A', () => {
  beforeEach(() => {
    const demoDb = createDemoDatabase();
    demoDb.metadata.lastBackupAt = new Date().toISOString();
    useWineStore.setState({
      db: demoDb,
      storageMode: 'local_test',
      isPrivacyMode: false,
    });
  });

  it('persists 0.5-step rating, companions, tastingNote, and photoFileIds cleanly through Zod', async () => {
    const targetBottle = useWineStore.getState().db!.bottles.find((b) => b.status === 'IN_STOCK')!;

    await useWineStore.getState().consumeOrGiftBottle({
      bottleId: targetBottle.id,
      type: 'CONSUMED',
      eventDate: '2026-11-24',
      occasion: '기념일 디너',
      memo: '직구 15만 구매분',
      rating: 4.5,
      companions: '가족',
      tastingNote: '체리·장미 아로마, 실키한 타닌',
      photoFileIds: ['local_photo_test_1'],
    });

    const dbAfter = parseWineDatabase(useWineStore.getState().db!);
    const tasting = dbAfter.tastings.find((t) => t.bottleId === targetBottle.id)!;
    expect(tasting.rating).toBe(4.5);
    expect(tasting.companions).toBe('가족');
    expect(tasting.tastingNote).toBe('체리·장미 아로마, 실키한 타닌');
    expect(tasting.photoFileIds).toEqual(['local_photo_test_1']);
  });

  it('keeps tastingNote, companions, and rating visible while masking price & legacy memo in Privacy Mode', () => {
    useWineStore.setState({ isPrivacyMode: true });

    const wine: WineMaster = {
      id: 'w-1',
      name: 'Domaine Test',
      country: '프랑스',
      region: '부르고뉴',
      subRegion: '볼네',
      color: 'R',
      vintage: '2019',
      bottleSizeMl: 750,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const bottle: BottleInstance = {
      id: 'b-1',
      wineId: 'w-1',
      status: 'CONSUMED',
      locationId: null,
      purchaseDate: '2025-05-01',
      purchaseSource: '와인샵',
      purchasePrice: 185000,
      includeInTrackingSince: true,
      createdAt: '2025-05-01T00:00:00Z',
      updatedAt: '2026-11-24T00:00:00Z',
    };
    const tasting: TastingRecord = {
      id: 't-1',
      bottleId: 'b-1',
      type: 'CONSUMED',
      eventDate: '2026-11-24',
      occasion: '홈파티',
      memo: '추가 18.5만 구매분',
      companions: '대학 동기들',
      rating: 4.5,
      tastingNote: '붉은 과실과 은은한 오크, 지금이 딱 적기',
      createdAt: '2026-11-24T00:00:00Z',
    };

    render(<HistoryCard tasting={tasting} bottle={bottle} wine={wine} locations={[]} />);

    // 2-A 정책: 평점·동반자·상세 시음노트는 표시
    expect(screen.getByText('4.5')).toBeInTheDocument();
    expect(screen.getByText('대학 동기들')).toBeInTheDocument();
    expect(screen.getByText('붉은 과실과 은은한 오크, 지금이 딱 적기')).toBeInTheDocument();

    // 가격 및 기존 memo는 100% 마스킹
    expect(screen.queryByText('₩185,000')).not.toBeInTheDocument();
    expect(screen.queryByText('추가 18.5만 구매분')).not.toBeInTheDocument();
    expect(screen.getByText('••••원')).toBeInTheDocument();
    expect(screen.getByText('•••• (메모 숨김)')).toBeInTheDocument();
  });
});

describe('Phase 2-3A — Image Scaling Helper', () => {
  it('scales landscape and portrait images within maxDim without upscaling small images', () => {
    expect(computeScaledDimensions(2000, 1000, 500)).toEqual({ width: 500, height: 250 });
    expect(computeScaledDimensions(1200, 2400, 1024)).toEqual({ width: 512, height: 1024 });
    expect(computeScaledDimensions(400, 300, 500)).toEqual({ width: 400, height: 300 });
  });
});
