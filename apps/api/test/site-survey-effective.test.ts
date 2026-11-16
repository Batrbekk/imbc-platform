import { describe, expect, it } from 'vitest';
import type { SiteSurveyRecordRead } from '@imbc/contracts';
import { effectiveSurveyState, profileSurveyTier, selectEffectiveSurvey, type SurveyReportEvidence } from '../src/modules/site-survey/effective-survey.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { profileId: id(1), organizationId: id(2) };
const at = '2026-11-16T08:00:00.123456Z';
const record: SiteSurveyRecordRead = { ...scope, id: id(3), visitStartedOn: '2020-02-29', visitEndedOn: null,
  result: 'yes', reportFileId: id(4), reportFileVersionId: id(5), reportFileVersionNumber: 1, expiresOn: null,
  comment: null, source: 'expert', recordedBy: id(6), recordedAt: at, updatedAt: at, needsReconciliation: false };
const report: SurveyReportEvidence = { id: id(5), fileObjectId: id(4), versionNumber: 1, organizationId: id(2),
  purpose: 'site_survey_report', dataClass: 'c_imbc', scanState: 'passed', purgeRequested: false };
const select = (records: SiteSurveyRecordRead[], reports: SurveyReportEvidence[] = [report], day = '2026-11-16') => selectEffectiveSurvey(scope, records, reports, day);
describe('IMBC-02 effective survey and tier', () => {
  it('keeps a signed no-expiry historical survey valid even decades later', () => {
    expect(select([record], [report], '2040-01-01')).toEqual({ siteSurveyed: true, siteSurveyedOn: '2020-02-29', currentSurveyId: id(3) });
  });
  it('expires on the specified Almaty date, without automatic one/two-year terms', () => {
    const expiring = { ...record, expiresOn: '2026-11-16' };
    expect(select([expiring], [report], '2026-11-15').siteSurveyed).toBe(true);
    expect(select([expiring]).siteSurveyed).toBe(false);
    expect(select([expiring], [report], '2026-11-17').siteSurveyed).toBe(false);
  });
  it('retains an older eligible record when newer records are expired, unsigned or no', () => {
    const newer = { ...record, id: id(7), visitStartedOn: '2026-11-15' };
    expect(select([{ ...newer, expiresOn: '2026-11-16' }, { ...newer, id: id(8), result: 'no' }, record]).currentSurveyId).toBe(record.id);
    expect(select([{ ...newer, reportFileId: null, reportFileVersionId: null, reportFileVersionNumber: null }, record]).currentSurveyId).toBe(record.id);
    expect(select([record, newer]).currentSurveyId).toBe(newer.id);
  });
  it('requires the exact clean signed version and tenant/purpose/class ownership', () => {
    for (const changed of [{ ...report, id: id(9) }, { ...report, fileObjectId: id(9) }, { ...report, versionNumber: 2 },
      { ...report, organizationId: id(9) }, { ...report, purpose: 'due_diligence_report' }, { ...report, dataClass: 'b_manufacturer' },
      { ...report, scanState: 'pending' }, { ...report, scanState: 'rejected' }, { ...report, purgeRequested: true }])
      expect(select([record], [changed]).siteSurveyed).toBe(false);
    expect(select([{ ...record, profileId: id(9) }]).siteSurveyed).toBe(false);
    expect(select([{ ...record, organizationId: id(9) }]).siteSurveyed).toBe(false);
    expect(select([record], [report, { ...report, id: id(9), versionNumber: 2, scanState: 'rejected' }]).siteSurveyed).toBe(true);
  });
  it('preserves unknown migration dates and has no tier before verification or company-wide tier 3', () => {
    expect(select([{ ...record, source: 'migration', visitStartedOn: null, needsReconciliation: true }]))
      .toEqual({ siteSurveyed: false, siteSurveyedOn: null, currentSurveyId: null });
    expect(select([{ ...record, source: 'migration', needsReconciliation: true }]).siteSurveyed).toBe(false);
    expect(profileSurveyTier(false, true)).toBeNull();
    expect(profileSurveyTier(true, false)).toBe(1);
    expect(profileSurveyTier(true, true)).toBe(2);
  });
  it('does not treat a retained legacy file ID as proof of a signed captured version', () => {
    expect(select([{ ...record, source: 'migration', reportFileVersionId: null, reportFileVersionNumber: null, needsReconciliation: true }]).siteSurveyed).toBe(false);
  });
  it('schedules the last eligible expiry while retaining the most recent signed visit as the current report', () => {
    const older = { ...record, expiresOn: '2028-01-01' };
    const recent = { ...record, id: id(7), visitStartedOn: '2026-11-15', expiresOn: '2027-01-01' };
    expect(effectiveSurveyState(scope, [older, recent], [report], '2026-11-16'))
      .toEqual({ summary: { siteSurveyed: true, siteSurveyedOn: recent.visitStartedOn, currentSurveyId: recent.id }, effectiveUntil: older.expiresOn, nextRefreshOn: recent.expiresOn });
    expect(effectiveSurveyState(scope, [record, recent], [report], '2026-11-16').effectiveUntil).toBeNull();
    const afterRecentExpiry = effectiveSurveyState(scope, [older, recent], [report], '2027-01-01');
    expect(afterRecentExpiry.summary.currentSurveyId).toBe(older.id);
    expect(afterRecentExpiry.effectiveUntil).toBe(older.expiresOn);
    expect(effectiveSurveyState(scope, [older, recent], [report], '2028-01-01'))
      .toEqual({ summary: { siteSurveyed: false, siteSurveyedOn: null, currentSurveyId: null }, effectiveUntil: null, nextRefreshOn: null });
  });
});
