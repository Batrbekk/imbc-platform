import { SECTION_KINDS, siteSurveyCurrentReportSchema, type SectionKind, type SiteSurveyCurrentReport } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { validateProfileRevisionGraph, type ExactProfileRevisionMap } from '../profiles/profile-publication-graph.js';
import { loadSiteSurveyState, type SiteSurveyScope } from './survey-state.js';

/** Public exception is checked against today's scoped verified graph and exact report, never a stored latest ID. */
export async function loadCurrentCompanySurvey(tx: Database, scope: SiteSurveyScope): Promise<{ visible: boolean; current: SiteSurveyCurrentReport | null }> {
  const profile = (await tx.execute<{ revisionIds: unknown }>(sql`
    select c.card->'verifiedRevisionIds' as "revisionIds" from manufacturer_profile p
    join due_diligence_record d on d.profile_id=p.id and d.organization_id=p.organization_id and d.result in ('green','amber')
    join catalog_visible c on c.profile_id=p.id and c.organization_id=p.organization_id
    where p.id=${scope.profileId} and p.organization_id=${scope.organizationId} and p.status='verified' and p.verified_at is not null`)).rows[0];
  if (!profile) return { visible: false, current: null };
  const pointers = (await tx.execute<{ kind: SectionKind; revisionId: string }>(sql`
    select s.kind,r.id as "revisionId" from profile_section s join section_revision r
      on r.id=s.verified_revision_id and r.profile_section_id=s.id and r.organization_id=s.organization_id and r.state='verified'
    where s.profile_id=${scope.profileId} and s.organization_id=${scope.organizationId}`)).rows;
  if (pointers.length !== SECTION_KINDS.length || new Set(pointers.map(p => p.kind)).size !== SECTION_KINDS.length)
    return { visible: false, current: null };
  const revisions = Object.fromEntries(pointers.map(p => [p.kind, p.revisionId])) as ExactProfileRevisionMap;
  if (!profile.revisionIds || typeof profile.revisionIds !== 'object' || Array.isArray(profile.revisionIds)
    || Object.keys(profile.revisionIds).length !== SECTION_KINDS.length
    || SECTION_KINDS.some(kind => (profile.revisionIds as Record<string, unknown>)[kind] !== revisions[kind])
    || !(await validateProfileRevisionGraph(tx, { ...scope, revisions })).valid) return { visible: false, current: null };
  const state = await loadSiteSurveyState(tx, scope);
  const selected = state.records.find(record => record.id === state.summary.currentSurveyId);
  if (!selected?.report || selected.visitStartedOn === null) return { visible: true, current: null };
  return { visible: true, current: siteSurveyCurrentReportSchema.parse({ visitStartedOn: selected.visitStartedOn, visitEndedOn: selected.visitEndedOn,
    expiresOn: selected.expiresOn, report: selected.report }) };
}

export async function readCurrentCompanySurvey(tx: Database, scope: SiteSurveyScope): Promise<SiteSurveyCurrentReport | null> {
  return (await loadCurrentCompanySurvey(tx, scope)).current;
}
