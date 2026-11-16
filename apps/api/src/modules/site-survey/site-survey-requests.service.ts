import { parseSurveyInput } from "./survey-parse.js";
import { randomUUID } from "node:crypto";
import {
  siteSurveyIdempotencyKeySchema,
  siteSurveyRequestInputSchema,
  siteSurveyRequestListQuerySchema,
  siteSurveyRequestReadSchema,
  siteSurveyRequestListSchema,
  type SiteSurveyRequestRead,
  type SiteSurveyRequestList,
} from "@imbc/contracts";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type pg from "pg";
import { AuditService } from "../../common/audit.service.js";
import { ProblemException } from "../../common/problem.js";
import { parseResponse } from "../../common/response.js";
import { PG_POOL, type Database } from "../../database/database.module.js";
import type { AuthUser } from "../auth/auth.types.js";
import { runSurveyAction, type SurveyScope } from "./survey-scope.js";

const OWN_ROUTE = "v1/profiles/:profileId/site-survey-requests";
const conflict = () =>
  new ProblemException(
    409,
    "conflict",
    "Ключ уже использован для другого запроса обследования.",
  );
const literalLike = (name: string) => `%${name.replace(/[!%_]/g, "!$&")}%`;
type RequestStored = {
  id: string;
  profile_id: string;
  organization_id: string;
  requested_by: string;
  requested_at: string;
  idempotency_key: string;
  audit_entry_id: string;
  transaction_id: string;
};

@Injectable()
export class SiteSurveyRequestsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly audit: AuditService,
  ) {}
  ownList(
    actor: AuthUser,
    profileId: string,
    query: unknown,
    ip: string | null = null,
  ): Promise<SiteSurveyRequestList> {
    const filter = parseSurveyInput(siteSurveyRequestListQuerySchema, query);
    return runSurveyAction(
      this.pool,
      this.audit,
      actor,
      { mode: "own_requests", profileId, route: OWN_ROUTE, ip },
      async (tx, _queueDb, scope) => this.page(tx, filter, scope!),
    );
  }
  queue(
    actor: AuthUser,
    query: unknown,
    ip: string | null = null,
  ): Promise<SiteSurveyRequestList> {
    const filter = parseSurveyInput(siteSurveyRequestListQuerySchema, query);
    return runSurveyAction(
      this.pool,
      this.audit,
      actor,
      { mode: "expert_requests", route: "v1/site-survey-requests", ip },
      async (tx) => this.page(tx, filter, null),
    );
  }
  request(
    actor: AuthUser,
    profileId: string,
    body: unknown,
    idempotency: unknown,
    ip: string | null = null,
  ): Promise<SiteSurveyRequestRead> {
    parseSurveyInput(siteSurveyRequestInputSchema, body);
    const key = parseSurveyInput(
      siteSurveyIdempotencyKeySchema,
      idempotency,
    ).toLowerCase();
    return runSurveyAction(
      this.pool,
      this.audit,
      actor,
      { mode: "own_requests", profileId, route: OWN_ROUTE, ip },
      async (tx, _queueDb, scope) => {
        const prior = (
          await tx.execute<{
            id: string;
            profileId: string;
            organizationId: string;
            requestedBy: string;
            requestedAt: string;
            view: unknown;
            valid: boolean;
          }>(sql`
        select r.id,r.profile_id as "profileId",r.organization_id as "organizationId",r.requested_by as "requestedBy",
          to_char(r.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "requestedAt",a.diff->'afterView' as view,
          a.user_id=r.requested_by and a.organization_id=r.organization_id and a.action='site_survey.requested'
          and a.object_type='site_survey_request' and a.object_id=r.id::text and a.outcome='ok' as valid
        from site_survey_request r left join audit_entries a on a.id=r.audit_entry_id
        where r.requested_by=${actor.id} and r.idempotency_key=${key}`)
        ).rows[0];
        if (prior) {
          if (
            prior.profileId !== scope!.profileId ||
            prior.organizationId !== scope!.organizationId
          )
            throw conflict();
          if (!prior.valid)
            throw new Error("Survey request replay has no exact audit");
          const receipt = parseResponse(
            siteSurveyRequestReadSchema,
            prior.view,
            "запрос обследования",
          );
          if (
            receipt.id !== prior.id ||
            receipt.profileId !== prior.profileId ||
            receipt.organizationId !== prior.organizationId ||
            receipt.requestedBy !== prior.requestedBy ||
            receipt.requestedAt !== prior.requestedAt
          )
            throw new Error(
              "Survey request receipt differs from its sealed record",
            );
          return receipt;
        }
        if (scope!.profileStatus !== "verified")
          throw new ProblemException(
            409,
            "site_survey_request_requires_verified",
            "Запросить обследование можно из подтверждённого профиля.",
          );
        const id = randomUUID(),
          auditId = randomUUID();
        const raw = (
          await tx.execute<{ record: RequestStored }>(sql`
        select to_jsonb(jsonb_populate_record(null::site_survey_request,jsonb_build_object(
          'id',${id}::uuid,'profile_id',${scope!.profileId}::uuid,'organization_id',${scope!.organizationId}::uuid,
          'requested_by',${actor.id}::uuid,'requested_at',clock_timestamp(),'idempotency_key',${key}::uuid,
          'audit_entry_id',${auditId}::uuid,'transaction_id',pg_current_xact_id()::text))) as record`)
        ).rows[0]!.record;
        const timestamp = (
          await tx.execute<{ at: string }>(
            sql`select to_char(${raw.requested_at}::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at`,
          )
        ).rows[0]!.at;
        const receipt = parseResponse(
          siteSurveyRequestReadSchema,
          {
            id,
            profileId: scope!.profileId,
            organizationId: scope!.organizationId,
            organizationName: scope!.organizationName,
            requestedBy: actor.id,
            requestedAt: timestamp,
          },
          "запрос обследования",
        );
        await tx.execute(sql`insert into audit_entries(id,at,user_id,organization_id,action,object_type,object_id,outcome,diff,ip)
        values(${auditId},${raw.requested_at}::timestamptz,${actor.id},${scope!.organizationId},'site_survey.requested','site_survey_request',${id},'ok',
          ${JSON.stringify({ actor: { type: "user", id: actor.id }, before: null, after: raw, afterView: receipt })}::jsonb,${ip}::inet)`);
        await tx.execute(
          sql`insert into site_survey_request select * from jsonb_populate_record(null::site_survey_request,${JSON.stringify(raw)}::jsonb)`,
        );
        // A request creates no survey, report, projection or notification. Later intentional requests use another UUID key.
        return receipt;
      },
    );
  }
  private async page(
    tx: Database,
    filter: {
      offset: number;
      limit: number;
      name?: string;
      profileId?: string;
    },
    own: SurveyScope | null,
  ): Promise<SiteSurveyRequestList> {
    const payload = (
      await tx.execute<{ payload: unknown }>(sql`
      with filtered as(select r.*,o.name as organization_name from site_survey_request r
        join manufacturer_profile p on p.id=r.profile_id and p.organization_id=r.organization_id
        join organizations o on o.id=p.organization_id and o.type='manufacturer'
        where true ${own ? sql`and r.profile_id=${own.profileId} and r.organization_id=${own.organizationId}` : sql``}
          ${filter.profileId ? sql`and r.profile_id=${filter.profileId}` : sql``}
          ${filter.name ? sql`and o.name ilike ${literalLike(filter.name)} escape '!'` : sql``}),
      page as(select * from filtered order by requested_at,id limit ${filter.limit} offset ${filter.offset})
      select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'profileId',r.profile_id,
        'organizationId',r.organization_id,'organizationName',r.organization_name,'requestedBy',r.requested_by,
        'requestedAt',to_char(r.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by r.requested_at,r.id) from page r),'[]'::jsonb),
        'total',(select count(*) from filtered),'offset',${filter.offset}::integer,'limit',${filter.limit}::integer) as payload`)
    ).rows[0]!.payload;
    return parseResponse(
      siteSurveyRequestListSchema,
      payload,
      "запросы обследования",
    );
  }
}
