import { sql } from 'drizzle-orm';
import { isUuid, notFound } from '../../common/actor-transaction.js';
import { ProblemException } from '../../common/problem.js';
import type { Database } from '../../database/database.module.js';
import { revisionOwnedFiles } from './file-owner.js';

export type CapturedFileVersion = {
  fileObjectId: string;
  fileVersionId: string;
  versionNumber: number;
};

/**
 * DATA-07 / future 3в submission boundary, not an HTTP submit action.
 * The caller checks actor/section permissions and submission requirements, and locks profile/section first;
 * call only inside that transaction, then freeze the revision and clear/replace the working pointer before commit.
 * Revision lock prevents a concurrent save changing its references.
 * Sorted file_object locks serialize with FilesService.recordVersion. Read latest versions in a SEPARATE
 * statement after the locks: a replacement that committed while we waited must be seen under READ COMMITTED.
 * Only an already passed latest version is captured; a later scan can never become frozen evidence by timestamp.
 */
export async function captureRevisionFileVersions(
  tx: Database,
  input: { sectionRevisionId: string; organizationId: string },
): Promise<CapturedFileVersion[]> {
  if (!isUuid(input.sectionRevisionId) || !isUuid(input.organizationId)) throw notFound();
  const { rows: revisions } = await tx.execute<{ state: string; submittedAt: Date | null }>(sql`
    select r.state, r.submitted_at as "submittedAt" from section_revision r
    join profile_section s on s.id = r.profile_section_id and s.organization_id = r.organization_id
    join manufacturer_profile p on p.id = s.profile_id and p.organization_id = s.organization_id
    where r.id = ${input.sectionRevisionId} and r.organization_id = ${input.organizationId}
    for update of r`);
  const revision = revisions[0];
  if (!revision) throw notFound();
  if (revision.state !== 'working' || revision.submittedAt !== null)
    throw new ProblemException(409, 'profile_locked', 'Редакция уже отправлена на проверку');

  const owned = await revisionOwnedFiles(tx, input.sectionRevisionId, input.organizationId);
  if (owned.some((file) => !file.valid))
    throw new ProblemException(400, 'validation', 'Файл не соответствует записи-владельцу');
  const fileIds = [...new Set(owned.map((file) => file.fileObjectId))].sort();
  let captured: CapturedFileVersion[] = [];
  if (fileIds.length > 0) {
    const { rows: objects } = await tx.execute<{ id: string }>(sql`
      select id from file_object where id = any(${sql.param(fileIds)}::uuid[]) and organization_id = ${input.organizationId}
        and purge_requested_at is null
      order by id for update`);
    if (objects.length !== fileIds.length) throw notFound();
    const { rows: versions } = await tx.execute<CapturedFileVersion & { scanState: string }>(sql`
      select v.file_object_id as "fileObjectId", v.id as "fileVersionId",
             v.version_number as "versionNumber", v.scan_state as "scanState"
      from file_version v where v.file_object_id = any(${sql.param(fileIds)}::uuid[])
        and v.version_number = (select max(latest.version_number) from file_version latest
                               where latest.file_object_id = v.file_object_id)
      order by v.file_object_id for share of v`);
    if (versions.length !== fileIds.length) throw notFound();
    for (const version of versions) {
      if (version.scanState === 'pending')
        throw new ProblemException(409, 'file_pending_scan', 'Файл ещё проверяется на вредоносное содержимое');
      if (version.scanState !== 'passed')
        throw new ProblemException(409, 'file_rejected', 'Файл не прошёл проверку на вредоносное содержимое');
    }
    captured = versions.map(({ fileObjectId, fileVersionId, versionNumber }) => ({
      fileObjectId,
      fileVersionId,
      versionNumber,
    }));
  }

  // Retry while working refreshes the technical draft snapshot; frozen rows cannot be modified by DB triggers.
  await tx.execute(sql`delete from revision_file_version where section_revision_id = ${input.sectionRevisionId}
                       and organization_id = ${input.organizationId}`);
  for (let i = 0; i < captured.length; i += 1000) {
    const values = captured.slice(i, i + 1000).map(
      (version) => sql`(${input.sectionRevisionId}, ${version.fileObjectId},
      ${version.fileVersionId}, ${input.organizationId})`,
    );
    await tx.execute(sql`insert into revision_file_version
      (section_revision_id, file_object_id, file_version_id, organization_id) values ${sql.join(values, sql`, `)}`);
  }
  return captured;
}

/**
 * Resolve an exact frozen-section file version for its DTO, after the caller's section authorization (GEN-09).
 * No snapshot or no matching owner means no file; there is deliberately no global-latest/timestamp fallback.
 * FilesService still checks this explicit version's scan state when content is requested.
 */
export async function frozenRevisionFileVersion(
  tx: Database,
  input: { sectionRevisionId: string; organizationId: string; fileObjectId: string },
): Promise<CapturedFileVersion | null> {
  if (![input.sectionRevisionId, input.organizationId, input.fileObjectId].every(isUuid)) return null;
  const { rows } = await tx.execute<CapturedFileVersion>(sql`
    select s.file_object_id as "fileObjectId", s.file_version_id as "fileVersionId",
           v.version_number as "versionNumber"
    from revision_file_version s
    join section_revision r on r.id = s.section_revision_id and r.organization_id = s.organization_id
    join file_version v on v.id = s.file_version_id and v.file_object_id = s.file_object_id
    where s.section_revision_id = ${input.sectionRevisionId} and s.organization_id = ${input.organizationId}
      and s.file_object_id = ${input.fileObjectId} and (r.state <> 'working' or r.submitted_at is not null)`);
  if (!rows[0]) return null;
  const owned = await revisionOwnedFiles(tx, input.sectionRevisionId, input.organizationId);
  return owned.some((file) => file.fileObjectId === input.fileObjectId && file.valid) ? rows[0] : null;
}
