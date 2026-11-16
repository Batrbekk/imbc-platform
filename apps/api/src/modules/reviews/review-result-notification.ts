import { PROFILE_SUBMISSION_MODES, SECTION_KINDS, type ProfileSubmissionMode, type SectionKind } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../database/database.module.js';
import { notifyJobSchema, type NotifyJob } from '../../notifications/enqueue.js';
import { PermanentNotificationError } from '../../notifications/errors.js';

export const REVIEW_RESULT_NOTIFICATION_SCHEMA = 'review-result-v1';
type Outcome = 'verified' | 'rejected';
export interface ReviewResultNotificationContext {
  assignmentId: string;
  profileId: string;
  organizationId: string;
  mode: ProfileSubmissionMode;
  status: 'verified' | 'returned';
  sections: {
    kind: SectionKind;
    revisionId: string;
    decisionId: string;
    reviewRequired: boolean;
    notificationRelevant: boolean;
    outcome: Outcome;
    comment: string | null;
    publication: 'published' | 'retained' | 'rejected' | 'unchanged';
  }[];
}
const uuid = z.uuid();
const decisionKeys = SECTION_KINDS.map((kind) => `decision_${kind}`);
const eventParams = z.strictObject({
  schema: z.literal(REVIEW_RESULT_NOTIFICATION_SCHEMA),
  ...Object.fromEntries(decisionKeys.map((key) => [key, uuid])),
});
const closure = z.object({
  profileId: uuid,
  status: z.enum(['verified', 'returned']),
  decisions: z.array(z.strictObject({ kind: z.enum(SECTION_KINDS), revisionId: uuid, decisionId: uuid })).length(7),
  publishKinds: z.array(z.enum(SECTION_KINDS)),
  retainKinds: z.array(z.enum(SECTION_KINDS)),
  verifiedBefore: z.strictObject(Object.fromEntries(SECTION_KINDS.map((kind) => [kind, uuid.nullable()]))),
});
const invalid = (code: string) => new PermanentNotificationError(`notification NOT-05: ${code}`);

/** Only immutable IDs/codes enter pg-boss: comments, names and recipient identities remain in the database. */
export function buildReviewResultNotificationParams(
  decisions: readonly { kind: SectionKind; decisionId: string }[],
): Record<string, string> {
  if (
    decisions.length !== SECTION_KINDS.length ||
    new Set(decisions.map((item) => item.kind)).size !== SECTION_KINDS.length
  )
    throw invalid('result decision map invalid');
  const parsed = eventParams.safeParse({
    schema: REVIEW_RESULT_NOTIFICATION_SCHEMA,
    ...Object.fromEntries(decisions.map((item) => [`decision_${item.kind}`, item.decisionId])),
  });
  if (!parsed.success) throw invalid('result decision map invalid');
  return parsed.data as Record<string, string>;
}

/**
 * Closed assignment, immutable map, append-only decisions and unique closure audit pin this historical event.
 * Legacy params:{} is supported solely by that closure snapshot, never by current pointers/latest decisions.
 */
export async function loadReviewResultNotification(
  db: Database,
  input: NotifyJob,
): Promise<ReviewResultNotificationContext> {
  const parsed = notifyJobSchema.safeParse(input);
  if (!parsed.success || parsed.data.rule !== 'NOT-05') throw invalid('invalid result event');
  const job = parsed.data;
  if (
    !job.profileId ||
    !job.organizationId ||
    job.related?.type !== 'review_assignment' ||
    job.eventKey !== `profile-review-result:${job.related.id}`
  )
    throw invalid('result event context invalid');
  const legacy = Object.keys(job.params).length === 0;
  const params = legacy ? null : eventParams.safeParse(job.params);
  if (params && !params.success) throw invalid('result event params invalid');
  const assignment = (
    await db.execute<{
      id: string;
      profileId: string;
      organizationId: string;
      mode: string;
      closedBy: string;
      closeReason: string;
      closed: boolean;
    }>(sql`
    select a.id,a.profile_id as "profileId",a.organization_id as "organizationId",a.submission_mode as mode,
      a.closed_by as "closedBy",a.close_reason as "closeReason",a.closed_at is not null as closed
    from review_assignment a join manufacturer_profile p on p.id=a.profile_id and p.organization_id=a.organization_id
    join organizations o on o.id=p.organization_id and o.type='manufacturer'
    where a.id=${job.related.id} and a.profile_id=${job.profileId} and a.organization_id=${job.organizationId}`)
  ).rows[0];
  if (
    !assignment?.closed ||
    assignment.closeReason !== 'review_result' ||
    !PROFILE_SUBMISSION_MODES.includes(assignment.mode as ProfileSubmissionMode)
  )
    throw invalid('closed result assignment required');
  const audits = (
    await db.execute<{ userId: string | null; organizationId: string | null; outcome: string; diff: unknown }>(sql`
    select user_id as "userId",organization_id as "organizationId",outcome,diff from audit_entries
    where action='review.submit_result' and object_type='review_assignment' and object_id=${assignment.id}`)
  ).rows;
  if (
    audits.length !== 1 ||
    audits[0]!.outcome !== 'ok' ||
    audits[0]!.organizationId !== assignment.organizationId ||
    audits[0]!.userId !== assignment.closedBy
  )
    throw invalid('unique result closure required');
  const audited = closure.safeParse(audits[0]!.diff);
  if (
    !audited.success ||
    audited.data.profileId !== assignment.profileId ||
    new Set(audited.data.decisions.map((item) => item.kind)).size !== 7 ||
    new Set(audited.data.decisions.map((item) => item.decisionId)).size !== 7 ||
    new Set(audited.data.publishKinds).size !== audited.data.publishKinds.length ||
    new Set(audited.data.retainKinds).size !== audited.data.retainKinds.length ||
    audited.data.publishKinds.some((kind) => audited.data.retainKinds.includes(kind))
  )
    throw invalid('result closure snapshot invalid');
  const snapshot = audited.data;
  const verifiedBefore = snapshot.verifiedBefore as Record<SectionKind, string | null>;
  const explicit = params?.success ? (params.data as Record<string, string>) : null;
  if (explicit && snapshot.decisions.some((item) => explicit[`decision_${item.kind}`] !== item.decisionId))
    throw invalid('result event differs from closure');
  const map = (
    await db.execute<{
      kind: SectionKind;
      sectionId: string;
      revisionId: string;
      reviewRequired: boolean;
      retainedDecisionId: string | null;
      retainedFromAssignmentId: string | null;
      retainedProvenance: boolean;
    }>(sql`
    select s.kind,m.profile_section_id as "sectionId",m.section_revision_id as "revisionId",m.review_required as "reviewRequired",m.retained_decision_id as "retainedDecisionId",
      m.retained_from_assignment_id as "retainedFromAssignmentId",
      case when m.retained_from_assignment_id is null then false else profile_review_unlock_retained_provenance(
        m.review_assignment_id,m.retained_from_assignment_id,m.section_revision_id,m.profile_section_id,m.profile_id,m.organization_id,m.retained_decision_id)
      end as "retainedProvenance"
    from review_assignment_section m join profile_section s on s.id=m.profile_section_id and s.profile_id=m.profile_id and s.organization_id=m.organization_id
    where m.review_assignment_id=${assignment.id} and m.profile_id=${assignment.profileId} and m.organization_id=${assignment.organizationId}`)
  ).rows;
  if (map.length !== 7 || new Set(map.map((item) => item.kind)).size !== 7)
    throw invalid('result assignment map invalid');
  const ids = snapshot.decisions.map((item) => item.decisionId);
  const decisions = (
    await db.execute<{
      id: string;
      assignmentId: string;
      sectionId: string;
      revisionId: string | null;
      subjectRevisionId: string;
      outcome: Outcome;
      comment: string | null;
      final: boolean;
      prior: boolean;
    }>(sql`
    select d.id,d.review_assignment_id as "assignmentId",d.profile_section_id as "sectionId",d.section_revision_id as "revisionId",d.subject_revision_id as "subjectRevisionId",d.outcome,d.comment,
      not exists(select 1 from review_decision newer where newer.review_assignment_id=d.review_assignment_id and newer.section_revision_id=d.section_revision_id and newer.organization_id=d.organization_id and newer.decision_order>d.decision_order) as final,
      a.closed_at is not null and a.assignment_order<current_assignment.assignment_order and a.closed_at<=current_assignment.received_at
        and exists(select 1 from review_assignment_section source_map where source_map.review_assignment_id=a.id
          and source_map.profile_id=a.profile_id and source_map.organization_id=a.organization_id
          and source_map.profile_section_id=d.profile_section_id and source_map.section_revision_id=d.section_revision_id) as prior
    from review_decision d join review_assignment a on a.id=d.review_assignment_id and a.organization_id=d.organization_id
    join review_assignment current_assignment on current_assignment.id=${assignment.id}
    where d.id=any(${sql.param(ids)}::uuid[]) and d.organization_id=${assignment.organizationId} and a.profile_id=${assignment.profileId}`)
  ).rows;
  if (decisions.length !== 7) throw invalid('result decisions unavailable');
  const sections: ReviewResultNotificationContext['sections'] = SECTION_KINDS.map((kind) => {
    const mapped = map.find((item) => item.kind === kind)!;
    const reference = snapshot.decisions.find((item) => item.kind === kind)!;
    const decision = decisions.find((item) => item.id === reference.decisionId);
    const ownFinal = decision?.assignmentId === assignment.id && decision.final && mapped.reviewRequired;
    const keptFinal =
      decision?.id === mapped.retainedDecisionId &&
      decision.final &&
      decision.prior &&
      (mapped.retainedFromAssignmentId !== null
        ? mapped.retainedProvenance
        : !mapped.reviewRequired && decision.outcome === 'verified');
    if (
      !decision ||
      reference.revisionId !== mapped.revisionId ||
      decision.sectionId !== mapped.sectionId ||
      decision.revisionId !== mapped.revisionId ||
      decision.subjectRevisionId !== mapped.revisionId ||
      !['verified', 'rejected'].includes(decision.outcome) ||
      (decision.outcome === 'rejected' && !decision.comment?.trim()) ||
      (!ownFinal && !keptFinal) ||
      (mapped.retainedFromAssignmentId !== null && !mapped.retainedProvenance)
    )
      throw invalid('result decision binding invalid');
    const published = snapshot.publishKinds.includes(kind),
      retained = snapshot.retainKinds.includes(kind);
    if (decision.outcome === 'verified' ? published === retained : published || retained)
      throw invalid('result publication snapshot invalid');
    return {
      kind,
      revisionId: mapped.revisionId,
      decisionId: decision.id,
      reviewRequired: mapped.reviewRequired,
      notificationRelevant:
        assignment.mode !== 'verified_changes'
          ? decision.outcome === 'rejected'
          : mapped.revisionId !== verifiedBefore[kind],
      outcome: decision.outcome,
      comment: decision.comment,
      publication:
        mapped.revisionId === verifiedBefore[kind]
          ? 'unchanged'
          : decision.outcome === 'rejected'
            ? 'rejected'
            : published
              ? 'published'
              : 'retained',
    };
  });
  const mode = assignment.mode as ProfileSubmissionMode;
  const status =
    mode === 'verified_changes' || sections.every((section) => section.outcome === 'verified')
      ? 'verified'
      : 'returned';
  if (snapshot.status !== status) throw invalid('result closure status invalid');
  return {
    assignmentId: assignment.id,
    profileId: assignment.profileId,
    organizationId: assignment.organizationId,
    mode,
    status,
    sections,
  };
}
