import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { rebuildVerifiedCatalogProjection } from './catalog-projection.js';

/** PostgreSQL's complete row JSON, including exact timestamps and report version pins. Never a JS Date. */
export type DiligenceStoredRecord = {
  profile_id: string;
  organization_id: string;
  checked_on: string;
  adata_result: 'green' | 'amber' | 'red' | null;
  result: 'green' | 'amber' | 'red';
  comment: string | null;
  report_file_id: string | null;
  report_file_version_id: string | null;
  overridden_by: string | null;
  overridden_at: string | null;
  enhanced: 'done' | 'not_done';
  enhanced_comment: string | null;
  enhanced_report_file_id: string | null;
  enhanced_report_file_version_id: string | null;
  source_snapshot_id: string | null;
  updated_at: string;
};
export type DiligenceStoredCheck = {
  id: string;
  profile_id: string;
  organization_id: string;
  group_name: string;
  subject_name: string;
  check_name: string;
  adata_value: string | null;
  mark: 'clear' | 'finding' | 'shown_only' | 'no_answer';
  attention: boolean;
  position: number;
};
export type DiligenceStoredState = { record: DiligenceStoredRecord | null; checks: DiligenceStoredCheck[] };
export type DiligenceOperationPhase =
  'audit' | 'sealed' | 'checks_deleted' | 'record_written' | 'checks_written' | 'projection';
export type DiligenceOperationHook = (phase: DiligenceOperationPhase, tx: Database) => Promise<void>;

export async function storedDiligenceState(
  tx: Database,
  profileId: string,
  organizationId: string,
): Promise<DiligenceStoredState> {
  return (
    await tx.execute<DiligenceStoredState>(sql`
    select (select to_jsonb(r) from due_diligence_record r where r.profile_id=${profileId} and r.organization_id=${organizationId}) as record,
      coalesce((select jsonb_agg(to_jsonb(c) order by c.position,c.id) from due_diligence_check c
        where c.profile_id=${profileId} and c.organization_id=${organizationId}),'[]'::jsonb) as checks`)
  ).rows[0]!;
}

/** The token advances by at least one microsecond even when two writes share a transaction clock. */
export async function diligenceOperationClock(
  tx: Database,
  old: DiligenceStoredRecord | null,
): Promise<{ at: string; date: string }> {
  return (
    await tx.execute<{ at: string; date: string }>(sql`
    select to_char(greatest(clock_timestamp(),coalesce(${old?.updated_at ?? null}::timestamptz + interval '1 microsecond','-infinity'::timestamptz))
      at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,
      (clock_timestamp() at time zone 'Asia/Almaty')::date::text as date`)
  ).rows[0]!;
}

/**
 * Insert full audit first, then seal it in SQL, mutate rows, verify projection, and defer one full after
 * comparison to commit. SQL guards bind the seal to this transaction; an old audit cannot authorise DML.
 * Caller locks the profile first. One operation per profile/transaction is enforced in PostgreSQL.
 */
export async function replaceDiligenceState(
  tx: Database,
  input: {
    profileId: string;
    organizationId: string;
    before: DiligenceStoredState;
    after: DiligenceStoredState;
    action:
      'due_diligence.received' | 'due_diligence.override' | 'due_diligence.enhanced' | 'due_diligence.legacy_import';
    actorId: string | null;
    ip?: string | null;
    hook?: DiligenceOperationHook;
  },
): Promise<string> {
  const operationId = randomUUID();
  // Coerce through the actual row type before audit so PG timestamp/UUID/enum JSON is exactly reproducible.
  const after = (
    await tx.execute<DiligenceStoredState>(sql`
    select ${input.after.record === null ? sql`null::jsonb` : sql`to_jsonb(jsonb_populate_record(null::due_diligence_record,${JSON.stringify(input.after.record)}::jsonb))`} as record,
      coalesce((select jsonb_agg(to_jsonb(c) order by c.position,c.id)
        from jsonb_populate_recordset(null::due_diligence_check,${JSON.stringify(input.after.checks)}::jsonb) c),'[]'::jsonb) as checks`)
  ).rows[0]!;
  const diff = {
    operationId,
    actor: input.actorId === null ? { type: 'system' } : { type: 'user', id: input.actorId },
    before: input.before,
    after,
  };
  const auditId = (
    await tx.execute<{ id: string }>(sql`
    insert into audit_entries(user_id,organization_id,action,object_type,object_id,outcome,diff,ip)
    values (${input.actorId},${input.organizationId},${input.action},'due_diligence',${input.profileId},'ok',${JSON.stringify(diff)}::jsonb,${input.ip ?? null}::inet) returning id`)
  ).rows[0]!.id;
  await input.hook?.('audit', tx);
  await tx.execute(sql`insert into diligence_operation(id,profile_id,organization_id,audit_entry_id)
    values (${operationId},${input.profileId},${input.organizationId},${auditId})`);
  await tx.execute(sql`select set_config('imbc.diligence_operation_id',${operationId},true)`);
  await input.hook?.('sealed', tx);
  await tx.execute(
    sql`delete from due_diligence_check where profile_id=${input.profileId} and organization_id=${input.organizationId}`,
  );
  await input.hook?.('checks_deleted', tx);
  if (after.record === null) {
    await tx.execute(
      sql`delete from due_diligence_record where profile_id=${input.profileId} and organization_id=${input.organizationId}`,
    );
  } else if (input.before.record !== null) {
    // UPDATE preserves OLD in the report guard: an independent enhanced edit must not re-capture an
    // unchanged historical version merely because a new, possibly unscanned candidate was uploaded.
    await tx.execute(sql`update due_diligence_record r set checked_on=n.checked_on,adata_result=n.adata_result,
      result=n.result,comment=n.comment,report_file_id=n.report_file_id,report_file_version_id=n.report_file_version_id,
      overridden_by=n.overridden_by,overridden_at=n.overridden_at,enhanced=n.enhanced,enhanced_comment=n.enhanced_comment,
      enhanced_report_file_id=n.enhanced_report_file_id,enhanced_report_file_version_id=n.enhanced_report_file_version_id,
      source_snapshot_id=n.source_snapshot_id,updated_at=n.updated_at
      from jsonb_populate_record(null::due_diligence_record,${JSON.stringify(after.record)}::jsonb) n
      where r.profile_id=${input.profileId} and r.organization_id=${input.organizationId}`);
  } else {
    await tx.execute(
      sql`insert into due_diligence_record select * from jsonb_populate_record(null::due_diligence_record,${JSON.stringify(after.record)}::jsonb)`,
    );
  }
  await input.hook?.('record_written', tx);
  if (after.checks.length)
    await tx.execute(
      sql`insert into due_diligence_check select * from jsonb_populate_recordset(null::due_diligence_check,${JSON.stringify(after.checks)}::jsonb)`,
    );
  await input.hook?.('checks_written', tx);
  await rebuildVerifiedCatalogProjection(tx, input);
  await input.hook?.('projection', tx);
  return operationId;
}
