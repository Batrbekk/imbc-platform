import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id } from './_shared.js';
import { userAccounts } from './access.js';
import { recordStatus } from './enums.js';
import { fileObject, fileVersion } from './files.js';
import { certificate, document } from './profile-content.js';
import { manufacturerProfile, profileSection, sectionRevision } from './profile.js';

/** Allocated by SQL guards only after parent locks; cache=1 preserves database insertion order. */
export const profileReviewAssignmentOrderSequence = pgSequence('profile_review_assignment_order_seq', {
  cache: 1,
  increment: 1,
  startWith: 1,
});
export const profileReviewDecisionOrderSequence = pgSequence('profile_review_decision_order_seq', {
  cache: 1,
  increment: 1,
  startWith: 1,
});

function previousAssignmentColumns(): [AnyPgColumn, AnyPgColumn, AnyPgColumn] {
  return [reviewAssignment.id, reviewAssignment.profileId, reviewAssignment.organizationId];
}

/** DBML review_assignment. Legacy plural tables remain for the R1 expand boundary. */
export const reviewAssignment = pgTable(
  'review_assignment',
  {
    id: id(),
    profileId: uuid('profile_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    /** Database-managed order; neither receivedAt nor a caller UUID chooses the previous cycle. */
    assignmentOrder: bigint('assignment_order', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /** Automatic repeat provenance; the closed immediate previous assignment supplied the assignee. */
    reusedFromAssignmentId: uuid('reused_from_assignment_id'),
    expertId: uuid('expert_id').references(() => userAccounts.id),
    assignedBy: uuid('assigned_by').references(() => userAccounts.id),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closeReason: text('close_reason'),
    closedBy: uuid('closed_by').references(() => userAccounts.id),
    closeOperationKey: uuid('close_operation_key'),
    /** Server-derived submit provenance, never a client-selected status or reviewer. */
    submittedBy: uuid('submitted_by')
      .notNull()
      .references(() => userAccounts.id),
    accuracyConfirmedAt: timestamp('accuracy_confirmed_at', { withTimezone: true }).notNull(),
    submissionMode: text('submission_mode').notNull(),
    operationKey: uuid('operation_key').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'review_assignment_profile_org_fk',
      columns: [t.profileId, t.organizationId],
      foreignColumns: [manufacturerProfile.id, manufacturerProfile.organizationId],
    }),
    foreignKey({
      name: 'review_assignment_reused_from_fk',
      columns: [t.reusedFromAssignmentId, t.profileId, t.organizationId],
      foreignColumns: previousAssignmentColumns(),
    }),
    uniqueIndex('review_assignment_order_uq').on(t.assignmentOrder),
    uniqueIndex('review_assignment_id_org_uq').on(t.id, t.organizationId),
    uniqueIndex('review_assignment_id_profile_org_uq').on(t.id, t.profileId, t.organizationId),
    uniqueIndex('review_assignment_active_uq')
      .on(t.profileId)
      .where(sql`${t.closedAt} is null`),
    uniqueIndex('review_assignment_operation_uq').on(t.profileId, t.operationKey),
    uniqueIndex('review_assignment_close_operation_uq')
      .on(t.profileId, t.closeOperationKey)
      .where(sql`${t.closeOperationKey} is not null`),
    index('review_assignment_queue_idx')
      .on(t.receivedAt, t.id)
      .where(sql`${t.closedAt} is null`),
    check('review_assignment_mode_ck', sql`${t.submissionMode} in ('initial', 'resubmit', 'verified_changes')`),
    check('review_assignment_fingerprint_ck', sql`${t.requestFingerprint} ~ '^[0-9a-f]{64}$'`),
    check('review_assignment_order_ck', sql`${t.assignmentOrder} > 0`),
    check(
      'review_assignment_assigned_ck',
      sql`(${t.expertId} is null and ${t.assignedAt} is null and ${t.assignedBy} is null)
    or (${t.expertId} is not null and ${t.assignedAt} is not null and ${t.assignedBy} is not null)`,
    ),
    check(
      'review_assignment_closed_ck',
      sql`(${t.closedAt} is null and ${t.closeReason} is null and ${t.closedBy} is null and ${t.closeOperationKey} is null)
    or (${t.closedAt} is not null and ${t.closedBy} is not null and ${t.closeReason} is not null and
      ((${t.closeReason} = 'review_result' and ${t.closeOperationKey} is null)
        or (${t.closeReason} = 'manufacturer_unlock' and ${t.closeOperationKey} is not null)))`,
    ),
    check(
      'review_assignment_times_ck',
      sql`${t.accuracyConfirmedAt} = ${t.receivedAt}
    and (${t.assignedAt} is null or ${t.assignedAt} >= ${t.receivedAt})
    and (${t.closedAt} is null or ${t.closedAt} >= ${t.receivedAt})`,
    ),
  ],
);

// Explicit column types break the map ↔ retained-decision inference cycle. Evaluated after module init.
function retainedDecisionColumns(): [AnyPgColumn, AnyPgColumn, AnyPgColumn] {
  return [reviewDecision.id, reviewDecision.sectionRevisionId, reviewDecision.organizationId];
}

/** Immutable full-seven Send graph; deferred SQL guards require all seven frozen subjects at COMMIT. */
export const reviewAssignmentSection = pgTable(
  'review_assignment_section',
  {
    reviewAssignmentId: uuid('review_assignment_id').notNull(),
    profileId: uuid('profile_id').notNull(),
    profileSectionId: uuid('profile_section_id').notNull(),
    sectionRevisionId: uuid('section_revision_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    reviewRequired: boolean('review_required').notNull(),
    retainedDecisionId: uuid('retained_decision_id'),
    /** MAN-43/NOT-29: exact immediately previous unlock map, separate from the decision's original authoring assignment. */
    retainedFromAssignmentId: uuid('retained_from_assignment_id'),
  },
  (t) => [
    primaryKey({ columns: [t.reviewAssignmentId, t.profileSectionId] }),
    foreignKey({ name: 'review_assignment_section_retained_from_fk',
      columns: [t.retainedFromAssignmentId, t.profileId, t.organizationId],
      foreignColumns: [reviewAssignment.id, reviewAssignment.profileId, reviewAssignment.organizationId] }),
    uniqueIndex('review_assignment_section_context_uq').on(
      t.reviewAssignmentId,
      t.profileSectionId,
      t.sectionRevisionId,
      t.organizationId,
    ),
    foreignKey({
      name: 'review_assignment_section_assignment_fk',
      columns: [t.reviewAssignmentId, t.profileId, t.organizationId],
      foreignColumns: [reviewAssignment.id, reviewAssignment.profileId, reviewAssignment.organizationId],
    }),
    foreignKey({
      name: 'review_assignment_section_section_org_fk',
      columns: [t.profileSectionId, t.organizationId],
      foreignColumns: [profileSection.id, profileSection.organizationId],
    }),
    foreignKey({
      name: 'review_assignment_section_revision_fk',
      columns: [t.sectionRevisionId, t.profileSectionId, t.organizationId],
      foreignColumns: [sectionRevision.id, sectionRevision.profileSectionId, sectionRevision.organizationId],
    }),
    foreignKey({
      name: 'review_assignment_section_retained_fk',
      columns: [t.retainedDecisionId, t.sectionRevisionId, t.organizationId],
      foreignColumns: retainedDecisionColumns(),
    }),
    check('review_assignment_section_retained_ck', sql`(${t.reviewRequired} = (${t.retainedDecisionId} is null))
      or (${t.reviewRequired} and ${t.retainedFromAssignmentId} is not null and ${t.retainedDecisionId} is not null)`),
  ],
);

/** Exactly one immutable review subject, within the exact assignment map (REV-05–09). */
export const reviewDecision = pgTable(
  'review_decision',
  {
    id: id(),
    reviewAssignmentId: uuid('review_assignment_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    expertId: uuid('expert_id')
      .notNull()
      .references(() => userAccounts.id),
    /** Context columns are not extra decision subjects. */
    profileSectionId: uuid('profile_section_id').notNull(),
    subjectRevisionId: uuid('subject_revision_id').notNull(),
    sectionRevisionId: uuid('section_revision_id'),
    certificateId: uuid('certificate_id'),
    documentId: uuid('document_id'),
    fileVersionId: uuid('file_version_id'),
    fileObjectId: uuid('file_object_id'),
    outcome: recordStatus('outcome').notNull(),
    comment: text('comment'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
    /** Globally monotonic, assigned after the assignment lock; never controlled by decidedAt or client input. */
    decisionOrder: bigint('decision_order', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
  },
  (t) => [
    uniqueIndex('review_decision_order_uq').on(t.decisionOrder),
    uniqueIndex('review_decision_id_org_uq').on(t.id, t.organizationId),
    uniqueIndex('review_decision_id_subject_org_uq').on(t.id, t.sectionRevisionId, t.organizationId),
    index('review_decision_assignment_time_idx').on(t.reviewAssignmentId, t.decidedAt, t.id),
    index('review_decision_section_effective_idx')
      .on(t.sectionRevisionId, t.organizationId, t.decisionOrder)
      .where(sql`${t.sectionRevisionId} is not null`),
    index('review_decision_certificate_effective_idx')
      .on(t.certificateId, t.organizationId, t.decisionOrder)
      .where(sql`${t.certificateId} is not null`),
    index('review_decision_document_effective_idx')
      .on(t.documentId, t.organizationId, t.decisionOrder)
      .where(sql`${t.documentId} is not null`),
    index('review_decision_file_effective_idx')
      .on(t.fileVersionId, t.organizationId, t.decisionOrder)
      .where(sql`${t.fileVersionId} is not null`),
    foreignKey({
      name: 'review_decision_assignment_org_fk',
      columns: [t.reviewAssignmentId, t.organizationId],
      foreignColumns: [reviewAssignment.id, reviewAssignment.organizationId],
    }),
    foreignKey({
      name: 'review_decision_map_fk',
      columns: [t.reviewAssignmentId, t.profileSectionId, t.subjectRevisionId, t.organizationId],
      foreignColumns: [
        reviewAssignmentSection.reviewAssignmentId,
        reviewAssignmentSection.profileSectionId,
        reviewAssignmentSection.sectionRevisionId,
        reviewAssignmentSection.organizationId,
      ],
    }),
    foreignKey({
      name: 'review_decision_section_org_fk',
      columns: [t.sectionRevisionId, t.organizationId],
      foreignColumns: [sectionRevision.id, sectionRevision.organizationId],
    }),
    foreignKey({
      name: 'review_decision_certificate_org_fk',
      columns: [t.certificateId, t.organizationId],
      foreignColumns: [certificate.id, certificate.organizationId],
    }),
    foreignKey({
      name: 'review_decision_document_org_fk',
      columns: [t.documentId, t.organizationId],
      foreignColumns: [document.id, document.organizationId],
    }),
    foreignKey({
      name: 'review_decision_file_org_fk',
      columns: [t.fileObjectId, t.organizationId],
      foreignColumns: [fileObject.id, fileObject.organizationId],
    }),
    foreignKey({
      name: 'review_decision_version_object_fk',
      columns: [t.fileVersionId, t.fileObjectId],
      foreignColumns: [fileVersion.id, fileVersion.fileObjectId],
    }),
    check(
      'review_decision_one_subject_ck',
      sql`num_nonnulls(${t.sectionRevisionId}, ${t.certificateId}, ${t.documentId}, ${t.fileVersionId}) = 1`,
    ),
    check(
      'review_decision_section_context_ck',
      sql`${t.sectionRevisionId} is null or ${t.sectionRevisionId} = ${t.subjectRevisionId}`,
    ),
    check('review_decision_file_context_ck', sql`(${t.fileVersionId} is null) = (${t.fileObjectId} is null)`),
    check('review_decision_outcome_ck', sql`${t.outcome} in ('verified', 'rejected')`),
    check('review_decision_order_ck', sql`${t.decisionOrder} > 0`),
    check(
      'review_decision_rejected_comment_ck',
      sql`${t.outcome} <> 'rejected' or nullif(btrim(${t.comment}), '') is not null`,
    ),
  ],
);

/** Current manufacturer candidate survives a closed assignment and cleared pending pointer; never publication. */
export const profileSectionCandidate = pgTable(
  'profile_section_candidate',
  {
    profileSectionId: uuid('profile_section_id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    reviewAssignmentId: uuid('review_assignment_id').notNull(),
    sectionRevisionId: uuid('section_revision_id').notNull(),
    /** Historical hint only: every current acceptance consumer rechecks effective latest outcome. Never copied to COW. */
    acceptedDecisionId: uuid('accepted_decision_id'),
  },
  (t) => [
    foreignKey({
      name: 'profile_section_candidate_map_fk',
      columns: [t.reviewAssignmentId, t.profileSectionId, t.sectionRevisionId, t.organizationId],
      foreignColumns: [
        reviewAssignmentSection.reviewAssignmentId,
        reviewAssignmentSection.profileSectionId,
        reviewAssignmentSection.sectionRevisionId,
        reviewAssignmentSection.organizationId,
      ],
    }),
    foreignKey({
      name: 'profile_section_candidate_accepted_fk',
      columns: [t.acceptedDecisionId, t.sectionRevisionId, t.organizationId],
      foreignColumns: retainedDecisionColumns(),
    }),
  ],
);
