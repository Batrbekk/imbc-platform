import type { DocumentStatus, ProfileFile, SectionRevisionState } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import type { SectionContext } from './section-handler.js';

type Outcome = 'verified' | 'rejected';
export type ItemReview = { outcome: Outcome | null; fileOutcome: Outcome | null };

/** Exact business-row and captured-file subjects; later COW rows and latest uploaded versions never inherit decisions. */
export async function profileItemReviews(
  tx: Database,
  context: SectionContext,
  kind: 'certificate' | 'document',
): Promise<Map<string, ItemReview>> {
  const table = sql.identifier(kind);
  const certificateId = kind === 'certificate' ? sql`b.id` : sql`null::uuid`;
  const documentId = kind === 'document' ? sql`b.id` : sql`null::uuid`;
  const { rows } = await tx.execute<ItemReview & { identityId: string }>(sql`
    select b.identity_id as "identityId", item.outcome, file_decision.outcome as "fileOutcome"
    from ${table} b
    join section_revision r on r.id=b.section_revision_id and r.organization_id=b.organization_id
    join profile_section s on s.id=r.profile_section_id and s.organization_id=r.organization_id
    left join review_decision item on item.id=profile_review_effective_decision(
      s.profile_id,s.organization_id,null::uuid,${certificateId},${documentId},null::uuid)
    left join revision_file_version capture on capture.section_revision_id=r.id
      and capture.organization_id=r.organization_id and capture.file_object_id=b.file_object_id
    left join review_decision file_decision on file_decision.id=profile_review_effective_decision(
      s.profile_id,s.organization_id,null::uuid,null::uuid,null::uuid,capture.file_version_id)
    where r.id=${context.revisionId} and s.id=${context.sectionId}
      and s.profile_id=${context.profileId} and s.organization_id=${context.organizationId}`);
  return new Map(rows.map(({ identityId, ...review }) => [identityId, review]));
}

/** Legacy frozen status survives until R1 retirement; a working copy has no inherited verification. */
export function profileItemStatus(input: {
  fileId: string | null;
  file: ProfileFile | null;
  state: SectionRevisionState | 'superseded' | undefined;
  legacyStatus: DocumentStatus;
  review: ItemReview | undefined;
}): DocumentStatus {
  if (input.fileId === null) return 'missing';
  if (input.file?.scanState === 'rejected' || input.review?.fileOutcome === 'rejected') return 'rejected';
  if (input.state === 'submitted') return 'under_review';
  if (input.state === 'working') return 'uploaded';
  if (input.review?.outcome === 'rejected') return 'rejected';
  if (input.file?.canDownload && input.review?.outcome === 'verified') return 'verified';
  if (input.legacyStatus === 'verified' && !input.file?.canDownload) return 'uploaded';
  return input.legacyStatus;
}
