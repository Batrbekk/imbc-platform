import { PROFILE_UPLOAD_PURPOSES } from '@imbc/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { fileObject, fileVersion } from '../../database/schema/index.js';

/** Unused candidate retention; saved owners, revision snapshots and any file history are permanent references. */
export const UNUSED_PROFILE_UPLOAD_TTL_MS = 30 * 24 * 60 * 60_000;
export const CLEANUP_UPLOAD_PURPOSES = Object.values(PROFILE_UPLOAD_PURPOSES).flat();
export type FilePurgeClaim = {
  fileObjectId: string;
  organizationId: string | null;
  versions: { id: string; storageKey: string }[];
};

/** PostgreSQL knows every direct/composite/version-number FK, including future review and legacy tables. */
export async function fileHasReferences(tx: Database, fileObjectId: string): Promise<boolean> {
  const { rows } = await tx.execute<{ referenced: boolean }>(
    sql`select public.file_has_references(${fileObjectId}::uuid) as referenced`,
  );
  return rows[0]?.referenced !== false;
}

/** Parent UPDATE lock precedes fresh age/state/owner checks; binding guards take SHARE on this same parent. */
export async function claimUnusedProfileUpload(
  tx: Database,
  fileObjectId: string,
  now: Date,
): Promise<FilePurgeClaim | null> {
  const [object] = await tx.select().from(fileObject).where(eq(fileObject.id, fileObjectId)).for('update');
  if (
    !object ||
    object.dataClass !== 'b_manufacturer' ||
    !(CLEANUP_UPLOAD_PURPOSES as readonly string[]).includes(object.purpose)
  )
    return null;
  const versions = await tx
    .select({
      id: fileVersion.id,
      storageKey: fileVersion.storageKey,
      state: fileVersion.scanState,
      uploadedAt: fileVersion.uploadedAt,
    })
    .from(fileVersion)
    .where(eq(fileVersion.fileObjectId, object.id))
    .orderBy(asc(fileVersion.versionNumber));
  if (versions.some((version) => version.state === 'pending')) return null;
  if (await fileHasReferences(tx, object.id)) return null;
  const latestUpload =
    versions.length > 0
      ? Math.max(...versions.map((version) => version.uploadedAt.getTime()))
      : object.createdAt.getTime();
  if (object.purgeRequestedAt === null) {
    if (latestUpload >= now.getTime() - UNUSED_PROFILE_UPLOAD_TTL_MS) return null;
    await tx.update(fileObject).set({ purgeRequestedAt: now }).where(eq(fileObject.id, object.id));
  }
  return {
    fileObjectId: object.id,
    organizationId: object.organizationId,
    versions: versions.map(({ id, storageKey }) => ({ id, storageKey })),
  };
}

/** Storage is already absent; the permanent claim blocks every new FK owner while this final check runs. */
export async function finishFilePurge(tx: Database, claim: FilePurgeClaim): Promise<boolean> {
  const [object] = await tx
    .select({ id: fileObject.id, purgeRequestedAt: fileObject.purgeRequestedAt })
    .from(fileObject)
    .where(eq(fileObject.id, claim.fileObjectId))
    .for('update');
  if (!object) return false;
  if (object.purgeRequestedAt === null || (await fileHasReferences(tx, object.id)))
    throw new Error('File purge eligibility changed');
  await tx.delete(fileVersion).where(eq(fileVersion.fileObjectId, object.id));
  await tx.delete(fileObject).where(and(eq(fileObject.id, object.id), sql`${fileObject.purgeRequestedAt} is not null`));
  return true;
}
