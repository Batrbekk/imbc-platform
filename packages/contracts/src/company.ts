import { z } from 'zod';
import { COMMODITY_GROUPS, PROFILE_TIERS, UPDATE_STATUSES } from './enums.js';

/** Контактное лицо компании (focal point). Видят роли с `focal_point.read`, наблюдатель — нет (GEN-13). */
export const companyContactSchema = z.object({
  fullName: z.string(),
  position: z.string(),
  email: z.string(),
  phone: z.string(),
});
export type CompanyContact = z.infer<typeof companyContactSchema>;

/** Форма jsonb catalog_visible.card — seed пишет её, сервис разбирает safeParse, иначе поля пустые. */
export const companyCardDataSchema = z.object({
  companyPhone: z.string().nullable(),
  companyEmail: z.string().nullable(),
  focalPoint: companyContactSchema.nullable(),
});
export type CompanyCardData = z.infer<typeof companyCardDataSchema>;

/**
 * Страница компании из каталога, только для чтения (OPR-09, OPR-10, OPR-11). Поля — из проекции
 * catalog_visible; IMBC-записей, заметок и ожидающих значений в ней нет (OPR-12).
 * Ключа `focalPoint` нет в ответе роли без `focal_point.read` (GEN-13).
 */
export const companyPageSchema = z.object({
  profileId: z.uuid(),
  bin: z.string(),
  nameEn: z.string(),
  nameRu: z.string(),
  region: z.string(),
  commodityGroups: z.array(z.enum(COMMODITY_GROUPS)),
  tnvedCodes: z.array(z.string()),
  mainTnved: z.string().nullable(),
  headcountTotal: z.number().int().nullable(),
  /** certificate_types с датой из certificates_valid_until. */
  certificates: z.array(z.object({ type: z.string(), validUntil: z.iso.date().nullable() })),
  siteSurveyed: z.boolean(),
  tier: z.enum(PROFILE_TIERS),
  unifiedRegister: z.boolean(),
  worksWithCount: z.number().int().min(0).max(3),
  updateStatus: z.enum(UPDATE_STATUSES),
  pendingChanges: z.boolean(),
  verifiedAt: z.string(),
  /** Телефон и email компании из префилла — видит и наблюдатель (GEN-13). */
  companyPhone: z.string().nullable(),
  companyEmail: z.string().nullable(),
  focalPoint: companyContactSchema.nullable().optional(),
});
export type CompanyPage = z.infer<typeof companyPageSchema>;
