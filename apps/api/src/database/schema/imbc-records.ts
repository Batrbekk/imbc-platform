import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid, boolean, date } from 'drizzle-orm/pg-core';
import { id } from './_shared.js';
import { userAccounts } from './access.js';
import { manufacturerProfile, productLineIdentity } from './profile.js';
import { dictionaryEntry } from './reference.js';
import { auditEntries } from './platform.js';

export const imbcNoteKind = pgEnum('imbc_note_kind', ['general', 'legacy_ranking', 'registry_review', 'migration_context']);
export const eoiResponse = pgEnum('eoi_response', ['interested', 'not_interested']);
export const imbcRecordSource = pgEnum('imbc_record_source', ['expert', 'migration']);
const noteWhitespace = sql.raw(String.raw`U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'`);
const clock = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updateClock = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const scope = () => ({ profileId: uuid('profile_id').notNull(), organizationId: uuid('organization_id').notNull() });
const provenance = () => ({ recordedBy: uuid('recorded_by').references(() => userAccounts.id), createdAt: clock(), updatedAt: updateClock(), source: imbcRecordSource('source').notNull() });
/** DBML1351: no deletes; legacy plural notes remain until approved Stage8 reconciliation. */
export const imbcNote = pgTable('imbc_note', {
  id: id(), ...scope(), authorId: uuid('author_id').references(() => userAccounts.id),
  kind: imbcNoteKind('kind').notNull().default('general'), body: text('body').notNull(),
  createdAt: clock(), updatedAt: updateClock(), source: imbcRecordSource('source').notNull(),
}, t => [
  foreignKey({ name: 'imbc_note_profile_org_fk', columns: [t.profileId,t.organizationId], foreignColumns: [manufacturerProfile.id,manufacturerProfile.organizationId] }),
  unique('imbc_note_scope_uq').on(t.id,t.profileId,t.organizationId), index('imbc_note_profile_idx').on(t.profileId,t.createdAt,t.id),
  check('imbc_note_body_ck', sql`length(btrim(${t.body},${noteWhitespace}))>0 and length(${t.body})<=10000`),
  check('imbc_note_clock_ck', sql`${t.updatedAt}>=${t.createdAt}`), check('imbc_note_expert_ck', sql`${t.source}<>'expert' or ${t.authorId} is not null`),
]);
export const imbcEngagement = pgTable('imbc_engagement', {
  profileId: uuid('profile_id').primaryKey(), organizationId: uuid('organization_id').notNull(),
  receiptConfirmed: boolean('receipt_confirmed'), response: eoiResponse('response'), responseSummary: text('response_summary'),
  readyForSiteVisit: boolean('ready_for_site_visit'), addedToImbcYear: integer('added_to_imbc_year'), folderUrl: text('folder_url'), ...provenance(),
}, t => [
  foreignKey({ name: 'imbc_engagement_profile_org_fk', columns: [t.profileId,t.organizationId], foreignColumns: [manufacturerProfile.id,manufacturerProfile.organizationId] }),
  unique('imbc_engagement_scope_uq').on(t.profileId,t.organizationId), check('imbc_engagement_year_ck', sql`${t.addedToImbcYear} between 1 and 9999`),
  check('imbc_engagement_summary_ck', sql`length(${t.responseSummary})<=10000`),
  check('imbc_engagement_folder_ck', sql`imbc_records_folder_valid(${t.folderUrl})`),
  check('imbc_engagement_clock_ck', sql`${t.updatedAt}>=${t.createdAt}`), check('imbc_engagement_expert_ck', sql`${t.source}<>'expert' or ${t.recordedBy} is not null`),
]);
export const imbcEngagementSource = pgTable('imbc_engagement_source', {
  ...scope(), sourceEntryId: uuid('source_entry_id').notNull().references(() => dictionaryEntry.id),
}, t => [primaryKey({ columns: [t.profileId,t.sourceEntryId] }), foreignKey({ name: 'imbc_engagement_source_scope_fk', columns: [t.profileId,t.organizationId], foreignColumns: [imbcEngagement.profileId,imbcEngagement.organizationId] })]);
export const imbcEoiEmailEvent = pgTable('imbc_eoi_email_event', {
  id: id(), ...scope(), sentOn: date('sent_on').notNull(), ...provenance(),
}, t => [
  foreignKey({ name: 'imbc_eoi_email_event_profile_org_fk', columns: [t.profileId,t.organizationId], foreignColumns: [imbcEngagement.profileId,imbcEngagement.organizationId] }),
  unique('imbc_eoi_event_date_uq').on(t.profileId,t.sentOn), unique('imbc_eoi_event_scope_uq').on(t.id,t.profileId,t.organizationId),
  check('imbc_eoi_event_clock_ck', sql`${t.updatedAt}>=${t.createdAt}`),
  check('imbc_eoi_event_date_ck', sql`${t.sentOn}>='0001-01-01'::date and ${t.sentOn}<='9999-12-31'::date`),
  check('imbc_eoi_event_expert_ck', sql`${t.source}<>'expert' or ${t.recordedBy} is not null`),
]);
export const imbcProductContext = pgTable('imbc_product_context', {
  productLineIdentityId: uuid('product_line_identity_id').primaryKey(), ...scope(),
  programmeId: uuid('programme_id').references(() => dictionaryEntry.id), priorityId: uuid('priority_id').references(() => dictionaryEntry.id), ...provenance(),
}, t => [
  foreignKey({ name: 'imbc_product_context_profile_org_fk', columns: [t.profileId,t.organizationId], foreignColumns: [manufacturerProfile.id,manufacturerProfile.organizationId] }),
  foreignKey({ name: 'imbc_product_context_product_org_fk', columns: [t.productLineIdentityId,t.organizationId], foreignColumns: [productLineIdentity.id,productLineIdentity.organizationId] }),
  check('imbc_product_context_clock_ck', sql`${t.updatedAt}>=${t.createdAt}`), check('imbc_product_context_expert_ck', sql`${t.source}<>'expert' or ${t.recordedBy} is not null`),
]);
/** Full native snapshots/audit seals are checked before DML and again at COMMIT. */
export const imbcRecordsOperation = pgTable('imbc_records_operation', {
  id: uuid('id').primaryKey(), recordKind: text('record_kind').notNull(), recordId: uuid('record_id').notNull(), ...scope(),
  actorId: uuid('actor_id').notNull().references(() => userAccounts.id), action: text('action').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  auditEntryId: uuid('audit_entry_id').notNull().references(() => auditEntries.id),
  transactionId: text('transaction_id').notNull().default(sql`pg_current_xact_id()::text`),
  beforeRecordHash: text('before_record_hash'), afterRecordHash: text('after_record_hash').notNull(),
  beforeProgrammeId: uuid('before_programme_id').references(() => dictionaryEntry.id), afterProgrammeId: uuid('after_programme_id').references(() => dictionaryEntry.id),
  beforePriorityId: uuid('before_priority_id').references(() => dictionaryEntry.id), afterPriorityId: uuid('after_priority_id').references(() => dictionaryEntry.id),
}, t => [
  foreignKey({ name: 'imbc_records_operation_profile_fk', columns: [t.profileId,t.organizationId], foreignColumns: [manufacturerProfile.id,manufacturerProfile.organizationId] }),
  unique('imbc_records_operation_actor_key_uq').on(t.actorId,t.idempotencyKey), unique('imbc_records_operation_transaction_uq').on(t.recordKind,t.recordId,t.transactionId),
  unique('imbc_records_operation_audit_entry_id_key').on(t.auditEntryId), index('imbc_records_operation_history_idx').on(t.profileId,t.recordKind,t.recordId,t.id),
  check('imbc_records_operation_record_kind_check', sql`${t.recordKind} in ('note','engagement','product_context')`),
  check('imbc_records_operation_request_fingerprint_check', sql`${t.requestFingerprint} ~ '^[0-9a-f]{64}$'`),
  check('imbc_records_operation_action_ck', sql`${t.action} in ('imbc_note.created','imbc_note.updated','imbc_engagement.created','imbc_engagement.updated','imbc_product_context.created','imbc_product_context.updated')`),
]);
export const imbcRecordsOperationChild = pgTable('imbc_records_operation_child', {
  operationId: uuid('operation_id').notNull().references(() => imbcRecordsOperation.id), phase: text('phase').notNull(),
  childKind: text('child_kind').notNull(), childId: uuid('child_id').notNull(), ...scope(),
  sourceEntryId: uuid('source_entry_id').references(() => dictionaryEntry.id), eoiEventId: uuid('eoi_event_id'), sentOn: date('sent_on'),
  recordedBy: uuid('recorded_by').references(() => userAccounts.id), createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }), source: imbcRecordSource('source'), snapshot: jsonb('snapshot').notNull(),
}, t => [
  primaryKey({ columns: [t.operationId,t.phase,t.childKind,t.childId] }),
  foreignKey({ name: 'imbc_records_operation_child_profile_fk', columns: [t.profileId,t.organizationId], foreignColumns: [manufacturerProfile.id,manufacturerProfile.organizationId] }),
  foreignKey({ name: 'imbc_records_operation_child_event_fk', columns: [t.eoiEventId,t.profileId,t.organizationId], foreignColumns: [imbcEoiEmailEvent.id,imbcEoiEmailEvent.profileId,imbcEoiEmailEvent.organizationId] }),
  check('imbc_records_operation_child_phase_check', sql`${t.phase} in ('before','after')`), check('imbc_records_operation_child_child_kind_check', sql`${t.childKind} in ('source','eoi')`),
  check('imbc_records_operation_child_shape_ck', sql`(${t.childKind}='source' and ${t.sourceEntryId} is not null and ${t.sourceEntryId}=${t.childId} and ${t.eoiEventId} is null and ${t.sentOn} is null and ${t.recordedBy} is null and ${t.createdAt} is null and ${t.updatedAt} is null and ${t.source} is null)
    or (${t.childKind}='eoi' and ${t.sourceEntryId} is null and ${t.eoiEventId} is not null and ${t.eoiEventId}=${t.childId} and ${t.sentOn} is not null and ${t.createdAt} is not null and ${t.updatedAt} is not null and ${t.source} is not null)`),
]);
