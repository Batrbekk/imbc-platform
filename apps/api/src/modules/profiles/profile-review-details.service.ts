import { profileOwnReviewDetailsSchema, SECTION_KINDS, type ProfileOwnReviewDetails } from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { AuditService } from '../../common/audit.service.js';
import { parseResponse } from '../../common/response.js';
import { PG_POOL } from '../../database/database.module.js';
import { reviewAssignment } from '../../database/schema/index.js';
import type { AuthUser } from '../auth/auth.types.js';
import { runOwnProfileAction } from './own-profile-action.js';
import { profileSubmissionRevisions, selectedCandidateRevisionId } from './profile-candidate.js';
import { profileReviewEvidence, type ReviewEvidence } from './profile-review.service.js';

const decisionDto = (item: ReviewEvidence | undefined) =>
  item?.decisionId && item.outcome && item.decidedAt
    ? {
        id: item.decisionId,
        outcome: item.outcome,
        comment: item.comment,
        decidedAt: new Date(item.decidedAt).toISOString(),
      }
    : null;

/** Own producer comments use the exact last Send graph; working copies only provide comparison labels. */
@Injectable()
export class ProfileReviewDetailsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly audit: AuditService,
  ) {}
  async read(actor: AuthUser, ip: string | null = null): Promise<ProfileOwnReviewDetails> {
    return runOwnProfileAction(
      this.pool,
      this.audit,
      actor,
      { action: 'profile.read', route: '/api/v1/profiles/own/review', ip },
      async (tx, _queueDb, { profile, sections }) => {
        const [assignment] = await tx
          .select()
          .from(reviewAssignment)
          .where(sql`profile_id=${profile.id} and organization_id=${profile.organizationId}`)
          .orderBy(sql`assignment_order desc`)
          .limit(1);
        const map = assignment
          ? await profileSubmissionRevisions(tx, {
              assignmentId: assignment.id,
              profileId: profile.id,
              organizationId: profile.organizationId,
            })
          : [];
        const facts = map.length ? await profileReviewEvidence(tx, { profile, map }) : [];
        return parseResponse(
          profileOwnReviewDetailsSchema,
          {
            profileId: profile.id,
            assignment: assignment
              ? {
                  id: assignment.id,
                  receivedAt: assignment.receivedAt.toISOString(),
                  closedAt: assignment.closedAt?.toISOString() ?? null,
                  expertId: assignment.expertId,
                }
              : null,
            sections: SECTION_KINDS.map((kind) => {
              const section = sections.find((item) => item.kind === kind)!;
              const mapped = map.find((item) => item.kind === kind);
              const currentRevisionId = selectedCandidateRevisionId(section);
              const reviewedRevisionId = mapped?.revisionId ?? null;
              const evidence = facts.filter((item) => item.kind === kind && item.revisionId === reviewedRevisionId);
              return {
                kind,
                currentRevisionId,
                reviewedRevisionId,
                reviewRequired: mapped?.reviewRequired ?? null,
                appliesToCurrentRevision: reviewedRevisionId !== null && reviewedRevisionId === currentRevisionId,
                decision: decisionDto(evidence.find((item) => item.subject.kind === 'section')),
                items: evidence
                  .filter(
                    (item) =>
                      item.subject.kind !== 'section' && (item.subject.kind !== 'file' || item.decisionId !== null),
                  )
                  .map((item) => ({
                    subject: item.subject,
                    stableIdentityId: item.stableIdentityId,
                    fileObjectId: item.fileObjectId,
                    label: item.label,
                    decision: decisionDto(item),
                  })),
              };
            }),
          },
          'замечания к своей рассмотренной версии',
        );
      },
    );
  }
}
