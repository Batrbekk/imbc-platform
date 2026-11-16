import { siteSurveySummarySchema, type SiteSurveyRecordRead, type SiteSurveySummary } from '@imbc/contracts';
import { z } from 'zod';

/** A server-resolved exact version, never an upload candidate or metadata supplied by the client. */
export interface SurveyReportEvidence {
  id: string;
  fileObjectId: string;
  versionNumber: number;
  organizationId: string | null;
  purpose: string;
  dataClass: string;
  scanState: string;
  purgeRequested: boolean;
}

/** IMBC-02: any eligible record is enough; a newer expired/unsigned/no record cannot cancel an older valid one. */
export function selectEffectiveSurvey(
  scope: { profileId: string; organizationId: string },
  records: readonly SiteSurveyRecordRead[],
  reports: readonly SurveyReportEvidence[],
  asOfAlmatyDate: string,
): SiteSurveySummary {
  return effectiveSurveyState(scope, records, reports, asOfAlmatyDate).summary;
}

/** NOT11 expiry follows all qualifying evidence; a selected newer visit can expire before an older valid one. */
export function effectiveSurveyState(
  scope: { profileId: string; organizationId: string },
  records: readonly SiteSurveyRecordRead[],
  reports: readonly SurveyReportEvidence[],
  asOfAlmatyDate: string,
): { summary: SiteSurveySummary; effectiveUntil: string | null; nextRefreshOn: string | null } {
  z.iso.date().parse(asOfAlmatyDate);
  const versions = new Map(reports.map(report => [report.id, report]));
  const eligible = records.filter(record => {
    if (record.profileId !== scope.profileId || record.organizationId !== scope.organizationId || record.result !== 'yes'
      || record.needsReconciliation || record.visitStartedOn === null
      || record.expiresOn !== null && record.expiresOn <= asOfAlmatyDate || record.reportFileVersionId === null) return false;
    const report = versions.get(record.reportFileVersionId);
    return !!report && report.fileObjectId === record.reportFileId && report.versionNumber === record.reportFileVersionNumber
      && report.organizationId === scope.organizationId && report.purpose === 'site_survey_report'
      && report.dataClass === 'c_imbc' && report.scanState === 'passed' && !report.purgeRequested;
  }).sort((a, b) => (b.visitStartedOn ?? '').localeCompare(a.visitStartedOn ?? '')
    || b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id));
  const selected = eligible[0];
  return {
    summary: siteSurveySummarySchema.parse(selected
      ? { siteSurveyed: true, siteSurveyedOn: selected.visitStartedOn, currentSurveyId: selected.id }
      : { siteSurveyed: false, siteSurveyedOn: null, currentSurveyId: null }),
    effectiveUntil: !selected || eligible.some(record => record.expiresOn === null)
      ? null : eligible.reduce((latest, record) => record.expiresOn! > latest ? record.expiresOn! : latest, ''),
    nextRefreshOn: eligible.flatMap(record => record.expiresOn ? [record.expiresOn] : []).sort()[0] ?? null,
  };
}

/** IMBC-19/20: verification is tier 1; the survey mark makes tier 2. Visibility is a separate DD rule. */
export function profileSurveyTier(verified: boolean, surveyed: boolean): 1 | 2 | null {
  return verified ? surveyed ? 2 : 1 : null;
}
