import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../../database/database.module.js";
import type { SiteSurveyRecordView, SiteSurveySummary } from "@imbc/contracts";
import {
  normalizeSurveyRecord,
  type SurveyStoredRecord,
} from "./survey-store.js";

export type SurveyMutationPhase =
  "audit" | "sealed" | "record_written" | "projection";
export type SurveyMutationHook = (
  phase: SurveyMutationPhase,
  tx: Database,
) => Promise<void>;
/** Root implements this with durable generation observation, exact catalog publication and NOT11 outbox. */
export const SITE_SURVEY_PUBLICATION = Symbol("SITE_SURVEY_PUBLICATION");
export interface SurveyPublicationObservation {
  readonly profileId: string;
  readonly organizationId: string;
  readonly asOfAlmatyDate: string;
  readonly effectiveBefore: {
    readonly summary: SiteSurveySummary;
    readonly effectiveUntil: string | null;
  };
  readonly persistedBefore: {
    readonly siteSurveyed: boolean;
    readonly generation: bigint;
    readonly effectiveUntil: string | null;
  };
}
export interface SurveyPublication {
  /** Read and lock only. No intermediate publication/outbox is written before the final mutation. */
  observeBeforeMutation(
    tx: Database,
    scope: { profileId: string; organizationId: string },
  ): Promise<SurveyPublicationObservation>;
  refreshAfterMutation(
    tx: Database,
    scope: { profileId: string; organizationId: string },
    observation: SurveyPublicationObservation,
  ): Promise<void>;
}

/** Full audit and transaction-bound hash seal precede DML; Root's deferred guard proves final state at COMMIT. */
export async function replaceSurveyRecord(
  tx: Database,
  input: {
    actorId: string;
    ip: string | null;
    before: SurveyStoredRecord | null;
    after: SurveyStoredRecord;
    beforeView: SiteSurveyRecordView | null;
    afterView: SiteSurveyRecordView;
    idempotencyKey: string | null;
    requestFingerprint: string | null;
    hook?: SurveyMutationHook;
  },
): Promise<void> {
  const operationId = randomUUID();
  const after = await normalizeSurveyRecord(tx, input.after);
  const action = input.before ? "site_survey.updated" : "site_survey.created";
  const diff = {
    operationId,
    actor: { type: "user", id: input.actorId },
    before: input.before,
    after,
    beforeView: input.beforeView,
    afterView: input.afterView,
    requestFingerprint: input.requestFingerprint,
  };
  const auditId = (
    await tx.execute<{ id: string }>(sql`
    insert into audit_entries(at,user_id,organization_id,action,object_type,object_id,outcome,diff,ip)
    values(${after.updated_at}::timestamptz,${input.actorId},${after.organization_id},${action},'site_survey_record',${after.id},'ok',${JSON.stringify(diff)}::jsonb,${input.ip}::inet) returning id`)
  ).rows[0]!.id;
  await input.hook?.("audit", tx);
  await tx.execute(sql`insert into site_survey_operation(id,survey_record_id,profile_id,organization_id,actor_id,action,
    idempotency_key,request_fingerprint,audit_entry_id,before_record_hash,after_record_hash)
    values(${operationId},${after.id},${after.profile_id},${after.organization_id},${input.actorId},${action},
      ${input.idempotencyKey},${input.requestFingerprint},${auditId},
      ${input.before === null ? sql`null::text` : sql`encode(sha256(convert_to((${JSON.stringify(input.before)}::jsonb)::text,'UTF8')),'hex')`},
      encode(sha256(convert_to((${JSON.stringify(after)}::jsonb)::text,'UTF8')),'hex'))`);
  await tx.execute(
    sql`select set_config('imbc.site_survey_operation_id',${operationId},true)`,
  );
  await input.hook?.("sealed", tx);
  if (input.before === null)
    await tx.execute(
      sql`insert into site_survey_record select * from jsonb_populate_record(null::site_survey_record,${JSON.stringify(after)}::jsonb)`,
    );
  else
    await tx.execute(sql`update site_survey_record r set visit_started_on=n.visit_started_on,visit_ended_on=n.visit_ended_on,
    result=n.result,file_object_id=n.file_object_id,file_version_id=n.file_version_id,expires_on=n.expires_on,comment=n.comment,updated_at=n.updated_at
    from jsonb_populate_record(null::site_survey_record,${JSON.stringify(after)}::jsonb) n
    where r.id=${after.id} and r.profile_id=${after.profile_id} and r.organization_id=${after.organization_id}`);
  await input.hook?.("record_written", tx);
}
