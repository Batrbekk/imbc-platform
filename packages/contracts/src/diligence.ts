import { z } from 'zod';

export const DILIGENCE_RESULTS = ['green', 'amber', 'red'] as const;
export const DILIGENCE_MARKS = ['clear', 'finding', 'shown_only', 'no_answer'] as const;
export const DILIGENCE_CHECK_GROUPS = [
  'company_enterprise',
  'company_finance',
  'company_procurement',
  'company_tax',
  'director',
  'founder',
  'beneficiary',
] as const;
export const ENHANCED_DILIGENCE_STATES = ['done', 'not_done'] as const;
export const DILIGENCE_RUN_STATES = [
  'waiting',
  'received',
  'no_answer',
  'unavailable',
  'modules_not_connected',
  'not_configured',
  'quota_exhausted',
  'malformed',
] as const;

/** Preserve the actual PG concurrency token; parsing through Date would lose its last three digits. */
export const diligenceTimestampSchema = z.iso.datetime({ precision: 6 });
const safeText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !/[\u0000\uD800-\uDFFF]/u.test(value), { message: 'text_format' });
const nullableText = safeText(10_000).nullable();
const uuid = z.uuid();
export const diligenceCheckReadSchema = z
  .strictObject({
    id: uuid,
    profileId: uuid,
    organizationId: uuid,
    groupName: z.enum(DILIGENCE_CHECK_GROUPS),
    subjectName: safeText(10_000).min(1),
    checkName: safeText(10_000).min(1),
    // One returned check may contain four exact 10,000-digit court counters as JSON.
    adataValue: safeText(100_000).min(1).nullable(),
    mark: z.enum(DILIGENCE_MARKS),
    attention: z.boolean(),
    position: z.number().int().nonnegative(),
  })
  .refine((row) => (row.mark === 'no_answer') === (row.adataValue === null), { message: 'check_value_mark_mismatch' })
  .refine((row) => !row.attention || row.mark === 'shown_only', { message: 'check_attention_mark_mismatch' });
export type DiligenceCheckRead = z.infer<typeof diligenceCheckReadSchema>;
export const diligenceRecordReadSchema = z
  .strictObject({
    profileId: uuid,
    organizationId: uuid,
    checkedOn: z.iso.date(),
    /** Exact time/provenance of the selected business source, independent of a newer failed run. */
    checkedAt: diligenceTimestampSchema.nullable(),
    sourceIsTestData: z.boolean().nullable(),
    adataResult: z.enum(DILIGENCE_RESULTS).nullable(),
    result: z.enum(DILIGENCE_RESULTS),
    comment: nullableText,
    reportFileId: uuid.nullable(),
    reportFileVersionId: uuid.nullable(),
    reportFileVersionNumber: z.number().int().positive().nullable(),
    overriddenBy: uuid.nullable(),
    overriddenAt: diligenceTimestampSchema.nullable(),
    enhanced: z.enum(ENHANCED_DILIGENCE_STATES),
    enhancedComment: nullableText,
    enhancedReportFileId: uuid.nullable(),
    enhancedReportFileVersionId: uuid.nullable(),
    enhancedReportFileVersionNumber: z.number().int().positive().nullable(),
    sourceSnapshotId: uuid.nullable(),
    updatedAt: diligenceTimestampSchema,
  })
  .refine((row) => (row.overriddenBy === null) === (row.overriddenAt === null), {
    message: 'override_actor_time_mismatch',
  })
  .refine(
    (row) =>
      (row.reportFileId === null) === (row.reportFileVersionId === null) &&
      (row.reportFileId === null) === (row.reportFileVersionNumber === null) &&
      (row.enhancedReportFileId === null) === (row.enhancedReportFileVersionId === null) &&
      (row.enhancedReportFileId === null) === (row.enhancedReportFileVersionNumber === null),
    { message: 'report_version_pin_mismatch' },
  )
  .refine(
    (row) =>
      (row.sourceSnapshotId === null) === (row.checkedAt === null) &&
      (row.sourceSnapshotId === null) === (row.sourceIsTestData === null),
    { message: 'source_metadata_pin_mismatch' },
  );
export type DiligenceRecordRead = z.infer<typeof diligenceRecordReadSchema>;
export const diligenceLastRunReadSchema = z
  .strictObject({
    attemptId: uuid,
    snapshotId: uuid.nullable(),
    state: z.enum(DILIGENCE_RUN_STATES),
    requestedAt: diligenceTimestampSchema,
    completedAt: diligenceTimestampSchema.nullable(),
    isTestData: z.boolean(),
  })
  .superRefine((row, ctx) => {
    if ((row.state === 'waiting') !== (row.completedAt === null))
      ctx.addIssue({ code: 'custom', message: 'run_state_time_mismatch' });
    if (row.state === 'waiting' && row.snapshotId !== null)
      ctx.addIssue({ code: 'custom', message: 'waiting_run_has_snapshot' });
  });
export const diligenceReadSchema = z
  .strictObject({
    profileId: uuid,
    organizationId: uuid,
    record: diligenceRecordReadSchema.nullable(),
    checks: z.array(diligenceCheckReadSchema),
    lastRun: diligenceLastRunReadSchema.nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.record === null && data.checks.length)
      ctx.addIssue({ code: 'custom', message: 'checks_without_current_record' });
    if (data.record && (data.record.profileId !== data.profileId || data.record.organizationId !== data.organizationId))
      ctx.addIssue({ code: 'custom', message: 'record_scope_mismatch' });
    const ids = new Set<string>();
    data.checks.forEach((row, index) => {
      if (row.profileId !== data.profileId || row.organizationId !== data.organizationId)
        ctx.addIssue({ code: 'custom', path: ['checks', index], message: 'check_scope_mismatch' });
      if (row.position !== index || ids.has(row.id))
        ctx.addIssue({ code: 'custom', path: ['checks', index], message: 'check_order_identity_mismatch' });
      ids.add(row.id);
    });
  });
export type DiligenceRead = z.infer<typeof diligenceReadSchema>;

export const diligenceOverrideWriteSchema = z.strictObject({
  expectedUpdatedAt: diligenceTimestampSchema.nullable(),
  result: z.enum(DILIGENCE_RESULTS),
  comment: nullableText,
  reportFileId: uuid.nullable(),
});
export type DiligenceOverrideWrite = z.infer<typeof diligenceOverrideWriteSchema>;
export const diligenceEnhancedWriteSchema = z.strictObject({
  expectedUpdatedAt: diligenceTimestampSchema.nullable(),
  enhanced: z.enum(ENHANCED_DILIGENCE_STATES),
  comment: nullableText,
  reportFileId: uuid.nullable(),
});
export type DiligenceEnhancedWrite = z.infer<typeof diligenceEnhancedWriteSchema>;

/** The only DD projection fields readable by operators/observers. No Class C result/check/report fields. */
export const diligencePublicSummarySchema = z.strictObject({
  checkedOn: z.iso.date().nullable(),
  enhancedDone: z.boolean(),
});
export type DiligencePublicSummary = z.infer<typeof diligencePublicSummarySchema>;

/** Full sealed SQL snapshots retain their original timestamps and spelling without lossy conversion. */
const storedTimestamp = z.iso.datetime({ offset: true });
const storedRecord = z
  .strictObject({
    profile_id: uuid,
    organization_id: uuid,
    checked_on: z.iso.date(),
    adata_result: z.enum(DILIGENCE_RESULTS).nullable(),
    result: z.enum(DILIGENCE_RESULTS),
    comment: nullableText,
    report_file_id: uuid.nullable(),
    report_file_version_id: uuid.nullable(),
    overridden_by: uuid.nullable(),
    overridden_at: storedTimestamp.nullable(),
    enhanced: z.enum(ENHANCED_DILIGENCE_STATES),
    enhanced_comment: nullableText,
    enhanced_report_file_id: uuid.nullable(),
    enhanced_report_file_version_id: uuid.nullable(),
    source_snapshot_id: uuid.nullable(),
    updated_at: storedTimestamp,
  })
  .refine(
    (row) =>
      (row.report_file_id === null) === (row.report_file_version_id === null) &&
      (row.enhanced_report_file_id === null) === (row.enhanced_report_file_version_id === null) &&
      (row.overridden_by === null) === (row.overridden_at === null),
    { message: 'stored_record_pin_mismatch' },
  );
const storedCheck = z
  .strictObject({
    id: uuid,
    profile_id: uuid,
    organization_id: uuid,
    group_name: z.enum(DILIGENCE_CHECK_GROUPS),
    subject_name: safeText(10_000).min(1),
    check_name: safeText(10_000).min(1),
    adata_value: safeText(100_000).min(1).nullable(),
    mark: z.enum(DILIGENCE_MARKS),
    attention: z.boolean(),
    position: z.number().int().nonnegative(),
  })
  .refine((row) => (row.mark === 'no_answer') === (row.adata_value === null), {
    message: 'stored_check_value_mismatch',
  })
  .refine((row) => !row.attention || row.mark === 'shown_only', { message: 'stored_check_attention_mismatch' });
const storedState = z
  .strictObject({ record: storedRecord.nullable(), checks: z.array(storedCheck) })
  .superRefine((state, ctx) => {
    if (state.record === null && state.checks.length)
      ctx.addIssue({ code: 'custom', message: 'stored_checks_without_record' });
    const ids = new Set<string>();
    state.checks.forEach((check, index) => {
      if (check.position !== index || ids.has(check.id))
        ctx.addIssue({ code: 'custom', message: 'stored_check_order_mismatch' });
      if (
        state.record &&
        (check.profile_id !== state.record.profile_id || check.organization_id !== state.record.organization_id)
      )
        ctx.addIssue({ code: 'custom', message: 'stored_check_scope_mismatch' });
      ids.add(check.id);
    });
  });
export const diligenceHistoryEntrySchema = z
  .strictObject({
    id: uuid,
    at: diligenceTimestampSchema,
    actorId: uuid.nullable(),
    actorName: nullableText,
    action: z.enum([
      'due_diligence.received',
      'due_diligence.override',
      'due_diligence.enhanced',
      'due_diligence.legacy_import',
    ]),
    diff: z.strictObject({
      operationId: uuid,
      actor: z.discriminatedUnion('type', [
        z.strictObject({ type: z.literal('system') }),
        z.strictObject({ type: z.literal('user'), id: uuid }),
      ]),
      before: storedState,
      after: storedState,
    }),
    reports: z.array(z.strictObject({ fileId: uuid, versionId: uuid, versionNumber: z.number().int().positive() })),
    /** Provenance belongs to the exact immutable snapshots in this operation, never the latest run. */
    sourceSnapshots: z
      .array(z.strictObject({ snapshotId: uuid, checkedAt: diligenceTimestampSchema, isTestData: z.boolean() }))
      .max(2),
  })
  .superRefine((entry, ctx) => {
    const { before, after, actor } = entry.diff;
    if (entry.actorId === null ? actor.type !== 'system' : actor.type !== 'user' || actor.id !== entry.actorId)
      ctx.addIssue({ code: 'custom', message: 'history_actor_mismatch' });
    if (!before.record && !after.record) ctx.addIssue({ code: 'custom', message: 'history_without_record' });
    if (
      before.record &&
      after.record &&
      (before.record.profile_id !== after.record.profile_id ||
        before.record.organization_id !== after.record.organization_id)
    )
      ctx.addIssue({ code: 'custom', message: 'history_scope_mismatch' });
    const ownerPairs = new Set(
      [before.record, after.record].flatMap((row) =>
        row
          ? [
              row.report_file_id && row.report_file_version_id
                ? `${row.report_file_id}:${row.report_file_version_id}`
                : null,
              row.enhanced_report_file_id && row.enhanced_report_file_version_id
                ? `${row.enhanced_report_file_id}:${row.enhanced_report_file_version_id}`
                : null,
            ].filter((pair): pair is string => pair !== null)
          : [],
      ),
    );
    const seen = new Set<string>();
    entry.reports.forEach((report) => {
      const pair = `${report.fileId}:${report.versionId}`;
      if (!ownerPairs.has(pair) || seen.has(pair))
        ctx.addIssue({ code: 'custom', message: 'history_report_owner_mismatch' });
      seen.add(pair);
    });
    const sourcePins = new Set(
      [before.record?.source_snapshot_id, after.record?.source_snapshot_id].filter(
        (pin): pin is string => typeof pin === 'string',
      ),
    );
    const sourceSeen = new Set<string>();
    entry.sourceSnapshots.forEach((source) => {
      if (!sourcePins.has(source.snapshotId) || sourceSeen.has(source.snapshotId))
        ctx.addIssue({ code: 'custom', message: 'history_source_owner_mismatch' });
      sourceSeen.add(source.snapshotId);
    });
    if (sourcePins.size !== sourceSeen.size)
      ctx.addIssue({ code: 'custom', message: 'history_source_metadata_missing' });
  });
export const diligenceHistorySchema = z.array(diligenceHistoryEntrySchema).max(50);
export type DiligenceHistoryEntry = z.infer<typeof diligenceHistoryEntrySchema>;
export type DiligenceHistory = z.infer<typeof diligenceHistorySchema>;
