import { type SQL, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  inet,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id } from './_shared.js';
import { organizations, userAccounts } from './access.js';
import { commodityGroup, profileTier, snapshotPeriod, updateStatus } from './enums.js';
import { manufacturerProfiles } from './profiles.js';

/** Справочники ADM-10 с переводами и флагом обязательности (ADM-11, DATA-04). */
export const dictionaries = pgTable('dictionaries', {
  code: text('code').primaryKey(),
  title: text('title').notNull(),
});

export const dictionaryEntries = pgTable(
  'dictionary_entries',
  {
    id: id(),
    dictionaryCode: text('dictionary_code')
      .notNull()
      .references(() => dictionaries.code),
    code: text('code').notNull(),
    labelKk: text('label_kk').notNull(),
    labelRu: text('label_ru').notNull(),
    labelEn: text('label_en').notNull(),
    parentCode: text('parent_code'),
    isMandatory: boolean('is_mandatory').notNull().default(false),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    sortOrder: smallint('sort_order').notNull().default(0),
  },
  (t) => [uniqueIndex('dictionary_entries_uq').on(t.dictionaryCode, t.code)],
);

/**
 * Журнал аудита (AUD-01…03): append-only, 5 лет. Роль приложения не имеет
 * UPDATE/DELETE (см. миграцию 9999_grants). Партиционирование по месяцам —
 * отдельной ручной миграцией перед production.
 */
export const auditEntries = pgTable(
  'audit_entries',
  {
    id: id(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    userId: uuid('user_id'),
    organizationId: uuid('organization_id'),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id'),
    outcome: text('outcome').notNull().default('ok'),
    diff: jsonb('diff'),
    isAccountEvent: boolean('is_account_event').notNull().default(false),
    ip: inet('ip'),
  },
  (t) => [
    index('audit_entries_at_idx').on(t.at),
    index('audit_entries_object_idx').on(t.objectType, t.objectId),
    index('audit_entries_user_idx').on(t.userId, t.at),
  ],
);

/** Снимки активности недели и месяца (AUD-04). */
export const activitySnapshots = pgTable(
  'activity_snapshots',
  {
    id: id(),
    period: snapshotPeriod('period').notNull(),
    periodStart: date('period_start').notNull(),
    counts: jsonb('counts').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('activity_snapshots_uq').on(t.period, t.periodStart)],
);

/**
 * Отправленные письма: одно письмо на событие и адрес (NOT-20, ADR-22).
 * Уникальный ключ делает повтор задания безопасным.
 */
export const notificationsSent = pgTable(
  'notifications_sent',
  {
    id: id(),
    code: text('code').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    recipient: text('recipient').notNull(),
    locale: text('locale').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('notifications_sent_uq').on(t.code, t.dedupeKey, sql`lower(${t.recipient})`)],
);

/**
 * Проекция каталога: одна строка на видимый профиль, собрана только из верифицированных
 * редакций (архитектура §10). Видимый профиль — Verified и due diligence green/amber при любом
 * статусе актуальности (раздел 4); unresponsive остаётся в выдаче (UPD-04) и идёт ниже остальных.
 * Её читают поиск, страница компании, выгрузки, pull API и дашборд — и ничего больше.
 */
export const catalogVisible = pgTable(
  'catalog_visible',
  {
    profileId: uuid('profile_id')
      .primaryKey()
      .references(() => manufacturerProfiles.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    bin: text('bin').notNull(),
    nameEn: text('name_en').notNull(),
    nameRu: text('name_ru').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    region: text('region').notNull(),
    commodityGroups: commodityGroup('commodity_groups').array().notNull(),
    commodityTypes: text('commodity_types').array().notNull(),
    tnvedCodes: text('tnved_codes').array().notNull(),
    kpvedCodes: text('kpved_codes').array().notNull(),
    okedCodes: text('oked_codes').array().notNull(),
    certificateTypes: text('certificate_types').array().notNull(),
    certificatesValidUntil: jsonb('certificates_valid_until').notNull(),
    mainTnved: text('main_tnved'),
    headcountTotal: smallint('headcount_total'),
    siteSurveyed: boolean('site_surveyed').notNull().default(false),
    /** Тир профиля (IMBC-19, IMBC-20): вычисляется из site_surveyed, отдельно не записывается. */
    tier: profileTier('tier')
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`case when ${catalogVisible.siteSurveyed} then 'tier_2'::profile_tier else 'tier_1'::profile_tier end`,
      ),
    unifiedRegister: boolean('unified_register').notNull().default(false),
    worksWithCount: smallint('works_with_count').notNull().default(0),
    updateStatus: updateStatus('update_status').notNull(),
    pendingChanges: boolean('pending_changes').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    /** Полный набор полей страницы компании (OPR-10, OPR-11, DATA-35). */
    card: jsonb('card').notNull(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('catalog_name_trgm_idx').using('gin', sql`${t.nameNormalized} gin_trgm_ops`),
    index('catalog_groups_idx').using('gin', t.commodityGroups),
    index('catalog_types_idx').using('gin', t.commodityTypes),
    index('catalog_certs_idx').using('gin', t.certificateTypes),
    index('catalog_oked_idx').using('gin', t.okedCodes),
    index('catalog_region_idx').on(t.region),
    index('catalog_verified_idx').on(t.verifiedAt),
  ],
);
