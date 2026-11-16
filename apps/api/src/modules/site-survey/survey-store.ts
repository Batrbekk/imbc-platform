import {
  siteSurveyRecordViewSchema,
  type SiteSurveyRecordView,
  type SiteSurveySummary,
} from "@imbc/contracts";
import { sql } from "drizzle-orm";
import { parseResponse } from "../../common/response.js";
import type { Database } from "../../database/database.module.js";
import {
  selectEffectiveSurvey,
  type SurveyReportEvidence,
} from "./effective-survey.js";
import type { SurveyScope } from "./survey-scope.js";

/** Full native PostgreSQL JSON row. Dates/timestamps remain strings, with no JS millisecond roundtrip. */
export type SurveyStoredRecord = {
  id: string;
  profile_id: string;
  organization_id: string;
  visit_started_on: string;
  visit_ended_on: string | null;
  result: "yes" | "no";
  file_object_id: string | null;
  file_version_id: string | null;
  expires_on: string | null;
  comment: string | null;
  source: "expert" | "migration";
  recorded_by: string | null;
  recorded_at: string;
  updated_at: string;
};
export async function lockedSurveyRecord(
  tx: Database,
  scope: SurveyScope,
  id: string,
): Promise<SurveyStoredRecord | null> {
  return (
    (
      await tx.execute<{
        record: SurveyStoredRecord;
      }>(sql`select to_jsonb(r) as record from site_survey_record r
    where r.id=${id} and r.profile_id=${scope.profileId} and r.organization_id=${scope.organizationId} for no key update`)
    ).rows[0]?.record ?? null
  );
}
export async function surveyClock(
  tx: Database,
  old: SurveyStoredRecord | null,
): Promise<string> {
  return (
    await tx.execute<{
      at: string;
    }>(sql`select to_char(greatest(clock_timestamp(),coalesce(${old?.updated_at ?? null}::timestamptz+interval '1 microsecond','-infinity'::timestamptz))
    at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at`)
  ).rows[0]!.at;
}
export async function normalizeSurveyRecord(
  tx: Database,
  row: SurveyStoredRecord,
): Promise<SurveyStoredRecord> {
  return (
    await tx.execute<{ record: SurveyStoredRecord }>(
      sql`select to_jsonb(jsonb_populate_record(null::site_survey_record,${JSON.stringify(row)}::jsonb)) as record`,
    )
  ).rows[0]!.record;
}

/** Exact pin hydration is batched for both current rows and old full-audit rows, including retired/inactive authors. */
export async function surveyViews(
  tx: Database,
  scope: SurveyScope,
  records: readonly SurveyStoredRecord[],
): Promise<SiteSurveyRecordView[]> {
  if (!records.length) return [];
  const payload = (
    await tx.execute<{ items: SiteSurveyRecordView[] }>(sql`
    with raw as(select value as r,ordinality from jsonb_array_elements(${JSON.stringify(records)}::jsonb) with ordinality)
    select jsonb_agg(jsonb_build_object('id',r->>'id','profileId',r->>'profile_id','organizationId',r->>'organization_id',
      'visitStartedOn',r->>'visit_started_on','visitEndedOn',r->>'visit_ended_on','result',r->>'result',
      'reportFileId',r->>'file_object_id','reportFileVersionId',r->>'file_version_id','reportFileVersionNumber',v.version_number,
      'expiresOn',r->>'expires_on','comment',r->>'comment','source',r->>'source','recordedBy',r->>'recorded_by',
      'recordedAt',to_char((r->>'recorded_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'updatedAt',to_char((r->>'updated_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'needsReconciliation',false,'recordedByName',actor.full_name,
      'report',case when r->>'file_object_id' is null then null else jsonb_build_object(
        'fileId',r->>'file_object_id','versionId',v.id,'versionNumber',v.version_number,'originalName',v.original_name,
        'byteSize',v.byte_size,'mediaType',v.detected_media_type,'scanState',v.scan_state,'rejectionReason',v.rejection_reason,
        'uploadedAt',to_char(v.uploaded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'canDownload',v.scan_state='passed' and f.purge_requested_at is null) end) order by raw.ordinality) as items
    from raw left join file_object f on f.id::text=r->>'file_object_id' and f.organization_id=${scope.organizationId}
      and f.purpose='site_survey_report' and f.data_class='c_imbc'
    left join file_version v on v.id::text=r->>'file_version_id' and v.file_object_id=f.id
    left join user_accounts actor on actor.id::text=r->>'recorded_by'
    where r->>'profile_id'=${scope.profileId} and r->>'organization_id'=${scope.organizationId}`)
  ).rows[0]!.items;
  if (payload.length !== records.length)
    throw new Error("Survey row scope or immutable pin unavailable");
  return payload.map((row) =>
    parseResponse(siteSurveyRecordViewSchema, row, "обследование"),
  );
}

/** Read-only truth is independent of paged records and of current DD/operator visibility. */
export async function surveySummary(
  tx: Database,
  scope: SurveyScope,
): Promise<SiteSurveySummary> {
  const records = (
    await tx.execute<{ record: SurveyStoredRecord }>(
      sql`select to_jsonb(r) as record from site_survey_record r where r.profile_id=${scope.profileId} and r.organization_id=${scope.organizationId}`,
    )
  ).rows.map((row) => row.record);
  const views = await surveyViews(tx, scope, records);
  const versions = records.flatMap((row) =>
    row.file_version_id ? [row.file_version_id] : [],
  );
  const reports = versions.length
    ? (
        await tx.execute<SurveyReportEvidence & Record<string, unknown>>(sql`
    select v.id,v.file_object_id as "fileObjectId",v.version_number as "versionNumber",f.organization_id as "organizationId",
      f.purpose,f.data_class as "dataClass",v.scan_state as "scanState",f.purge_requested_at is not null as "purgeRequested"
    from file_version v join file_object f on f.id=v.file_object_id where v.id=any(${sql.param(versions)}::uuid[]) and f.organization_id=${scope.organizationId}`)
      ).rows
    : [];
  const date = (
    await tx.execute<{ day: string }>(
      sql`select (clock_timestamp() at time zone 'Asia/Almaty')::date::text as day`,
    )
  ).rows[0]!.day;
  return selectEffectiveSurvey(scope, views, reports, date);
}
