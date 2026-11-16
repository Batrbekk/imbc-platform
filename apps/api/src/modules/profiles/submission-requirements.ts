import { COMPANY_ISO_CODES, DOCUMENT_REQUIRED_CODES } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import { ProblemException } from '../../common/problem.js';
import type { Database } from '../../database/database.module.js';
import { lockSubmissionRequirementDictionary } from '../../database/submission-requirement-lock.js';
import type { SectionContext } from './section-handler.js';

export type RequirementSection = 'certificates' | 'documents';
export type SubmissionRequirements = Record<RequirementSection, string[]>;

/** Same rule for working section completeness and every new Send, including unchanged frozen sections. */
export async function currentRequirementIds(tx: Database, kind: RequirementSection): Promise<string[]> {
  const code = kind === 'certificates' ? 'certificate_type' : 'document_type';
  const fixed =
    kind === 'certificates' ? COMPANY_ISO_CODES.map((value) => value.toLowerCase()) : [...DOCUMENT_REQUIRED_CODES];
  const { rows } = await tx.execute<{ id: string }>(sql`
    select e.id from dictionary_entry e join dictionary d on d.id=e.dictionary_id
    where d.code=${code} and (lower(e.code)=any(${sql.param(fixed)}::text[])
      or (e.mandatory and e.retired_at is null))
    order by e.sort_order,e.code,e.id`);
  return rows.map(({ id }) => id);
}

/**
 * Paired with the dictionary-entry statement trigger in 0021. The second statement sees a mutation
 * committed while the advisory lock was being acquired; row locks alone cannot prevent new required types.
 */
export async function lockCurrentSubmissionRequirements(tx: Database): Promise<SubmissionRequirements> {
  await lockSubmissionRequirementDictionary(tx);
  await tx.execute(sql`select e.id from dictionary_entry e join dictionary d on d.id=e.dictionary_id
    where d.code in ('certificate_type','document_type') order by e.id for share of e`);
  return {
    certificates: await currentRequirementIds(tx, 'certificates'),
    documents: await currentRequirementIds(tx, 'documents'),
  };
}

/** Frozen evidence is compared as a set. An extra or missing entry requires a new COW, never a snapshot edit. */
export async function requirementSnapshotMatches(
  tx: Database,
  context: SectionContext,
  expectedIds: readonly string[],
): Promise<boolean> {
  const { rows } = await tx.execute<{ id: string }>(sql`select dictionary_entry_id as id from submission_requirement
    where section_revision_id=${context.revisionId} and organization_id=${context.organizationId} order by dictionary_entry_id`);
  const expected = [...new Set(expectedIds)].sort();
  return rows.length === expected.length && rows.every(({ id }, index) => id === expected[index]);
}

/** Working-only capture. The caller holds the requirement lock and freezes the revision in this transaction. */
export async function captureSubmissionRequirements(
  tx: Database,
  context: SectionContext,
  entryIds: readonly string[],
  capturedAt: Date,
): Promise<void> {
  const { rows } = await tx.execute<{ state: string; submittedAt: Date | string | null }>(sql`
    select r.state,r.submitted_at as "submittedAt" from section_revision r
    join profile_section s on s.id=r.profile_section_id and s.organization_id=r.organization_id
    where r.id=${context.revisionId} and r.organization_id=${context.organizationId}
      and s.id=${context.sectionId} and s.profile_id=${context.profileId} for update of r`);
  if (rows.length !== 1 || rows[0]!.state !== 'working' || rows[0]!.submittedAt !== null)
    throw new ProblemException(409, 'submission_requirements_changed', 'Требования этой отправки нельзя изменить.');
  await tx.execute(sql`delete from submission_requirement where section_revision_id=${context.revisionId}
    and organization_id=${context.organizationId}`);
  const ids = [...new Set(entryIds)].sort();
  for (let offset = 0; offset < ids.length; offset += 1000) {
    const values = ids
      .slice(offset, offset + 1000)
      .map((id) => sql`(${context.revisionId},${context.organizationId},${id},${capturedAt})`);
    await tx.execute(sql`insert into submission_requirement (section_revision_id,organization_id,dictionary_entry_id,captured_at)
      values ${sql.join(values, sql`, `)}`);
  }
}
