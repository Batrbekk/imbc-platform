import { z } from 'zod';
import { profileFileSchema } from './profile-files.js';
import { PROFILE_STATUSES } from './enums.js';

export const SITE_SURVEY_RESULTS = ['yes', 'no'] as const;
export const SITE_SURVEY_SOURCES = ['migration', 'expert'] as const;
const uuid = z.uuid();
const day = z.iso.date().refine(value => Number(value.slice(0, 4)) > 0, { message: 'date_year' });
export const siteSurveyTimestampSchema = z.iso.datetime({ precision: 6 });
const comment = z.string().max(10_000).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value), { message: 'text_format' }).nullable();
const fields = {
  visitStartedOn: day,
  visitEndedOn: day.nullable(),
  result: z.enum(SITE_SURVEY_RESULTS),
  expiresOn: day.nullable(),
  comment,
};
const chronological = (value: { visitStartedOn: string; visitEndedOn: string | null }) =>
  value.visitEndedOn === null || value.visitStartedOn <= value.visitEndedOn;

/** A new expert record includes the signed report; source, actor and exact version are server facts. */
export const siteSurveyCreateSchema = z.strictObject({ ...fields, reportFileId: uuid })
  .refine(chronological, { message: 'visit_date_order' });
export type SiteSurveyCreate = z.infer<typeof siteSurveyCreateSchema>;

/** Nullable report supports existing unsigned migration records; the service checks the retained source. */
export const siteSurveyUpdateSchema = z.strictObject({
  ...fields,
  reportFileId: uuid.nullable(),
  expectedUpdatedAt: siteSurveyTimestampSchema,
}).refine(chronological, { message: 'visit_date_order' });
export type SiteSurveyUpdate = z.infer<typeof siteSurveyUpdateSchema>;

/** Historical unknown visit dates remain explicit during reconciliation; writes still require a real date. */
export const siteSurveyRecordReadSchema = z.strictObject({
  id: uuid, profileId: uuid, organizationId: uuid,
  visitStartedOn: day.nullable(), visitEndedOn: day.nullable(),
  result: z.enum(SITE_SURVEY_RESULTS),
  reportFileId: uuid.nullable(), reportFileVersionId: uuid.nullable(), reportFileVersionNumber: z.number().int().positive().nullable(),
  expiresOn: day.nullable(), comment,
  source: z.enum(SITE_SURVEY_SOURCES), recordedBy: uuid.nullable(),
  recordedAt: siteSurveyTimestampSchema, updatedAt: siteSurveyTimestampSchema,
  needsReconciliation: z.boolean(),
}).superRefine((row, ctx) => {
  if (row.visitStartedOn === null && !row.needsReconciliation)
    ctx.addIssue({ code: 'custom', message: 'unknown_visit_requires_reconciliation' });
  if (row.visitStartedOn !== null && row.visitEndedOn !== null && row.visitStartedOn > row.visitEndedOn)
    ctx.addIssue({ code: 'custom', message: 'visit_date_order' });
  const hasVersion = row.reportFileVersionId !== null;
  if (hasVersion !== (row.reportFileVersionNumber !== null)
    || hasVersion && row.reportFileId === null
    || !hasVersion && row.reportFileId !== null && !row.needsReconciliation)
    ctx.addIssue({ code: 'custom', message: 'report_version_pin_mismatch' });
});
export type SiteSurveyRecordRead = z.infer<typeof siteSurveyRecordReadSchema>;

/** Class C comment, result and author never enter this derived summary. */
export const siteSurveySummarySchema = z.strictObject({
  siteSurveyed: z.boolean(), siteSurveyedOn: day.nullable(), currentSurveyId: uuid.nullable(),
}).refine(row => row.siteSurveyed ? row.currentSurveyId !== null : row.currentSurveyId === null && row.siteSurveyedOn === null,
  { message: 'survey_summary_mismatch' });
export type SiteSurveySummary = z.infer<typeof siteSurveySummarySchema>;

/** The manufacturer asks for a survey of its verified profile, with no product and no notification. */
export const siteSurveyRequestInputSchema = z.strictObject({});

export const siteSurveyIdempotencyKeySchema = uuid;
const page = {
  offset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
  limit: z.coerce.number().int().positive().max(100).default(50),
};
export const siteSurveyListQuerySchema = z.strictObject(page);
export const siteSurveyHistoryQuerySchema = z.strictObject({
  beforeId: uuid.optional(), limit: z.coerce.number().int().positive().max(50).default(25),
});
export const siteSurveyRequestListQuerySchema = z.strictObject({
  ...page, name: z.string().max(200).optional(), profileId: uuid.optional(),
});

/** Metadata is resolved for this record's pin, including history; it never follows the global latest upload. */
export const siteSurveyRecordViewSchema = siteSurveyRecordReadSchema.safeExtend({
  report: profileFileSchema.nullable(), recordedByName: z.string().nullable(),
}).superRefine((row, ctx) => {
  if (row.reportFileId === null ? row.report !== null : row.report === null
    || row.report.fileId !== row.reportFileId || row.report.versionId !== row.reportFileVersionId
    || row.report.versionNumber !== row.reportFileVersionNumber)
    ctx.addIssue({ code: 'custom', path: ['report'], message: 'report_metadata_pin_mismatch' });
});
export type SiteSurveyRecordView = z.infer<typeof siteSurveyRecordViewSchema>;

export const siteSurveyListReadSchema = z.strictObject({
  profileId: uuid, organizationId: uuid, organizationName: z.string(), profileStatus: z.enum(PROFILE_STATUSES),
  tier: z.union([z.literal(1), z.literal(2)]).nullable(), summary: siteSurveySummarySchema,
  canEdit: z.boolean(), items: z.array(siteSurveyRecordViewSchema).max(100),
  total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), limit: z.number().int().positive().max(100),
});
export type SiteSurveyListRead = z.infer<typeof siteSurveyListReadSchema>;

export const SITE_SURVEY_ACTIONS = ['site_survey.created', 'site_survey.updated', 'site_survey.legacy_import'] as const;
export const siteSurveyHistoryEntrySchema = z.strictObject({
  id: uuid, at: siteSurveyTimestampSchema, action: z.enum(SITE_SURVEY_ACTIONS), actorName: z.string().nullable(),
  before: siteSurveyRecordViewSchema.nullable(), after: siteSurveyRecordViewSchema,
}).superRefine((entry, ctx) => {
  if (entry.before !== null && (entry.before.id !== entry.after.id || entry.before.profileId !== entry.after.profileId
    || entry.before.organizationId !== entry.after.organizationId))
    ctx.addIssue({ code: 'custom', message: 'history_record_scope_mismatch' });
  if ((entry.action === 'site_survey.updated') !== (entry.before !== null))
    ctx.addIssue({ code: 'custom', message: 'history_action_mismatch' });
});
export const siteSurveyHistorySchema = z.strictObject({
  items: z.array(siteSurveyHistoryEntrySchema).max(50), nextCursor: uuid.nullable(),
});
export type SiteSurveyHistory = z.infer<typeof siteSurveyHistorySchema>;
export type SiteSurveyHistoryEntry = z.infer<typeof siteSurveyHistoryEntrySchema>;

export const siteSurveyRequestReadSchema = z.strictObject({
  id: uuid, profileId: uuid, organizationId: uuid, organizationName: z.string(),
  requestedBy: uuid, requestedAt: siteSurveyTimestampSchema,
});
export type SiteSurveyRequestRead = z.infer<typeof siteSurveyRequestReadSchema>;
export const siteSurveyRequestListSchema = z.strictObject({
  items: z.array(siteSurveyRequestReadSchema).max(100), total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(), limit: z.number().int().positive().max(100),
});
export type SiteSurveyRequestList = z.infer<typeof siteSurveyRequestListSchema>;

/** OPR-10/GEN-13 company-page exception: only dates and a currently eligible signed report. */
export const siteSurveyCurrentReportSchema = z.strictObject({
  visitStartedOn: day, visitEndedOn: day.nullable(), expiresOn: day.nullable(), report: profileFileSchema,
}).superRefine((row, ctx) => {
  if (!row.report.canDownload || row.report.scanState !== 'passed' || row.report.versionId === null || row.report.versionNumber === null)
    ctx.addIssue({ code: 'custom', path: ['report'], message: 'report_not_current_signed_evidence' });
  if (!chronological(row)) ctx.addIssue({ code: 'custom', message: 'visit_date_order' });
});
export type SiteSurveyCurrentReport = z.infer<typeof siteSurveyCurrentReportSchema>;
