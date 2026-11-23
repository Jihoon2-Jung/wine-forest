export type WineColor = 'R' | 'W' | 'SP' | 'SW' | 'RO';
export type BottleStatus = 'IN_STOCK' | 'CONSUMED' | 'GIFTED';

export interface WineMaster {
  id: string; // UUID v4
  name: string; // 와인명 (필수)
  producer?: string; // 생산자 (선택)
  country: string; // 1단계: 국가 (예: '프랑스', '이탈리아', '미국', '미분류')
  region: string; // 2단계: 지역 (예: '부르고뉴', '보르도', '토스카나', VDF 등은 '프랑스')
  subRegion?: string; // 3단계: 세부지역 — 마을·밭·프리미어/그랑크뤼 (예: '에세죠', '생줄리앙', '볼게리', 상위에서 끝나면 생략)
  color: WineColor; // R | W | SP | SW(주정강화 포함) | RO
  vintage: string; // '2019' 등 4자리 연도 또는 'NV'
  bottleSizeMl: number; // 기본값 750 (375, 500, 1500 등)
  // --- Phase 2 예약 필드 (1차에서는 유지·보존만 수행, UI 미노출) ---
  labelImageFileId?: string | null; // Google Drive JH_Wine_Forest/photos/ 내 파일 ID
  drinkingWindowStart?: number | null;
  drinkingWindowEnd?: number | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface CellarLocation {
  id: string; // 예: 'loc_samsung_1_1' 또는 UUID
  zone: string; // 대분류: '삼성' | 'LG' | '냉장고 신선' | '거실' 등
  shelf: string; // 세부 선반: '1-1' ~ '2-7', '1-1' ~ '3-2', '기본' 등
  displayName: string; // 화면 표시명 (예: '삼성 1-1', '냉장고 신선')
  maxCapacity: number; // 최대 정원 (초과 적재 허용, 초과 시 경고 배지만 표시)
  sortOrder: number; // 화면 정렬 순서
}

export interface BottleInstance {
  id: string; // UUID v4 (1행 = 1병)
  wineId: string; // FK -> WineMaster.id
  status: BottleStatus; // 'IN_STOCK' | 'CONSUMED' | 'GIFTED'
  locationId: string | null; // FK -> CellarLocation.id (소비/선물 시에도 직전 위치 참고용 보존 가능)
  purchaseDate: string | null; // 'YYYY-MM-DD' (미상 시 null)
  purchaseDateUncertain?: boolean; // 원본 '?' 등 불확실 날짜 표기
  purchaseSource: string; // 구매처 (예: '이마트', '와인앤모어', '직구')
  purchasePrice: number; // 병당 원화 정수 (0 이상)
  fxNote?: string; // 직구 외화 메모 (예: '9715엔', '45유로')
  includeInTrackingSince: boolean; // 관리 시작일(2023-02-18) 이후 누적 지출 포함 여부
  memo?: string; // 비고
  legacyRowNumber?: number; // 마이그레이션 원본 엑셀 행 번호 추적용
  createdAt: string;
  updatedAt: string;
}

export interface TastingRecord {
  id: string; // UUID v4
  bottleId: string; // FK -> BottleInstance.id (1:1)
  type: 'CONSUMED' | 'GIFTED'; // 소비 vs 선물/양도 구분
  eventDate: string | null; // 소비/선물 일자 'YYYY-MM-DD'
  occasion?: string; // 모임명, 장소, 선물 대상
  memo?: string; // 1차 간단 메모
  // --- Phase 2 예약 필드 (1차에서는 유지·보존만 수행, UI 미노출) ---
  companions?: string;
  rating?: number | null;
  tastingNote?: string;
  photoFileIds?: string[];
  createdAt: string;
}

export interface AppMetadata {
  schemaVersion: 1;
  appName: 'JH Wine Forest';
  trackingSinceDate: string; // 기본값 '2023-02-18'
  lastModifiedAt: string; // ISO 8601
  lastBackupAt: string | null; // 주 1회 자동 백업 기준 시각 (ISO 8601)
  deviceLabel?: string; // 마지막 수정 기기 식별자
}

export interface WineDatabase {
  metadata: AppMetadata;
  wines: WineMaster[];
  locations: CellarLocation[];
  bottles: BottleInstance[];
  tastings: TastingRecord[];
}

export const WINE_COLORS: readonly WineColor[] = ['R', 'W', 'SP', 'SW', 'RO'] as const;

export const WINE_COLOR_LABELS: Record<WineColor, string> = {
  R: '레드',
  W: '화이트',
  SP: '스파클링',
  SW: '스위트·주정강화',
  RO: '로제',
};

export const WINE_COLOR_SHORT_LABELS: Record<WineColor, string> = {
  R: 'R',
  W: 'W',
  SP: 'SP',
  SW: 'SW',
  RO: 'RO',
};

export const DEFAULT_TRACKING_SINCE_DATE = '2023-02-18';
