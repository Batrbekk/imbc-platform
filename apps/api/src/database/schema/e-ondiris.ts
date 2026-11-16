import { sql } from 'drizzle-orm';
import { boolean, check, date, index, numeric, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { id } from './_shared.js';

/** Unexported until the Stage 4a expand migration is integrated. Exact v1.4 source facts. */
export const eOndirisRecord = pgTable(
  'e_ondiris_record',
  {
    id: id(),
    bin: text('bin').notNull(),
    registrationNumber: text('registration_number').notNull(),
    legalName: text('legal_name'),
    placeName: text('place_name'),
    productionAddress: text('production_address'),
    website: text('website'),
    phone: text('phone'),
    email: text('email'),
    productName: text('product_name'),
    productionCapacity: text('production_capacity'),
    tnVedCode: text('tn_ved_code'),
    kpvedCode: text('kpved_code'),
    kpvedName: text('kpved_name'),
    enstruCode: text('enstru_code'),
    enstruName: text('enstru_name'),
    inCountryValueShare: numeric('in_country_value_share', { precision: 5, scale: 2 }),
    includedOn: date('included_on'),
    active: boolean('active'),
    contentHash: text('content_hash').notNull(),
    pulledAt: timestamp('pulled_at', { withTimezone: true }).notNull(),
    isCurrent: boolean('is_current').notNull().default(true),
  },
  (t) => [
    uniqueIndex('e_ondiris_record_version_uq').on(t.bin, t.registrationNumber, t.contentHash),
    uniqueIndex('e_ondiris_record_current_uq')
      .on(t.bin, t.registrationNumber)
      .where(sql`${t.isCurrent}`),
    index('e_ondiris_record_bin_idx').on(t.bin),
    check('e_ondiris_record_bin_ck', sql`${t.bin} ~ '^[0-9]{12}$'`),
    check('e_ondiris_record_registration_ck', sql`${t.registrationNumber} ~ '^[0-9]+$'`),
    check('e_ondiris_record_tn_ved_ck', sql`${t.tnVedCode} IS NULL OR ${t.tnVedCode} ~ '^[0-9]{10}$'`),
    check(
      'e_ondiris_record_dvc_ck',
      sql`${t.inCountryValueShare} IS NULL OR ${t.inCountryValueShare} BETWEEN 0 AND 100`,
    ),
    check('e_ondiris_record_hash_ck', sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

/** Operational metadata, not upstream business facts. A complete accepted BIN scope has one CAS watermark. */
export const eOndirisSyncScope = pgTable(
  'e_ondiris_sync_scope',
  {
    bin: text('bin').primaryKey(),
    acceptedObservedAt: timestamp('accepted_observed_at', { withTimezone: true }).notNull(),
    acceptedScopeHash: text('accepted_scope_hash').notNull(),
    provenance: text('provenance').notNull(),
  },
  (t) => [
    check('e_ondiris_sync_scope_bin_ck', sql`${t.bin} ~ '^[0-9]{12}$'`),
    check('e_ondiris_sync_scope_hash_ck', sql`${t.acceptedScopeHash} ~ '^[0-9a-f]{64}$'`),
    check('e_ondiris_sync_scope_provenance_ck', sql`${t.provenance} IN ('synthetic', 'recorded', 'provider')`),
  ],
);
