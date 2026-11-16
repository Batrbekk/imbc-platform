import { profileFileSchema, unavailableProfileFile, type FilePurpose, type ProfileFile } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import { isUuid, notFound } from '../../common/actor-transaction.js';
import type { Database } from '../../database/database.module.js';
import { revisionOwnedFiles } from '../files/file-owner.js';
import { sectionFieldError } from './section-errors.js';
import type { SectionContext } from './section-handler.js';

type FileBinding = { fileId: string; purposes: readonly FilePurpose[]; path: string };

/** DATA-05/07: persisted own-file bindings, before any content writes; scan state does not forbid a partial draft. */
export async function validateProfileFileBindings(
  tx: Database,
  context: SectionContext,
  bindings: readonly FileBinding[],
): Promise<void> {
  for (const binding of bindings)
    if (!isUuid(binding.fileId)) throw sectionFieldError(binding.path, 'file_invalid');
  const ids = [...new Set(bindings.map((binding) => binding.fileId))].sort();
  if (ids.length === 0) return;
  const { rows } = await tx.execute<{ id: string; purpose: FilePurpose; dataClass: string; purgeRequestedAt: Date | string | null }>(sql`
    select id, purpose, data_class as "dataClass", purge_requested_at as "purgeRequestedAt" from file_object
    where organization_id = ${context.organizationId} and id = any(${sql.param(ids)}::uuid[])
    order by id for share`);
  const files = new Map(rows.map((file) => [file.id, file]));
  for (const binding of bindings) {
    const file = files.get(binding.fileId);
    if (!file || file.purgeRequestedAt !== null || file.dataClass !== 'b_manufacturer' || !binding.purposes.includes(file.purpose))
      throw sectionFieldError(binding.path, 'file_invalid');
  }
}

type FileRow = {
  fileId: string;
  versionId: string | null;
  versionNumber: number | null;
  originalName: string | null;
  byteSize: string | number | null;
  mediaType: string | null;
  scanState: 'pending' | 'passed' | 'rejected' | null;
  rejectionReason: ProfileFile['rejectionReason'];
  uploadedAt: Date | string | null;
};

/**
 * One tenant-checked query preserves caller order without one query per file. Working revisions use latest;
 * submitted/verified/rejected revisions use only their captured version. No source storage key is exposed.
 */
export async function profileFiles(
  tx: Database,
  context: SectionContext,
  ids: readonly string[],
): Promise<ProfileFile[]> {
  if (ids.length === 0) return [];
  if (![context.profileId, context.sectionId, context.revisionId, context.organizationId, ...ids].every(isUuid))
    throw notFound();
  const owners = await revisionOwnedFiles(tx, context.revisionId, context.organizationId);
  const validIds = new Set(owners.filter((owner) => owner.valid).map((owner) => owner.fileObjectId));
  const requestedIds = [...new Set(ids)].filter((id) => validIds.has(id));
  if (requestedIds.length === 0) return ids.map(unavailableProfileFile);
  const { rows } = await tx.execute<FileRow>(sql`
    select f.id as "fileId", v.id as "versionId", v.version_number as "versionNumber",
           v.original_name as "originalName", v.byte_size as "byteSize",
           coalesce(v.detected_media_type, v.declared_media_type) as "mediaType",
           v.scan_state as "scanState", v.rejection_reason as "rejectionReason", v.uploaded_at as "uploadedAt"
    from section_revision r
    join profile_section s on s.id = r.profile_section_id and s.organization_id = r.organization_id
    join manufacturer_profile p on p.id = s.profile_id and p.organization_id = s.organization_id
    join file_object f on f.organization_id = r.organization_id and f.data_class = 'b_manufacturer' and f.purge_requested_at is null
                     and f.id = any(${sql.param(requestedIds)}::uuid[])
    left join revision_file_version snap on snap.section_revision_id = r.id
      and snap.organization_id = r.organization_id and snap.file_object_id = f.id
    left join lateral (
      select fv.* from file_version fv where fv.file_object_id = f.id
        and ((r.state = 'working' and r.submitted_at is null) or fv.id = snap.file_version_id)
      order by fv.version_number desc limit 1
    ) v on true
    where r.id = ${context.revisionId} and r.organization_id = ${context.organizationId}
      and s.id = ${context.sectionId} and p.id = ${context.profileId}`);
  const found = new Map(rows.map((row) => [row.fileId, profileFileSchema.parse({
    ...row,
    byteSize: row.byteSize === null ? null : Number(row.byteSize),
    uploadedAt: row.uploadedAt === null ? null : new Date(row.uploadedAt).toISOString(),
    canDownload: row.versionId !== null && row.scanState === 'passed',
  })]));
  return ids.map((id) => found.get(id) ?? unavailableProfileFile(id));
}

export const profileFileComplete = (file: ProfileFile): boolean => file.canDownload;
