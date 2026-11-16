import { sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import type { SurveyPublicationObservation } from './survey-operation.js';
import { loadSiteSurveyState, type SiteSurveyScope } from './survey-state.js';

async function persistedSurveyState(tx: Database, scope: SiteSurveyScope) {
  const row = (await tx.execute<{ siteSurveyed: boolean; generation: string; effectiveUntil: string | null }>(sql`
    select site_surveyed as "siteSurveyed",generation::text as generation,effective_until::text as "effectiveUntil"
    from site_survey_publication_state where profile_id=${scope.profileId} and organization_id=${scope.organizationId}
    for no key update`)).rows[0];
  return row ? { ...row, generation: BigInt(row.generation) }
    : { siteSurveyed: false, generation: 0n, effectiveUntil: null };
}

/** Caller holds the profile lock. Observation cannot publish an intermediate pre-mutation event. */
export async function observeSiteSurveyPublication(tx: Database, scope: SiteSurveyScope): Promise<SurveyPublicationObservation> {
  const persistedBefore = await persistedSurveyState(tx, scope);
  const effectiveBefore = await loadSiteSurveyState(tx, scope);
  return { ...scope, asOfAlmatyDate: effectiveBefore.asOfAlmatyDate, persistedBefore, effectiveBefore };
}

/** Shared by survey mutation, review/DD publication and expiry recovery. Never reads a latest report version. */
export async function reconcileSiteSurveyPublication(
  tx: Database,
  scope: SiteSurveyScope,
  observation?: SurveyPublicationObservation,
) {
  if (observation && (observation.profileId !== scope.profileId || observation.organizationId !== scope.organizationId))
    throw new Error('Survey publication observation scope differs');
  const previous = await persistedSurveyState(tx, scope);
  if (observation && (previous.generation !== observation.persistedBefore.generation
    || previous.siteSurveyed !== observation.persistedBefore.siteSurveyed
    || previous.effectiveUntil !== observation.persistedBefore.effectiveUntil))
    throw new Error('Survey publication changed after its locked observation');
  const effective = await loadSiteSurveyState(tx, scope, observation?.asOfAlmatyDate);
  const expiredBefore = previous.siteSurveyed && previous.effectiveUntil !== null
    && previous.effectiveUntil <= effective.asOfAlmatyDate;
  const becameSurveyed = effective.summary.siteSurveyed && (!previous.siteSurveyed || expiredBefore
    || observation !== undefined && !observation.effectiveBefore.summary.siteSurveyed);
  const generation = previous.generation + (becameSurveyed ? 1n : 0n);
  await tx.execute(sql`
    insert into site_survey_publication_state(profile_id,organization_id,site_surveyed,effective_until,next_refresh_on,generation,changed_at)
    values(${scope.profileId},${scope.organizationId},${effective.summary.siteSurveyed},${effective.effectiveUntil}::date,
      ${effective.nextRefreshOn}::date,${generation.toString()}::bigint,clock_timestamp())
    on conflict(profile_id) do update set site_surveyed=excluded.site_surveyed,effective_until=excluded.effective_until,
      next_refresh_on=excluded.next_refresh_on,generation=excluded.generation,changed_at=excluded.changed_at
    where (site_survey_publication_state.site_surveyed,site_survey_publication_state.effective_until,
      site_survey_publication_state.next_refresh_on,site_survey_publication_state.generation)
      is distinct from (excluded.site_surveyed,excluded.effective_until,excluded.next_refresh_on,excluded.generation)`);
  if (becameSurveyed) {
    await tx.execute(sql`insert into site_survey_notice_outbox(profile_id,organization_id,generation,survey_record_id)
      values(${scope.profileId},${scope.organizationId},${generation.toString()}::bigint,${effective.summary.currentSurveyId})
      on conflict(profile_id,generation) do nothing`);
  }
  return { ...effective, generation, becameSurveyed };
}
