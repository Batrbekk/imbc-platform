import {
  reviewAssignInputSchema,
  reviewAssignmentMetadataSchema,
  type ReviewAssignmentMetadata,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { isUuid, notFound } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { parseOrThrow, ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { PG_POOL, type Database } from '../../database/database.module.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ReviewScopeDenied, runReviewAction } from './review-scope.js';
import { queueScopeCondition, sentReviewChanges } from './reviews.service.js';

const changed = () => new ProblemException(409, 'assignment_changed', 'Это рассмотрение уже изменилось или завершено.');
type AssignmentTarget = {
  profileId: string;
  organizationId: string;
  expertId: string | null;
  submissionMode: string;
  closedAt: string | null;
};
type ProfileTarget = { id: string; organizationId: string; status: string; assignedExpertId: string | null };
async function metadata(tx: Database, profileId: string): Promise<ReviewAssignmentMetadata> {
  const row = (
    await tx.execute(sql`
    select p.id as "profileId",o.name as "organizationName",p.status,
      (p.status='verified' and ${sentReviewChanges}) as "hasPendingChanges",a.id as "assignmentId",
      a.expert_id as "assignedExpertId",coalesce(nullif(e.full_name,''),e.email) as "assignedExpert",false as unresolved
    from manufacturer_profile p join organizations o on o.id=p.organization_id
    join review_assignment a on a.profile_id=p.id and a.organization_id=p.organization_id and a.closed_at is null
    left join user_accounts e on e.id=a.expert_id where p.id=${profileId} and ${queueScopeCondition}`)
  ).rows[0];
  if (!row) throw changed();
  return parseResponse(reviewAssignmentMetadataSchema, row, 'назначение проверки');
}

@Injectable()
export class ReviewAssignmentService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly audit: AuditService,
  ) {}

  readMetadata(actor: AuthUser, assignmentId: string, ip: string | null = null): Promise<ReviewAssignmentMetadata> {
    if (!isUuid(assignmentId)) throw notFound();
    return runReviewAction(
      this.pool,
      this.audit,
      actor,
      { action: 'review.assign', role: 'administrator', route: 'v1/reviews/assignment-queue/:id', ip },
      async (tx) => metadata(tx, (await this.lockTarget(tx, assignmentId)).profile.id),
    );
  }

  take(actor: AuthUser, assignmentId: string, ip: string | null = null): Promise<ReviewAssignmentMetadata> {
    if (!isUuid(assignmentId)) throw notFound();
    return runReviewAction(
      this.pool,
      this.audit,
      actor,
      { action: 'review.take', role: 'expert', route: 'v1/reviews/assignments/:id/take', ip },
      async (tx) => {
        const { profile, assignment } = await this.lockTarget(tx, assignmentId);
        if (assignment.expertId !== null && assignment.expertId !== actor.id) throw new ReviewScopeDenied();
        await this.assignIn(
          tx,
          actor,
          profile,
          assignmentId,
          actor.id,
          assignment.expertId === null,
          'review.take',
          ip,
        );
        return metadata(tx, profile.id);
      },
    );
  }
  assign(
    actor: AuthUser,
    assignmentId: string,
    body: unknown,
    ip: string | null = null,
  ): Promise<ReviewAssignmentMetadata> {
    if (!isUuid(assignmentId)) throw notFound();
    const input = parseOrThrow(reviewAssignInputSchema, body);
    return runReviewAction(
      this.pool,
      this.audit,
      actor,
      {
        action: 'review.assign',
        role: 'administrator',
        route: 'v1/reviews/assignments/:id/assign',
        ip,
        targetId: input.expertId,
      },
      async (tx) => {
        // Actor and target account were locked together in UUID order before entering this callback.
        const expert = (
          await tx.execute(sql`select a.id from user_accounts a join organizations o on o.id=a.organization_id
          where a.id=${input.expertId} and a.role='expert' and a.state='active' and o.type='imbc' for no key update of a`)
        ).rows[0];
        if (!expert)
          throw new ProblemException(400, 'review_expert_unavailable', 'Выберите действующего эксперта IMBC.');
        const { profile, assignment } = await this.lockTarget(tx, assignmentId);
        if (assignment.expertId !== input.expectedExpertId) throw changed();
        await this.assignIn(
          tx,
          actor,
          profile,
          assignmentId,
          input.expertId,
          assignment.expertId !== input.expertId,
          'review.assign',
          ip,
        );
        return metadata(tx, profile.id);
      },
    );
  }

  private async lockTarget(tx: Database, assignmentId: string) {
    const target = (
      await tx.execute<AssignmentTarget>(sql`
      select profile_id as "profileId",organization_id as "organizationId",expert_id as "expertId",
        submission_mode as "submissionMode",closed_at::text as "closedAt" from review_assignment where id=${assignmentId}`)
    ).rows[0];
    if (!target) throw notFound();
    if (target.closedAt !== null) throw changed();
    const profile = (
      await tx.execute<ProfileTarget>(sql`
      select id,organization_id as "organizationId",status,assigned_expert_id as "assignedExpertId"
      from manufacturer_profile where id=${target.profileId} and organization_id=${target.organizationId} for no key update`)
    ).rows[0];
    if (!profile) throw notFound();
    const assignment = (
      await tx.execute<AssignmentTarget>(sql`
      select profile_id as "profileId",organization_id as "organizationId",expert_id as "expertId",
        submission_mode as "submissionMode",closed_at::text as "closedAt" from review_assignment
      where id=${assignmentId} and profile_id=${profile.id} and organization_id=${profile.organizationId} for update`)
    ).rows[0];
    if (
      !assignment ||
      assignment.closedAt !== null ||
      (assignment.submissionMode === 'verified_changes'
        ? profile.status !== 'verified'
        : !['submitted', 'under_review'].includes(profile.status))
    )
      throw changed();
    return { profile, assignment };
  }

  private async assignIn(
    tx: Database,
    actor: AuthUser,
    profile: ProfileTarget,
    assignmentId: string,
    expertId: string,
    change: boolean,
    action: 'review.take' | 'review.assign',
    ip: string | null,
  ) {
    const before = (
      await tx.execute(sql`select jsonb_build_object('assignment',to_jsonb(a),'profile',
      jsonb_build_object('id',p.id,'status',p.status,'assignedExpertId',p.assigned_expert_id,'updatedAt',p.updated_at)) as value
      from review_assignment a join manufacturer_profile p on p.id=a.profile_id and p.organization_id=a.organization_id
      where a.id=${assignmentId}`)
    ).rows[0]!.value;
    if (change)
      await tx.execute(sql`update review_assignment set expert_id=${expertId},assigned_by=${actor.id},
      assigned_at=greatest(clock_timestamp(),received_at) where id=${assignmentId}`);
    // Mirror only the actual assignment; it does not change profile status or mark work as opened.
    await tx.execute(sql`update manufacturer_profile set assigned_expert_id=${expertId},updated_at=clock_timestamp()
      where id=${profile.id} and organization_id=${profile.organizationId} and assigned_expert_id is distinct from ${expertId}::uuid`);
    const after = (
      await tx.execute(sql`select jsonb_build_object('assignment',to_jsonb(a),'profile',
      jsonb_build_object('id',p.id,'status',p.status,'assignedExpertId',p.assigned_expert_id,'updatedAt',p.updated_at)) as value
      from review_assignment a join manufacturer_profile p on p.id=a.profile_id and p.organization_id=a.organization_id
      where a.id=${assignmentId}`)
    ).rows[0]!.value;
    await this.audit.record(
      {
        userId: actor.id,
        organizationId: profile.organizationId,
        action,
        objectType: 'review_assignment',
        objectId: assignmentId,
        diff: { before, after },
        ip,
      },
      tx,
    );
  }
}
