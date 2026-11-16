import { parseSurveyInput } from "./survey-parse.js";
import { createHash, randomUUID } from "node:crypto";
import {
  siteSurveyCreateSchema,
  siteSurveyUpdateSchema,
  siteSurveyIdempotencyKeySchema,
  siteSurveyListQuerySchema,
  siteSurveyListReadSchema,
  siteSurveyRecordViewSchema,
  siteSurveyHistoryQuerySchema,
  siteSurveyHistorySchema,
  type SiteSurveyCreate,
  type SiteSurveyRecordView,
  type SiteSurveyListRead,
  type SiteSurveyHistory,
} from "@imbc/contracts";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type pg from "pg";
import { isUuid, notFound } from "../../common/actor-transaction.js";
import { AuditService } from "../../common/audit.service.js";
import { ProblemException } from "../../common/problem.js";
import { parseResponse } from "../../common/response.js";
import { PG_POOL, type Database } from "../../database/database.module.js";
import type { AuthUser } from "../auth/auth.types.js";
import { profileSurveyTier } from "./effective-survey.js";
import { captureSurveyReport } from "./survey-report.js";
import { runSurveyAction, type SurveyScope } from "./survey-scope.js";
import {
  lockedSurveyRecord,
  normalizeSurveyRecord,
  surveyClock,
  surveyViews,
  surveySummary,
  type SurveyStoredRecord,
} from "./survey-store.js";
import {
  replaceSurveyRecord,
  SITE_SURVEY_PUBLICATION,
  type SurveyPublication,
  type SurveyMutationHook,
} from "./survey-operation.js";

const ROUTE = "v1/profiles/:profileId/site-surveys";
const conflict = () =>
  new ProblemException(
    409,
    "conflict",
    "Ключ операции уже использован для другого обследования.",
  );
const changed = () =>
  new ProblemException(
    409,
    "conflict",
    "Обследование изменилось. Обновите запись.",
  );
const canonical = (body: SiteSurveyCreate) => ({
  ...body,
  reportFileId: body.reportFileId.toLowerCase(),
});
export const surveyCreateFingerprint = (body: SiteSurveyCreate) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        visitStartedOn: body.visitStartedOn,
        visitEndedOn: body.visitEndedOn,
        result: body.result,
        expiresOn: body.expiresOn,
        comment: body.comment,
        reportFileId: body.reportFileId.toLowerCase(),
      }),
    )
    .digest("hex");

@Injectable()
export class SiteSurveyService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly audit: AuditService,
    @Inject(SITE_SURVEY_PUBLICATION)
    private readonly publication: SurveyPublication,
  ) {}
  list(
    actor: AuthUser,
    profileId: string,
    query: unknown,
    ip: string | null = null,
  ): Promise<SiteSurveyListRead> {
    const filter = parseSurveyInput(siteSurveyListQuerySchema, query);
    return runSurveyAction(
      this.pool,
      this.audit,
      actor,
      { mode: "staff_read", profileId, route: ROUTE, ip },
      async (tx, _queueDb, scope) => {
        const payload = (
          await tx.execute<{
            records: SurveyStoredRecord[];
            total: string;
          }>(sql`
        with filtered as(select * from site_survey_record where profile_id=${scope!.profileId} and organization_id=${scope!.organizationId}),
        page as(select * from filtered order by visit_started_on desc,recorded_at desc,id desc limit ${filter.limit} offset ${filter.offset})
        select coalesce((select jsonb_agg(to_jsonb(p) order by visit_started_on desc,recorded_at desc,id desc) from page p),'[]'::jsonb) as records,
          (select count(*) from filtered)::text as total`)
        ).rows[0]!;
        const summary = await surveySummary(tx, scope!);
        return parseResponse(
          siteSurveyListReadSchema,
          {
            ...scope,
            summary,
            tier: profileSurveyTier(
              scope!.profileStatus === "verified",
              summary.siteSurveyed,
            ),
            canEdit: actor.role === "expert",
            items: await surveyViews(tx, scope!, payload.records),
            total: Number(payload.total),
            ...filter,
          },
          "обследования",
        );
      },
    );
  }
  read(
    actor: AuthUser,
    profileId: string,
    recordId: string,
    ip: string | null = null,
  ): Promise<SiteSurveyRecordView> {
    if (!isUuid(recordId)) throw notFound();
    return runSurveyAction(
      this.pool,
      this.audit,
      actor,
      { mode: "staff_read", profileId, route: ROUTE + "/:recordId", ip },
      async (tx, _queueDb, scope) => {
        const row = await lockedSurveyRecord(tx, scope!, recordId);
        if (!row) throw notFound();
        return (await surveyViews(tx, scope!, [row]))[0]!;
      },
    );
  }
  create(
    actor: AuthUser,
    profileId: string,
    body: unknown,
    idempotency: unknown,
    ip: string | null = null,
    hook?: SurveyMutationHook,
  ): Promise<SiteSurveyRecordView> {
    const input = canonical(parseSurveyInput(siteSurveyCreateSchema, body));
    const key = parseSurveyInput(
      siteSurveyIdempotencyKeySchema,
      idempotency,
    ).toLowerCase();
    const fingerprint = surveyCreateFingerprint(input);
    return runSurveyAction(
      this.pool,
      this.audit,
      actor,
      { mode: "staff_edit", profileId, route: ROUTE, ip },
      async (tx, _queueDb, scope) => {
        const replay = await this.replayCreate(
          tx,
          scope!,
          actor.id,
          key,
          fingerprint,
        );
        if (replay) return replay;
        const observation = await this.publication.observeBeforeMutation(
          tx,
          scope!,
        );
        const at = await surveyClock(tx, null);
        const version = await captureSurveyReport(
          tx,
          scope!,
          input.reportFileId,
          null,
        );
        if (!version)
          throw new Error("Expert survey requires a captured signed report");
        const after = await normalizeSurveyRecord(tx, {
          id: randomUUID(),
          profile_id: scope!.profileId,
          organization_id: scope!.organizationId,
          visit_started_on: input.visitStartedOn,
          visit_ended_on: input.visitEndedOn,
          result: input.result,
          file_object_id: input.reportFileId,
          file_version_id: version,
          expires_on: input.expiresOn,
          comment: input.comment,
          source: "expert",
          recorded_by: actor.id,
          recorded_at: at,
          updated_at: at,
        });
        const receipt = (await surveyViews(tx, scope!, [after]))[0]!;
        await replaceSurveyRecord(tx, {
          actorId: actor.id,
          ip,
          before: null,
          after,
          beforeView: null,
          afterView: receipt,
          idempotencyKey: key,
          requestFingerprint: fingerprint,
          hook,
        });
        await this.publication.refreshAfterMutation(tx, scope!, observation);
        await hook?.("projection", tx);
        return receipt;
      },
    );
  }
  update(
    actor: AuthUser,
    profileId: string,
    recordId: string,
    body: unknown,
    ip: string | null = null,
    hook?: SurveyMutationHook,
  ): Promise<SiteSurveyRecordView> {
    if (!isUuid(recordId)) throw notFound();
    const input = parseSurveyInput(siteSurveyUpdateSchema, body);
    return runSurveyAction(
      this.pool,
      this.audit,
      actor,
      { mode: "staff_edit", profileId, route: ROUTE + "/:recordId", ip },
      async (tx, _queueDb, scope) => {
        const before = await lockedSurveyRecord(tx, scope!, recordId);
        if (!before) throw notFound();
        const matches = (
          await tx.execute<{ matches: boolean }>(
            sql`select ${before.updated_at}::timestamptz=${input.expectedUpdatedAt}::timestamptz as matches`,
          )
        ).rows[0]!.matches;
        if (!matches) throw changed();
        const observation = await this.publication.observeBeforeMutation(
          tx,
          scope!,
        );
        const beforeView = (await surveyViews(tx, scope!, [before]))[0]!;
        const fileId = input.reportFileId?.toLowerCase() ?? null;
        const version = await captureSurveyReport(tx, scope!, fileId, before);
        const after = await normalizeSurveyRecord(tx, {
          ...before,
          visit_started_on: input.visitStartedOn,
          visit_ended_on: input.visitEndedOn,
          result: input.result,
          expires_on: input.expiresOn,
          comment: input.comment,
          file_object_id: fileId,
          file_version_id: version,
          updated_at: await surveyClock(tx, before),
        });
        const receipt = (await surveyViews(tx, scope!, [after]))[0]!;
        await replaceSurveyRecord(tx, {
          actorId: actor.id,
          ip,
          before,
          after,
          beforeView,
          afterView: receipt,
          idempotencyKey: null,
          requestFingerprint: null,
          hook,
        });
        await this.publication.refreshAfterMutation(tx, scope!, observation);
        await hook?.("projection", tx);
        return receipt;
      },
    );
  }
  history(
    actor: AuthUser,
    profileId: string,
    recordId: string,
    query: unknown,
    ip: string | null = null,
  ): Promise<SiteSurveyHistory> {
    if (!isUuid(recordId)) throw notFound();
    const filter = parseSurveyInput(siteSurveyHistoryQuerySchema, query);
    return runSurveyAction(
      this.pool,
      this.audit,
      actor,
      {
        mode: "staff_read",
        profileId,
        route: ROUTE + "/:recordId/history",
        ip,
      },
      async (tx, _queueDb, scope) => {
        if (!(await lockedSurveyRecord(tx, scope!, recordId))) throw notFound();
        if (
          filter.beforeId &&
          !(
            await tx.execute(sql`select a.id from site_survey_operation op join audit_entries a on a.id=op.audit_entry_id
        where a.id=${filter.beforeId} and op.survey_record_id=${recordId} and op.profile_id=${scope!.profileId} and op.organization_id=${scope!.organizationId}`)
          ).rows.length
        )
          throw notFound();
        const rows = (
          await tx.execute<{
            id: string;
            at: string;
            action: string;
            actorName: string | null;
            diff: {
              before: SurveyStoredRecord | null;
              after: SurveyStoredRecord;
            };
          }>(sql`
        select a.id,to_char(a.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,a.action,actor.full_name as "actorName",a.diff
        from site_survey_operation op join audit_entries a on a.id=op.audit_entry_id
        left join user_accounts actor on actor.id=a.user_id
        where op.survey_record_id=${recordId} and op.profile_id=${scope!.profileId} and op.organization_id=${scope!.organizationId}
          and a.object_type='site_survey_record' and a.object_id=op.survey_record_id::text and a.organization_id=op.organization_id
          and a.user_id=op.actor_id and a.action=op.action and a.outcome='ok'
        ${filter.beforeId ? sql`and (a.at,a.id)<(select at,id from audit_entries where id=${filter.beforeId})` : sql``}
        order by a.at desc,a.id desc limit ${filter.limit + 1}`)
        ).rows;
        const page = rows.slice(0, filter.limit);
        const raw = page.flatMap((row) =>
          row.diff.before
            ? [row.diff.before, row.diff.after]
            : [row.diff.after],
        );
        const views = await surveyViews(tx, scope!, raw);
        let index = 0;
        return parseResponse(
          siteSurveyHistorySchema,
          {
            items: page.map((row) => ({
              id: row.id,
              at: row.at,
              action: row.action,
              actorName: row.actorName,
              before: row.diff.before ? views[index++] : null,
              after: views[index++],
            })),
            nextCursor: rows.length > filter.limit ? page.at(-1)!.id : null,
          },
          "история обследования",
        );
      },
    );
  }
  private async replayCreate(
    tx: Database,
    scope: SurveyScope,
    actorId: string,
    key: string,
    fingerprint: string,
  ): Promise<SiteSurveyRecordView | null> {
    const row = (
      await tx.execute<{
        profileId: string;
        organizationId: string;
        fingerprint: string;
        action: string;
        recordId: string;
        recordedAt: string;
        updatedAt: string;
        valid: boolean;
        diff: { after: SurveyStoredRecord; afterView: unknown };
      }>(sql`
      select op.profile_id as "profileId",op.organization_id as "organizationId",op.request_fingerprint as fingerprint,op.action,op.survey_record_id as "recordId",a.diff,
        to_char((a.diff#>>'{after,recorded_at}')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "recordedAt",
        to_char((a.diff#>>'{after,updated_at}')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt",
        a.user_id=op.actor_id and a.action=op.action and a.organization_id=op.organization_id and a.outcome='ok'
        and a.object_type='site_survey_record' and a.object_id=op.survey_record_id::text
        and a.diff->>'operationId'=op.id::text and a.diff#>>'{actor,id}'=op.actor_id::text as valid
      from site_survey_operation op left join audit_entries a on a.id=op.audit_entry_id
      where op.actor_id=${actorId} and op.idempotency_key=${key}
        `)
    ).rows[0];
    if (!row) return null;
    if (
      row.action !== "site_survey.created" ||
      row.profileId !== scope.profileId ||
      row.organizationId !== scope.organizationId ||
      row.fingerprint !== fingerprint
    )
      throw conflict();
    if (!row.valid)
      throw new Error("Survey creation replay has no exact sealed audit");
    const receipt = parseResponse(
      siteSurveyRecordViewSchema,
      row.diff.afterView,
      "подтверждение создания обследования",
    );
    const raw = row.diff.after;
    if (
      receipt.id !== row.recordId ||
      receipt.id !== raw.id ||
      receipt.profileId !== scope.profileId ||
      receipt.organizationId !== scope.organizationId ||
      receipt.reportFileId !== raw.file_object_id ||
      receipt.reportFileVersionId !== raw.file_version_id ||
      receipt.visitStartedOn !== raw.visit_started_on ||
      receipt.visitEndedOn !== raw.visit_ended_on ||
      receipt.result !== raw.result ||
      receipt.expiresOn !== raw.expires_on ||
      receipt.comment !== raw.comment ||
      receipt.source !== raw.source ||
      receipt.recordedBy !== raw.recorded_by ||
      receipt.recordedAt !== row.recordedAt ||
      receipt.updatedAt !== row.updatedAt
    )
      throw new Error("Survey creation receipt differs from its sealed record");
    return receipt;
  }
}
