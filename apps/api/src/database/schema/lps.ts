import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id } from './_shared.js';
import { userAccounts } from './access.js';
import { dictionaryEntry } from './reference.js';

const authored = () => ({
  createdBy: uuid('created_by')
    .notNull()
    .references(() => userAccounts.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by')
    .notNull()
    .references(() => userAccounts.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by').references(() => userAccounts.id),
});
/** Class G, independent of organization, BIN and manufacturer profiles. */
export const lpsCompany = pgTable('lps_company', { id: id(), name: text('name').notNull(), ...authored() }, (t) => [
  check('lps_company_name_ck', sql`${t.name} <> '' and ${t.name} = btrim(${t.name})`),
  check('lps_company_deleted_ck', sql`(${t.deletedAt} is null) = (${t.deletedBy} is null)`),
]);
export const lpsCompanyCountry = pgTable(
  'lps_company_country',
  {
    companyId: uuid('lps_company_id')
      .notNull()
      .references(() => lpsCompany.id),
    countryId: uuid('country_id')
      .notNull()
      .references(() => dictionaryEntry.id),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.countryId] })],
);
export const lpsEntry = pgTable(
  'lps_entry',
  {
    id: id(),
    companyId: uuid('lps_company_id')
      .notNull()
      .references(() => lpsCompany.id),
    sourceTypeId: uuid('source_type_id')
      .notNull()
      .references(() => dictionaryEntry.id),
    scopeDescription: text('scope_description').notNull(),
    statusId: uuid('status_id')
      .notNull()
      .references(() => dictionaryEntry.id),
    plannedLaunch: text('planned_launch'),
    comment: text('comment'),
    investmentUsd: numeric('investment_usd'),
    newJobs: integer('new_jobs'),
    lastUpdatedOn: date('last_updated_on', { mode: 'string' }),
    /** Reserved for stage 8 migration; never exposed as writable company identity. */
    migrationKey: text('migration_key'),
    ...authored(),
  },
  (t) => [
    uniqueIndex('lps_entry_migration_key_uq').on(t.migrationKey),
    index('lps_entry_company_status_idx').on(t.companyId, t.statusId),
    index('lps_entry_status_idx').on(t.statusId),
    index('lps_entry_last_updated_idx').on(t.lastUpdatedOn),
    check(
      'lps_entry_scope_ck',
      sql`${t.scopeDescription} <> '' and ${t.scopeDescription} = btrim(${t.scopeDescription})`,
    ),
    check(
      'lps_entry_investment_ck',
      sql`${t.investmentUsd} >= 0 and ${t.investmentUsd} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)`,
    ),
    check('lps_entry_jobs_ck', sql`${t.newJobs} >= 0`),
    check('lps_entry_deleted_ck', sql`(${t.deletedAt} is null) = (${t.deletedBy} is null)`),
  ],
);
export const lpsEntryCommodity = pgTable(
  'lps_entry_commodity',
  {
    entryId: uuid('lps_entry_id')
      .notNull()
      .references(() => lpsEntry.id),
    commodityTypeId: uuid('commodity_type_id')
      .notNull()
      .references(() => dictionaryEntry.id),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.commodityTypeId] })],
);
export const lpsLocation = pgTable(
  'lps_location',
  {
    id: id(),
    entryId: uuid('lps_entry_id')
      .notNull()
      .references(() => lpsEntry.id),
    city: text('city'),
    regionId: uuid('region_id').references(() => dictionaryEntry.id),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('lps_location_pair_uq').on(t.entryId, t.city, t.regionId).nullsNotDistinct(),
    check('lps_location_place_ck', sql`${t.city} is not null or ${t.regionId} is not null`),
    check('lps_location_city_ck', sql`${t.city} <> '' and ${t.city} = btrim(${t.city})`),
    check('lps_location_order_ck', sql`${t.sortOrder} >= 0`),
    index('lps_location_entry_idx').on(t.entryId),
  ],
);
export const lpsContact = pgTable(
  'lps_contact',
  {
    id: id(),
    entryId: uuid('lps_entry_id')
      .notNull()
      .references(() => lpsEntry.id),
    fullName: text('full_name'),
    roleTitle: text('role_title'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    check('lps_contact_name_ck', sql`${t.fullName} <> '' and ${t.fullName} = btrim(${t.fullName})`),
    check('lps_contact_role_ck', sql`${t.roleTitle} <> '' and ${t.roleTitle} = btrim(${t.roleTitle})`),
    check('lps_contact_order_ck', sql`${t.sortOrder} >= 0`),
    index('lps_contact_entry_idx').on(t.entryId),
  ],
);
export const lpsContactEmail = pgTable(
  'lps_contact_email',
  {
    contactId: uuid('lps_contact_id')
      .notNull()
      .references(() => lpsContact.id),
    email: text('email').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.email] }),
    check('lps_contact_email_ck', sql`${t.email} <> '' and ${t.email} = lower(btrim(${t.email}))`),
    check('lps_contact_email_order_ck', sql`${t.sortOrder} >= 0`),
  ],
);
export const lpsContactPhone = pgTable(
  'lps_contact_phone',
  {
    contactId: uuid('lps_contact_id')
      .notNull()
      .references(() => lpsContact.id),
    phone: text('phone').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.phone] }),
    check('lps_contact_phone_ck', sql`${t.phone} ~ '^[+][1-9][0-9]{6,14}( ext[.] [0-9]+)?$'`),
    check('lps_contact_phone_order_ck', sql`${t.sortOrder} >= 0`),
  ],
);
