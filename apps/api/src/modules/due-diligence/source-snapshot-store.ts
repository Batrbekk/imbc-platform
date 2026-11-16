import { sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { evaluateReceivedDiligence } from './scoring.js';
import type { DiligenceSourceReceipt } from './source-receipt.js';

export type DiligenceReceiptInput = DiligenceSourceReceipt & {
  profileId: string;
  organizationId: string;
  attemptId: string;
};

/**
 * Called in the EXACT Adata terminal transaction after its attempt update. Timestamp/state come directly
 * from PostgreSQL, preserving all six digits. A quota/config retry of the same ID is a distinct completion.
 * No explicit profile lock: its composite FK takes KEY SHARE, compatible with DD's NO KEY UPDATE.
 */
export async function recordDiligenceSourceReceipt(tx: Database, input: DiligenceReceiptInput): Promise<string | null> {
  const evaluation = input.state === 'received' ? evaluateReceivedDiligence(input.evidence) : null;
  if (evaluation && !evaluation.checks.some((check) => check.mark !== 'no_answer'))
    throw new Error('Received diligence receipt has no answered checks');
  if ((evaluation?.automaticResult ?? null) !== input.automaticResult)
    throw new Error('Diligence receipt evaluation mismatch');
  if (!['received', 'no_answer'].includes(input.state) && input.evidence.length !== 0)
    throw new Error('Unavailable diligence receipt contains evidence');
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into diligence_source_snapshot
      (profile_id,organization_id,attempt_id,terminal_state,normalized_state,completed_at,
       schema_version,schema_sha256,is_test_data,evidence,evaluation)
    select c.profile_id,c.organization_id,a.id,a.state::text,${input.state},a.completed_at,
      ${input.schemaVersion},${input.schemaSha256},${input.isTestData},${JSON.stringify(input.evidence)}::jsonb,
      ${evaluation === null ? null : JSON.stringify(evaluation)}::jsonb
    from external_check c join external_check_attempt a on a.external_check_id=c.id and c.latest_attempt_id=a.id
    where c.profile_id=${input.profileId} and c.organization_id=${input.organizationId} and c.connector='adata'
      and a.id=${input.attemptId} and a.completed_at is not null
      and a.is_test_data=${input.isTestData}
      and ((a.state='received' and ${input.state} in ('received','no_answer','modules_not_connected','malformed'))
        or (a.state='unavailable' and ${input.state}=case when a.failure='module_off' then 'modules_not_connected'
          when a.failure='malformed' then 'malformed' else 'unavailable' end)
        or (a.state in ('not_configured','quota_exhausted') and a.state::text=${input.state}))
      and a.state in ('received','unavailable','not_configured','quota_exhausted')
    on conflict(attempt_id,completed_at,terminal_state) do nothing returning id`);
  let id = rows[0]?.id;
  if (!id) {
    const old = (
      await tx.execute<{ id: string; equal: boolean }>(sql`
      select s.id, s.normalized_state=${input.state} and s.schema_version=${input.schemaVersion}
        and s.schema_sha256=${input.schemaSha256} and s.is_test_data=${input.isTestData}
        and s.evidence=${JSON.stringify(input.evidence)}::jsonb
        and s.evaluation is not distinct from ${evaluation === null ? null : JSON.stringify(evaluation)}::jsonb as equal
      from diligence_source_snapshot s join external_check_attempt a on a.id=s.attempt_id
        and a.completed_at=s.completed_at and a.state::text=s.terminal_state
      join external_check c on c.id=a.external_check_id and c.latest_attempt_id=a.id
      where s.profile_id=${input.profileId} and s.organization_id=${input.organizationId}
        and a.id=${input.attemptId} and c.connector='adata'`)
    ).rows[0];
    if (!old) return null;
    if (!old.equal) throw new Error('Immutable diligence receipt already has different content');
    id = old.id;
  }
  await tx.execute(sql`
    insert into diligence_refresh_outbox(profile_id,organization_id,requested_snapshot_id,state)
    select s.profile_id,s.organization_id,s.id,'pending' from diligence_source_snapshot s
    join external_check c on c.profile_id=s.profile_id and c.organization_id=s.organization_id and c.connector='adata'
    join external_check_attempt a on a.id=c.latest_attempt_id and a.id=s.attempt_id
      and a.completed_at=s.completed_at and a.state::text=s.terminal_state
    where s.id=${id}
    on conflict(profile_id) do update set requested_snapshot_id=excluded.requested_snapshot_id,
      state=case when diligence_refresh_outbox.applied_snapshot_id=excluded.requested_snapshot_id then 'applied' else 'pending' end,
      attempt_count=case when diligence_refresh_outbox.requested_snapshot_id=excluded.requested_snapshot_id
        then diligence_refresh_outbox.attempt_count else 0 end,
      last_attempt_at=case when diligence_refresh_outbox.requested_snapshot_id=excluded.requested_snapshot_id
        then diligence_refresh_outbox.last_attempt_at else null end`);
  return id;
}
