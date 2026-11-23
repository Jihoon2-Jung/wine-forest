import {
  DEFAULT_TRACKING_SINCE_DATE,
  type CellarLocation,
  type WineDatabase,
} from '@/types/schema';

export function createDefaultLocations(): CellarLocation[] {
  const locations: CellarLocation[] = [];
  let sortOrder = 1;

  // 삼성 셀러 (1-1: 8병, 1-2 ~ 2-7: 5병)
  for (let col = 1; col <= 2; col++) {
    for (let shelf = 1; shelf <= 7; shelf++) {
      const shelfCode = `${col}-${shelf}`;
      locations.push({
        id: `loc_samsung_${col}_${shelf}`,
        zone: '삼성',
        shelf: shelfCode,
        displayName: `삼성 ${shelfCode}`,
        maxCapacity: shelfCode === '1-1' ? 8 : 5,
        sortOrder: sortOrder++,
      });
    }
  }

  // LG 셀러 (1-1: 9, 1-2: 16, 2-1~3-1: 8, 3-2: 32)
  const lgShelves: Array<[string, number]> = [
    ['1-1', 9],
    ['1-2', 16],
    ['2-1', 8],
    ['2-2', 8],
    ['2-3', 8],
    ['2-4', 8],
    ['3-1', 8],
    ['3-2', 32],
  ];
  for (const [shelf, maxCapacity] of lgShelves) {
    locations.push({
      id: `loc_lg_${shelf.replace('-', '_')}`,
      zone: 'LG',
      shelf,
      displayName: `LG ${shelf}`,
      maxCapacity,
      sortOrder: sortOrder++,
    });
  }

  // 냉장고 신선 & 거실
  locations.push({
    id: 'loc_fridge_fresh',
    zone: '냉장고 신선',
    shelf: '기본',
    displayName: '냉장고 신선',
    maxCapacity: 16,
    sortOrder: sortOrder++,
  });

  locations.push({
    id: 'loc_living_room',
    zone: '거실',
    shelf: '기본',
    displayName: '거실',
    maxCapacity: 80,
    sortOrder: sortOrder++,
  });

  return locations;
}

export function createEmptyDatabase(trackingSinceDate = DEFAULT_TRACKING_SINCE_DATE): WineDatabase {
  const now = new Date().toISOString();
  return {
    metadata: {
      schemaVersion: 1,
      appName: 'JH Wine Forest',
      trackingSinceDate,
      lastModifiedAt: now,
      lastBackupAt: null,
      deviceLabel: typeof navigator !== 'undefined' ? navigator.platform || 'Web' : 'Web',
    },
    wines: [],
    locations: createDefaultLocations(),
    bottles: [],
    tastings: [],
  };
}

/**
 * 로컬 테스트 모드에서 UI/통계/셀러맵을 바로 체험할 수 있도록 제공하는 가상 데모 데이터
 * (실제 개인 데이터와 무관한 공개 와인 샘플)
 */
export function createDemoDatabase(): WineDatabase {
  const now = new Date().toISOString();
  const locations = createDefaultLocations();

  const wines = [
    {
      id: 'demo-wine-1',
      name: 'Domaine Leflaive Bourgogne Blanc',
      producer: 'Domaine Leflaive',
      country: '프랑스',
      region: '부르고뉴',
      color: 'W' as const,
      vintage: '2020',
      bottleSizeMl: 750,
      labelImageFileId: null,
      drinkingWindowStart: null,
      drinkingWindowEnd: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-wine-2',
      name: 'Château Lynch-Bages',
      producer: 'Château Lynch-Bages',
      country: '프랑스',
      region: '보르도',
      subRegion: '뽀이약',
      color: 'R' as const,
      vintage: '2016',
      bottleSizeMl: 750,
      labelImageFileId: null,
      drinkingWindowStart: null,
      drinkingWindowEnd: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-wine-3',
      name: 'Billecart-Salmon Brut Rosé',
      producer: 'Billecart-Salmon',
      country: '프랑스',
      region: '상파뉴',
      color: 'SP' as const,
      vintage: 'NV',
      bottleSizeMl: 750,
      labelImageFileId: null,
      drinkingWindowStart: null,
      drinkingWindowEnd: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-wine-4',
      name: 'Biondi-Santi Brunello di Montalcino',
      producer: 'Biondi-Santi',
      country: '이탈리아',
      region: '토스카나',
      subRegion: '몬탈치노',
      color: 'R' as const,
      vintage: '2018',
      bottleSizeMl: 750,
      labelImageFileId: null,
      drinkingWindowStart: null,
      drinkingWindowEnd: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-wine-5',
      name: 'Château Rieussec Sauternes',
      producer: 'Château Rieussec',
      country: '프랑스',
      region: '보르도',
      subRegion: '소떼른',
      color: 'SW' as const,
      vintage: '2015',
      bottleSizeMl: 375,
      labelImageFileId: null,
      drinkingWindowStart: null,
      drinkingWindowEnd: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-wine-6',
      name: 'Domaines Ott By.Ott Rosé',
      producer: 'Domaines Ott',
      country: '프랑스',
      region: '프로방스',
      color: 'RO' as const,
      vintage: '2023',
      bottleSizeMl: 750,
      labelImageFileId: null,
      drinkingWindowStart: null,
      drinkingWindowEnd: null,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const bottles = [
    {
      id: 'demo-bottle-1',
      wineId: 'demo-wine-1',
      status: 'IN_STOCK' as const,
      locationId: 'loc_samsung_1_1',
      purchaseDate: '2025-11-12',
      purchaseSource: '와인앤모어',
      purchasePrice: 165000,
      includeInTrackingSince: true,
      memo: '시음 적기 체크',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-bottle-2',
      wineId: 'demo-wine-1',
      status: 'IN_STOCK' as const,
      locationId: 'loc_samsung_1_2',
      purchaseDate: '2026-02-14',
      purchaseSource: '직구',
      purchasePrice: 148000,
      fxNote: '95유로',
      includeInTrackingSince: true,
      memo: '프랑스 직구',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-bottle-3',
      wineId: 'demo-wine-2',
      status: 'IN_STOCK' as const,
      locationId: 'loc_samsung_1_1',
      purchaseDate: '2022-11-20',
      purchaseSource: '이마트',
      purchasePrice: 210000,
      includeInTrackingSince: false,
      memo: '장기 숙성용',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-bottle-4',
      wineId: 'demo-wine-3',
      status: 'IN_STOCK' as const,
      locationId: 'loc_fridge_fresh',
      purchaseDate: '2026-08-05',
      purchaseSource: '코스트코',
      purchasePrice: 118000,
      includeInTrackingSince: true,
      memo: '주말 오픈 예정',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-bottle-5',
      wineId: 'demo-wine-4',
      status: 'IN_STOCK' as const,
      locationId: 'loc_lg_1_1',
      purchaseDate: '2026-05-19',
      purchaseSource: '와인샵',
      purchasePrice: 295000,
      includeInTrackingSince: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-bottle-6',
      wineId: 'demo-wine-5',
      status: 'IN_STOCK' as const,
      locationId: 'loc_samsung_1_1',
      purchaseDate: '2025-12-24',
      purchaseSource: '이마트',
      purchasePrice: 52000,
      includeInTrackingSince: true,
      memo: 'HB 하프보틀',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-bottle-7',
      wineId: 'demo-wine-6',
      status: 'CONSUMED' as const,
      locationId: 'loc_fridge_fresh',
      purchaseDate: '2026-06-10',
      purchaseSource: '와인앤모어',
      purchasePrice: 42000,
      includeInTrackingSince: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-bottle-8',
      wineId: 'demo-wine-3',
      status: 'GIFTED' as const,
      locationId: 'loc_lg_1_1',
      purchaseDate: '2026-09-01',
      purchaseSource: '코스트코',
      purchasePrice: 115000,
      includeInTrackingSince: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const tastings = [
    {
      id: 'demo-tasting-1',
      bottleId: 'demo-bottle-7',
      type: 'CONSUMED' as const,
      eventDate: '2026-07-18',
      occasion: '여름 홈파티',
      memo: '산미가 깔끔하고 해산물과 잘 어울림',
      createdAt: now,
    },
    {
      id: 'demo-tasting-2',
      bottleId: 'demo-bottle-8',
      type: 'GIFTED' as const,
      eventDate: '2026-09-20',
      occasion: '지인 집들이 선물',
      memo: '로제 샴페인 선물',
      createdAt: now,
    },
  ];

  return {
    metadata: {
      schemaVersion: 1,
      appName: 'JH Wine Forest',
      trackingSinceDate: DEFAULT_TRACKING_SINCE_DATE,
      lastModifiedAt: now,
      lastBackupAt: null,
      deviceLabel: 'Local Demo',
    },
    wines,
    locations,
    bottles,
    tastings,
  };
}
