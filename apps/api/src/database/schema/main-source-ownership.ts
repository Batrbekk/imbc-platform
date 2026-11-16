import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { MainInformationRead } from '@imbc/contracts';
import { id } from './_shared.js';
import { mainInformation } from './profile-content.js';
import { manufacturerProfile, productionSiteIdentity, sectionRevision } from './profile.js';
import { externalCheckAttempt } from './records.js';
import { eOndirisRecord } from './e-ondiris.js';

const tenantFk = (
  name: string,
  child: AnyPgColumn,
  org: AnyPgColumn,
  parent: { id: AnyPgColumn; organizationId: AnyPgColumn },
) => foreignKey({ name, columns: [child, org], foreignColumns: [parent.id, parent.organizationId] });
const mainChild = () => ({
  id: id(),
  mainInformationId: uuid('main_information_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
});
const owners = sql`('unclaimed','legacy_unknown','manufacturer','adata','e_ondiris')`;

/** MAN-06/07/10/21: bounded normalized source facts, never the raw provider body. Immutable after insert. */
export const adataMainSnapshot = pgTable(
  'adata_main_snapshot',
  {
    id: id(),
    profileId: uuid('profile_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    bin: text('bin').notNull(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => externalCheckAttempt.id),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    contentHash: text('content_hash').notNull(),
    legal: jsonb('legal').$type<Omit<MainInformationRead['legalInformation'], 'alternativeName'>>().notNull(),
    phones: text('phones').array().notNull(),
    emails: text('emails').array().notNull(),
  },
  (t) => [
    tenantFk('adata_main_snapshot_profile_org_fk', t.profileId, t.organizationId, manufacturerProfile),
    uniqueIndex('adata_main_snapshot_id_org_uq').on(t.id, t.organizationId),
    uniqueIndex('adata_main_snapshot_attempt_uq').on(t.attemptId),
    check('adata_main_snapshot_bin_ck', sql`${t.bin} ~ '^[0-9]{12}$'`),
    check('adata_main_snapshot_hash_ck', sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

/** Exact source state selected by this revision. A failed later read may retain the last checked legal snapshot. */
export const mainSourcePin = pgTable(
  'main_source_pin',
  {
    ...mainChild(),
    adataSnapshotId: uuid('adata_snapshot_id'),
    latestAttemptId: uuid('latest_attempt_id').references(() => externalCheckAttempt.id),
    latestAttemptCompletedAt: timestamp('latest_attempt_completed_at', { withTimezone: true, mode: 'string' }),
    adataState: text('adata_state').notNull(),
    eOndirisObservedAt: timestamp('e_ondiris_observed_at', { withTimezone: true }),
    eOndirisScopeHash: text('e_ondiris_scope_hash'),
  },
  (t) => [
    tenantFk('main_source_pin_main_org_fk', t.mainInformationId, t.organizationId, mainInformation),
    tenantFk('main_source_pin_adata_org_fk', t.adataSnapshotId, t.organizationId, adataMainSnapshot),
    uniqueIndex('main_source_pin_main_uq').on(t.mainInformationId),
    check(
      'main_source_pin_state_ck',
      sql`${t.adataState} IN ('not_requested','waiting','received','not_configured','quota_exhausted','unavailable')`,
    ),
    check('main_source_pin_eo_pair_ck', sql`(${t.eOndirisObservedAt} IS NULL) = (${t.eOndirisScopeHash} IS NULL)`),
    check(
      'main_source_pin_eo_hash_ck',
      sql`${t.eOndirisScopeHash} IS NULL OR ${t.eOndirisScopeHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

/** A manufacturer clear is owner=manufacturer,value=NULL, distinct from an unclaimed initial blank. */
export const mainContactOwnership = pgTable(
  'main_contact_ownership',
  {
    ...mainChild(),
    field: text('field').notNull(),
    owner: text('owner').notNull(),
    value: text('value'),
    adataSnapshotId: uuid('adata_snapshot_id'),
    eOndirisRecordIds: uuid('e_ondiris_record_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
  },
  (t) => [
    tenantFk('main_contact_ownership_main_org_fk', t.mainInformationId, t.organizationId, mainInformation),
    tenantFk('main_contact_ownership_adata_org_fk', t.adataSnapshotId, t.organizationId, adataMainSnapshot),
    uniqueIndex('main_contact_ownership_field_uq').on(t.mainInformationId, t.field),
    check('main_contact_ownership_field_ck', sql`${t.field} IN ('companyPhone','contactEmail')`),
    check('main_contact_ownership_owner_ck', sql`${t.owner} IN ${owners}`),
    check(
      'main_contact_ownership_source_ck',
      sql`
    (${t.owner}='adata' AND ${t.adataSnapshotId} IS NOT NULL AND cardinality(${t.eOndirisRecordIds})=0 AND ${t.value} IS NOT NULL)
    OR (${t.owner}='e_ondiris' AND ${t.adataSnapshotId} IS NULL AND cardinality(${t.eOndirisRecordIds})>0 AND ${t.value} IS NOT NULL)
    OR (${t.owner} IN ('manufacturer','legacy_unknown') AND ${t.adataSnapshotId} IS NULL AND cardinality(${t.eOndirisRecordIds})=0)
    OR (${t.owner}='unclaimed' AND ${t.value} IS NULL AND ${t.adataSnapshotId} IS NULL AND cardinality(${t.eOndirisRecordIds})=0)`,
    ),
  ],
);

/** Saved removals remain as revision content; they suppress re-adding that source registration. */
export const mainSiteOwnership = pgTable(
  'main_site_ownership',
  {
    ...mainChild(),
    identityId: uuid('identity_id').notNull(),
    addressOwner: text('address_owner').notNull(),
    cityOwner: text('city_owner').notNull(),
    regionOwner: text('region_owner').notNull(),
    deleted: boolean('deleted').notNull().default(false),
  },
  (t) => [
    tenantFk('main_site_ownership_main_org_fk', t.mainInformationId, t.organizationId, mainInformation),
    tenantFk('main_site_ownership_identity_org_fk', t.identityId, t.organizationId, productionSiteIdentity),
    uniqueIndex('main_site_ownership_identity_uq').on(t.mainInformationId, t.identityId),
    check(
      'main_site_ownership_address_ck',
      sql`${t.addressOwner} IN ('unclaimed','legacy_unknown','manufacturer','e_ondiris')`,
    ),
    check('main_site_ownership_city_ck', sql`${t.cityOwner} IN ('unclaimed','legacy_unknown','manufacturer')`),
    check('main_site_ownership_region_ck', sql`${t.regionOwner} IN ('unclaimed','legacy_unknown','manufacturer')`),
  ],
);

export const mainSiteSourceBinding = pgTable(
  'main_site_source_binding',
  {
    ...mainChild(),
    registrationNumber: text('registration_number').notNull(),
    identityId: uuid('identity_id').notNull(),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => eOndirisRecord.id),
  },
  (t) => [
    tenantFk('main_site_source_binding_main_org_fk', t.mainInformationId, t.organizationId, mainInformation),
    tenantFk('main_site_source_binding_identity_org_fk', t.identityId, t.organizationId, productionSiteIdentity),
    uniqueIndex('main_site_source_binding_registration_uq').on(t.mainInformationId, t.registrationNumber),
    check('main_site_source_binding_registration_ck', sql`${t.registrationNumber} ~ '^[0-9]+$'`),
  ],
);

/** Worker-only retry ledger, queued in the source-result transaction; fresh pointers are reread under profile locks. */
export const mainSourceRefreshOutbox = pgTable(
  'main_source_refresh_outbox',
  {
    profileId: uuid('profile_id')
      .primaryKey()
      .references(() => manufacturerProfile.id),
    organizationId: uuid('organization_id').notNull(),
    requestedAttemptId: uuid('requested_attempt_id')
      .notNull()
      .references(() => externalCheckAttempt.id),
    requestedCompletedAt: timestamp('requested_completed_at', { withTimezone: true, mode: 'string' }).notNull(),
    requestedState: text('requested_state').notNull(),
    state: text('state').notNull().default('pending'),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    appliedAttemptId: uuid('applied_attempt_id').references(() => externalCheckAttempt.id),
    appliedCompletedAt: timestamp('applied_completed_at', { withTimezone: true, mode: 'string' }),
    appliedState: text('applied_state'),
    targetRevisionId: uuid('target_revision_id').references(() => sectionRevision.id),
  },
  (t) => [
    tenantFk('main_source_refresh_outbox_profile_org_fk', t.profileId, t.organizationId, manufacturerProfile),
    index('main_source_refresh_outbox_pending_idx').on(t.state, t.lastAttemptAt),
    check('main_source_refresh_outbox_state_ck', sql`${t.state} IN ('pending','applied','deferred')`),
    check('main_source_refresh_outbox_attempt_ck', sql`${t.attemptCount} >= 0`),
    check(
      'main_source_refresh_outbox_requested_state_ck',
      sql`${t.requestedState} IN ('received','unavailable','not_configured','quota_exhausted')`,
    ),
    check(
      'main_source_refresh_outbox_applied_state_ck',
      sql`${t.appliedState} IS NULL OR ${t.appliedState} IN ('received','unavailable','not_configured','quota_exhausted')`,
    ),
    check(
      'main_source_refresh_outbox_applied_pair_ck',
      sql`(${t.appliedAttemptId} IS NULL)=(${t.appliedCompletedAt} IS NULL) AND (${t.appliedAttemptId} IS NULL)=(${t.appliedState} IS NULL)`,
    ),
  ],
);
