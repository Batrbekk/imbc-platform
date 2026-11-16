import { sql } from 'drizzle-orm';
import { ProblemException } from '../../common/problem.js';
import { policyForTransaction } from '../../common/policy.js';
import type { Database } from '../../database/database.module.js';
import type { FileReadRule } from '../files/file-access.js';

type ReportPurpose = 'due_diligence_report' | 'enhanced_due_diligence_report';
/** Sorted caller/profile locks precede a file-object SHARE lock, serialising capture with version replacement. */
export async function captureDiligenceReport(
  tx: Database,
  input: {
    organizationId: string;
    fileId: string | null;
    purpose: ReportPurpose;
  },
): Promise<string | null> {
  if (input.fileId === null) return null;
  const object = (
    await tx.execute<{ id: string }>(sql`select id from file_object
    where id=${input.fileId} and organization_id=${input.organizationId} and purpose=${input.purpose}::file_purpose
      and data_class='c_imbc' and purge_requested_at is null for share`)
  ).rows[0];
  if (!object) throw new ProblemException(400, 'validation', 'Отчёт не соответствует записи-владельцу');
  // Separate statement sees a replacement that committed while the object lock was being acquired.
  const version = (
    await tx.execute<{ id: string; scanState: string }>(sql`
    select id,scan_state as "scanState" from file_version where file_object_id=${input.fileId}
      order by version_number desc limit 1 for share`)
  ).rows[0];
  if (!version || version.scanState !== 'passed')
    throw new ProblemException(400, 'validation', 'Отчёт ещё не прошёл проверку файла');
  return version.id;
}

/** Class C file access follows an actual current or reconstructable historical DD owner, never the upload ID. */
export const diligenceReportReadRule: FileReadRule = async ({ tx, auth, file }) => {
  if (
    file.organizationId === null ||
    file.dataClass !== 'c_imbc' ||
    !['due_diligence_report', 'enhanced_due_diligence_report'].includes(file.purpose)
  )
    return { allowed: false };
  const actor = (
    await tx.execute<{ role: 'expert' | 'director'; organizationId: string }>(sql`
    select a.role,a.organization_id as "organizationId" from user_accounts a join organizations o on o.id=a.organization_id
    where a.id=${auth.user.id} and a.state='active' and a.role in ('expert','director') and o.type='imbc'`)
  ).rows[0];
  if (
    !actor ||
    actor.role !== auth.user.role ||
    actor.organizationId !== auth.user.organizationId ||
    (await policyForTransaction(tx)).can(actor.role, 'imbc_records.read', 'c_imbc') !== 'all'
  )
    return { allowed: false };
  const objectKey = file.purpose === 'due_diligence_report' ? 'report_file_id' : 'enhanced_report_file_id';
  const versionKey =
    file.purpose === 'due_diligence_report' ? 'report_file_version_id' : 'enhanced_report_file_version_id';
  const versions = (
    await tx.execute<{ id: string }>(sql`
    select distinct v.id from file_version v where v.file_object_id=${file.id} and v.scan_state='passed' and (
      exists(select 1 from due_diligence_record r where r.organization_id=${file.organizationId}
        and to_jsonb(r)->>${objectKey}=${file.id} and to_jsonb(r)->>${versionKey}=v.id::text)
      or exists(select 1 from diligence_operation op join audit_entries a on a.id=op.audit_entry_id
        where op.organization_id=${file.organizationId} and a.organization_id=op.organization_id and a.object_id=op.profile_id::text
          and a.object_type='due_diligence' and a.outcome='ok' and (
            (a.diff#>>${sql.param(['before', 'record', objectKey])}::text[]=${file.id} and a.diff#>>${sql.param(['before', 'record', versionKey])}::text[]=v.id::text)
            or (a.diff#>>${sql.param(['after', 'record', objectKey])}::text[]=${file.id} and a.diff#>>${sql.param(['after', 'record', versionKey])}::text[]=v.id::text)))
    ) order by v.id`)
  ).rows;
  return versions.length ? { allowed: true, versions: versions.map((v) => v.id) } : { allowed: false };
};
