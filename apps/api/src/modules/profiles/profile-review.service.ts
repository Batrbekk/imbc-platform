import {
  profileReviewDecisionInputSchema,
  profileReviewDecisionSchema,
  SECTION_KINDS,
  type ProfileReviewDecision,
  type ProfileReviewDecisionInput,
  type ProfileReviewSubject,
  type SectionKind,
  type ProfileOwnReviewItemLabel,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { actorTransaction, isUuid, notFound, type QueueDb } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { PG_POOL, type Database } from '../../database/database.module.js';
import { manufacturerProfile, reviewAssignment, reviewDecision } from '../../database/schema/index.js';
import { QUEUE } from '../../infra/infra.module.js';
import { enqueueNotification } from '../../notifications/enqueue.js';
import type { AuthUser } from '../auth/auth.types.js';
import { profileSubmissionRevisions, type ProfileSubmissionRevision } from './profile-candidate.js';
import {
  selectProfilePublicationSubset,
  type ExactProfileRevisionMap,
  type VerifiedProfileRevisionMap,
} from './profile-publication-graph.js';
import { ownSections, type StoredSection } from './profile-store.js';
import { validateFrozenSubmissionFiles } from './submission-file-evidence.js';

const forbidden = () => new ProblemException(403, 'forbidden', 'Нет прав на это рассмотрение.');
const changed = () => new ProblemException(409, 'assignment_changed', 'Это рассмотрение уже изменилось или завершено.');
const incomplete = (missing: unknown[]) =>
  new ProblemException(409, 'review_incomplete', 'Не все решения рассмотрения заполнены.', undefined, { missing });
type Assignment = typeof reviewAssignment.$inferSelect;
type Profile = typeof manufacturerProfile.$inferSelect;
export interface LockedProfileReview {
  profile: Profile;
  assignment: Assignment;
  sections: StoredSection[];
  map: ProfileSubmissionRevision[];
}
/** Trusted entry-point guard; demo restrictions deliberately do not constrain the production service. */
export interface ProfileReviewOptions {
  ip?: string | null;
  beforeMutation?: (tx: Database, actor: AuthUser, graph: LockedProfileReview) => Promise<void>;
}
export interface ProfileReviewResult {
  profileId: string;
  assignmentId: string;
  profileStatus: 'verified' | 'returned';
  closedAt: string;
  publishKinds: SectionKind[];
  retainKinds: SectionKind[];
}
type Outcome = 'verified' | 'rejected';
export interface ReviewEvidence {
  kind: SectionKind;
  sectionId: string;
  revisionId: string;
  subject: ProfileReviewSubject;
  stableIdentityId: string | null;
  fileObjectId: string | null;
  label: ProfileOwnReviewItemLabel | null;
  decisionId: string | null;
  outcome: Outcome | null;
  comment: string | null;
  decidedAt: Date | string | null;
}

/** Exact mapped facts and globally effective decisions in four batched reads; no current/latest revision lookup. */
export async function profileReviewEvidence(
  tx: Database,
  graph: Pick<LockedProfileReview, 'profile' | 'map'>,
): Promise<ReviewEvidence[]> {
  const ids = graph.map.map((section) => section.revisionId);
  const profile = graph.profile;
  const sectionFacts = await tx.execute<{
    kind: SectionKind;
    sectionId: string;
    revisionId: string;
    decisionId: string | null;
    outcome: Outcome | null;
    comment: string | null;
    decidedAt: Date | string | null;
  }>(sql`select s.kind,s.id as "sectionId",r.id as "revisionId",d.id as "decisionId",d.outcome,d.comment,d.decided_at as "decidedAt"
    from section_revision r join profile_section s on s.id=r.profile_section_id and s.organization_id=r.organization_id
    left join review_decision d on d.id=profile_review_effective_decision(${profile.id},${profile.organizationId},r.id)
    where r.id=any(${sql.param(ids)}::uuid[]) and s.profile_id=${profile.id} and s.organization_id=${profile.organizationId}`);
  const evidence: ReviewEvidence[] = sectionFacts.rows.map((row) => ({
    ...row,
    subject: { kind: 'section', sectionRevisionId: row.revisionId },
    stableIdentityId: null,
    fileObjectId: null,
    label: null,
  }));
  for (const kind of ['document', 'certificate'] as const) {
    const table = sql.identifier(kind);
    const idArg = kind === 'document' ? sql`null,null,t.id` : sql`null,t.id`;
    const typeId = kind === 'document' ? sql`t.document_type_id` : sql`t.certificate_type_id`;
    const rows = await tx.execute<{
      id: string;
      kind: SectionKind;
      sectionId: string;
      revisionId: string;
      stableIdentityId: string;
      fileObjectId: string | null;
      decisionId: string | null;
      outcome: Outcome | null;
      comment: string | null;
      decidedAt: Date | string | null;
      label: ProfileOwnReviewItemLabel;
    }>(sql`select t.id,s.kind,s.id as "sectionId",r.id as "revisionId",t.identity_id as "stableIdentityId",
      t.file_object_id as "fileObjectId",d.id as "decisionId",d.outcome,d.comment,d.decided_at as "decidedAt",
      jsonb_build_object('kind',${kind}::text,'positionInList',t.position_in_list,'type',case when type_entry.id is null then null
        else jsonb_build_object('code',type_entry.code,'names',jsonb_build_object('en',type_names.names->>'en',
          'ru',type_names.names->>'ru','kk',type_names.names->>'kk')) end,
        ${kind === 'document' ? sql`'customName',t.custom_name` : sql`'number',t.number,'customTypeName',t.custom_type_name`}) as label
      from ${table} t join section_revision r on r.id=t.section_revision_id and r.organization_id=t.organization_id
      join profile_section s on s.id=r.profile_section_id and s.organization_id=r.organization_id
      left join dictionary_entry type_entry on type_entry.id=${typeId}
      left join lateral (select jsonb_object_agg(language,name) as names from dictionary_entry_translation
        where dictionary_entry_id=type_entry.id) type_names on true
      left join review_decision d on d.id=profile_review_effective_decision(${profile.id},${profile.organizationId},${idArg})
      where r.id=any(${sql.param(ids)}::uuid[]) and s.profile_id=${profile.id} and s.organization_id=${profile.organizationId}
        ${kind === 'certificate' ? sql`and not t.not_held` : sql``} order by t.position_in_list,t.id`);
    for (const { id, ...row } of rows.rows)
      evidence.push({ ...row, subject: kind === 'document' ? { kind, documentId: id } : { kind, certificateId: id } });
  }
  const files = await tx.execute<{
    id: string;
    kind: SectionKind;
    sectionId: string;
    revisionId: string;
    fileObjectId: string;
    decisionId: string | null;
    outcome: Outcome | null;
    comment: string | null;
    decidedAt: Date | string | null;
    originalName: string;
  }>(sql`select f.file_version_id as id,s.kind,s.id as "sectionId",r.id as "revisionId",f.file_object_id as "fileObjectId",
    d.id as "decisionId",d.outcome,d.comment,d.decided_at as "decidedAt",v.original_name as "originalName" from revision_file_version f
    join file_version v on v.id=f.file_version_id and v.file_object_id=f.file_object_id
    join section_revision r on r.id=f.section_revision_id and r.organization_id=f.organization_id
    join profile_section s on s.id=r.profile_section_id and s.organization_id=r.organization_id
    left join review_decision d on d.id=profile_review_effective_decision(${profile.id},${profile.organizationId},null,null,null,f.file_version_id)
    where r.id=any(${sql.param(ids)}::uuid[]) and s.profile_id=${profile.id} and s.organization_id=${profile.organizationId}
    order by s.kind,f.file_version_id`);
  for (const { id, originalName, ...row } of files.rows)
    evidence.push({
      ...row,
      subject: { kind: 'file', fileVersionId: id },
      stableIdentityId: null,
      label: { kind: 'file', originalName },
    });
  return evidence;
}
const subjectKey = (subject: ProfileReviewSubject) =>
  subject.kind === 'section'
    ? `section:${subject.sectionRevisionId}`
    : subject.kind === 'document'
      ? `document:${subject.documentId}`
      : subject.kind === 'certificate'
        ? `certificate:${subject.certificateId}`
        : `file:${subject.fileVersionId}`;
const localDate = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (kind: string) => parts.find((part) => part.type === kind)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};

/** Internal Phase-3c review core. Public SME routes belong to Phase 5. */
@Injectable()
export class ProfileReviewService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly audit: AuditService,
    @Inject(QUEUE) private readonly queue: PgBoss,
  ) {}

  private async run<T>(
    actor: AuthUser,
    assignmentId: string,
    action: string,
    options: ProfileReviewOptions,
    callback: (tx: Database, queueDb: QueueDb, graph: LockedProfileReview) => Promise<T>,
  ): Promise<T> {
    if (!isUuid(assignmentId)) throw notFound();
    return actorTransaction(
      this.pool,
      this.audit,
      actor,
      { action: 'profile.verify', route: `internal/profile-review/${action}`, ip: options.ip ?? null },
      async (tx, queueDb) => {
        const actual = (
          await tx.execute<{ organizationId: string }>(sql`select a.organization_id as "organizationId"
          from user_accounts a join organizations o on o.id=a.organization_id where a.id=${actor.id}
          and a.role='expert' and a.state='active' and o.type='imbc' for share of o`)
        ).rows[0];
        if (!actual || actual.organizationId !== actor.organizationId) throw forbidden();
        const target = (
          await tx
            .select({
              profileId: reviewAssignment.profileId,
              organizationId: reviewAssignment.organizationId,
              closedAt: reviewAssignment.closedAt,
              expertId: reviewAssignment.expertId,
            })
            .from(reviewAssignment)
            .where(eq(reviewAssignment.id, assignmentId))
        )[0];
        if (!target) throw notFound();
        // An already closed request never locks its old profile/assignee against a fresh Send.
        // Mutable assignment fields are rechecked after the profile lock below.
        if (target.closedAt !== null) throw changed();
        if (target.expertId !== null && target.expertId !== actor.id) throw forbidden();
        const profile = (
          await tx
            .select()
            .from(manufacturerProfile)
            .where(sql`id=${target.profileId} and organization_id=${target.organizationId}`)
            .for('no key update')
        )[0];
        if (!profile) throw notFound();
        const sections = await ownSections(tx, profile.id, profile.organizationId);
        const assignment = (
          await tx
            .select()
            .from(reviewAssignment)
            .where(
              sql`id=${assignmentId}
          and profile_id=${profile.id} and organization_id=${profile.organizationId}`,
            )
            .for('update')
        )[0];
        if (!assignment || assignment.closedAt !== null) throw changed();
        if (assignment.expertId !== null && assignment.expertId !== actor.id) throw forbidden();
        if (action !== 'take' && assignment.expertId !== actor.id) throw forbidden();
        const map = await profileSubmissionRevisions(tx, {
          assignmentId,
          profileId: profile.id,
          organizationId: profile.organizationId,
        });
        if (
          map.length !== SECTION_KINDS.length ||
          new Set(map.map((section) => section.kind)).size !== SECTION_KINDS.length
        )
          throw changed();
        const revisionIds = map.map((section) => section.revisionId).sort();
        const revisions = (
          await tx.execute<{ id: string; state: string }>(sql`select id,state from section_revision
          where id=any(${sql.param(revisionIds)}::uuid[]) and organization_id=${profile.organizationId} order by id for update`)
        ).rows;
        if (
          revisions.length !== SECTION_KINDS.length ||
          revisions.some((revision) => !['submitted', 'verified', 'rejected'].includes(revision.state)) ||
          sections.some(
            (section) =>
              section.workingRevisionId !== null ||
              !map.some(
                (mapped) => mapped.sectionId === section.id && mapped.revisionId === section.candidateRevisionId,
              ) ||
              (section.pendingRevisionId !== null &&
                !map.some(
                  (mapped) => mapped.sectionId === section.id && mapped.revisionId === section.pendingRevisionId,
                )),
          )
        )
          throw changed();
        if (
          assignment.submissionMode === 'verified_changes'
            ? profile.status !== 'verified'
            : !['submitted', 'under_review'].includes(profile.status)
        )
          throw changed();
        const graph = { profile, assignment, sections, map };
        await options.beforeMutation?.(tx, actor, graph);
        return callback(tx, queueDb, graph);
      },
    );
  }

  async take(actor: AuthUser, assignmentId: string, options: ProfileReviewOptions = {}) {
    return this.run(actor, assignmentId, 'take', options, async (tx, _queueDb, graph) => {
      if (graph.assignment.expertId === null)
        await tx
          .update(reviewAssignment)
          .set({ expertId: actor.id, assignedBy: actor.id, assignedAt: new Date() })
          .where(eq(reviewAssignment.id, assignmentId));
      await tx
        .update(manufacturerProfile)
        .set({
          assignedExpertId: actor.id,
          status: graph.assignment.submissionMode === 'verified_changes' ? 'verified' : 'under_review',
          updatedAt: new Date(),
        })
        .where(eq(manufacturerProfile.id, graph.profile.id));
      await this.audit.record(
        {
          userId: actor.id,
          organizationId: graph.profile.organizationId,
          action: 'review.take',
          objectType: 'review_assignment',
          objectId: assignmentId,
          diff: { expertId: actor.id },
          ip: options.ip,
        },
        tx,
      );
      return { assignmentId, expertId: actor.id };
    });
  }

  private async validateAccepted(
    tx: Database,
    graph: LockedProfileReview,
    section: ProfileSubmissionRevision,
    evidence: ReviewEvidence[],
  ) {
    const missing = evidence
      .filter(
        (item) =>
          item.revisionId === section.revisionId &&
          item.subject.kind !== 'section' &&
          (item.subject.kind === 'file' ? item.outcome === 'rejected' : item.outcome !== 'verified'),
      )
      .map((item) => ({ kind: section.kind, subject: item.subject, code: 'item_not_verified' }));
    if (missing.length) throw incomplete(missing);
    await validateFrozenSubmissionFiles(tx, {
      profileId: graph.profile.id,
      organizationId: graph.profile.organizationId,
      sectionId: section.sectionId,
      revisionId: section.revisionId,
    });
  }

  async decide(
    actor: AuthUser,
    assignmentId: string,
    input: ProfileReviewDecisionInput,
    options: ProfileReviewOptions = {},
  ): Promise<ProfileReviewDecision> {
    const normalized = profileReviewDecisionInputSchema.parse(input);
    return this.run(actor, assignmentId, 'decide', options, async (tx, _queueDb, graph) => {
      const evidence = await profileReviewEvidence(tx, graph);
      // A shared captured file can occur in multiple sections; choose a review-required exact owner deterministically.
      const fact = evidence.find(
        (item) =>
          subjectKey(item.subject) === subjectKey(normalized.subject) &&
          graph.map.some((section) => section.revisionId === item.revisionId && section.reviewRequired),
      );
      if (!fact)
        throw new ProblemException(404, 'review_subject_not_found', 'Предмет не принадлежит этому рассмотрению.');
      const mapped = graph.map.find((section) => section.revisionId === fact.revisionId)!;
      if (normalized.outcome === 'verified') {
        if (normalized.subject.kind === 'section') await this.validateAccepted(tx, graph, mapped, evidence);
        else {
          await validateFrozenSubmissionFiles(tx, {
            profileId: graph.profile.id,
            organizationId: graph.profile.organizationId,
            sectionId: mapped.sectionId,
            revisionId: mapped.revisionId,
          });
          if (
            normalized.subject.kind !== 'file' &&
            evidence.some(
              (item) =>
                item.subject.kind === 'file' &&
                item.revisionId === fact.revisionId &&
                item.fileObjectId === fact.fileObjectId &&
                item.outcome === 'rejected',
            )
          )
            throw incomplete([{ kind: mapped.kind, subject: normalized.subject, code: 'file_not_verified' }]);
        }
      }
      const subject = normalized.subject;
      const [decision] = await tx
        .insert(reviewDecision)
        .values({
          reviewAssignmentId: assignmentId,
          organizationId: graph.profile.organizationId,
          expertId: actor.id,
          profileSectionId: fact.sectionId,
          subjectRevisionId: fact.revisionId,
          sectionRevisionId: subject.kind === 'section' ? subject.sectionRevisionId : null,
          certificateId: subject.kind === 'certificate' ? subject.certificateId : null,
          documentId: subject.kind === 'document' ? subject.documentId : null,
          fileVersionId: subject.kind === 'file' ? subject.fileVersionId : null,
          fileObjectId: subject.kind === 'file' ? fact.fileObjectId : null,
          outcome: normalized.outcome,
          comment: normalized.comment,
          decidedAt: new Date(),
        })
        .returning();
      await this.audit.record(
        {
          userId: actor.id,
          organizationId: graph.profile.organizationId,
          action: 'review.decide',
          objectType: 'review_decision',
          objectId: decision!.id,
          diff: { assignmentId, subject, outcome: decision!.outcome },
          ip: options.ip,
        },
        tx,
      );
      return parseResponse(
        profileReviewDecisionSchema,
        {
          id: decision!.id,
          assignmentId,
          expertId: actor.id,
          subject,
          outcome: decision!.outcome,
          comment: decision!.comment,
          decidedAt: decision!.decidedAt.toISOString(),
        },
        'решение рассмотрения',
      );
    });
  }

  async submitResult(
    actor: AuthUser,
    assignmentId: string,
    options: ProfileReviewOptions = {},
  ): Promise<ProfileReviewResult> {
    return this.run(actor, assignmentId, 'submit-result', options, async (tx, queueDb, graph) => {
      const evidence = await profileReviewEvidence(tx, graph);
      const outcomes = new Map(
        evidence.filter((item) => item.subject.kind === 'section').map((item) => [item.revisionId, item]),
      );
      const missing = evidence
        .filter((item) => item.subject.kind !== 'file' && item.outcome === null)
        .map((item) => ({ kind: item.kind, subject: item.subject, code: 'decision_required' }));
      for (const section of graph.map) {
        const decision = outcomes.get(section.revisionId);
        if (
          !decision?.decisionId ||
          (!section.reviewRequired &&
            (decision.outcome !== 'verified' || decision.decisionId !== section.retainedDecisionId))
        )
          missing.push({
            kind: section.kind,
            subject: { kind: 'section', sectionRevisionId: section.revisionId },
            code: 'decision_required',
          });
      }
      if (missing.length) throw incomplete(missing);
      const accepted = graph.map.filter((section) => outcomes.get(section.revisionId)!.outcome === 'verified');
      for (const section of accepted) await this.validateAccepted(tx, graph, section, evidence);
      const initial = graph.assignment.submissionMode !== 'verified_changes';
      const candidates = Object.fromEntries(
        graph.map.map((section) => [section.kind, section.revisionId]),
      ) as ExactProfileRevisionMap;
      const verified = Object.fromEntries(
        graph.sections.map((section) => [section.kind, section.verifiedRevisionId]),
      ) as VerifiedProfileRevisionMap;
      const publication = await selectProfilePublicationSubset(tx, {
        profileId: graph.profile.id,
        organizationId: graph.profile.organizationId,
        candidates,
        verified: initial
          ? (Object.fromEntries(SECTION_KINDS.map((kind) => [kind, null])) as VerifiedProfileRevisionMap)
          : verified,
        acceptedKinds: accepted.map((section) => section.kind),
      });
      const allAccepted = accepted.length === SECTION_KINDS.length;
      if (allAccepted && publication.revisions === null)
        throw new ProblemException(
          409,
          'submission_graph_invalid',
          'Принятые разделы не образуют согласованный профиль.',
        );
      const status = initial && !allAccepted ? 'returned' : 'verified';
      const closedAt = new Date();
      // Pending pointers only allow submitted state: clear them before technical state transitions.
      await tx.execute(sql`update profile_section set pending_revision_id=null,updated_at=${closedAt}
        where profile_id=${graph.profile.id} and organization_id=${graph.profile.organizationId}`);
      for (const section of graph.map) {
        const decision = outcomes.get(section.revisionId)!;
        await tx.execute(sql`update section_revision set state=${decision.outcome}::revision_state
          where id=${section.revisionId} and organization_id=${graph.profile.organizationId} and state='submitted'`);
        await tx.execute(sql`insert into profile_section_candidate
          (profile_section_id,organization_id,review_assignment_id,section_revision_id,accepted_decision_id)
          values (${section.sectionId},${graph.profile.organizationId},${assignmentId},${section.revisionId},
            ${decision.outcome === 'verified' ? decision.decisionId : null})
          on conflict(profile_section_id) do update set review_assignment_id=excluded.review_assignment_id,
            section_revision_id=excluded.section_revision_id,accepted_decision_id=excluded.accepted_decision_id`);
        if (publication.publishKinds.includes(section.kind))
          await tx.execute(sql`update profile_section
          set verified_revision_id=${section.revisionId} where id=${section.sectionId} and organization_id=${graph.profile.organizationId}`);
      }
      await tx
        .update(manufacturerProfile)
        .set({
          status,
          hasPendingChanges: false,
          updatedAt: closedAt,
          ...(initial && status === 'verified'
            ? {
                updateStatus: 'active' as const,
                quarterAnchorAt: graph.profile.quarterAnchorAt ?? localDate(graph.profile.createdAt),
              }
            : {}),
          ...(!initial && accepted.some((section) => section.reviewRequired)
            ? { quarterAnchorAt: localDate(closedAt) }
            : {}),
          ...(status === 'verified' && graph.profile.verifiedAt === null ? { verifiedAt: closedAt } : {}),
        })
        .where(eq(manufacturerProfile.id, graph.profile.id));
      await tx
        .update(reviewAssignment)
        .set({ closedAt, closedBy: actor.id, closeReason: 'review_result' })
        .where(eq(reviewAssignment.id, assignmentId));
      await this.audit.record(
        {
          userId: actor.id,
          organizationId: graph.profile.organizationId,
          action: 'review.submit_result',
          objectType: 'review_assignment',
          objectId: assignmentId,
          ip: options.ip,
          diff: {
            profileId: graph.profile.id,
            status,
            publishKinds: publication.publishKinds,
            retainKinds: publication.retainKinds,
            decisions: graph.map.map((section) => ({
              kind: section.kind,
              revisionId: section.revisionId,
              decisionId: outcomes.get(section.revisionId)!.decisionId,
            })),
            quarterAnchorBefore: graph.profile.quarterAnchorAt,
            quarterAnchorAfter:
              initial && status === 'verified'
                ? (graph.profile.quarterAnchorAt ?? localDate(graph.profile.createdAt))
                : !initial && accepted.some((section) => section.reviewRequired)
                  ? localDate(closedAt)
                  : graph.profile.quarterAnchorAt,
            verifiedBefore: verified,
            verifiedAfter: publication.revisions ?? verified,
          },
        },
        tx,
      );
      await enqueueNotification(
        this.queue,
        {
          rule: 'NOT-05',
          eventKey: `profile-review-result:${assignmentId}`,
          profileId: graph.profile.id,
          organizationId: graph.profile.organizationId,
          related: { type: 'review_assignment', id: assignmentId },
          params: {},
        },
        queueDb,
      );
      return {
        profileId: graph.profile.id,
        assignmentId,
        profileStatus: status,
        closedAt: closedAt.toISOString(),
        publishKinds: publication.publishKinds,
        retainKinds: publication.retainKinds,
      };
    });
  }
}
