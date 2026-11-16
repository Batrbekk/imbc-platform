import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id } from './_shared.js';
import { userAccounts } from './access.js';
import { fileObject, fileVersion } from './files.js';
import { auditEntries } from './platform.js';
import { manufacturerProfile } from './profile.js';

export const surveyResult = pgEnum('survey_result', ['yes', 'no']);
export const surveySource = pgEnum('survey_source', ['migration', 'expert']);

/** Canonical v1.4; legacy plural records stay intact until their explicit Stage 8 reconciliation. */
export const siteSurveyRecord = pgTable(
  'site_survey_record',
  {
    id: id(),
    profileId: uuid('profile_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    visitStartedOn: date('visit_started_on').notNull(),
    visitEndedOn: date('visit_ended_on'),
    result: surveyResult('result').notNull(),
    fileObjectId: uuid('file_object_id'),
    fileVersionId: uuid('file_version_id'),
    expiresOn: date('expires_on'),
    comment: text('comment'),
    source: surveySource('source').notNull(),
    recordedBy: uuid('recorded_by').references(() => userAccounts.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'survey_record_profile_org_fk',
      columns: [t.profileId, t.organizationId],
      foreignColumns: [manufacturerProfile.id, manufacturerProfile.organizationId],
    }),
    foreignKey({
      name: 'survey_record_report_org_fk',
      columns: [t.fileObjectId, t.organizationId],
      foreignColumns: [fileObject.id, fileObject.organizationId],
    }),
    foreignKey({
      name: 'survey_record_report_version_fk',
      columns: [t.fileVersionId, t.fileObjectId],
      foreignColumns: [fileVersion.id, fileVersion.fileObjectId],
    }),
    uniqueIndex('survey_record_id_profile_org_uq').on(t.id, t.profileId, t.organizationId),
    index('survey_record_effective_idx').on(t.profileId, t.result, t.expiresOn),
    check('survey_record_dates_ck', sql`${t.visitEndedOn} is null or ${t.visitEndedOn} >= ${t.visitStartedOn}`),
    check('survey_record_report_pair_ck', sql`(${t.fileObjectId} is null) = (${t.fileVersionId} is null)`),
    check(
      'survey_record_expert_ck',
      sql`${t.source} <> 'expert' or (${t.recordedBy} is not null and ${t.fileObjectId} is not null)`,
    ),
    check('survey_record_clock_ck', sql`${t.updatedAt} >= ${t.recordedAt}`),
  ],
);

/** Full before/after audit is sealed before a record mutation and rechecked at transaction commit. */
export const siteSurveyOperation = pgTable(
  'site_survey_operation',
  {
    id: uuid('id').primaryKey(),
    surveyRecordId: uuid('survey_record_id').notNull(),
    profileId: uuid('profile_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => userAccounts.id),
    action: text('action').notNull(),
    idempotencyKey: uuid('idempotency_key'),
    requestFingerprint: text('request_fingerprint'),
    auditEntryId: uuid('audit_entry_id')
      .notNull()
      .references(() => auditEntries.id),
    transactionId: text('transaction_id')
      .notNull()
      .default(sql`pg_current_xact_id()::text`),
    beforeRecordHash: text('before_record_hash'),
    afterRecordHash: text('after_record_hash').notNull(),
    beforeFileObjectId: uuid('before_file_object_id'),
    beforeFileVersionId: uuid('before_file_version_id'),
    afterFileObjectId: uuid('after_file_object_id'),
    afterFileVersionId: uuid('after_file_version_id'),
  },
  (t) => [
    foreignKey({
      name: 'survey_operation_profile_org_fk',
      columns: [t.profileId, t.organizationId],
      foreignColumns: [manufacturerProfile.id, manufacturerProfile.organizationId],
    }),
    foreignKey({
      name: 'survey_operation_before_report_org_fk',
      columns: [t.beforeFileObjectId, t.organizationId],
      foreignColumns: [fileObject.id, fileObject.organizationId],
    }),
    foreignKey({
      name: 'survey_operation_before_version_fk',
      columns: [t.beforeFileVersionId, t.beforeFileObjectId],
      foreignColumns: [fileVersion.id, fileVersion.fileObjectId],
    }),
    foreignKey({
      name: 'survey_operation_after_report_org_fk',
      columns: [t.afterFileObjectId, t.organizationId],
      foreignColumns: [fileObject.id, fileObject.organizationId],
    }),
    foreignKey({
      name: 'survey_operation_after_version_fk',
      columns: [t.afterFileVersionId, t.afterFileObjectId],
      foreignColumns: [fileVersion.id, fileVersion.fileObjectId],
    }),
    uniqueIndex('survey_operation_record_transaction_uq').on(t.surveyRecordId, t.transactionId),
    uniqueIndex('survey_operation_audit_uq').on(t.auditEntryId),
    uniqueIndex('survey_operation_actor_key_uq').on(t.actorId, t.idempotencyKey),
    index('survey_operation_profile_idx').on(t.profileId, t.surveyRecordId),
    check(
      'survey_operation_action_ck',
      sql`${t.action} in ('site_survey.created','site_survey.updated','site_survey.legacy_import')`,
    ),
    check(
      'survey_operation_fingerprint_ck',
      sql`(${t.idempotencyKey} is null) = (${t.requestFingerprint} is null)
    and (${t.requestFingerprint} is null or ${t.requestFingerprint} ~ '^[0-9a-f]{64}$')
    and (${t.action} <> 'site_survey.created' or ${t.idempotencyKey} is not null)`,
    ),
    check(
      'survey_operation_before_ck',
      sql`(${t.action} = 'site_survey.updated') = (${t.beforeRecordHash} is not null)`,
    ),
    check(
      'survey_operation_pins_ck',
      sql`((${t.beforeFileObjectId} is null) = (${t.beforeFileVersionId} is null))
    and ((${t.afterFileObjectId} is null) = (${t.afterFileVersionId} is null))`,
    ),
  ],
);

/** A product-free manufacturer request is independent of survey records and sends no notification. */
export const siteSurveyRequest = pgTable(
  'site_survey_request',
  {
    id: id(),
    profileId: uuid('profile_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => userAccounts.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    auditEntryId: uuid('audit_entry_id')
      .notNull()
      .references(() => auditEntries.id),
    transactionId: text('transaction_id')
      .notNull()
      .default(sql`pg_current_xact_id()::text`),
  },
  (t) => [
    foreignKey({
      name: 'survey_request_profile_org_fk',
      columns: [t.profileId, t.organizationId],
      foreignColumns: [manufacturerProfile.id, manufacturerProfile.organizationId],
    }),
    uniqueIndex('survey_request_actor_key_uq').on(t.requestedBy, t.idempotencyKey),
    uniqueIndex('survey_request_audit_uq').on(t.auditEntryId),
    index('survey_request_profile_idx').on(t.profileId, t.requestedAt),
  ],
);

/** Survey generations are independent of operator visibility; hiding/showing alone does not resend NOT-11. */
export const siteSurveyPublicationState = pgTable(
  'site_survey_publication_state',
  {
    profileId: uuid('profile_id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    siteSurveyed: boolean('site_surveyed').notNull().default(false),
    effectiveUntil: date('effective_until'),
    nextRefreshOn: date('next_refresh_on'),
    generation: bigint('generation', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'survey_publication_profile_org_fk',
      columns: [t.profileId, t.organizationId],
      foreignColumns: [manufacturerProfile.id, manufacturerProfile.organizationId],
    }),
    check(
      'survey_publication_generation_ck',
      sql`${t.generation} >= 0 and (not ${t.siteSurveyed} or ${t.generation} > 0)`,
    ),
    check('survey_publication_expiry_ck', sql`${t.siteSurveyed} or ${t.effectiveUntil} is null`),
    index('survey_publication_expiry_idx')
      .on(t.effectiveUntil)
      .where(sql`${t.siteSurveyed} and ${t.effectiveUntil} is not null`),
    index('survey_publication_refresh_idx')
      .on(t.nextRefreshOn)
      .where(sql`${t.nextRefreshOn} is not null`),
  ],
);

/** One durable event per surveyed generation; actual dispatch rechecks current visibility and generation. */
export const siteSurveyNoticeOutbox = pgTable(
  'site_survey_notice_outbox',
  {
    id: id(),
    profileId: uuid('profile_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    generation: bigint('generation', { mode: 'bigint' }).notNull(),
    surveyRecordId: uuid('survey_record_id').notNull(),
    state: text('state').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    queuedAt: timestamp('queued_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    dispatchId: uuid('dispatch_id'),
    notificationJobId: uuid('notification_job_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    lastOutcome: text('last_outcome'),
  },
  (t) => [
    foreignKey({
      name: 'survey_notice_profile_org_fk',
      columns: [t.profileId, t.organizationId],
      foreignColumns: [manufacturerProfile.id, manufacturerProfile.organizationId],
    }),
    foreignKey({
      name: 'survey_notice_record_scope_fk',
      columns: [t.surveyRecordId, t.profileId, t.organizationId],
      foreignColumns: [siteSurveyRecord.id, siteSurveyRecord.profileId, siteSurveyRecord.organizationId],
    }),
    uniqueIndex('survey_notice_generation_uq').on(t.profileId, t.generation),
    index('survey_notice_pending_idx').on(t.state, t.lastAttemptAt),
    uniqueIndex('survey_notice_dispatch_uq').on(t.dispatchId),
    uniqueIndex('survey_notice_job_uq').on(t.notificationJobId),
    check('survey_notice_generation_ck', sql`${t.generation} > 0`),
    check(
      'survey_notice_state_ck',
      sql`${t.state} in ('pending','queued','completed','obsolete')
    and ((${t.state} = 'queued') = (${t.dispatchId} is not null))
    and ((${t.state} = 'queued') = (${t.notificationJobId} is not null))
    and ((${t.state} in ('completed','obsolete')) = (${t.resolvedAt} is not null))
    and (${t.state} <> 'pending' or ${t.queuedAt} is null)
    and (${t.state} <> 'queued' or ${t.queuedAt} is not null)`,
    ),
    check('survey_notice_attempt_ck', sql`${t.attemptCount} >= 0`),
  ],
);
