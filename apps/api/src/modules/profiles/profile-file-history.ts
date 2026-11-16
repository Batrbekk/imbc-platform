import { profileFileHistorySchema, type ProfileFileHistory } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { profileFileHistory } from '../../database/schema/index.js';
import { revisionOwnedFiles } from '../files/file-owner.js';
import { profileFiles } from './profile-files.js';
import type { SectionContext } from './section-handler.js';

/** Same save transaction: lock objects before choosing exact versions; capture before deleting old bindings. */
export async function retainProfileFiles(
  tx: Database, context: SectionContext, editVersion: number, actorId: string,
): Promise<void> {
  const owned = await revisionOwnedFiles(tx, context.revisionId, context.organizationId);
  const ids = [...new Set(owned.filter((item) => item.valid).map((item) => item.fileObjectId))].sort();
  if (ids.length === 0) return;
  await tx.execute(sql`select id from file_object where organization_id=${context.organizationId}
    and id=any(${sql.param(ids)}::uuid[]) order by id for share`);
  // Separate statement after the object locks, including exact capture-only resolution for frozen before-state.
  const files = await profileFiles(tx, context, ids);
  const rows = files.filter((file) => file.versionId !== null).map((file) => ({
    sectionRevisionId: context.revisionId, organizationId: context.organizationId, editVersion,
    fileObjectId: file.fileId, fileVersionId: file.versionId!, actorId,
  }));
  for (let i = 0; i < rows.length; i += 1000)
    await tx.insert(profileFileHistory).values(rows.slice(i, i + 1000)).onConflictDoNothing();
}

/** Caller has checked the active manufacturer and selected its own section; history does not grant other roles. */
export async function readProfileFileHistory(
  tx: Database, input: { profileId: string; sectionId: string; organizationId: string; offset: number; limit: number },
): Promise<ProfileFileHistory> {
  const scope = sql`from profile_file_history h
    join section_revision r on r.id=h.section_revision_id and r.organization_id=h.organization_id
    join profile_section s on s.id=r.profile_section_id and s.organization_id=r.organization_id
    join manufacturer_profile p on p.id=s.profile_id and p.organization_id=s.organization_id
    join file_object f on f.id=h.file_object_id and f.organization_id=h.organization_id
    join file_version v on v.id=h.file_version_id and v.file_object_id=f.id
    where p.id=${input.profileId} and s.id=${input.sectionId} and h.organization_id=${input.organizationId}`;
  const { rows: totals } = await tx.execute<{ total: string }>(sql`select count(*) as total ${scope}`);
  const { rows } = await tx.execute<{
    id: string; revisionId: string; editVersion: number; recordedAt: Date | string;
    fileId: string; versionId: string; versionNumber: number; originalName: string;
    byteSize: string | number; mediaType: string; scanState: string; rejectionReason: string | null;
    uploadedAt: Date | string;
  }>(sql`select h.id, h.section_revision_id as "revisionId", h.edit_version as "editVersion",
    h.recorded_at as "recordedAt", f.id as "fileId", v.id as "versionId", v.version_number as "versionNumber",
    v.original_name as "originalName", v.byte_size as "byteSize",
    coalesce(v.detected_media_type,v.declared_media_type) as "mediaType", v.scan_state as "scanState",
    v.rejection_reason as "rejectionReason", v.uploaded_at as "uploadedAt"
    ${scope} order by h.recorded_at desc, h.id desc limit ${input.limit} offset ${input.offset}`);
  return profileFileHistorySchema.parse({
    items: rows.map(({ id, revisionId, editVersion, recordedAt, ...file }) => ({
      id, revisionId, editVersion, recordedAt: new Date(recordedAt).toISOString(),
      file: { ...file, byteSize: Number(file.byteSize), uploadedAt: new Date(file.uploadedAt).toISOString(),
        canDownload: file.scanState === 'passed' },
    })), total: Number(totals[0]?.total ?? 0), offset: input.offset, limit: input.limit,
  });
}
