import {
  SECTION_KINDS,
  reviewWorkbenchSchema,
  reviewSectionReadSchema,
  reviewSectionDecisionInputSchema,
  reviewSectionDecisionResultSchema,
  reviewSubmitResultSchema,
  type SectionKind,
  type ReviewWorkbench,
  type ReviewSectionRead,
  type ReviewSectionDecisionResult,
  type ReviewSubmitResult,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { isUuid, notFound } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { parseOrThrow, ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import type { Database } from '../../database/database.module.js';
import type { AuthUser } from '../auth/auth.types.js';
import {
  ProfileReviewService,
  profileReviewEvidence,
  type LockedProfileReview,
  type ReviewEvidence,
} from '../profiles/profile-review.service.js';
import { PROFILE_SECTION_HANDLERS, type SectionHandler } from '../profiles/section-handler.js';

const decisionDto = (item: ReviewEvidence | undefined) =>
  item?.decisionId && item.outcome && item.decidedAt
    ? {
        id: item.decisionId,
        outcome: item.outcome,
        comment: item.comment,
        decidedAt: new Date(item.decidedAt).toISOString(),
      }
    : null;
const requireOpened = (graph: LockedProfileReview) => {
  if (graph.assignment.submissionMode !== 'verified_changes' && graph.profile.status !== 'under_review')
    throw new ProblemException(409, 'review_not_opened', 'Сначала откройте рассмотрение.');
};

@Injectable()
export class ReviewWorkbenchService {
  private readonly handlers = new Map<SectionKind, SectionHandler>();
  constructor(
    private readonly review: ProfileReviewService,
    private readonly audit: AuditService,
    @Inject(PROFILE_SECTION_HANDLERS) handlers: readonly SectionHandler[],
  ) {
    for (const handler of handlers) {
      if (!SECTION_KINDS.includes(handler.kind) || this.handlers.has(handler.kind))
        throw new Error('Invalid review section handler registry');
      this.handlers.set(handler.kind, handler);
    }
    if (this.handlers.size !== SECTION_KINDS.length) throw new Error('Review requires all seven section handlers');
  }

  read(actor: AuthUser, assignmentId: string, ip: string | null = null): Promise<ReviewWorkbench> {
    return this.review.inspect(actor, assignmentId, (tx, graph) => this.workbench(tx, graph), {
      authorizationAction: 'profile.read',
      route: 'v1/reviews/assignments/:id',
      ip,
    });
  }
  open(actor: AuthUser, assignmentId: string, ip: string | null = null): Promise<ReviewWorkbench> {
    return this.review.inspect(
      actor,
      assignmentId,
      async (tx, graph) => {
        const before = {
          status: graph.profile.status,
          assignmentId: graph.assignment.id,
          expertId: graph.assignment.expertId,
        };
        const status = graph.assignment.submissionMode === 'verified_changes' ? 'verified' : 'under_review';
        if (graph.profile.status !== status) {
          await tx.execute(sql`update manufacturer_profile set status=${status}::profile_status,updated_at=clock_timestamp()
          where id=${graph.profile.id} and organization_id=${graph.profile.organizationId}`);
          graph.profile.status = status;
        }
        await this.audit.record(
          {
            userId: actor.id,
            organizationId: graph.profile.organizationId,
            action: 'review.open',
            objectType: 'review_assignment',
            objectId: assignmentId,
            diff: { before, after: { ...before, status } },
            ip,
          },
          tx,
        );
        return this.workbench(tx, graph);
      },
      { authorizationAction: 'profile.read', route: 'v1/reviews/assignments/:id/open', ip },
    );
  }
  section(
    actor: AuthUser,
    assignmentId: string,
    rawKind: string,
    ip: string | null = null,
  ): Promise<ReviewSectionRead> {
    if (!isUuid(assignmentId) || !SECTION_KINDS.includes(rawKind as SectionKind)) throw notFound();
    const kind = rawKind as SectionKind;
    return this.review.inspect(
      actor,
      assignmentId,
      async (tx, graph) => {
        requireOpened(graph);
        const workbench = await this.workbench(tx, graph);
        const mapped = graph.map.find((section) => section.kind === kind)!;
        const handler = this.handlers.get(kind)!;
        const data = parseResponse(
          handler.readSchema,
          await handler.read(tx, {
            profileId: graph.profile.id,
            organizationId: graph.profile.organizationId,
            sectionId: mapped.sectionId,
            revisionId: mapped.revisionId,
          }),
          'раздел рассмотрения',
        );
        const references =
          kind === 'contacts'
            ? {
                selectedContactRoles: (
                  await tx.execute(sql`
        select e.id,e.code,jsonb_build_object('en',names.value->>'en','ru',names.value->>'ru','kk',names.value->>'kk') as names,
          e.retired_at is not null as retired
        from dictionary_entry e join dictionary d on d.id=e.dictionary_id and d.code='contact_role'
        left join lateral (select jsonb_object_agg(language,name) as value from dictionary_entry_translation
          where dictionary_entry_id=e.id) names on true
        where e.id in (select role_id from contact where section_revision_id=${mapped.revisionId} and organization_id=${graph.profile.organizationId})
        order by e.code,e.id`)
                ).rows,
              }
            : {};
        return parseResponse(
          reviewSectionReadSchema,
          { ...workbench.sections.find((section) => section.kind === kind)!, data, ...references },
          'раздел рассмотрения',
        );
      },
      { authorizationAction: 'profile.read', route: 'v1/reviews/assignments/:id/sections/:kind', ip },
    );
  }
  async decideSection(
    actor: AuthUser,
    assignmentId: string,
    body: unknown,
    ip: string | null = null,
  ): Promise<ReviewSectionDecisionResult> {
    const input = parseOrThrow(reviewSectionDecisionInputSchema, body);
    return parseResponse(
      reviewSectionDecisionResultSchema,
      await this.review.decideSection(actor, assignmentId, input, {
        authorizationAction: 'profile.verify',
        route: 'v1/reviews/assignments/:id/section-decision',
        ip,
        beforeMutation: async (_tx, _actor, graph) => requireOpened(graph),
      }),
      'решение по разделу',
    );
  }
  async submitResult(actor: AuthUser, assignmentId: string, ip: string | null = null): Promise<ReviewSubmitResult> {
    return parseResponse(
      reviewSubmitResultSchema,
      await this.review.submitResult(actor, assignmentId, {
        authorizationAction: 'profile.verify',
        route: 'v1/reviews/assignments/:id/submit-result',
        ip,
        beforeMutation: async (_tx, _actor, graph) => requireOpened(graph),
      }),
      'результат рассмотрения',
    );
  }

  private async workbench(tx: Database, graph: LockedProfileReview): Promise<ReviewWorkbench> {
    const facts = await profileReviewEvidence(tx, graph);
    const rows = (
      await tx.execute<{ id: string; state: string; completeness: string }>(sql`
      select id,state,completeness_percent as completeness from section_revision
      where id=any(${sql.param(graph.map.map((section) => section.revisionId))}::uuid[])
      and organization_id=${graph.profile.organizationId}`)
    ).rows;
    const assignment = (
      await tx.execute(sql`
      select id,expert_id as "expertId",to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "receivedAt",
        to_char(assigned_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "assignedAt"
      from review_assignment where id=${graph.assignment.id} and profile_id=${graph.profile.id} and organization_id=${graph.profile.organizationId}`)
    ).rows[0];
    const organizationName = (
      await tx.execute<{ name: string }>(sql`select name from organizations where id=${graph.profile.organizationId}`)
    ).rows[0]!.name;
    return parseResponse(
      reviewWorkbenchSchema,
      {
        profileId: graph.profile.id,
        organizationName,
        profileStatus: graph.profile.status,
        hasPendingChanges: graph.assignment.submissionMode === 'verified_changes',
        assignment,
        sections: SECTION_KINDS.map((kind) => {
          const mapped = graph.map.find((section) => section.kind === kind)!;
          const row = rows.find((revision) => revision.id === mapped.revisionId)!;
          const evidence = facts.filter((fact) => fact.revisionId === mapped.revisionId);
          return {
            kind,
            revisionId: mapped.revisionId,
            revisionState: row.state,
            reviewRequired: mapped.reviewRequired,
            retainedDecisionId: mapped.retainedDecisionId,
            completenessPct: Number(row.completeness),
            decision: decisionDto(evidence.find((fact) => fact.subject.kind === 'section')),
            items: evidence
              .filter((fact) => fact.subject.kind !== 'section')
              .map((fact) => ({
                subject: fact.subject,
                stableIdentityId: fact.stableIdentityId,
                fileObjectId: fact.fileObjectId,
                label: fact.label,
                decision: decisionDto(fact),
              })),
          };
        }),
        canSubmitResult:
          facts.every((fact) => fact.subject.kind === 'file' || fact.outcome !== null) &&
          graph.map.every((mapped) => {
            const evidence = facts.filter((fact) => fact.revisionId === mapped.revisionId);
            const section = evidence.find((fact) => fact.subject.kind === 'section');
            if (!section?.decisionId || (!mapped.reviewRequired && section.decisionId !== mapped.retainedDecisionId))
              return false;
            return (
              section.outcome !== 'verified' ||
              evidence.every((fact) =>
                fact.subject.kind === 'section'
                  ? true
                  : fact.subject.kind === 'file'
                    ? fact.outcome !== 'rejected'
                    : fact.outcome === 'verified',
              )
            );
          }),
      },
      'рабочее рассмотрение',
    );
  }
}
