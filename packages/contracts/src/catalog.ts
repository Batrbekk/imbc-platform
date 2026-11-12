import { z } from 'zod';
import { COMMODITY_GROUPS, PROFILE_TIERS, UPDATE_STATUSES } from './enums.js';

/**
 * Фильтры каталога (OPR-02, OPR-03). Значения живут в адресе страницы (OPR-05, D-21):
 * один и тот же объект парсится в web (React + Vite SPA, nuqs) и в API (query string).
 * Между фильтрами — AND, внутри одного фильтра — OR (OPR-04).
 */
export const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) return value.flatMap((v) => String(v).split(','));
    return String(value).split(',');
  }, z.array(item).optional());

const boolish = z.preprocess((value) => {
  if (value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1';
}, z.boolean().optional());

export const catalogFilterSchema = z.object({
  // Обычные фильтры
  q: z.string().trim().max(200).optional(),
  region: csv(z.string().max(32)),
  group: csv(z.enum(COMMODITY_GROUPS)),
  type: csv(z.string().max(64)),
  cert: csv(z.string().max(64)),
  surveyed: boolish,
  tier: csv(z.enum(PROFILE_TIERS)),
  // Расширенные фильтры
  tnved: z
    .string()
    .regex(/^\d{1,10}$/)
    .optional(),
  kpved: z
    .string()
    .regex(/^[\d.]{1,12}$/)
    .optional(),
  oked: csv(z.string().max(16)),
  worksWith: csv(z.coerce.number().int().min(0).max(3)),
  headcountMin: z.coerce.number().int().min(0).optional(),
  headcountMax: z.coerce.number().int().min(0).optional(),
  certValidUntil: z.iso.date().optional(),
  certAnyStatus: boolish,
  unifiedRegister: boolish,
  verifiedFrom: z.iso.date().optional(),
  verifiedTo: z.iso.date().optional(),
  // Выдача
  sort: z.enum(['name', 'verified_at', 'region']).default('name'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type CatalogFilter = z.infer<typeof catalogFilterSchema>;

/** Строка результата поиска (OPR-06). */
export const catalogItemSchema = z.object({
  profileId: z.uuid(),
  bin: z.string(),
  nameEn: z.string(),
  nameRu: z.string(),
  region: z.string(),
  commodityGroups: z.array(z.enum(COMMODITY_GROUPS)),
  mainTnved: z.string().nullable(),
  certificateTypes: z.array(z.string()),
  siteSurveyed: z.boolean(),
  tier: z.enum(PROFILE_TIERS),
  verifiedAt: z.string().nullable(),
  updateStatus: z.enum(UPDATE_STATUSES),
  pendingChanges: z.boolean(),
  worksWithCount: z.number().int().min(0).max(3),
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;

export const catalogPageSchema = z.object({
  items: z.array(catalogItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type CatalogPage = z.infer<typeof catalogPageSchema>;

const count = z.number().int().min(0);

/**
 * Дашборд видимых верифицированных производителей (OPR-31…35). Счётчики по статусу
 * актуальности включают все три статуса, unresponsive тоже остаётся на карте (OPR-33, UPD-06).
 * Счётчики по тиру — tier 1 и tier 2 профиля (OPR-32, IMBC-22).
 */
export const dashboardSchema = z.object({
  total: count,
  byRegion: z.array(z.object({ region: z.string(), count })),
  byCommodityGroup: z.array(z.object({ group: z.enum(COMMODITY_GROUPS), count })),
  siteSurveyed: count,
  unifiedRegister: count,
  updateStatus: z.object({ active: count, outdated: count, unresponsive: count }),
  tier: z.object({ tier_1: count, tier_2: count }),
  generatedAt: z.iso.datetime(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

/** Сериализация фильтров в query string (для API-клиента и ссылок в письмах). */
export function catalogFilterToSearchParams(filter: Partial<CatalogFilter>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  return params;
}
