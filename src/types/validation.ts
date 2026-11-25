import { z } from 'zod';
import type { WineDatabase } from './schema';

const isoDateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;
const vintageRegex = /^(\d{4}|NV)$/;

function isValidIsoCalendarDate(value: string): boolean {
  if (!isoDateOnlyRegex.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const isoDateOnlySchema = z
  .string()
  .regex(isoDateOnlyRegex, 'YYYY-MM-DD 형식이어야 합니다')
  .refine(isValidIsoCalendarDate, '유효한 달력 날짜가 아닙니다');

export const wineColorSchema = z.enum(['R', 'W', 'SP', 'SW', 'RO']);
export const bottleStatusSchema = z.enum(['IN_STOCK', 'CONSUMED', 'GIFTED']);

export const wineMasterSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1, '와인명은 필수입니다'),
    producer: z.string().optional(),
    country: z.string().min(1),
    region: z.string().min(1),
    subRegion: z.string().optional(),
    color: wineColorSchema,
    vintage: z.string().regex(vintageRegex, '빈티지는 4자리 연도 또는 NV여야 합니다'),
    bottleSizeMl: z.number().int().positive(),
    labelImageFileId: z.string().nullable().optional(),
    drinkingWindowStart: z.number().int().nullable().optional(),
    drinkingWindowEnd: z.number().int().nullable().optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .refine(
    (w) =>
      w.drinkingWindowStart == null ||
      w.drinkingWindowEnd == null ||
      w.drinkingWindowStart <= w.drinkingWindowEnd,
    {
      message: '음용 적기 시작 연도는 종료 연도보다 클 수 없습니다',
      path: ['drinkingWindowEnd'],
    },
  );

export const cellarLocationSchema = z.object({
  id: z.string().min(1),
  zone: z.string().min(1),
  shelf: z.string().min(1),
  displayName: z.string().min(1),
  maxCapacity: z.number().int().min(0),
  sortOrder: z.number().int(),
});

export const bottleInstanceSchema = z.object({
  id: z.string().min(1),
  wineId: z.string().min(1),
  status: bottleStatusSchema,
  locationId: z.string().min(1).nullable(),
  purchaseDate: isoDateOnlySchema.nullable(),
  purchaseDateUncertain: z.boolean().optional(),
  purchaseSource: z.string(),
  purchasePrice: z.number().int().min(0),
  fxNote: z.string().optional(),
  includeInTrackingSince: z.boolean(),
  memo: z.string().optional(),
  legacyRowNumber: z.number().int().positive().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const tastingRecordSchema = z.object({
  id: z.string().min(1),
  bottleId: z.string().min(1),
  type: z.enum(['CONSUMED', 'GIFTED']),
  eventDate: isoDateOnlySchema.nullable(),
  occasion: z.string().optional(),
  memo: z.string().optional(),
  companions: z.string().optional(),
  rating: z.number().min(0).max(100).nullable().optional(),
  tastingNote: z.string().optional(),
  photoFileIds: z.array(z.string()).optional(),
  createdAt: z.string().min(1),
});

export const appMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  appName: z.literal('JH Wine Forest'),
  trackingSinceDate: isoDateOnlySchema,
  lastModifiedAt: z.string().min(1),
  lastBackupAt: z.string().nullable(),
  deviceLabel: z.string().optional(),
});

export const wineDatabaseSchema = z
  .object({
    metadata: appMetadataSchema,
    wines: z.array(wineMasterSchema),
    locations: z.array(cellarLocationSchema),
    bottles: z.array(bottleInstanceSchema),
    tastings: z.array(tastingRecordSchema),
  })
  .superRefine((db, ctx) => {
    const wineIds = new Set<string>();
    db.wines.forEach((wine, index) => {
      if (wineIds.has(wine.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['wines', index, 'id'],
          message: `중복된 wine id: ${wine.id}`,
        });
      }
      wineIds.add(wine.id);
    });

    const locationIds = new Set<string>();
    db.locations.forEach((loc, index) => {
      if (locationIds.has(loc.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locations', index, 'id'],
          message: `중복된 location id: ${loc.id}`,
        });
      }
      locationIds.add(loc.id);
    });

    const bottleIds = new Set<string>();
    db.bottles.forEach((bottle, index) => {
      if (bottleIds.has(bottle.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['bottles', index, 'id'],
          message: `중복된 bottle id: ${bottle.id}`,
        });
      }
      bottleIds.add(bottle.id);

      if (!wineIds.has(bottle.wineId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['bottles', index, 'wineId'],
          message: `존재하지 않는 wineId 참조: ${bottle.wineId}`,
        });
      }
      if (bottle.status === 'IN_STOCK' && bottle.locationId !== null && !locationIds.has(bottle.locationId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['bottles', index, 'locationId'],
          message: `존재하지 않는 locationId 참조: ${bottle.locationId}`,
        });
      }
    });

    const tastingIds = new Set<string>();
    const tastingBottleIds = new Set<string>();
    db.tastings.forEach((tasting, index) => {
      if (tastingIds.has(tasting.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tastings', index, 'id'],
          message: `중복된 tasting id: ${tasting.id}`,
        });
      }
      tastingIds.add(tasting.id);

      if (!bottleIds.has(tasting.bottleId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tastings', index, 'bottleId'],
          message: `존재하지 않는 bottleId 참조: ${tasting.bottleId}`,
        });
      } else if (tastingBottleIds.has(tasting.bottleId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tastings', index, 'bottleId'],
          message: `중복된 시음 기록 bottleId 참조: ${tasting.bottleId}`,
        });
      }
      tastingBottleIds.add(tasting.bottleId);
    });
  });

export function parseWineDatabase(input: unknown): WineDatabase {
  return wineDatabaseSchema.parse(input);
}

export function safeParseWineDatabase(input: unknown) {
  return wineDatabaseSchema.safeParse(input);
}

export const approvedLabelItemSchema = z.object({
  wineId: z.string().min(1),
  wineIds: z.array(z.string().min(1)).optional(),
  wineName: z.string().optional(),
  color: wineColorSchema.optional(),
  vintage: z.string().optional(),
  mimeType: z.string().optional(),
  dataUrl: z
    .string()
    .refine((v) => v.startsWith('data:image/') && v.includes(';base64,'), '유효한 이미지 Data URL이어야 합니다'),
});

export const approvedLabelsBundleSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().optional(),
  items: z.array(approvedLabelItemSchema).min(1, '적용할 승인 라벨 항목이 1개 이상 필요합니다'),
});

export type ApprovedLabelsBundle = z.infer<typeof approvedLabelsBundleSchema>;

export function parseApprovedLabelsBundle(input: unknown): ApprovedLabelsBundle {
  return approvedLabelsBundleSchema.parse(input);
}
