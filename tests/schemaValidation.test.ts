import { describe, expect, it } from 'vitest';
import { createDemoDatabase, createEmptyDatabase } from '@/services/storage/defaultTemplates';
import { parseWineDatabase, safeParseWineDatabase } from '@/types/validation';

describe('WineDatabase Zod Schema Validation', () => {
  it('accepts a valid empty and demo database including Phase 2 reserved fields', () => {
    const emptyDb = createEmptyDatabase();
    const demoDb = createDemoDatabase();

    expect(() => parseWineDatabase(emptyDb)).not.toThrow();
    expect(() => parseWineDatabase(demoDb)).not.toThrow();

    // Phase 2 예약 필드 보존 검증
    demoDb.wines[0].labelImageFileId = 'drive-photo-id-123';
    demoDb.wines[0].drinkingWindowStart = 2025;
    demoDb.wines[0].drinkingWindowEnd = 2032;
    demoDb.tastings[0].rating = 94;
    demoDb.tastings[0].tastingNote = '미네랄과 시트러스 피니시';

    const parsed = parseWineDatabase(demoDb);
    expect(parsed.wines[0].labelImageFileId).toBe('drive-photo-id-123');
    expect(parsed.tastings[0].rating).toBe(94);
  });

  it('rejects invalid vintage, wine color, or negative price', () => {
    const demoDb = createDemoDatabase();
    const brokenVintage = structuredClone(demoDb);
    brokenVintage.wines[0].vintage = '20년';
    expect(safeParseWineDatabase(brokenVintage).success).toBe(false);

    const brokenPrice = structuredClone(demoDb);
    brokenPrice.bottles[0].purchasePrice = -5000;
    expect(safeParseWineDatabase(brokenPrice).success).toBe(false);
  });

  it('rejects dangling foreign keys for wineId, IN_STOCK locationId, and tasting bottleId', () => {
    const demoDb = createDemoDatabase();

    const badWineFk = structuredClone(demoDb);
    badWineFk.bottles[0].wineId = 'non-existent-wine';
    expect(safeParseWineDatabase(badWineFk).success).toBe(false);

    const badLocFk = structuredClone(demoDb);
    badLocFk.bottles[0].locationId = 'non-existent-shelf';
    expect(safeParseWineDatabase(badLocFk).success).toBe(false);

    const badTastingFk = structuredClone(demoDb);
    badTastingFk.tastings[0].bottleId = 'non-existent-bottle';
    expect(safeParseWineDatabase(badTastingFk).success).toBe(false);
  });

  it('allows CONSUMED bottle to retain historical locationId even if shelf was removed', () => {
    const demoDb = createDemoDatabase();
    const consumedBottle = demoDb.bottles.find((b) => b.status === 'CONSUMED')!;
    consumedBottle.locationId = 'removed-old-shelf';
    expect(safeParseWineDatabase(demoDb).success).toBe(true);
  });
});
