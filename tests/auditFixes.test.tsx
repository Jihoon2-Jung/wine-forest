import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WineDatabase } from '@/types/schema';
import { parseWineDatabase } from '@/types/validation';
import { estimateDrinkingWindow } from '@/services/domain/drinkingWindowEstimator';
import {
  buildWineLabelGroupKey,
  buildWineMasterKey,
  compareVintage,
  formatCompactKrw,
  sortBottlesFifo,
} from '@/services/domain/wineHelpers';
import { calculatePurchaseVsConsumptionTrend } from '@/services/analytics/statsCalculator';
import { dataUrlToBlob } from '@/services/media/imageProcessor';
import { SyncEngine } from '@/services/storage/syncEngine';
import type { BackupSnapshot, StorageAdapter } from '@/services/storage/types';
import { createDemoDatabase } from '@/services/storage/defaultTemplates';

const localCacheMocks = vi.hoisted(() => ({
  saveCachedState: vi.fn(async () => undefined),
  clearCachedState: vi.fn(async () => undefined),
  clearAllLocalBackups: vi.fn(async () => undefined),
  clearAllCachedPhotos: vi.fn(async () => undefined),
}));

vi.mock('@/services/storage/localCache', () => ({
  loadCachedState: vi.fn(async () => null),
  saveCachedState: localCacheMocks.saveCachedState,
  clearCachedState: localCacheMocks.clearCachedState,
  saveLocalBackup: vi.fn(async () => undefined),
  listLocalBackups: vi.fn(async () => []),
  loadLocalBackup: vi.fn(async () => null),
  clearAllLocalBackups: localCacheMocks.clearAllLocalBackups,
  getCachedPhoto: vi.fn(async () => null),
  putCachedPhoto: vi.fn(async () => undefined),
  deleteCachedPhoto: vi.fn(async () => undefined),
  clearAllCachedPhotos: localCacheMocks.clearAllCachedPhotos,
}));

import { useWineStore } from '@/store/useWineStore';
import { BottomSheet } from '@/components/common/BottomSheet';
import { PhotoLightbox } from '@/components/common/PhotoLightbox';
import { TrendChart } from '@/components/stats/TrendChart';
import { WineDetailSheet } from '@/components/wines/WineDetailSheet';
import { QuickAddModal } from '@/components/wines/QuickAddModal';

describe('Full Audit Regression Suite — Schema, Domain & Analytics', () => {
  it('rejects impossible calendar dates, duplicate IDs, and duplicate tasting bottleIds in Zod', () => {
    const base = createDemoDatabase();

    // 1. Impossible date 2025-02-31
    const badDate = structuredClone(base);
    badDate.bottles[0].purchaseDate = '2025-02-31';
    expect(() => parseWineDatabase(badDate)).toThrow();

    // 2. Duplicate wine primary key
    const dupWine = structuredClone(base);
    dupWine.wines.push({ ...dupWine.wines[0] });
    expect(() => parseWineDatabase(dupWine)).toThrow();

    // 3. Duplicate tasting.bottleId (breaks 1:1 invariant)
    const dupTasting = structuredClone(base);
    const bId = dupTasting.bottles[0].id;
    dupTasting.tastings = [
      {
        id: 't-1',
        bottleId: bId,
        type: 'CONSUMED',
        eventDate: '2025-05-01',
        createdAt: '2025-05-01T00:00:00Z',
      },
      {
        id: 't-2',
        bottleId: bId,
        type: 'CONSUMED',
        eventDate: '2025-05-02',
        createdAt: '2025-05-02T00:00:00Z',
      },
    ];
    expect(() => parseWineDatabase(dupTasting)).toThrow();
  });

  it('decodes multiline/whitespace base64 data URLs cleanly', () => {
    const multiline = 'data:image/webp;base64,UklG\nRgAA\r\n';
    const { blob, mimeType } = dataUrlToBlob(multiline);
    expect(mimeType).toBe('image/webp');
    expect(blob.size).toBe(6);
  });

  it('prevents Aloxe-Corton, Portia, Bonaparte, US SW, and NV referenceYear estimator bugs', () => {
    const aloxe = estimateDrinkingWindow({
      name: 'Domaine Test Aloxe-Corton',
      country: '프랑스',
      region: '부르고뉴',
      subRegion: '알록스 꼬르똥',
      color: 'R',
      vintage: '2020',
    });
    expect(aloxe?.basis).not.toContain('그랑크뤼');
    expect(aloxe?.end).toBeLessThan(2042);

    const portia = estimateDrinkingWindow({
      name: 'Bodegas Portia Crianza',
      country: '스페인',
      region: '리베라 델 두에로',
      color: 'R',
      vintage: '2020',
    });
    expect(portia?.basis).not.toContain('주정강화');

    const bonaparte = estimateDrinkingWindow({
      name: 'Cuvee Bonaparte Rouge',
      country: '프랑스',
      region: '랑그독',
      color: 'R',
      vintage: '2021',
    });
    expect(bonaparte?.basis).not.toContain('나파');

    const usSweet = estimateDrinkingWindow({
      name: 'Dolce Late Harvest',
      country: '미국',
      region: '나파',
      color: 'SW',
      vintage: '2018',
    });
    expect(usSweet?.basis).toContain('스위트');

    const echezeauxAccented = estimateDrinkingWindow({
      name: 'Domaine Test Échézeaux',
      country: '프랑스',
      region: '부르고뉴',
      color: 'R',
      vintage: '2019',
    });
    expect(echezeauxAccented?.basis).toContain('그랑크뤼');

    const nvBadRef = estimateDrinkingWindow({
      name: 'Krug Grande Cuvee',
      country: '프랑스',
      region: '상파뉴',
      color: 'SP',
      vintage: 'NV',
      referenceYear: 2,
    });
    expect(nvBadRef?.start).toBeGreaterThanOrEqual(2020);
  });

  it('formats compact KRW boundaries cleanly and normalizes NFC/NFD master keys', () => {
    expect(formatCompactKrw(99_950_000)).toBe('1.0억');
    expect(formatCompactKrw(9_999.5)).toBe('1만');
    expect(formatCompactKrw(18_000)).toBe('1.8만');
    expect(formatCompactKrw(20_000)).toBe('2만');

    const nfcName = '샤또  마고'.normalize('NFC');
    const nfdName = '샤또 마고'.normalize('NFD');
    expect(
      buildWineMasterKey({ name: nfcName, vintage: '2019', bottleSizeMl: 750, color: 'R' }),
    ).toBe(
      buildWineMasterKey({ name: nfdName, vintage: ' 2019 ', bottleSizeMl: 750, color: 'R' }),
    );
    expect(buildWineLabelGroupKey({ name: nfcName, color: 'R' })).toBe(
      buildWineLabelGroupKey({ name: nfdName, color: 'R' }),
    );
    expect(compareVintage(' 2018 ', '2020', 'asc')).toBeLessThan(0);

    const sorted = sortBottlesFifo([
      {
        id: 'b-empty',
        wineId: 'w1',
        status: 'IN_STOCK',
        locationId: null,
        purchaseDate: '',
        purchaseSource: '',
        purchasePrice: 10000,
        includeInTrackingSince: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 'b-dated',
        wineId: 'w1',
        status: 'IN_STOCK',
        locationId: null,
        purchaseDate: '2025-01-01',
        purchaseSource: '',
        purchasePrice: 10000,
        includeInTrackingSince: true,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ]);
    expect(sorted[0].id).toBe('b-dated');
  });

  it('fills zero-activity intermediate years and guards non-consumed tastings in yearly trend', () => {
    const db = createDemoDatabase();
    db.bottles = [
      {
        ...db.bottles[0],
        id: 'b-2022',
        status: 'IN_STOCK',
        purchaseDate: '2022-03-01',
        purchasePrice: 50000,
      },
      {
        ...db.bottles[0],
        id: 'b-2025',
        status: 'CONSUMED',
        purchaseDate: '2025-04-01',
        purchasePrice: 80000,
      },
    ];
    db.tastings = [
      {
        id: 't-in-stock-stale',
        bottleId: 'b-2022', // still IN_STOCK -> must be ignored
        type: 'CONSUMED',
        eventDate: '2022-05-01',
        createdAt: '2022-05-01T00:00:00Z',
      },
      {
        id: 't-valid',
        bottleId: 'b-2025',
        type: 'CONSUMED',
        eventDate: '2025-06-01',
        createdAt: '2025-06-01T00:00:00Z',
      },
    ];

    const yearly = calculatePurchaseVsConsumptionTrend(db, 'yearly');
    expect(yearly.points.map((p) => p.period)).toEqual(['2022', '2023', '2024', '2025']);
    expect(yearly.points[0].consumedCount).toBe(0);
    expect(yearly.points[1].purchasedCount).toBe(0);
    expect(yearly.points[3].consumedCount).toBe(1);
  });
});

describe('Full Audit Regression Suite — Store, Sync & UI Safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const demo = createDemoDatabase();
    demo.metadata.lastBackupAt = new Date().toISOString();
    useWineStore.setState({
      db: demo,
      storageMode: 'local_test',
      fileId: 'local-test-wine-db',
      lastSyncedModifiedTime: null,
      hasUnsyncedChanges: false,
      syncStatus: 'synced',
      syncError: null,
      conflict: null,
      toast: null,
      isPrivacyMode: false,
      isQuickAddOpen: false,
      quickAddPresetWineId: null,
    });
  });

  it('rejects invalid trackingSinceDate before mutating state or IndexedDB cache (C5)', async () => {
    const beforeDate = useWineStore.getState().db!.metadata.trackingSinceDate;
    await useWineStore.getState().updateTrackingSinceDate('', false);
    expect(useWineStore.getState().db!.metadata.trackingSinceDate).toBe(beforeDate);
    expect(localCacheMocks.saveCachedState).not.toHaveBeenCalled();
  });

  it('serializes concurrent commitMutation calls without self-conflict or lost updates (C3)', async () => {
    const demo = useWineStore.getState().db!;
    const b1 = demo.bottles.find((b) => b.status === 'IN_STOCK')!;
    const b2 = demo.bottles.find((b) => b.status === 'IN_STOCK' && b.id !== b1.id)!;
    const locA = demo.locations[0].id;
    const locB = demo.locations[1].id;

    await Promise.all([
      useWineStore.getState().moveBottle(b1.id, locA),
      useWineStore.getState().moveBottle(b2.id, locB),
    ]);

    const after = useWineStore.getState();
    expect(after.conflict).toBeNull();
    expect(after.syncStatus).toBe('synced');
    expect(after.db!.bottles.find((b) => b.id === b1.id)?.locationId).toBe(locA);
    expect(after.db!.bottles.find((b) => b.id === b2.id)?.locationId).toBe(locB);
  });

  it('atomically reorders cellar locations and clears localBackups on reset', async () => {
    const locs = [...useWineStore.getState().db!.locations].sort((a, b) => a.sortOrder - b.sortOrder);
    const reversedIds = [locs[1].id, locs[0].id, ...locs.slice(2).map((l) => l.id)];

    await useWineStore.getState().reorderLocations(reversedIds);
    const updatedLocs = [...useWineStore.getState().db!.locations].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    expect(updatedLocs[0].id).toBe(locs[1].id);
    expect(updatedLocs[1].id).toBe(locs[0].id);

    await useWineStore.getState().disconnectAndResetLocal();
    expect(localCacheMocks.clearAllLocalBackups).toHaveBeenCalledTimes(1);
    expect(localCacheMocks.clearAllCachedPhotos).toHaveBeenCalledTimes(1);
  });

  it('backs up newer remote DB before restoring a snapshot in SyncEngine.restoreBackupSafely (M12)', async () => {
    const localDb = createDemoDatabase();
    const remoteNewerDb = createDemoDatabase();
    remoteNewerDb.metadata.deviceLabel = 'Other Device Newer';
    const targetBackupDb = createDemoDatabase();
    targetBackupDb.metadata.deviceLabel = 'Historical Snapshot';

    const createdBackups: Array<{ fileName: string; deviceLabel?: string }> = [];
    const mockAdapter: StorageAdapter = {
      ensureWorkspace: vi.fn(async () => ({
        rootFolderId: 'r',
        backupFolderId: 'b',
        photoFolderId: 'p',
      })),
      findDbFile: vi.fn(async () => ({ fileId: 'f1', modifiedTime: '2026-11-26T00:05:00Z' })),
      getFileModifiedTime: vi.fn(async () => '2026-11-26T00:05:00Z'),
      loadDb: vi.fn(async () => ({ data: remoteNewerDb, modifiedTime: '2026-11-26T00:05:00Z' })),
      saveDb: vi.fn(async () => ({ fileId: 'f1', modifiedTime: '2026-11-26T00:06:00Z' })),
      createBackup: vi.fn(async (data: WineDatabase, fileName: string): Promise<BackupSnapshot> => {
        createdBackups.push({ fileName, deviceLabel: data.metadata.deviceLabel });
        return { fileId: `bk-${createdBackups.length}`, name: fileName, createdTime: '2026-11-26T00:06:00Z' };
      }),
      listBackups: vi.fn(async () => []),
      loadBackup: vi.fn(async () => targetBackupDb),
      uploadPhoto: vi.fn(async () => ({ fileId: 'ph-1' })),
      downloadPhoto: vi.fn(async () => new Blob()),
      deletePhoto: vi.fn(async () => undefined),
    };

    const engine = new SyncEngine();
    const result = await engine.restoreBackupSafely(mockAdapter, {
      fileId: 'f1',
      currentData: localDb,
      expectedModifiedTime: '2026-11-26T00:00:00Z', // older than remote 00:05:00Z
      backupFileId: 'bk-target',
    });

    expect(result.savedData.metadata.deviceLabel).toBe('Historical Snapshot');
    expect(createdBackups.some((b) => b.deviceLabel === 'Other Device Newer')).toBe(true);
  });

  it('closes only top-most BottomSheet on Escape and safely unlocks body scroll on nested unmount (H2)', () => {
    const onCloseBottom = vi.fn();
    const onCloseTop = vi.fn();
    document.body.style.overflow = '';

    const { rerender } = render(
      <>
        <BottomSheet open title="하단 시트" onClose={onCloseBottom}>
          <div>Bottom</div>
        </BottomSheet>
        <BottomSheet open title="상단 시트" onClose={onCloseTop}>
          <div>Top</div>
        </BottomSheet>
      </>,
    );

    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseTop).toHaveBeenCalledTimes(1);
    expect(onCloseBottom).not.toHaveBeenCalled();

    // Unmount bottom sheet FIRST while top sheet is still open
    rerender(
      <>
        <BottomSheet open={false} title="하단 시트" onClose={onCloseBottom}>
          <div>Bottom</div>
        </BottomSheet>
        <BottomSheet open title="상단 시트" onClose={onCloseTop}>
          <div>Top</div>
        </BottomSheet>
      </>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    // Now close top sheet -> scroll must be completely restored
    rerender(
      <>
        <BottomSheet open={false} title="하단 시트" onClose={onCloseBottom}>
          <div>Bottom</div>
        </BottomSheet>
        <BottomSheet open={false} title="상단 시트" onClose={onCloseTop}>
          <div>Top</div>
        </BottomSheet>
      </>,
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('resets WineDetailSheet edit form when wineId changes so Wine A draft never overwrites Wine B (C7)', () => {
    const demo = useWineStore.getState().db!;
    const wineA = demo.wines[0];
    const wineB = demo.wines[1];

    const { rerender } = render(<WineDetailSheet wineId={wineA.id} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /와인 정보 수정/ }));
    expect(screen.getByText('와인 마스터 정보 편집')).toBeInTheDocument();

    rerender(<WineDetailSheet wineId={wineB.id} onClose={vi.fn()} />);
    expect(screen.queryByText('와인 마스터 정보 편집')).not.toBeInTheDocument();
  });

  it('preserves preset wine custom drinking window in QuickAddModal on open (H3)', async () => {
    const demo = createDemoDatabase();
    demo.wines[0].drinkingWindowStart = 2033;
    demo.wines[0].drinkingWindowEnd = 2048;
    useWineStore.setState({
      db: demo,
      isQuickAddOpen: true,
      quickAddPresetWineId: demo.wines[0].id,
    });

    render(<QuickAddModal />);
    await waitFor(() => {
      expect(screen.getByText(/2033~2048/)).toBeInTheDocument();
    });
  });

  it('masks TrendChart completely in privacy mode when metric is value (H4)', () => {
    useWineStore.setState({ isPrivacyMode: true });
    const mockTrend = {
      points: [
        {
          period: '2026-01',
          label: '2026-01',
          purchasedCount: 2,
          purchasedValue: 200000,
          consumedCount: 1,
          consumedValue: 90000,
        },
      ],
      unknownPurchaseDateCount: 0,
      unknownEventDateCount: 0,
    };

    render(<TrendChart monthlyData={mockTrend} yearlyData={mockTrend} />);
    fireEvent.click(screen.getByRole('button', { name: '금액' }));
    expect(screen.getByText('가격 숨김(프라이버시) 모드 활성 중')).toBeInTheDocument();
  });

  it('shows dismissible fallback overlay in PhotoLightbox when photo URL is unavailable offline', () => {
    const onClose = vi.fn();
    render(<PhotoLightbox fileId="missing-offline-file" onClose={onClose} />);
    expect(screen.getByText(/오프라인\/재인증 필요 상태/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '사진 닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
