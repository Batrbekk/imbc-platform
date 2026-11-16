import type pg from 'pg';
import { MainSourceRefreshService } from './main-source-refresh.service.js';

interface PendingMainSource {
  profile_id: string;
  requested_attempt_id: string;
  requested_completed_at: string;
  requested_state: string;
  last_attempt_at: string | null;
}

/** Worker-only local recovery, with fair ordering and isolated, bounded per-request failures. */
export class MainSourceWorker {
  constructor(
    private readonly pool: pg.Pool,
    private readonly profiles: MainSourceRefreshService,
  ) {}
  async refreshPending(limit = 25): Promise<{ processed: number; deferred: number; failed: number }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid Main source batch size');
    const { rows } = await this.pool.query<PendingMainSource>(
      `SELECT profile_id,requested_attempt_id,requested_completed_at::text,requested_state,last_attempt_at::text FROM main_source_refresh_outbox
      WHERE state IN ('pending','deferred') AND (last_attempt_at IS NULL OR last_attempt_at<now()-interval '30 seconds')
      ORDER BY last_attempt_at ASC NULLS FIRST,profile_id LIMIT $1`,
      [limit],
    );
    let processed = 0,
      deferred = 0,
      failed = 0;
    for (const request of rows) {
      try {
        const result = await this.profiles.applyProfile(request.profile_id);
        if (result === 'deferred') deferred++;
        else processed++;
      } catch {
        failed++;
        await this.retryFailedRequest(request);
      }
    }
    return { processed, deferred, failed };
  }
  private async retryFailedRequest(request: PendingMainSource): Promise<void> {
    let client: pg.PoolClient | undefined,
      discard = false;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2s'");
      await client.query("SET LOCAL statement_timeout='5s'");
      await client.query(
        `UPDATE main_source_refresh_outbox SET state='deferred',attempt_count=attempt_count+1,last_attempt_at=now()
        WHERE profile_id=$1 AND requested_attempt_id=$2 AND requested_completed_at=$3::timestamptz AND requested_state=$4 AND last_attempt_at IS NOT DISTINCT FROM $5::timestamptz AND state IN ('pending','deferred')`,
        [
          request.profile_id,
          request.requested_attempt_id,
          request.requested_completed_at,
          request.requested_state,
          request.last_attempt_at,
        ],
      );
      await client.query('COMMIT');
    } catch {
      if (client)
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
    } finally {
      client?.release(discard);
    }
  }
}
