import type pg from 'pg';
import type { EOndirisIngestionResult } from './ingestion.js';

/** Called on the ingester's exact transaction/connection after its whole-BIN watermark update. */
export async function requestEOndirisProfileRefresh(
  client: pg.PoolClient,
  result: Extract<EOndirisIngestionResult, { kind: 'accepted' }>,
): Promise<void> {
  await client.query(
    `INSERT INTO e_ondiris_profile_refresh(bin,requested_observed_at,requested_scope_hash)
    SELECT bin,accepted_observed_at,accepted_scope_hash FROM e_ondiris_sync_scope WHERE bin=$1
    ON CONFLICT(bin) DO UPDATE SET requested_observed_at=EXCLUDED.requested_observed_at,
      requested_scope_hash=EXCLUDED.requested_scope_hash,state='pending',last_attempt_at=NULL`,
    [result.bin],
  );
}
