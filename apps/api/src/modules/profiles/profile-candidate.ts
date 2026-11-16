import type { ProfileReviewSubject, SectionKind } from '@imbc/contracts';
import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';

/** One current manufacturer graph; this resolver is never used for publication or assignment history. */
export function selectedCandidateRevisionId(input: {
  workingRevisionId: string | null;
  pendingRevisionId: string | null;
  candidateRevisionId: string | null;
  verifiedRevisionId: string | null;
}): string | null {
  return input.workingRevisionId ?? input.pendingRevisionId ?? input.candidateRevisionId ?? input.verifiedRevisionId;
}

/** Internal SQL alias only. The exact cursor/map FK prevents wrong-section or tenant fallback. */
export function profileCandidateRevisionSql(sectionAlias: string): SQL<string | null> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(sectionAlias)) throw new Error('Invalid internal section alias');
  const field = (name: string) => sql`${sql.identifier(sectionAlias)}.${sql.identifier(name)}`;
  return sql<string | null>`coalesce(${field('working_revision_id')}, ${field('pending_revision_id')},
    (select m.section_revision_id from profile_section_candidate c
      join review_assignment_section m on m.review_assignment_id=c.review_assignment_id
        and m.profile_section_id=c.profile_section_id and m.section_revision_id=c.section_revision_id
        and m.organization_id=c.organization_id
      where c.profile_section_id=${field('id')} and c.organization_id=${field('organization_id')}
        and m.profile_id=${field('profile_id')}), ${field('verified_revision_id')})`;
}

export type ProfileCandidateRevision = {
  sectionId: string;
  kind: SectionKind;
  revisionId: string | null;
  candidateRevisionId: string | null;
  candidateAssignmentId: string | null;
  /** Acceptance of the selected exact revision only; a working COW never inherits the cursor decision. */
  acceptedDecisionId: string | null;
};

/** Profile/tenant must come from the caller's trusted own-profile or authorized review context. */
export async function profileCandidateRevisions(
  tx: Database,
  input: { profileId: string; organizationId: string },
): Promise<ProfileCandidateRevision[]> {
  const { rows } = await tx.execute<ProfileCandidateRevision>(sql`
    select s.id as "sectionId", s.kind, ${profileCandidateRevisionSql('s')} as "revisionId",
      c.section_revision_id as "candidateRevisionId", c.review_assignment_id as "candidateAssignmentId",
      case when ${profileCandidateRevisionSql('s')}=c.section_revision_id
        and profile_review_effective_section_acceptance(c.accepted_decision_id,c.section_revision_id,s.profile_id,s.organization_id)
        then c.accepted_decision_id else null end as "acceptedDecisionId"
    from profile_section s left join profile_section_candidate c
      on c.profile_section_id=s.id and c.organization_id=s.organization_id
    where s.profile_id=${input.profileId} and s.organization_id=${input.organizationId}
    order by s.kind`);
  return rows;
}

export type ProfileSubmissionRevision = {
  sectionId: string;
  kind: SectionKind;
  revisionId: string;
  reviewRequired: boolean;
  retainedDecisionId: string | null;
};

/** Exact immutable submission/history graph. Authorization supplies all three scoped identifiers. */
export async function profileSubmissionRevisions(
  tx: Database,
  input: { assignmentId: string; profileId: string; organizationId: string },
): Promise<ProfileSubmissionRevision[]> {
  const { rows } = await tx.execute<ProfileSubmissionRevision>(sql`
    select m.profile_section_id as "sectionId", s.kind, m.section_revision_id as "revisionId",
      m.review_required as "reviewRequired", m.retained_decision_id as "retainedDecisionId"
    from review_assignment a join review_assignment_section m
      on m.review_assignment_id=a.id and m.profile_id=a.profile_id and m.organization_id=a.organization_id
    join profile_section s on s.id=m.profile_section_id and s.profile_id=m.profile_id and s.organization_id=m.organization_id
    where a.id=${input.assignmentId} and a.profile_id=${input.profileId} and a.organization_id=${input.organizationId}
    order by s.kind`);
  return rows;
}

/** Shared DB-managed effective latest outcome, scoped to the profile and exact subject, never timestamps. */
export async function effectiveProfileReviewDecisionId(
  tx: Database,
  input: { profileId: string; organizationId: string; subject: ProfileReviewSubject },
): Promise<string | null> {
  const subject = input.subject;
  const { rows } = await tx.execute<{ id: string | null }>(sql`
    select profile_review_effective_decision(${input.profileId},${input.organizationId},
      ${subject.kind === 'section' ? subject.sectionRevisionId : null},
      ${subject.kind === 'certificate' ? subject.certificateId : null},
      ${subject.kind === 'document' ? subject.documentId : null},
      ${subject.kind === 'file' ? subject.fileVersionId : null}) as id`);
  return rows[0]?.id ?? null;
}
