import type { Action } from "@imbc/contracts";
import { Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type pg from "pg";
import {
  actorTransaction,
  isUuid,
  notFound,
} from "../../common/actor-transaction.js";
import type { AuditService } from "../../common/audit.service.js";
import { policyForTransaction } from "../../common/policy.js";
import { ProblemException } from "../../common/problem.js";
import type { Database } from "../../database/database.module.js";
import type { QueueDb } from "../../database/transaction.js";
import type { AuthUser } from "../auth/auth.types.js";

export type SurveyScope = {
  profileId: string;
  organizationId: string;
  organizationName: string;
  profileStatus: string;
};
class SurveyScopeDenied extends ProblemException {
  constructor() {
    super(403, "forbidden", "Нет прав на это обследование.");
  }
}
class SurveyOwnScopeDenied extends ProblemException {
  constructor() {
    super(404, "not_found", "Не найдено");
  }
}
const logger = new Logger("SiteSurvey");
type ActorMode =
  "staff_read" | "staff_edit" | "expert_requests" | "own_requests";
const actionFor = (mode: ActorMode): Action =>
  mode === "staff_edit"
    ? "imbc_records.edit"
    : mode === "own_requests"
      ? "tier.request"
      : "imbc_records.read";

/** Actor lock precedes profile, record and file locks; authorization never follows a record's former author. */
export async function assertSurveyActor(
  tx: Database,
  actor: AuthUser,
  mode: ActorMode,
): Promise<void> {
  const actual = (
    await tx.execute<{
      role: string;
      organizationId: string;
      type: string;
    }>(sql`
    select a.role,a.organization_id as "organizationId",o.type from user_accounts a
    join organizations o on o.id=a.organization_id where a.id=${actor.id} and a.state='active' for share of o`)
  ).rows[0];
  const own = mode === "own_requests";
  if (
    !actual ||
    actual.organizationId !== actor.organizationId ||
    actual.role !== actor.role ||
    (own
      ? actual.type !== "manufacturer" || actual.role !== "manufacturer"
      : actual.type !== "imbc" ||
        (mode === "staff_read"
          ? !["expert", "director"].includes(actual.role)
          : actual.role !== "expert"))
  )
    throw new SurveyScopeDenied();
  const policy = await policyForTransaction(tx);
  if (
    policy.can(actual.role as AuthUser["role"], actionFor(mode), "c_imbc") !==
    (own ? "own" : "all")
  )
    throw new SurveyScopeDenied();
}

export async function lockSurveyProfile(
  tx: Database,
  profileId: string,
  actor: AuthUser,
  own: boolean,
): Promise<SurveyScope> {
  if (!isUuid(profileId)) throw notFound();
  const scope = (
    await tx.execute<SurveyScope>(sql`
    select p.id as "profileId",p.organization_id as "organizationId",o.name as "organizationName",p.status as "profileStatus"
    from manufacturer_profile p join organizations o on o.id=p.organization_id and o.type='manufacturer'
    where p.id=${profileId} ${own ? sql`and p.organization_id=${actor.organizationId}` : sql``} for no key update of p`)
  ).rows[0];
  if (!scope) {
    // The same 404 hides foreign and missing profiles while GEN-08 still records the scope refusal.
    if (own) throw new SurveyOwnScopeDenied();
    throw notFound();
  }
  return scope;
}

export async function runSurveyAction<T>(
  pool: pg.Pool,
  audit: AuditService,
  actor: AuthUser,
  options: {
    mode: ActorMode;
    route: string;
    ip: string | null;
    profileId?: string;
  },
  work: (
    tx: Database,
    queueDb: QueueDb,
    scope: SurveyScope | null,
  ) => Promise<T>,
): Promise<T> {
  try {
    return await actorTransaction(
      pool,
      audit,
      actor,
      { action: actionFor(options.mode), route: options.route, ip: options.ip },
      async (tx, queueDb) => {
        await assertSurveyActor(tx, actor, options.mode);
        const scope = options.profileId
          ? await lockSurveyProfile(
              tx,
              options.profileId,
              actor,
              options.mode === "own_requests",
            )
          : null;
        return work(tx, queueDb, scope);
      },
    );
  } catch (error) {
    if (
      error instanceof SurveyScopeDenied ||
      error instanceof SurveyOwnScopeDenied
    ) {
      try {
        await audit.record({
          userId: actor.id,
          organizationId: actor.organizationId,
          action: actionFor(options.mode),
          objectType: "route",
          objectId: options.route,
          outcome: "denied",
          ip: options.ip,
        });
      } catch {
        logger.warn("Site survey denial audit unavailable");
      }
    }
    throw error;
  }
}
