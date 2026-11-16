import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
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
import { externalCheckAttempt } from './records.js';
import type { DiligenceEvidence, DiligenceEvaluation } from '../../modules/due-diligence/scoring.js';

/** Canonical v1.4 enums deliberately differ from the retained legacy dd_result. */
export const diligenceResult = pgEnum('diligence_result', ['green', 'amber', 'red']);
export const diligenceMark = pgEnum('diligence_mark', ['clear', 'finding', 'shown_only', 'no_answer']);
export const enhancedDiligence = pgEnum('enhanced_diligence', ['done', 'not_done']);

/** Immutable, normalized Class C receipt. Contains no unfiltered provider report or personal identifiers. */
export const diligenceSourceSnapshot = pgTable(
  'diligence_source_snapshot',
  {
    id: id(),
    profileId: uuid('profile_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => externalCheckAttempt.id),
    terminalState: text('terminal_state').notNull(),
    normalizedState: text('normalized_state').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
    schemaVersion: text('schema_version').notNull(),
    schemaSha256: text('schema_sha256').notNull(),
    isTestData: boolean('is_test_data').notNull(),
    evidence: jsonb('evidence').$type<readonly DiligenceEvidence[]>().notNull(),
    evaluation: jsonb('evaluation').$type<DiligenceEvaluation | null>(),
  },
  (t) => [
    foreignKey({
      name: 'diligence_snapshot_profile_org_fk',
      columns: [t.profileId, t.organizationId],
      foreignColumns: [manufacturerProfile.id, manufacturerProfile.organizationId],
    }),
    uniqueIndex('diligence_snapshot_terminal_uq').on(t.attemptId, t.completedAt, t.terminalState),
    uniqueIndex('diligence_snapshot_id_profile_org_uq').on(t.id, t.profileId, t.organizationId),
    index('diligence_snapshot_profile_idx').on(t.profileId, t.completedAt),
    check(
      'diligence_snapshot_state_ck',
      sql`${t.normalizedState} in ('received','no_answer','unavailable','modules_not_connected','not_configured','quota_exhausted','malformed')`,
    ),
    check('diligence_snapshot_evaluation_ck', sql`(${t.normalizedState} = 'received') = (${t.evaluation} is not null)`),
    check('diligence_snapshot_hash_ck', sql`${t.schemaSha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

/** One current business result per profile; technical version pins make report history reconstructable. */
export const dueDiligenceRecord = pgTable(
  'due_diligence_record',
  {
    profileId: uuid('profile_id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    checkedOn: date('checked_on').notNull(),
    adataResult: diligenceResult('adata_result'),
    result: diligenceResult('result').notNull(),
    comment: text('comment'),
    reportFileId: uuid('report_file_id'),
    reportFileVersionId: uuid('report_file_version_id'),
    overriddenBy: uuid('overridden_by').references(() => userAccounts.id),
    overriddenAt: timestamp('overridden_at', { withTimezone: true }),
    enhanced: enhancedDiligence('enhanced').notNull().default('not_done'),
    enhancedComment: text('enhanced_comment'),
    enhancedReportFileId: uuid('enhanced_report_file_id'),
    enhancedReportFileVersionId: uuid('enhanced_report_file_version_id'),
    sourceSnapshotId: uuid('source_snapshot_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('due_diligence_record_profile_org_uq').on(t.profileId, t.organizationId),
    foreignKey({
      name: 'due_diligence_record_profile_org_fk',
      columns: [t.profileId, t.organizationId],
      foreignColumns: [manufacturerProfile.id, manufacturerProfile.organizationId],
    }),
    foreignKey({
      name: 'due_diligence_record_snapshot_scope_fk',
      columns: [t.sourceSnapshotId, t.profileId, t.organizationId],
      foreignColumns: [
        diligenceSourceSnapshot.id,
        diligenceSourceSnapshot.profileId,
        diligenceSourceSnapshot.organizationId,
      ],
    }),
    foreignKey({
      name: 'due_diligence_record_report_org_fk',
      columns: [t.reportFileId, t.organizationId],
      foreignColumns: [fileObject.id, fileObject.organizationId],
    }),
    foreignKey({
      name: 'due_diligence_record_report_version_fk',
      columns: [t.reportFileVersionId, t.reportFileId],
      foreignColumns: [fileVersion.id, fileVersion.fileObjectId],
    }),
    foreignKey({
      name: 'due_diligence_record_enhanced_report_org_fk',
      columns: [t.enhancedReportFileId, t.organizationId],
      foreignColumns: [fileObject.id, fileObject.organizationId],
    }),
    foreignKey({
      name: 'due_diligence_record_enhanced_report_version_fk',
      columns: [t.enhancedReportFileVersionId, t.enhancedReportFileId],
      foreignColumns: [fileVersion.id, fileVersion.fileObjectId],
    }),
    check('due_diligence_record_override_pair_ck', sql`(${t.overriddenBy} is null) = (${t.overriddenAt} is null)`),
    check('due_diligence_record_report_pair_ck', sql`(${t.reportFileId} is null) = (${t.reportFileVersionId} is null)`),
    check(
      'due_diligence_record_enhanced_report_pair_ck',
      sql`(${t.enhancedReportFileId} is null) = (${t.enhancedReportFileVersionId} is null)`,
    ),
  ],
);

export const dueDiligenceCheck = pgTable(
  'due_diligence_check',
  {
    id: id(),
    profileId: uuid('profile_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    groupName: text('group_name').notNull(),
    subjectName: text('subject_name').notNull(),
    checkName: text('check_name').notNull(),
    adataValue: text('adata_value'),
    mark: diligenceMark('mark').notNull(),
    /** IMBC-13: a shown-only partial amount is not automatically a human-attention finding. */
    attention: boolean('attention').notNull().default(false),
    position: integer('position').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'due_diligence_check_record_org_fk',
      columns: [t.profileId, t.organizationId],
      foreignColumns: [dueDiligenceRecord.profileId, dueDiligenceRecord.organizationId],
    }),
    uniqueIndex('due_diligence_check_position_uq').on(t.profileId, t.position),
    check('due_diligence_check_position_ck', sql`${t.position} >= 0`),
    check('due_diligence_check_value_ck', sql`(${t.mark} = 'no_answer') = (${t.adataValue} is null)`),
    check('due_diligence_check_attention_ck', sql`not ${t.attention} or ${t.mark} = 'shown_only'`),
    check(
      'due_diligence_check_group_ck',
      sql`${t.groupName} in ('company_enterprise','company_finance','company_procurement','company_tax','director','founder','beneficiary')`,
    ),
  ],
);

/** Durable latest receipt cursor. No profile lock is acquired by the terminal Adata transaction. */
export const diligenceRefreshOutbox = pgTable(
  'diligence_refresh_outbox',
  {
    profileId: uuid('profile_id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    requestedSnapshotId: uuid('requested_snapshot_id').notNull(),
    appliedSnapshotId: uuid('applied_snapshot_id'),
    state: text('state').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'diligence_outbox_profile_org_fk',
      columns: [t.profileId, t.organizationId],
      foreignColumns: [manufacturerProfile.id, manufacturerProfile.organizationId],
    }),
    foreignKey({
      name: 'diligence_outbox_requested_scope_fk',
      columns: [t.requestedSnapshotId, t.profileId, t.organizationId],
      foreignColumns: [
        diligenceSourceSnapshot.id,
        diligenceSourceSnapshot.profileId,
        diligenceSourceSnapshot.organizationId,
      ],
    }),
    foreignKey({
      name: 'diligence_outbox_applied_scope_fk',
      columns: [t.appliedSnapshotId, t.profileId, t.organizationId],
      foreignColumns: [
        diligenceSourceSnapshot.id,
        diligenceSourceSnapshot.profileId,
        diligenceSourceSnapshot.organizationId,
      ],
    }),
    index('diligence_outbox_pending_idx').on(t.state, t.lastAttemptAt),
    check('diligence_outbox_state_ck', sql`${t.state} in ('pending','applied')`),
    check('diligence_outbox_attempt_ck', sql`${t.attemptCount} >= 0`),
  ],
);

/** SQL seals an existing full audit snapshot BEFORE business DML and verifies its complete after state at commit. */
export const diligenceOperation = pgTable(
  'diligence_operation',
  {
    id: uuid('id').primaryKey(),
    profileId: uuid('profile_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    auditEntryId: uuid('audit_entry_id')
      .notNull()
      .references(() => auditEntries.id),
    transactionId: text('transaction_id')
      .notNull()
      .default(sql`pg_current_xact_id()::text`),
    beforeRecordHash: text('before_record_hash'),
    afterRecordHash: text('after_record_hash'),
    beforeCheckHashes: jsonb('before_check_hashes')
      .notNull()
      .default(sql`'{}'::jsonb`),
    afterCheckHashes: jsonb('after_check_hashes')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    foreignKey({
      name: 'diligence_operation_profile_org_fk',
      columns: [t.profileId, t.organizationId],
      foreignColumns: [manufacturerProfile.id, manufacturerProfile.organizationId],
    }),
    uniqueIndex('diligence_operation_profile_transaction_uq').on(t.profileId, t.transactionId),
    uniqueIndex('diligence_operation_audit_uq').on(t.auditEntryId),
  ],
);
