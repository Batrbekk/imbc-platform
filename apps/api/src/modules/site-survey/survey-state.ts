import { siteSurveyRecordViewSchema, type SiteSurveyRecordView } from '@imbc/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { parseResponse } from '../../common/response.js';
import type { Database } from '../../database/database.module.js';
import { effectiveSurveyState, type SurveyReportEvidence } from './effective-survey.js';

export type SiteSurveyScope = { profileId: string; organizationId: string };

/** One exact canonical pin predicate for own tier and the verified catalogue. Legacy rows cannot qualify. */
export function siteSurveyedPredicate(profileId: string | SQL, organizationId: string | SQL, day?: string | SQL): SQL {
  const today = day ?? sql`(clock_timestamp() at time zone 'Asia/Almaty')::date`;
  return sql`exists(select 1 from site_survey_record r
    join file_object f on f.id=r.file_object_id and f.organization_id=r.organization_id
      and f.purpose='site_survey_report' and f.data_class='c_imbc' and f.purge_requested_at is null
    join file_version v on v.id=r.file_version_id and v.file_object_id=f.id and v.scan_state='passed'
    where r.profile_id=${profileId} and r.organization_id=${organizationId} and r.result='yes'
      and r.visit_started_on is not null and (r.expires_on is null or r.expires_on>${today}::date))`;
}

/** Read-only: callers supply their consistent snapshot or hold the manufacturer lock for publication. */
export async function loadSiteSurveyState(tx: Database, scope: SiteSurveyScope, asOfDate?: string) {
  const asOfAlmatyDate = asOfDate ?? (await tx.execute<{ day: string }>(
    sql`select (clock_timestamp() at time zone 'Asia/Almaty')::date::text as day`,
  )).rows[0]!.day;
  const payload = (await tx.execute<{ records: unknown[]; reports: SurveyReportEvidence[] }>(sql`
    with records as(select r.* from site_survey_record r
      where r.profile_id=${scope.profileId} and r.organization_id=${scope.organizationId})
    select coalesce((select jsonb_agg(site_survey_record_view(to_jsonb(r))) from records r),'[]'::jsonb) as records,
      coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'fileObjectId',v.file_object_id,'versionNumber',v.version_number,
        'organizationId',f.organization_id,'purpose',f.purpose,'dataClass',f.data_class,'scanState',v.scan_state,
        'purgeRequested',f.purge_requested_at is not null))
        from records r join file_version v on v.id=r.file_version_id and v.file_object_id=r.file_object_id
        join file_object f on f.id=v.file_object_id and f.organization_id=r.organization_id),'[]'::jsonb) as reports`)).rows[0]!;
  const records: SiteSurveyRecordView[] = payload.records.map(record =>
    parseResponse(siteSurveyRecordViewSchema, record, 'обследование площадки'));
  return { asOfAlmatyDate, records, ...effectiveSurveyState(scope, records, payload.reports, asOfAlmatyDate) };
}
