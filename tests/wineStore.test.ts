import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedAppState, LocalBackupRecord } from '@/services/storage/localCache';
import { createDemoDatabase } from '@/services/storage/defaultTemplates';

const memoryCache: {
  state: CachedAppState | null;
  backups: LocalBackupRecord[];
} = {
  state: null,
  backups: [],
};

vi.mock('@/services/storage/localCache', () => ({
  loadCachedState: vi.fn(async () => memoryCache.state),
  saveCachedState: vi.fn(async (next: Omit<CachedAppState, 'id' | 'updatedAt'>) => {
    memoryCache.state = {
      ...next,
      id: 'singleton',
      updatedAt: new Date().toISOString(),
    };
  }),
  clearCachedState: vi.fn(async () => {
    memoryCache.state = null;
  }),
  saveLocalBackup: vi.fn(async (record: LocalBackupRecord) => {
    memoryCache.backups.push(record);
  }),
  listLocalBackups: vi.fn(async () =>
    memoryCache.backups.map(({ data: _d, ...rest }) => rest),
  ),
  loadLocalBackup: vi.fn(async (fileId: string) => {
    return memoryCache.backups.find((b) => b.fileId === fileId)?.data ?? null;
  }),
  clearAllLocalBackups: vi.fn(async () => {
    memoryCache.backups = [];
  }),
  getCachedPhoto: vi.fn(async () => null),
  putCachedPhoto: vi.fn(async () => undefined),
  deleteCachedPhoto: vi.fn(async () => undefined),
  clearAllCachedPhotos: vi.fn(async () => undefined),
}));

import { useWineStore } from '@/store/useWineStore';

describe('useWineStore — Domain Mutations & Data Integrity', () => {
  beforeEach(async () => {
    memoryCache.state = null;
    memoryCache.backups = [];
    const demoDb = createDemoDatabase();
    demoDb.metadata.lastBackupAt = new Date().toISOString();
    useWineStore.setState({
      db: demoDb,
      storageMode: 'local_test',
      fileId: 'local-test-wine-db',
      lastSyncedModifiedTime: null,
      hasUnsyncedChanges: false,
      syncStatus: 'synced',
      syncError: null,
      conflict: null,
      toast: null,
    });
  });

  it('distinguishes masters by 4-tuple (name, vintage, bottleSizeMl, color) and supports 250ml', async () => {
    const initialWines = useWineStore.getState().db!.wines.length;

    await useWineStore.getState().addBottles({
      name: 'Domaine Test Cuvee',
      country: '프랑스',
      region: '부르고뉴',
      subRegion: '볼네',
      color: 'R',
      vintage: '2021',
      bottleSizeMl: 250,
      quantity: 2,
      purchasePrice: 45000,
      locationId: 'loc_samsung_1_1',
      purchaseDate: '2026-11-20',
      purchaseSource: '와인앤모어',
    });

    // 동일 이름·빈티지·용량이지만 색상이 W -> 별도 마스터 생성
    await useWineStore.getState().addBottles({
      name: 'Domaine Test Cuvee',
      country: '프랑스',
      region: '부르고뉴',
      subRegion: '볼네',
      color: 'W',
      vintage: '2021',
      bottleSizeMl: 250,
      quantity: 1,
      purchasePrice: 48000,
      locationId: 'loc_samsung_1_1',
      purchaseDate: '2026-11-20',
      purchaseSource: '와인앤모어',
    });

    // 동일 4중 키(R, 2021, 250ml) 재입고 -> 기존 마스터 재사용
    await useWineStore.getState().addBottles({
      name: '  domaine test cuvee ',
      country: '프랑스',
      region: '부르고뉴',
      color: 'R',
      vintage: '2021',
      bottleSizeMl: 250,
      quantity: 1,
      purchasePrice: 46000,
      locationId: 'loc_samsung_1_2',
      purchaseDate: '2026-11-21',
      purchaseSource: '이마트',
    });

    const db = useWineStore.getState().db!;
    expect(db.wines.length).toBe(initialWines + 2);
    const redMaster = db.wines.find(
      (w) => w.name === 'Domaine Test Cuvee' && w.color === 'R' && w.bottleSizeMl === 250,
    );
    const whiteMaster = db.wines.find(
      (w) => w.name === 'Domaine Test Cuvee' && w.color === 'W' && w.bottleSizeMl === 250,
    );
    expect(redMaster).toBeDefined();
    expect(whiteMaster).toBeDefined();
    expect(db.bottles.filter((b) => b.wineId === redMaster!.id)).toHaveLength(3);
    expect(db.bottles.filter((b) => b.wineId === whiteMaster!.id)).toHaveLength(1);
  });

  it('merges duplicate WineMasters when updateWineMaster receives mergeTargetWineId', async () => {
    const dbBefore = useWineStore.getState().db!;
    const sourceWine = dbBefore.wines[0];
    const targetWine = dbBefore.wines[1];
    const sourceBottleIds = dbBefore.bottles
      .filter((b) => b.wineId === sourceWine.id)
      .map((b) => b.id);
    const targetCountBefore = dbBefore.bottles.filter((b) => b.wineId === targetWine.id).length;

    await useWineStore.getState().updateWineMaster(
      sourceWine.id,
      { name: targetWine.name },
      targetWine.id,
    );

    const dbAfter = useWineStore.getState().db!;
    expect(dbAfter.wines.some((w) => w.id === sourceWine.id)).toBe(false);
    expect(dbAfter.wines.length).toBe(dbBefore.wines.length - 1);
    for (const bid of sourceBottleIds) {
      expect(dbAfter.bottles.find((b) => b.id === bid)?.wineId).toBe(targetWine.id);
    }
    expect(dbAfter.bottles.filter((b) => b.wineId === targetWine.id)).toHaveLength(
      targetCountBefore + sourceBottleIds.length,
    );
  });

  it('automatically removes an orphan WineMaster only when its very last bottle is deleted', async () => {
    // 2병 이상 보유 와인 1병 삭제 -> 마스터 유지
    const dbInit = useWineStore.getState().db!;
    const multiWine = dbInit.wines.find(
      (w) => dbInit.bottles.filter((b) => b.wineId === w.id).length > 1,
    )!;
    expect(multiWine).toBeDefined();
    const multiWineId = multiWine.id;
    const multiBottles = dbInit.bottles.filter((b) => b.wineId === multiWineId);
    expect(multiBottles.length).toBeGreaterThan(1);

    await useWineStore.getState().deleteBottle(multiBottles[0].id);
    expect(useWineStore.getState().db!.wines.some((w) => w.id === multiWineId)).toBe(true);

    // 1병만 있는 신규 와인 삭제 -> 고아 마스터 자동 정리
    await useWineStore.getState().addBottles({
      name: 'Single Bottle Orphan Test',
      country: '이탈리아',
      region: '토스카나',
      color: 'R',
      vintage: '2019',
      bottleSizeMl: 750,
      quantity: 1,
      purchasePrice: 70000,
      locationId: 'loc_lg_1_1',
      purchaseDate: '2026-11-22',
      purchaseSource: '와인샵',
    });

    const addedWine = useWineStore
      .getState()
      .db!.wines.find((w) => w.name === 'Single Bottle Orphan Test')!;
    const addedBottle = useWineStore
      .getState()
      .db!.bottles.find((b) => b.wineId === addedWine.id)!;

    await useWineStore.getState().deleteBottle(addedBottle.id);
    const dbAfter = useWineStore.getState().db!;
    expect(dbAfter.bottles.some((b) => b.id === addedBottle.id)).toBe(false);
    expect(dbAfter.wines.some((w) => w.id === addedWine.id)).toBe(false);
  });

  it('blocks deleting a shelf with IN_STOCK bottles, and clears dangling locationId on consumed bottles when deleted', async () => {
    // 1) 보유 병이 들어있는 선반 삭제 시도 -> 차단
    const occupiedLocId = 'loc_samsung_1_1';
    await useWineStore.getState().deleteLocation(occupiedLocId);
    expect(useWineStore.getState().db!.locations.some((l) => l.id === occupiedLocId)).toBe(true);
    expect(useWineStore.getState().toast?.tone).toBe('warning');

    // 2) 소비 완료된 병만 참조하고 있는 선반 삭제 -> 허용 + 과거 병 locationId null 정리
    const consumedOnlyLocId = 'loc_samsung_1_2';
    const inStockOnShelf = useWineStore
      .getState()
      .db!.bottles.filter((b) => b.locationId === consumedOnlyLocId && b.status === 'IN_STOCK');
    for (const b of inStockOnShelf) {
      await useWineStore.getState().consumeOrGiftBottle({
        bottleId: b.id,
        type: 'CONSUMED',
        eventDate: '2026-11-23',
        occasion: '테스트 시음',
        memo: '메모 보존 테스트',
      });
    }

    await useWineStore.getState().deleteLocation(consumedOnlyLocId);
    const dbAfter = useWineStore.getState().db!;
    expect(dbAfter.locations.some((l) => l.id === consumedOnlyLocId)).toBe(false);
    expect(dbAfter.bottles.some((b) => b.locationId === consumedOnlyLocId)).toBe(false);
  });

  it('preserves previous locationId on consume and cleanly restores bottle back to IN_STOCK', async () => {
    const target = useWineStore.getState().db!.bottles.find((b) => b.status === 'IN_STOCK')!;
    const prevLoc = target.locationId;

    await useWineStore.getState().consumeOrGiftBottle({
      bottleId: target.id,
      type: 'GIFTED',
      eventDate: '2026-11-24',
      occasion: '집들이 선물',
      memo: '만족도 높음',
    });

    const afterConsume = useWineStore.getState().db!;
    const consumedBottle = afterConsume.bottles.find((b) => b.id === target.id)!;
    expect(consumedBottle.status).toBe('GIFTED');
    expect(consumedBottle.locationId).toBe(prevLoc);
    expect(afterConsume.tastings.find((t) => t.bottleId === target.id)?.memo).toBe('만족도 높음');

    await useWineStore.getState().restoreBottleToStock(target.id, prevLoc);
    const afterRestore = useWineStore.getState().db!;
    const restoredBottle = afterRestore.bottles.find((b) => b.id === target.id)!;
    expect(restoredBottle.status).toBe('IN_STOCK');
    expect(restoredBottle.locationId).toBe(prevLoc);
    expect(afterRestore.tastings.some((t) => t.bottleId === target.id)).toBe(false);
  });

  it('renames a shelf via updateLocation and refreshes metadata.deviceLabel on commit', async () => {
    const firstLoc = useWineStore.getState().db!.locations[0];
    await useWineStore.getState().updateLocation(firstLoc.id, {
      zone: '삼성',
      shelf: '1-9',
      displayName: '삼성 1-9 (테스트)',
      maxCapacity: 12,
    });

    const dbAfter = useWineStore.getState().db!;
    const renamed = dbAfter.locations.find((l) => l.id === firstLoc.id)!;
    expect(renamed.shelf).toBe('1-9');
    expect(renamed.displayName).toBe('삼성 1-9 (테스트)');
    expect(renamed.maxCapacity).toBe(12);
    expect(dbAfter.metadata.deviceLabel).toBeTruthy();
    expect(dbAfter.metadata.deviceLabel).not.toBe('Local Demo');
  });
});
