import { describe, expect, it } from 'vitest';
import { siteSurveyCreateSchema, siteSurveyUpdateSchema, siteSurveyRecordReadSchema, siteSurveySummarySchema, siteSurveyRequestInputSchema,
  siteSurveyRecordViewSchema, siteSurveyCurrentReportSchema, siteSurveyHistoryEntrySchema, siteSurveyIdempotencyKeySchema, siteSurveyListQuerySchema } from '../src/site-survey.js';

const id = '00000000-0000-4000-8000-000000000001';
const at = '2026-11-16T08:00:00.123456Z';
const write = { visitStartedOn: '2020-02-29', visitEndedOn: null, result: 'yes', expiresOn: null, comment: null, reportFileId: id };
describe('site survey canonical boundary', () => {
  it('retains historic dates and perpetual or explicitly past expiry without inventing a term', () => {
    expect(siteSurveyCreateSchema.parse(write).expiresOn).toBeNull();
    expect(siteSurveyCreateSchema.parse({ ...write, expiresOn: '2020-03-01' }).expiresOn).toBe('2020-03-01');
    expect(siteSurveyCreateSchema.safeParse({ ...write, visitEndedOn: '2020-02-28' }).success).toBe(false);
    expect(siteSurveyCreateSchema.safeParse({ ...write, visitStartedOn: '0000-01-01' }).success).toBe(false);
  });
  it('requires signed file for new expert records and rejects caller-owned actor/source/version fields', () => {
    expect(siteSurveyCreateSchema.safeParse({ ...write, reportFileId: null }).success).toBe(false);
    for (const field of ['source', 'recordedBy', 'profileId', 'reportFileVersionId', 'reportFileVersionNumber'])
      expect(siteSurveyCreateSchema.safeParse({ ...write, [field]: id }).success).toBe(false);
    expect(siteSurveyUpdateSchema.parse({ ...write, reportFileId: null, expectedUpdatedAt: at }).expectedUpdatedAt).toBe(at);
    expect(siteSurveyUpdateSchema.safeParse({ ...write, expectedUpdatedAt: at.replace('123456', '123') }).success).toBe(false);
  });
  it('keeps unresolved unknown dates explicit and captures complete exact report version metadata', () => {
    const record = { ...write, id, profileId: id, organizationId: id, source: 'migration', recordedBy: null,
      recordedAt: at, updatedAt: at, reportFileVersionId: id, reportFileVersionNumber: 7, needsReconciliation: false };
    expect(siteSurveyRecordReadSchema.parse(record).reportFileVersionNumber).toBe(7);
    expect(siteSurveyRecordReadSchema.safeParse({ ...record, reportFileVersionNumber: null }).success).toBe(false);
    expect(siteSurveyRecordReadSchema.safeParse({ ...record, visitStartedOn: null }).success).toBe(false);
    expect(siteSurveyRecordReadSchema.parse({ ...record, visitStartedOn: null, needsReconciliation: true }).visitStartedOn).toBeNull();
    expect(siteSurveyRecordReadSchema.safeParse({ ...record, source: 'manual' }).success).toBe(false);
  });
  it('allows only the derived public fields and a profile-only empty manufacturer request', () => {
    expect(siteSurveySummarySchema.parse({ siteSurveyed: true, siteSurveyedOn: null, currentSurveyId: id }).siteSurveyedOn).toBeNull();
    expect(siteSurveySummarySchema.safeParse({ siteSurveyed: false, siteSurveyedOn: '2020-02-29', currentSurveyId: id }).success).toBe(false);
    expect(siteSurveySummarySchema.safeParse({ siteSurveyed: true, siteSurveyedOn: '2020-02-29', currentSurveyId: id, comment: 'Private' }).success).toBe(false);
    expect(siteSurveyRequestInputSchema.parse({})).toEqual({});
    expect(siteSurveyRequestInputSchema.safeParse({ productId: id }).success).toBe(false);
  });
  it('retains an unresolved legacy report ID without fabricating a captured version', () => {
    const unresolved = { ...write, id, profileId: id, organizationId: id, source: 'migration', recordedBy: null,
      recordedAt: at, updatedAt: at, reportFileVersionId: null, reportFileVersionNumber: null, needsReconciliation: true };
    expect(siteSurveyRecordReadSchema.parse(unresolved).reportFileId).toBe(id);
    expect(siteSurveyRecordReadSchema.safeParse({ ...unresolved, needsReconciliation: false }).success).toBe(false);
    expect(siteSurveyRecordReadSchema.safeParse({ ...unresolved, reportFileVersionNumber: 1 }).success).toBe(false);
    expect(siteSurveyRecordReadSchema.safeParse({ ...unresolved, reportFileId: null, reportFileVersionId: id, reportFileVersionNumber: 1 }).success).toBe(false);
  });
  const report = { fileId: id, versionId: id, versionNumber: 7, originalName: 'signed.pdf', byteSize: 2048,
    mediaType: 'application/pdf', scanState: 'passed', rejectionReason: null, uploadedAt: at, canDownload: true };
  const view = { ...write, id, profileId: id, organizationId: id, source: 'expert', recordedBy: id, recordedByName: 'SME',
    recordedAt: at, updatedAt: at, reportFileVersionId: id, reportFileVersionNumber: 7, needsReconciliation: false, report };
  it('binds displayed metadata to its record pin and refuses another latest upload', () => {
    expect(siteSurveyRecordViewSchema.parse(view).report?.versionNumber).toBe(7);
    expect(siteSurveyRecordViewSchema.safeParse({ ...view, report: { ...report, versionNumber: 8 } }).success).toBe(false);
    expect(siteSurveyRecordViewSchema.safeParse({ ...view, report: null }).success).toBe(false);
  });
  it('projects only dates and currently signed report evidence for the company-page exception', () => {
    const projected = { visitStartedOn: write.visitStartedOn, visitEndedOn: null, expiresOn: null, report };
    expect(siteSurveyCurrentReportSchema.parse(projected).report.versionNumber).toBe(7);
    for (const key of ['comment', 'result', 'recordedBy', 'source', 'history'])
      expect(siteSurveyCurrentReportSchema.safeParse({ ...projected, [key]: 'private' }).success).toBe(false);
    for (const changed of [{ ...report, canDownload: false }, { ...report, scanState: 'pending' }, { ...report, versionNumber: null }])
      expect(siteSurveyCurrentReportSchema.safeParse({ ...projected, report: changed }).success).toBe(false);
  });
  it('rejects mismatched history scope/action and bounds request retry/page identities', () => {
    const history = { id, at, action: 'site_survey.updated', actorName: 'SME', before: view, after: view };
    expect(siteSurveyHistoryEntrySchema.parse(history).after.id).toBe(id);
    expect(siteSurveyHistoryEntrySchema.safeParse({ ...history, action: 'site_survey.created' }).success).toBe(false);
    expect(siteSurveyHistoryEntrySchema.safeParse({ ...history, after: { ...view, profileId: '00000000-0000-4000-8000-000000000002' } }).success).toBe(false);
    expect(siteSurveyIdempotencyKeySchema.parse(id)).toBe(id);
    expect(siteSurveyIdempotencyKeySchema.safeParse('request@external.test').success).toBe(false);
    expect(siteSurveyListQuerySchema.safeParse({ offset: '2147483648' }).success).toBe(false);
  });
});
