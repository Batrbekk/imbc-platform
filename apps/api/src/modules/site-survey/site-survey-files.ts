import { sql } from 'drizzle-orm';
import { policyForTransaction } from '../../common/policy.js';
import type { FileReadRule } from '../files/file-access.js';
import { readCurrentCompanySurvey } from './site-survey-company.js';

/** GEN-09/13: staff sees exact current/history pins; operator/observer only today's company-page report. */
export const siteSurveyReportReadRule: FileReadRule = async ({ tx, auth, file }) => {
  if (file.organizationId === null || file.purpose !== 'site_survey_report' || file.dataClass !== 'c_imbc')
    return { allowed: false };
  const actor = (await tx.execute<{ role: typeof auth.user.role; organizationId: string; type: string }>(sql`
    select a.role,a.organization_id as "organizationId",o.type from user_accounts a join organizations o on o.id=a.organization_id
    where a.id=${auth.user.id} and a.state='active'`)).rows[0];
  if (!actor || actor.role !== auth.user.role || actor.organizationId !== auth.user.organizationId) return { allowed: false };
  const policy = await policyForTransaction(tx);
  if (['expert','director'].includes(actor.role) && actor.type === 'imbc'
    && policy.can(actor.role, 'imbc_records.read', 'c_imbc') === 'all') {
    const versions = (await tx.execute<{ id: string }>(sql`
      select v.id from file_version v where v.file_object_id=${file.id} and v.scan_state='passed' and (
        exists(select 1 from site_survey_record r where r.organization_id=${file.organizationId}
          and r.file_object_id=${file.id} and r.file_version_id=v.id)
        or exists(select 1 from site_survey_operation op where op.organization_id=${file.organizationId}
          and ((op.before_file_object_id=${file.id} and op.before_file_version_id=v.id)
            or (op.after_file_object_id=${file.id} and op.after_file_version_id=v.id)))) order by v.id`)).rows;
    return versions.length ? { allowed: true, versions: versions.map(v => v.id) } : { allowed: false };
  }
  if (!['operator','observer'].includes(actor.role) || actor.type !== actor.role
    || policy.can(actor.role, 'catalog.search') !== 'visible') return { allowed: false };
  const profiles = (await tx.execute<{ profileId: string }>(sql`
    select id as "profileId" from manufacturer_profile where organization_id=${file.organizationId}`)).rows;
  if (profiles.length !== 1) return { allowed: false };
  const current = await readCurrentCompanySurvey(tx, { profileId: profiles[0]!.profileId, organizationId: file.organizationId });
  return current?.report.fileId === file.id && current.report.versionId !== null
    ? { allowed: true, versions: [current.report.versionId] } : { allowed: false };
};
