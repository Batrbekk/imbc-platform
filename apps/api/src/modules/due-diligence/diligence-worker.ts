import type pg from 'pg';
import { DiligenceService } from './diligence.service.js';
type Pending = {
  profile_id: string;
  organization_id: string;
  requested_snapshot_id: string;
  last_attempt_at: string | null;
};

/** Fair bounded recovery; failure CAS cannot delay a newer completion or overwrite a concurrently applied cursor. */
export class DiligenceWorker {
  constructor(
    private readonly pool: pg.Pool,
    private readonly diligence: DiligenceService,
  ) {}
  async refreshPending(limit = 25): Promise<{ processed: number; deferred: number; failed: number }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid diligence batch size');
    const { rows } = await this.pool.query<Pending>(
      `select profile_id,organization_id,requested_snapshot_id,last_attempt_at::text
      from diligence_refresh_outbox where state='pending' and (last_attempt_at is null or last_attempt_at<now()-interval '30 seconds')
      order by last_attempt_at asc nulls first,profile_id limit $1`,
      [limit],
    );
    let processed = 0,
      deferred = 0,
      failed = 0;
    for (const request of rows) {
      try {
        if (await this.diligence.refresh(request.profile_id, request.organization_id)) processed++;
        else {
          deferred++;
          await this.defer(request);
        }
      } catch {
        failed++;
        await this.defer(request);
      }
    }
    return { processed, deferred, failed };
  }
  private async defer(request: Pending): Promise<void> {
    let client: pg.PoolClient | undefined,
      discard = false;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2s'");
      await client.query("SET LOCAL statement_timeout='5s'");
      await client.query(
        `update diligence_refresh_outbox set last_attempt_at=clock_timestamp(),attempt_count=attempt_count+1
        where profile_id=$1 and organization_id=$2 and requested_snapshot_id=$3 and state='pending'
          and last_attempt_at is not distinct from $4::timestamptz`,
        [request.profile_id, request.organization_id, request.requested_snapshot_id, request.last_attempt_at],
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
