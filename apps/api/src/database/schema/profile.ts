import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_shared.js';
import { organizations, userAccounts } from './access.js';
import { profileStatus, revisionOrigin, revisionState, sectionKind, updateStatus, valueSource } from './enums.js';

/** One profile per organisation (MAN-03); legacy columns remain during expand/migrate (NFR-06). */
export const manufacturerProfile = pgTable(
  'manufacturer_profile',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    status: profileStatus('status').notNull().default('draft'),
    hasPendingChanges: boolean('has_pending_changes').notNull().default(false),
    updateStatus: updateStatus('update_status'),
    quarterAnchorAt: date('quarter_anchor_at'),
    missedQuarters: smallint('missed_quarters').notNull().default(0),
    finalNoticeDueAt: date('final_notice_due_at'),
    assignedExpertId: uuid('assigned_expert_id').references(() => userAccounts.id),
    /** Whole-percent display retained for existing readers; section arithmetic belongs to the core. */
    completenessPct: smallint('completeness_pct').notNull().default(0),
    completenessPercent: numeric('completeness_percent').notNull().default('0'),
    heardAboutUs: text('heard_about_us'),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    source: valueSource('source').notNull().default('manual'),
    migrated: boolean('migrated').notNull().default(false),
    binCheckDigitValid: boolean('bin_check_digit_valid').notNull().default(true),
    migrationFlags: jsonb('migration_flags'),
    accuracyConfirmedAt: timestamp('accuracy_confirmed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('manufacturer_profile_org_uq').on(t.organizationId),
    uniqueIndex('manufacturer_profile_id_org_uq').on(t.id, t.organizationId),
    index('manufacturer_profile_status_idx').on(t.status),
  ],
);

/** Section pointers must name a revision of this section and tenant (DATA-01, GEN-11). */
export const profileSection = pgTable(
  'profile_section',
  {
    id: id(),
    profileId: uuid('profile_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    kind: sectionKind('kind').notNull(),
    verifiedRevisionId: uuid('verified_revision_id'),
    pendingRevisionId: uuid('pending_revision_id'),
    /** Technical pointer, maintained by the section core; one working revision enforced by an index. */
    workingRevisionId: uuid('working_revision_id'),
    completenessPct: numeric('completeness_percent').notNull().default('0'),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('profile_section_profile_kind_uq').on(t.profileId, t.kind),
    uniqueIndex('profile_section_id_org_uq').on(t.id, t.organizationId),
    foreignKey({
      name: 'profile_section_profile_org_fk',
      columns: [t.profileId, t.organizationId],
      foreignColumns: [manufacturerProfile.id, manufacturerProfile.organizationId],
    }),
  ],
);

/** Immutable after send; savedAt/editVersion support partial drafts and optimistic concurrency (MAN-40). */
export const sectionRevision = pgTable(
  'section_revision',
  {
    id: id(),
    profileSectionId: uuid('profile_section_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),
    state: revisionState('state').notNull().default('working'),
    origin: revisionOrigin('origin').notNull().default('manufacturer'),
    authorId: uuid('author_id').references(() => userAccounts.id),
    completenessPct: numeric('completeness_percent').notNull().default('0'),
    createdAt: createdAt(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    savedAt: timestamp('saved_at', { withTimezone: true }),
    editVersion: integer('edit_version').notNull().default(0),
  },
  (t) => [
    uniqueIndex('section_revision_number_uq').on(t.profileSectionId, t.revisionNumber),
    uniqueIndex('section_revision_id_org_uq').on(t.id, t.organizationId),
    uniqueIndex('section_revision_id_section_org_uq').on(t.id, t.profileSectionId, t.organizationId),
    uniqueIndex('section_revision_working_uq')
      .on(t.profileSectionId)
      .where(sql`${t.state} = 'working'`),
    foreignKey({
      name: 'section_revision_section_org_fk',
      columns: [t.profileSectionId, t.organizationId],
      foreignColumns: [profileSection.id, profileSection.organizationId],
    }),
  ],
);

/** Stable identities are never copied; organisation is immutable (MAN-11, DATA-01). */
export const productionSiteIdentity = pgTable(
  'production_site_identity',
  {
    id: id(),
    profileId: uuid('profile_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
  },
  (t) => [
    uniqueIndex('production_site_identity_id_org_uq').on(t.id, t.organizationId),
    foreignKey({
      name: 'production_site_identity_profile_org_fk',
      columns: [t.profileId, t.organizationId],
      foreignColumns: [manufacturerProfile.id, manufacturerProfile.organizationId],
    }),
  ],
);

export const productLineIdentity = pgTable(
  'product_line_identity',
  {
    id: id(),
    profileId: uuid('profile_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('product_line_identity_id_org_uq').on(t.id, t.organizationId),
    foreignKey({
      name: 'product_line_identity_profile_org_fk',
      columns: [t.profileId, t.organizationId],
      foreignColumns: [manufacturerProfile.id, manufacturerProfile.organizationId],
    }),
  ],
);

export const certificateIdentity = pgTable(
  'certificate_identity',
  {
    id: id(),
    profileId: uuid('profile_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    /** The future notification schedule is independent of frozen certificate content. */
    currentExpiryScheduleId: uuid('current_expiry_schedule_id'),
  },
  (t) => [
    uniqueIndex('certificate_identity_id_org_uq').on(t.id, t.organizationId),
    check('certificate_identity_schedule_reserved_ck', sql`${t.currentExpiryScheduleId} is null`),
    foreignKey({
      name: 'certificate_identity_profile_org_fk',
      columns: [t.profileId, t.organizationId],
      foreignColumns: [manufacturerProfile.id, manufacturerProfile.organizationId],
    }),
  ],
);

/** Stable document identity across working copies and per-document review decisions (MAN-36). */
export const documentIdentity = pgTable('document_identity', {
  id: id(),
  profileId: uuid('profile_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
}, (t) => [
  uniqueIndex('document_identity_id_org_uq').on(t.id, t.organizationId),
  foreignKey({ name: 'document_identity_profile_org_fk', columns: [t.profileId, t.organizationId],
    foreignColumns: [manufacturerProfile.id, manufacturerProfile.organizationId] }),
]);
