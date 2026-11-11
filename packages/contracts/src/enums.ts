/**
 * Перечисления предметной области. Источник — спецификация v1.3
 * (разделы 3.1, 5.5, 6.3, 6.10) и архитектура v0.4 (разделы 6–9).
 */

/** Тип организации (GEN-01…06). */
export const ORGANIZATION_TYPES = ['manufacturer', 'operator', 'observer', 'imbc'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

/** Роли (раздел 3.1, D-51). У IMBC три роли, суперпользователя нет. */
export const ROLES = ['manufacturer', 'expert', 'administrator', 'director', 'operator', 'observer'] as const;
export type Role = (typeof ROLES)[number];

/** Состояние аккаунта (раздел 9.1). */
export const ACCOUNT_STATES = ['invited', 'active', 'inactive', 'blocked'] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

/** Статус профиля (раздел 6.3). Pending changes — отдельный флаг на Verified. */
export const PROFILE_STATUSES = ['draft', 'submitted', 'under_review', 'verified', 'returned'] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

/** Статус актуальности верифицированного профиля (UPD-01…06). */
export const UPDATE_STATUSES = ['active', 'outdated', 'unresponsive'] as const;
export type UpdateStatus = (typeof UPDATE_STATUSES)[number];

/**
 * Тир профиля (IMBC-19, IMBC-20): tier_1 — верифицирован, tier_2 — пока профиль site surveyed.
 * Тир выводится, отдельно не записывается. Tier 3 принадлежит продукту (IMBC-21) и сюда не входит.
 */
export const PROFILE_TIERS = ['tier_1', 'tier_2'] as const;
export type ProfileTier = (typeof PROFILE_TIERS)[number];

/** Восемь секций профиля (раздел 5.2). Production — не входит в полноту (MAN-91). */
export const PROFILE_SECTIONS = [
  'main',
  'contacts',
  'personnel',
  'shareholders',
  'products',
  'production',
  'certificates',
  'documents',
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];
export const SECTIONS_IN_COMPLETENESS: readonly ProfileSection[] = PROFILE_SECTIONS.filter((s) => s !== 'production');

/** Статус документа или сертификата (раздел 6.3). */
export const DOCUMENT_STATUSES = ['uploaded', 'under_review', 'verified', 'rejected', 'expired', 'missing'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Товарные группы A–E. */
export const COMMODITY_GROUPS = ['A', 'B', 'C', 'D', 'E'] as const;
export type CommodityGroup = (typeof COMMODITY_GROUPS)[number];

/** Роль контакта (MAN-20). */
export const CONTACT_ROLES = ['management', 'technical', 'commercial'] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

/** Единицы производственной мощности в год (MAN-50). */
export const CAPACITY_UNITS = ['pieces', 'tonnes', 'metres', 'sets'] as const;
export type CapacityUnit = (typeof CAPACITY_UNITS)[number];

/** Состояние отметки Works with (раздел 9.1). */
export const MARK_STATES = ['waiting', 'validated', 'rejected'] as const;
export type MarkState = (typeof MARK_STATES)[number];

/** Языки интерфейса (LANG-01). Казахский — по умолчанию. */
export const LOCALES = ['kk', 'ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'kk';

/** Часовой пояс всех дат и расписаний (DATA-08). */
export const PLATFORM_TIMEZONE = 'Asia/Almaty';

/** Допустимые файлы (DATA-06). */
export const ALLOWED_FILE_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
} as const;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
