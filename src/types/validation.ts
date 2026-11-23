import { z } from 'zod';
import type { WineDatabase } from './schema';

const isoDateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;
const vintageRegex = /^(\d{4}|NV)$/;

export const wineColorSchema = z.enum(['R', 'W', 'SP', 'SW', 'RO']);
export const bottleStatusSchema = z.enum(['IN_STOCK', 'CONSUMED', 'GIFTED']);

export const wineMasterSchema = z.object({
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
});

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
  purchaseDate: z.string().regex(isoDateOnlyRegex, 'YYYY-MM-DD 형식이어야 합니다').nullable(),
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
  eventDate: z.string().regex(isoDateOnlyRegex, 'YYYY-MM-DD 형식이어야 합니다').nullable(),
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
  trackingSinceDate: z.string().regex(isoDateOnlyRegex, 'YYYY-MM-DD 형식이어야 합니다'),
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
    const wineIds = new Set(db.wines.map((w) => w.id));
    const locationIds = new Set(db.locations.map((l) => l.id));
    const bottleIds = new Set(db.bottles.map((b) => b.id));

    db.bottles.forEach((bottle, index) => {
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

    db.tastings.forEach((tasting, index) => {
      if (!bottleIds.has(tasting.bottleId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tastings', index, 'bottleId'],
          message: `존재하지 않는 bottleId 참조: ${tasting.bottleId}`,
        });
      }
    });
  });

export function parseWineDatabase(input: unknown): WineDatabase {
  return wineDatabaseSchema.parse(input);
}

export function safeParseWineDatabase(input: unknown) {
  return wineDatabaseSchema.safeParse(input);
}
