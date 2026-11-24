import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BottleInstance, TastingRecord, WineMaster } from '@/types/schema';
import { parseWineDatabase } from '@/types/validation';
import { calculateDrinkingWindowSummary } from '@/services/analytics/statsCalculator';
import {
  formatDrinkingWindowRange,
  getDrinkingWindowStatus,
} from '@/services/domain/wineHelpers';
import { estimateDrinkingWindow } from '@/services/domain/drinkingWindowEstimator';
import { computeScaledDimensions, dataUrlToBlob } from '@/services/media/imageProcessor';
import { pickImageFile } from '@/services/media/photoPicker';
import { usePhotoUrl } from '@/services/media/photoLoader';
import { GoogleDriveAdapter } from '@/services/storage/googleDriveAdapter';
import { LocalOnlyAdapter } from '@/services/storage/localOnlyAdapter';
import { AuthRequiredError } from '@/services/storage/types';
import * as localCache from '@/services/storage/localCache';
import * as googleAuth from '@/services/auth/googleAuth';
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
  clearAllCachedPhotos: vi.fn(async () => undefined),
}));

import { useWineStore } from '@/store/useWineStore';
import { HistoryCard } from '@/components/history/HistoryCard';
import { QuickConsumeModal } from '@/components/wines/QuickConsumeModal';
import { StarRatingBadge } from '@/components/common/StarRating';

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

  it('estimates drinking windows from regional/grade/vintage chart and handles NV', () => {
    const bdx2019 = estimateDrinkingWindow({
      name: 'Chateau Talbot',
      country: '프랑스',
      region: '보르도',
      subRegion: '생줄리앙',
      color: 'R',
      vintage: '2019',
    });
    expect(bdx2019).toEqual(expect.objectContaining({ start: 2028, end: 2047 }));

    const bdx2017 = estimateDrinkingWindow({
      name: 'Chateau Talbot',
      country: '프랑스',
      region: '보르도',
      subRegion: '생줄리앙',
      color: 'R',
      vintage: '2017',
    });
    expect(bdx2017).toEqual(expect.objectContaining({ start: 2024, end: 2040 }));

    const burgGc2019 = estimateDrinkingWindow({
      name: 'Domaine Test Echezeaux Grand Cru',
      country: '프랑스',
      region: '부르고뉴',
      subRegion: '에세죠',
      color: 'R',
      vintage: '2019',
    });
    expect(burgGc2019).toEqual(expect.objectContaining({ start: 2027, end: 2043 }));

    const champNv = estimateDrinkingWindow({
      name: 'Krug Grande Cuvee',
      country: '프랑스',
      region: '상파뉴',
      color: 'SP',
      vintage: 'NV',
      referenceYear: 2025,
    });
    expect(champNv).toEqual(expect.objectContaining({ start: 2025, end: 2028 }));
  });

  it('auto-fills only missing drinking windows without overwriting manually configured wines', async () => {
    const demoDb = createDemoDatabase();
    demoDb.metadata.lastBackupAt = new Date().toISOString();
    demoDb.wines[0].drinkingWindowStart = 2025;
    demoDb.wines[0].drinkingWindowEnd = 2031;
    for (let i = 1; i < demoDb.wines.length; i += 1) {
      demoDb.wines[i].drinkingWindowStart = null;
      demoDb.wines[i].drinkingWindowEnd = null;
    }

    useWineStore.setState({ db: demoDb, storageMode: 'local_test' });
    const filled = await useWineStore.getState().autoFillMissingDrinkingWindows();
    expect(filled).toBe(demoDb.wines.length - 1);

    const dbAfter = useWineStore.getState().db!;
    // 수동 입력 와인 보존 확인
    expect(dbAfter.wines[0].drinkingWindowStart).toBe(2025);
    expect(dbAfter.wines[0].drinkingWindowEnd).toBe(2031);
    // 나머지 미입력 와인 자동 채움 확인
    for (let i = 1; i < dbAfter.wines.length; i += 1) {
      expect(dbAfter.wines[i].drinkingWindowStart).toBeTypeOf('number');
      expect(dbAfter.wines[i].drinkingWindowEnd).toBeTypeOf('number');
      expect(dbAfter.wines[i].drinkingWindowEnd!).toBeGreaterThan(
        dbAfter.wines[i].drinkingWindowStart!,
      );
    }
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

describe('Phase 2-3A — Image Scaling & Unified Photo Picker', () => {
  it('scales landscape and portrait images within maxDim without upscaling small images', () => {
    expect(computeScaledDimensions(2000, 1000, 500)).toEqual({ width: 500, height: 250 });
    expect(computeScaledDimensions(1200, 2400, 1024)).toEqual({ width: 512, height: 1024 });
    expect(computeScaledDimensions(400, 300, 500)).toEqual({ width: 400, height: 300 });
  });

  it('triggers hidden image file input and resolves the picked file via pickImageFile', async () => {
    const fakeFile = new File(['webp-bytes'], 'label.webp', { type: 'image/webp' });
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(function (this: HTMLInputElement) {
        Object.defineProperty(this, 'files', {
          value: [fakeFile],
          configurable: true,
        });
        this.dispatchEvent(new Event('change'));
      });

    try {
      const picked = await pickImageFile({ preset: 'label', source: 'camera' });
      expect(picked).toBe(fakeFile);
    } finally {
      clickSpy.mockRestore();
    }
  });

  it('converts base64 Data URLs to Blobs and applies approved_labels bundle in bulk', async () => {
    const sampleDataUrl = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
    const { blob, extension } = dataUrlToBlob(sampleDataUrl);
    expect(extension).toBe('webp');
    expect(blob.type).toBe('image/webp');
    expect(blob.size).toBeGreaterThan(0);

    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock-label-1');
    URL.revokeObjectURL = vi.fn();

    try {
      const demoDb = createDemoDatabase();
      demoDb.metadata.lastBackupAt = new Date().toISOString();
      // 동일 와인명·색상의 다른 빈티지 추가 (빈티지 무관 공통 라벨 적용 검증)
      const baseWine = demoDb.wines[0];
      const siblingWine: WineMaster = {
        ...baseWine,
        id: 'wine-sibling-vintage',
        vintage: '2022',
        labelImageFileId: null,
      };
      demoDb.wines.push(siblingWine);
      useWineStore.setState({ db: demoDb, storageMode: 'local_test' });

      const result = await useWineStore.getState().importApprovedLabelsBundle({
        schemaVersion: 1,
        generatedAt: '2026-11-24T00:00:00Z',
        items: [
          {
            wineId: baseWine.id,
            wineIds: [baseWine.id, siblingWine.id],
            wineName: baseWine.name,
            color: baseWine.color,
            mimeType: 'image/webp',
            dataUrl: sampleDataUrl,
          },
          {
            wineId: 'non-existent-wine-id',
            dataUrl: sampleDataUrl,
          },
        ],
      });

      expect(result).toEqual({ applied: 2, skipped: 1, failed: 0 });
      const updatedBase = useWineStore.getState().db!.wines.find((w) => w.id === baseWine.id)!;
      const updatedSibling = useWineStore.getState().db!.wines.find((w) => w.id === siblingWine.id)!;
      expect(updatedBase.labelImageFileId).toBeTruthy();
      expect(updatedBase.labelImageFileId).toBe(updatedSibling.labelImageFileId);

      // 추후 새 빈티지 입고 시 기존 (와인명, 색상) 라벨 자동 상속 검증
      await useWineStore.getState().addBottles({
        name: baseWine.name,
        country: baseWine.country,
        region: baseWine.region,
        subRegion: baseWine.subRegion,
        color: baseWine.color,
        vintage: '2024',
        bottleSizeMl: 750,
        quantity: 1,
        purchasePrice: 90000,
        locationId: demoDb.locations[0].id,
        purchaseDate: '2026-11-24',
        purchaseSource: '와인샵',
      });
      const newVintageWine = useWineStore
        .getState()
        .db!.wines.find((w) => w.name === baseWine.name && w.vintage === '2024')!;
      expect(newVintageWine.labelImageFileId).toBe(updatedBase.labelImageFileId);

      // 동일 번들 재업로드: overwriteExisting=false 시 기존 라벨 건너뛰기(파일 ID 유지), true 시 새 파일로 교체
      const firstFileId = updatedBase.labelImageFileId;
      const skipRes = await useWineStore.getState().importApprovedLabelsBundle(
        {
          schemaVersion: 1,
          items: [
            {
              wineId: baseWine.id,
              wineIds: [baseWine.id, siblingWine.id],
              wineName: baseWine.name,
              color: baseWine.color,
              dataUrl: sampleDataUrl,
            },
          ],
        },
        { overwriteExisting: false },
      );
      expect(skipRes).toEqual({ applied: 0, skipped: 1, failed: 0 });
      expect(useWineStore.getState().db!.wines.find((w) => w.id === baseWine.id)!.labelImageFileId).toBe(
        firstFileId,
      );

      const overwriteRes = await useWineStore.getState().importApprovedLabelsBundle(
        {
          schemaVersion: 1,
          items: [
            {
              wineId: baseWine.id,
              wineIds: [baseWine.id, siblingWine.id],
              wineName: baseWine.name,
              color: baseWine.color,
              dataUrl: sampleDataUrl,
            },
          ],
        },
        { overwriteExisting: true },
      );
      expect(overwriteRes).toEqual({ applied: 3, skipped: 0, failed: 0 });
      expect(
        useWineStore.getState().db!.wines.find((w) => w.id === baseWine.id)!.labelImageFileId,
      ).not.toBe(firstFileId);
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});

describe('Code Review Regression Fixes — Estimator, HistoryCard Edit, & Reauth Photo Reload', () => {
  it('classifies Burgundy village communes separately from Grand Cru, supports Korean spellings, and handles RO/SP', () => {
    // 1) 부르고뉴 빌라쥬 와인이 그랑크뤼(+7~+22)로 오분류되지 않고 1er/주요 마을(+5~+16, 2018 shift -1/-1 → 2022~2033)로 분류되어야 함
    const gevreyVillage = estimateDrinkingWindow({
      name: 'Domaine Test Gevrey-Chambertin',
      country: '프랑스',
      region: '부르고뉴',
      subRegion: '쥬브레 샹베르탱',
      color: 'R',
      vintage: '2018',
    });
    expect(gevreyVillage).toEqual(expect.objectContaining({ start: 2022, end: 2033 }));
    expect(gevreyVillage?.basis).toContain('1er/주요 마을');

    const vosneVillage = estimateDrinkingWindow({
      name: 'Domaine Test Vosne-Romanée',
      country: '프랑스',
      region: '부르고뉴',
      subRegion: '본 로마네',
      color: 'R',
      vintage: '2018',
    });
    expect(vosneVillage).toEqual(expect.objectContaining({ start: 2022, end: 2033 }));
    expect(vosneVillage?.basis).toContain('1er/주요 마을');

    const chambolleVillage = estimateDrinkingWindow({
      name: 'Domaine Test Chambolle-Musigny',
      country: '프랑스',
      region: '부르고뉴',
      subRegion: '샹볼 뮈지니',
      color: 'R',
      vintage: '2018',
    });
    expect(chambolleVillage).toEqual(expect.objectContaining({ start: 2022, end: 2033 }));
    expect(chambolleVillage?.basis).toContain('1er/주요 마을');

    // 화이트 주요 마을(+4~+12, 2018 shift -1/-1 → 2021~2029)
    const chassagneVillage = estimateDrinkingWindow({
      name: 'Domaine Test Chassagne-Montrachet',
      country: '프랑스',
      region: '부르고뉴',
      subRegion: '샤샤뉴 몽라쉐',
      color: 'W',
      vintage: '2018',
    });
    expect(chassagneVillage).toEqual(expect.objectContaining({ start: 2021, end: 2029 }));
    expect(chassagneVillage?.basis).toContain('1er/주요 마을');

    // 2) 실제 그랑크뤼(+7~+22 / +5~+16, 2018 shift -1/-1) 및 local_migration_script 한글 표기('꼬르똥', '샤또뇌프 뒤 빠쁘') 정상 매칭
    const charmesGc = estimateDrinkingWindow({
      name: 'Domaine Test Charmes-Chambertin',
      country: '프랑스',
      region: '부르고뉴',
      subRegion: '쥬브레 샹베르탱',
      color: 'R',
      vintage: '2018',
    });
    expect(charmesGc).toEqual(expect.objectContaining({ start: 2024, end: 2039 }));
    expect(charmesGc?.basis).toContain('그랑크뤼');

    const cortonCharlemagne = estimateDrinkingWindow({
      name: 'Domaine Test 꼬르똥 샤를마뉴',
      country: '프랑스',
      region: '부르고뉴',
      subRegion: '꼬르똥',
      color: 'W',
      vintage: '2018',
    });
    expect(cortonCharlemagne).toEqual(expect.objectContaining({ start: 2022, end: 2033 }));
    expect(cortonCharlemagne?.basis).toContain('그랑크뤼');

    const cdp = estimateDrinkingWindow({
      name: 'Chateau Test',
      country: '프랑스',
      region: '론',
      subRegion: '샤또뇌프 뒤 빠쁘',
      color: 'R',
      vintage: '2018',
    });
    expect(cdp).toEqual(expect.objectContaining({ start: 2023, end: 2034 }));
    expect(cdp?.basis).toContain('CDP');

    // 3) 로제(RO)와 비-상파뉴 프랑스 스파클링(크레망 SP)이 레드/빈티지 상파뉴로 오분류되지 않아야 함
    const bdxRose = estimateDrinkingWindow({
      name: 'Chateau Test Rose',
      country: '프랑스',
      region: '보르도',
      color: 'RO',
      vintage: '2022',
    });
    expect(bdxRose).toEqual(expect.objectContaining({ start: 2023, end: 2025 }));

    const cremant = estimateDrinkingWindow({
      name: 'Domaine Test Cremant de Bourgogne',
      country: '프랑스',
      region: '부르고뉴',
      color: 'SP',
      vintage: '2020',
    });
    expect(cremant).toEqual(expect.objectContaining({ start: 2022, end: 2026 }));

    const vintageChamp = estimateDrinkingWindow({
      name: 'Dom Perignon',
      country: '프랑스',
      region: '상파뉴',
      color: 'SP',
      vintage: '2015',
    });
    expect(vintageChamp).toEqual(expect.objectContaining({ start: 2022, end: 2035 }));
  });

  it('defers existing photo deletion until save and resets draft on cancel in HistoryCard', async () => {
    const deletePhotoMock = vi.fn(async () => undefined);
    const updateTastingMock = vi.fn(async () => undefined);

    const origDelete = useWineStore.getState().deleteTastingPhotoFile;
    const origUpdate = useWineStore.getState().updateTastingRecord;
    useWineStore.setState({
      isPrivacyMode: false,
      deleteTastingPhotoFile: deletePhotoMock,
      updateTastingRecord: updateTastingMock,
    });

    const wine: WineMaster = {
      id: 'w-edit-1',
      name: 'Test Wine',
      country: '프랑스',
      region: '부르고뉴',
      color: 'R',
      vintage: '2020',
      bottleSizeMl: 750,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const bottle: BottleInstance = {
      id: 'b-edit-1',
      wineId: 'w-edit-1',
      status: 'CONSUMED',
      locationId: null,
      purchaseDate: '2025-01-01',
      purchaseSource: '와인샵',
      purchasePrice: 100000,
      includeInTrackingSince: true,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const tasting: TastingRecord = {
      id: 't-edit-1',
      bottleId: 'b-edit-1',
      type: 'CONSUMED',
      eventDate: '2026-11-24',
      occasion: '원본 모임',
      tastingNote: '원본 노트',
      photoFileIds: ['https://example.com/saved-photo.webp'],
      createdAt: '2026-11-24T00:00:00Z',
    };

    try {
      render(<HistoryCard tasting={tasting} bottle={bottle} wine={wine} locations={[]} />);

      // 1) 편집 열기 → 텍스트 수정 + 기존 사진 X 클릭 → [취소]
      fireEvent.click(screen.getByRole('button', { name: '이력 수정' }));
      const occasionInput = screen.getByPlaceholderText('모임 / 대상');
      fireEvent.change(occasionInput, { target: { value: '임시 수정값' } });
      fireEvent.click(screen.getByRole('button', { name: '사진 제거' }));

      // 저장 전 삭제 호출되면 안 됨
      expect(deletePhotoMock).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: '취소' }));
      expect(deletePhotoMock).not.toHaveBeenCalled();
      expect(updateTastingMock).not.toHaveBeenCalled();

      // 2) 편집 재진입 시 직전 취소한 임시값이 리셋되고 기존 사진이 유지되어야 함
      fireEvent.click(screen.getByRole('button', { name: '이력 수정' }));
      expect((screen.getByPlaceholderText('모임 / 대상') as HTMLInputElement).value).toBe('원본 모임');
      expect(screen.getByRole('button', { name: '사진 제거' })).toBeInTheDocument();

      // 3) 기존 사진 삭제 후 [저장] → 그제서야 deleteTastingPhotoFile 호출
      fireEvent.click(screen.getByRole('button', { name: '사진 제거' }));
      fireEvent.click(screen.getByRole('button', { name: '저장' }));

      await waitFor(() => {
        expect(updateTastingMock).toHaveBeenCalledWith(
          't-edit-1',
          expect.objectContaining({ photoFileIds: [] }),
        );
        expect(deletePhotoMock).toHaveBeenCalledWith('https://example.com/saved-photo.webp');
      });
    } finally {
      useWineStore.setState({
        deleteTastingPhotoFile: origDelete,
        updateTastingRecord: origUpdate,
      });
    }
  });

  it('reloads uncached Drive photos via usePhotoUrl when authRevision increments even if googleConnected stays true', async () => {
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:reloaded-drive-photo');
    URL.revokeObjectURL = vi.fn();

    let tokenValid = false;
    const isTokenSpy = vi.spyOn(googleAuth, 'isTokenValid').mockImplementation(() => tokenValid);
    const downloadSpy = vi
      .spyOn(GoogleDriveAdapter.prototype, 'downloadPhoto')
      .mockResolvedValue(new Blob(['img-bytes'], { type: 'image/webp' }));

    function PhotoProbe({ fileId }: { fileId: string }) {
      const url = usePhotoUrl(fileId);
      return <div data-testid="photo-url">{url ?? 'EMPTY'}</div>;
    }

    try {
      // 1시간 만료 상황: googleConnected는 true 유지, 토큰은 무효
      useWineStore.setState({
        storageMode: 'google_drive',
        googleConnected: true,
        authRevision: 1,
      });

      render(<PhotoProbe fileId="drive_uncached_photo_1" />);
      await waitFor(() => {
        expect(screen.getByTestId('photo-url').textContent).toBe('EMPTY');
      });
      expect(downloadSpy).not.toHaveBeenCalled();

      // 재인증 완료: googleConnected는 여전히 true이지만 authRevision 증가
      tokenValid = true;
      act(() => {
        useWineStore.setState({ authRevision: 2 });
      });

      await waitFor(() => {
        expect(screen.getByTestId('photo-url').textContent).toBe('blob:reloaded-drive-photo');
      });
      expect(downloadSpy).toHaveBeenCalledWith('drive_uncached_photo_1');
    } finally {
      isTokenSpy.mockRestore();
      downloadSpy.mockRestore();
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      act(() => {
        useWineStore.setState({ storageMode: 'local_test', googleConnected: false });
      });
    }
  });
});

describe('Medium Code Review Fixes — Orphans, Modal Preservation, Bulk Labels & Rating Display', () => {
  it('clears photoCache on disconnect, inherits metadata on master merge, and cleans up unreferenced photos on delete/restore', async () => {
    const clearPhotosSpy = vi.mocked(localCache.clearAllCachedPhotos);
    clearPhotosSpy.mockClear();
    const deletePhotoSpy = vi
      .spyOn(LocalOnlyAdapter.prototype, 'deletePhoto')
      .mockResolvedValue(undefined);

    try {
      // 1) updateWineMaster 병합 시 원본의 labelImageFileId & drinkingWindow 계승
      const db = createDemoDatabase();
      db.metadata.lastBackupAt = new Date().toISOString();
      const sourceWine = db.wines[0];
      const targetWine = db.wines[1];
      sourceWine.labelImageFileId = 'shared_label_from_source';
      sourceWine.drinkingWindowStart = 2026;
      sourceWine.drinkingWindowEnd = 2034;
      targetWine.labelImageFileId = null;
      targetWine.drinkingWindowStart = null;
      targetWine.drinkingWindowEnd = null;
      useWineStore.setState({ db, storageMode: 'local_test' });

      await useWineStore.getState().updateWineMaster(sourceWine.id, {}, targetWine.id);
      const mergedTarget = useWineStore.getState().db!.wines.find((w) => w.id === targetWine.id)!;
      expect(mergedTarget.labelImageFileId).toBe('shared_label_from_source');
      expect(mergedTarget.drinkingWindowStart).toBe(2026);
      expect(mergedTarget.drinkingWindowEnd).toBe(2034);

      // 2) restoreBottleToStock 시 삭제되는 tasting의 photoFileIds 정리
      const consumedBottle = useWineStore.getState().db!.bottles.find((b) => b.status === 'CONSUMED')!;
      const tasting = useWineStore.getState().db!.tastings.find((t) => t.bottleId === consumedBottle.id)!;
      tasting.photoFileIds = ['orphan_tasting_photo_restore'];
      deletePhotoSpy.mockClear();

      await useWineStore.getState().restoreBottleToStock(consumedBottle.id, null);
      expect(deletePhotoSpy).toHaveBeenCalledWith('orphan_tasting_photo_restore');

      // 3) deleteBottle 시 고아 마스터 라벨 파일 정리
      const singleBottleWine = useWineStore.getState().db!.wines[0];
      const bottlesOfWine = useWineStore
        .getState()
        .db!.bottles.filter((b) => b.wineId === singleBottleWine.id);
      singleBottleWine.labelImageFileId = 'orphan_label_on_delete';
      deletePhotoSpy.mockClear();
      for (const b of bottlesOfWine) {
        await useWineStore.getState().deleteBottle(b.id);
      }
      expect(deletePhotoSpy).toHaveBeenCalledWith('orphan_label_on_delete');

      // 4) disconnectAndResetLocal 시 IndexedDB photoCache도 함께 초기화
      await useWineStore.getState().disconnectAndResetLocal();
      expect(clearPhotosSpy).toHaveBeenCalled();
    } finally {
      deletePhotoSpy.mockRestore();
    }
  });

  it('preserves user tasting input in QuickConsumeModal when bottles array reference changes while open', () => {
    const db = createDemoDatabase();
    useWineStore.setState({ db, storageMode: 'local_test' });
    const wine = db.wines[0];
    const bottlesV1 = db.bottles.filter((b) => b.wineId === wine.id && b.status === 'IN_STOCK');

    const { rerender } = render(
      <QuickConsumeModal open wine={wine} bottles={bottlesV1} onClose={() => undefined} />,
    );

    const occasionInput = screen.getByLabelText('모임 / 장소') as HTMLInputElement;
    fireEvent.change(occasionInput, { target: { value: '결혼기념일 디너' } });
    expect(occasionInput.value).toBe('결혼기념일 디너');

    // 동기화 등으로 새로운 배열 참조가 전달되어도 입력 중인 폼이 초기화되지 않아야 함
    const bottlesV2 = bottlesV1.map((b) => ({ ...b }));
    rerender(<QuickConsumeModal open wine={wine} bottles={bottlesV2} onClose={() => undefined} />);
    expect((screen.getByLabelText('모임 / 장소') as HTMLInputElement).value).toBe('결혼기념일 디너');
  });

  it('keeps 1-label consistency on partial groups (overwrite=false) and aborts immediately on 401 AuthRequiredError', async () => {
    const sampleDataUrl = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock-partial');
    URL.revokeObjectURL = vi.fn();

    const localUploadSpy = vi.spyOn(LocalOnlyAdapter.prototype, 'uploadPhoto');
    const driveUploadSpy = vi.spyOn(GoogleDriveAdapter.prototype, 'uploadPhoto');
    const tokenSpy = vi.spyOn(googleAuth, 'isTokenValid').mockReturnValue(true);

    try {
      // 1) 부분 라벨 그룹(2019에 기존 라벨 A, 2020은 null): overwriteExisting=false 시 중복 업로드 없이 라벨 A 공유
      const db = createDemoDatabase();
      db.metadata.lastBackupAt = new Date().toISOString();
      const baseWine = db.wines[0];
      baseWine.labelImageFileId = 'existing_label_A';
      const siblingWine: WineMaster = {
        ...baseWine,
        id: 'wine-partial-sibling',
        vintage: '2023',
        labelImageFileId: null,
      };
      db.wines.push(siblingWine);
      useWineStore.setState({ db, storageMode: 'local_test' });
      localUploadSpy.mockClear();

      const partialRes = await useWineStore.getState().importApprovedLabelsBundle(
        {
          schemaVersion: 1,
          items: [
            {
              wineId: baseWine.id,
              wineIds: [baseWine.id, siblingWine.id],
              wineName: baseWine.name,
              color: baseWine.color,
              dataUrl: sampleDataUrl,
            },
          ],
        },
        { overwriteExisting: false },
      );
      expect(partialRes).toEqual({ applied: 0, skipped: 1, failed: 0 });
      expect(localUploadSpy).not.toHaveBeenCalled();
      expect(
        useWineStore.getState().db!.wines.find((w) => w.id === siblingWine.id)!.labelImageFileId,
      ).toBe('existing_label_A');

      // 2) 대량 업로드 중 401 AuthRequiredError 발생 시 남은 항목 즉시 중단 + auth_required 전환
      const driveDb = createDemoDatabase();
      driveDb.wines[0].labelImageFileId = null;
      driveDb.wines[1].labelImageFileId = null;
      driveDb.wines[2].labelImageFileId = null;
      useWineStore.setState({ db: driveDb, storageMode: 'google_drive', syncStatus: 'synced' });

      driveUploadSpy.mockReset();
      driveUploadSpy.mockRejectedValueOnce(new AuthRequiredError('토큰 만료'));

      const authRes = await useWineStore.getState().importApprovedLabelsBundle({
        schemaVersion: 1,
        items: [
          { wineId: driveDb.wines[0].id, dataUrl: sampleDataUrl },
          { wineId: driveDb.wines[1].id, dataUrl: sampleDataUrl },
          { wineId: driveDb.wines[2].id, dataUrl: sampleDataUrl },
        ],
      });

      // 첫 번째 401에서 즉시 중단되어 uploadPhoto는 1회만 호출되고 남은 3건 모두 실패 처리
      expect(driveUploadSpy).toHaveBeenCalledTimes(1);
      expect(authRes).toEqual({ applied: 0, skipped: 0, failed: 3 });
      expect(useWineStore.getState().syncStatus).toBe('auth_required');
    } finally {
      localUploadSpy.mockRestore();
      driveUploadSpy.mockRestore();
      tokenSpy.mockRestore();
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      useWineStore.setState({ storageMode: 'local_test', syncStatus: 'synced' });
    }
  });

  it('displays 5-point scale as decimal stars and legacy 100-point imported ratings cleanly with 점 suffix', () => {
    const { rerender } = render(<StarRatingBadge rating={4.5} />);
    expect(screen.getByText('4.5')).toBeInTheDocument();

    rerender(<StarRatingBadge rating={92} />);
    expect(screen.getByText('92점')).toBeInTheDocument();
  });
});
