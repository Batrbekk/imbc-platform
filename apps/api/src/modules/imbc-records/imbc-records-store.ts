import { randomUUID } from 'node:crypto';
import { imbcRecordReadSchema, type ImbcRecordKind, type ImbcRecordRead } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import { parseResponse } from '../../common/response.js';
import type { Database } from '../../database/database.module.js';
import type { ImbcRecordsScope } from './imbc-records-scope.js';

export type NativeRow = Record<string, unknown> & { profile_id: string; organization_id: string; created_at: string; updated_at: string; source: 'expert' | 'migration' };
export type NativeSnapshot = { row: NativeRow; sources: Record<string,string>[]; eoiEvents: NativeRow[] };
export type RecordsMutationHook = (phase: 'audit' | 'sealed' | 'row_written' | 'children_written', tx: Database) => Promise<void>;
export async function readSnapshot(tx: Database, scope: ImbcRecordsScope, kind: ImbcRecordKind, id: string): Promise<NativeSnapshot | null> {
  return (await tx.execute<{ snapshot: NativeSnapshot | null }>(sql`select imbc_records_snapshot(${kind},${id}::uuid,${scope.profileId}::uuid,${scope.organizationId}::uuid) as snapshot`)).rows[0]!.snapshot;
}
export async function normalizeSnapshot(tx: Database, kind: ImbcRecordKind, snapshot: NativeSnapshot): Promise<NativeSnapshot> {
  return (await tx.execute<{ snapshot: NativeSnapshot }>(sql`select imbc_records_normalize(${kind},${JSON.stringify(snapshot)}::jsonb) as snapshot`)).rows[0]!.snapshot;
}
export async function recordView(tx: Database, kind: ImbcRecordKind, snapshot: NativeSnapshot): Promise<ImbcRecordRead> {
  const view = (await tx.execute<{ view: unknown }>(sql`select imbc_records_view(${kind},${JSON.stringify(snapshot)}::jsonb) as view`)).rows[0]!.view;
  return parseResponse(imbcRecordReadSchema, view, 'запись IMBC');
}
export async function recordClock(tx: Database, before: NativeSnapshot | null): Promise<string> {
  return (await tx.execute<{ at: string }>(sql`select imbc_records_utc6(greatest(clock_timestamp(),
    coalesce(${before?.row.updated_at ?? null}::timestamptz+interval '1 microsecond','-infinity'::timestamptz))) as at`)).rows[0]!.at;
}
/** Audit and native snapshot seal precede all parent/child DML; deferred guard proves full final state. */
export async function replaceSnapshot(tx: Database, input: {
  scope: ImbcRecordsScope; kind: ImbcRecordKind; id: string; actorId: string; ip: string | null;
  before: NativeSnapshot | null; after: NativeSnapshot; idempotencyKey: string; requestFingerprint: string; hook?: RecordsMutationHook;
}): Promise<ImbcRecordRead> {
  const operationId = randomUUID();
  const after = await normalizeSnapshot(tx, input.kind, input.after);
  const beforeView = input.before ? await recordView(tx, input.kind, input.before) : null;
  const afterView = await recordView(tx, input.kind, after);
  const action = `imbc_${input.kind}.${input.before ? 'updated' : 'created'}`;
  const diff = { operationId, actor: { type: 'user', id: input.actorId }, before: input.before, after,
    beforeView, afterView, requestFingerprint: input.requestFingerprint };
  const auditId = (await tx.execute<{ id: string }>(sql`
    insert into audit_entries(at,user_id,organization_id,action,object_type,object_id,outcome,diff,ip)
    values(${after.row.updated_at}::timestamptz,${input.actorId},${input.scope.organizationId},${action},${'imbc_'+input.kind},${input.id},'ok',${JSON.stringify(diff)}::jsonb,${input.ip}::inet) returning id`)).rows[0]!.id;
  await input.hook?.('audit', tx);
  await tx.execute(sql`insert into imbc_records_operation(id,record_kind,record_id,profile_id,organization_id,actor_id,action,
    idempotency_key,request_fingerprint,audit_entry_id,before_record_hash,after_record_hash)
    values(${operationId},${input.kind},${input.id},${input.scope.profileId},${input.scope.organizationId},${input.actorId},${action},
    ${input.idempotencyKey},${input.requestFingerprint},${auditId},null,'sealed-by-trigger')`);
  await tx.execute(sql`select set_config('imbc.records_operation_id',${operationId},true)`);
  await input.hook?.('sealed', tx);
  const payload = JSON.stringify(after.row);
  const table = sql.identifier('imbc_'+input.kind);
  if (input.before === null) await tx.execute(sql`insert into ${table} select * from jsonb_populate_record(null::${table},${payload}::jsonb)`);
  else if (input.kind === 'note') await tx.execute(sql`update imbc_note set body=${after.row.body}::text,updated_at=${after.row.updated_at}::timestamptz
    where id=${input.id} and profile_id=${input.scope.profileId} and organization_id=${input.scope.organizationId}`);
  else if (input.kind === 'product_context') await tx.execute(sql`update imbc_product_context set programme_id=${after.row.programme_id}::uuid,
    priority_id=${after.row.priority_id}::uuid,updated_at=${after.row.updated_at}::timestamptz where product_line_identity_id=${input.id}
    and profile_id=${input.scope.profileId} and organization_id=${input.scope.organizationId}`);
  else await tx.execute(sql`update imbc_engagement r set receipt_confirmed=n.receipt_confirmed,response=n.response,
    response_summary=n.response_summary,ready_for_site_visit=n.ready_for_site_visit,added_to_imbc_year=n.added_to_imbc_year,
    folder_url=n.folder_url,updated_at=n.updated_at from jsonb_populate_record(null::imbc_engagement,${payload}::jsonb) n
    where r.profile_id=${input.scope.profileId} and r.organization_id=${input.scope.organizationId}`);
  await input.hook?.('row_written', tx);
  if (input.kind === 'engagement') {
    const oldSources = new Set(input.before?.sources.map(s => s.source_entry_id) ?? []);
    const newSources = new Set(after.sources.map(s => s.source_entry_id));
    for (const old of [...oldSources].sort()) if (!newSources.has(old)) await tx.execute(sql`
      delete from imbc_engagement_source where profile_id=${input.scope.profileId} and organization_id=${input.scope.organizationId} and source_entry_id=${old}`);
    for (const entry of after.sources) if (!oldSources.has(entry.source_entry_id)) await tx.execute(sql`
      insert into imbc_engagement_source select * from jsonb_populate_record(null::imbc_engagement_source,${JSON.stringify(entry)}::jsonb)`);
    const oldEvents = new Map(input.before?.eoiEvents.map(e => [e.id,e]) ?? []);
    for (const event of after.eoiEvents) {
      const old = oldEvents.get(event.id);
      if (!old) await tx.execute(sql`insert into imbc_eoi_email_event select * from jsonb_populate_record(null::imbc_eoi_email_event,${JSON.stringify(event)}::jsonb)`);
      else if (old.sent_on !== event.sent_on) await tx.execute(sql`update imbc_eoi_email_event set sent_on=${event.sent_on}::date,
        updated_at=${event.updated_at}::timestamptz where id=${event.id}::uuid and profile_id=${input.scope.profileId} and organization_id=${input.scope.organizationId}`);
    }
  }
  await input.hook?.('children_written', tx);
  return afterView;
}
