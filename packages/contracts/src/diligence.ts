import { z } from 'zod';

export const DILIGENCE_RESULTS = ['green', 'amber', 'red'] as const;
export const DILIGENCE_MARKS = ['clear', 'finding', 'shown_only', 'no_answer'] as const;
export const DILIGENCE_CHECK_GROUPS = ['company_enterprise', 'company_finance', 'company_procurement', 'company_tax', 'director', 'founder', 'beneficiary'] as const;
export const ENHANCED_DILIGENCE_STATES = ['done', 'not_done'] as const;
export const DILIGENCE_RUN_STATES = ['waiting', 'received', 'no_answer', 'unavailable', 'modules_not_connected', 'not_configured', 'quota_exhausted', 'malformed'] as const;

/** Preserve the actual PG concurrency token; parsing through Date would lose its last three digits. */
export const diligenceTimestampSchema = z.iso.datetime({ precision: 6 });
const safeText = (max: number) => z.string().max(max).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value), { message: 'text_format' });
const nullableText = safeText(10_000).nullable();
const uuid = z.uuid();
export const diligenceCheckReadSchema = z.strictObject({
  id: uuid,
  profileId: uuid,
  organizationId: uuid,
  groupName: z.enum(DILIGENCE_CHECK_GROUPS),
  subjectName: safeText(10_000).min(1),
  checkName: safeText(10_000).min(1),
  // One returned check may contain four exact 10,000-digit court counters as JSON.
  adataValue: safeText(100_000).min(1).nullable(),
  mark: z.enum(DILIGENCE_MARKS),
  position: z.number().int().nonnegative(),
}).refine(row => (row.mark === 'no_answer') === (row.adataValue === null), { message: 'check_value_mark_mismatch' });
export type DiligenceCheckRead = z.infer<typeof diligenceCheckReadSchema>;
export const diligenceRecordReadSchema = z.strictObject({
  profileId: uuid,
  organizationId: uuid,
  checkedOn: z.iso.date(),
  adataResult: z.enum(DILIGENCE_RESULTS).nullable(),
  result: z.enum(DILIGENCE_RESULTS),
  comment: nullableText,
  reportFileId: uuid.nullable(),
  overriddenBy: uuid.nullable(),
  overriddenAt: diligenceTimestampSchema.nullable(),
  enhanced: z.enum(ENHANCED_DILIGENCE_STATES),
  enhancedComment: nullableText,
  enhancedReportFileId: uuid.nullable(),
  sourceSnapshotId: uuid.nullable(),
  updatedAt: diligenceTimestampSchema,
}).refine(row => (row.overriddenBy === null) === (row.overriddenAt === null), { message: 'override_actor_time_mismatch' });
export type DiligenceRecordRead = z.infer<typeof diligenceRecordReadSchema>;
export const diligenceLastRunReadSchema = z.strictObject({
  attemptId: uuid,
  snapshotId: uuid.nullable(),
  state: z.enum(DILIGENCE_RUN_STATES),
  requestedAt: diligenceTimestampSchema,
  completedAt: diligenceTimestampSchema.nullable(),
  isTestData: z.boolean(),
}).superRefine((row, ctx) => {
  if ((row.state === 'waiting') !== (row.completedAt === null))
    ctx.addIssue({ code: 'custom', message: 'run_state_time_mismatch' });
  if (row.state === 'waiting' && row.snapshotId !== null)
    ctx.addIssue({ code: 'custom', message: 'waiting_run_has_snapshot' });
});
export const diligenceReadSchema = z.strictObject({
  profileId: uuid,
  organizationId: uuid,
  record: diligenceRecordReadSchema.nullable(),
  checks: z.array(diligenceCheckReadSchema),
  lastRun: diligenceLastRunReadSchema.nullable(),
}).superRefine((data, ctx) => {
  if (data.record === null && data.checks.length) ctx.addIssue({ code: 'custom', message: 'checks_without_current_record' });
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
export const diligencePublicSummarySchema = z.strictObject({ checkedOn: z.iso.date().nullable(), enhancedDone: z.boolean() });
export type DiligencePublicSummary = z.infer<typeof diligencePublicSummarySchema>;
