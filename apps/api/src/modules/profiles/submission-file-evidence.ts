import { sql } from 'drizzle-orm';
import { ProblemException } from '../../common/problem.js';
import type { Database } from '../../database/database.module.js';
import { revisionOwnedFiles } from '../files/file-owner.js';
import type { SectionContext } from './section-handler.js';

const unavailable = () =>
  new ProblemException(409, 'submission_file_unavailable', 'Файл этой отправки недоступен или не прошёл проверку.');

/**
 * Reused frozen sections keep their original evidence. No latest-version lookup, timestamp guess or
 * retrospective capture is allowed, including for optional CVs, extracts and shared equipment photos.
 */
export async function validateFrozenSubmissionFiles(tx: Database, context: SectionContext): Promise<void> {
  const { rows: revisions } = await tx.execute<{ state: string; submittedAt: Date | string | null }>(sql`
    select r.state,r.submitted_at as "submittedAt" from section_revision r
    join profile_section s on s.id=r.profile_section_id and s.organization_id=r.organization_id
    where r.id=${context.revisionId} and r.organization_id=${context.organizationId}
      and s.id=${context.sectionId} and s.profile_id=${context.profileId} for share of r`);
  if (
    revisions.length !== 1 ||
    !['submitted', 'verified', 'rejected'].includes(revisions[0]!.state) ||
    revisions[0]!.submittedAt === null
  )
    throw unavailable();
  const owned = await revisionOwnedFiles(tx, context.revisionId, context.organizationId);
  if (owned.some((file) => !file.valid)) throw unavailable();
  const ids = [...new Set(owned.map((file) => file.fileObjectId))].sort();
  if (ids.length) {
    const { rows: objects } = await tx.execute<{ id: string }>(sql`select id from file_object
      where id=any(${sql.param(ids)}::uuid[]) and organization_id=${context.organizationId}
        and data_class='b_manufacturer' and purge_requested_at is null order by id for share`);
    if (objects.length !== ids.length) throw unavailable();
  }
  // Separate statement after object locks: a purge/scan change committed while waiting is visible.
  const { rows: captured } = await tx.execute<{ fileId: string; state: string }>(sql`
    select snap.file_object_id as "fileId",v.scan_state as state from revision_file_version snap
    join file_version v on v.id=snap.file_version_id and v.file_object_id=snap.file_object_id
    where snap.section_revision_id=${context.revisionId} and snap.organization_id=${context.organizationId}
    order by snap.file_object_id for share of v`);
  if (
    captured.length !== ids.length ||
    captured.some((file, index) => file.fileId !== ids[index] || file.state !== 'passed')
  )
    throw unavailable();
}
