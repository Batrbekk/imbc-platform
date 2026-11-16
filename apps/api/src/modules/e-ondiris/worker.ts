import type pg from 'pg';
import { QUEUES } from '../../jobs/queues.js';
import type { EOndirisCapture, EOndirisCaptureResult } from './capture.js';
import { EOndirisSnapshotStore } from './ingestion.js';
import { requestEOndirisProfileRefresh } from './profile-outbox.js';
import { EOndirisProfileRefreshService } from './profile-refresh.service.js';

export const E_ONDIRIS_QUEUES = { daily: QUEUES.eOndirisDaily, refresh: QUEUES.eOndirisProfileRefresh } as const;
export const E_ONDIRIS_DAILY_SCHEDULE = { queue: E_ONDIRIS_QUEUES.daily, cron: '0 4 * * *' } as const;
export type EOndirisFeedResult =
  | { kind: 'received'; captures: EOndirisCapture[] }
  | Extract<EOndirisCaptureResult, { kind: 'unavailable' | 'quarantined' }>;
export interface EOndirisFeedConnector {
  configured: boolean;
  pull(signal?: AbortSignal): Promise<EOndirisFeedResult>;
}

interface PendingProfileRefresh {
  bin: string;
  requested_observed_at: string;
  requested_scope_hash: string;
  last_attempt_at: string | null;
}

/** There is no approved upstream access/coverage/observation protocol. Never report an empty successful daily copy. */
export class DisabledEOndirisFeedConnector implements EOndirisFeedConnector {
  readonly configured = false;
  async pull(): Promise<EOndirisFeedResult> {
    return { kind: 'unavailable', reason: 'access_not_configured' };
  }
}

/** Workers return only operational counts/status; no raw source body or manufacturer contacts in pg-boss output. */
export class EOndirisWorker {
  constructor(
    private readonly pool: pg.Pool,
    private readonly connector: EOndirisFeedConnector,
    private readonly store: EOndirisSnapshotStore,
    private readonly profiles: EOndirisProfileRefreshService,
  ) {}

  async daily(
    signal?: AbortSignal,
  ): Promise<{ state: 'disabled' | 'unavailable' | 'quarantined' | 'processed'; accepted: number; rejected: number }> {
    if (!this.connector.configured) return { state: 'disabled', accepted: 0, rejected: 0 };
    let feed: EOndirisFeedResult;
    try {
      feed = await this.connector.pull(signal);
    } catch {
      return { state: 'unavailable', accepted: 0, rejected: 0 };
    }
    if (feed.kind !== 'received') return { state: feed.kind, accepted: 0, rejected: 0 };
    // One assembled feed has one scope per BIN; never accept independent pages at the same observation time.
    if (new Set(feed.captures.map((capture) => capture.bin)).size !== feed.captures.length)
      return { state: 'quarantined', accepted: 0, rejected: 0 };
    let accepted = 0,
      rejected = 0;
    for (const capture of [...feed.captures].sort((a, b) => a.bin.localeCompare(b.bin, 'en'))) {
      const result = await this.store.ingest(capture, undefined, requestEOndirisProfileRefresh);
      if (result.kind === 'accepted') accepted++;
      else rejected++;
    }
    return { state: 'processed', accepted, rejected };
  }

  /** Recovery scan for the transactional outbox. Duplicate workers are safe under profile/BIN serialization. */
  async refreshPending(
    limit = 25,
  ): Promise<{ processed: number; deferred: number; ambiguous: number; failed: number }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid source refresh batch size');
    const { rows } = await this.pool.query<PendingProfileRefresh>(
      `SELECT bin,requested_observed_at::text,requested_scope_hash,last_attempt_at::text FROM e_ondiris_profile_refresh
      WHERE state IN ('pending','deferred','ambiguous') AND (last_attempt_at IS NULL OR last_attempt_at<now()-interval '30 seconds')
      ORDER BY e_ondiris_profile_refresh.last_attempt_at ASC NULLS FIRST,bin LIMIT $1`,
      [limit],
    );
    let processed = 0,
      deferred = 0,
      ambiguous = 0,
      failed = 0;
    for (const request of rows) {
      try {
        const result = await this.profiles.applyBin(request.bin);
        if (result.kind === 'deferred') deferred++;
        else if (result.kind === 'ambiguous') ambiguous++;
        else processed++;
      } catch {
        // applyBin rolls back the entire COW transaction. A blocked file or one bad BIN must
        // not interrupt unrelated profiles. No error body, source contact or storage key is emitted.
        failed++;
        await this.retryFailedRequest(request);
      }
    }
    return { processed, deferred, ambiguous, failed };
  }

  /** Stamp only the selected request; a newer source capture or another completed attempt wins. */
  private async retryFailedRequest(request: PendingProfileRefresh): Promise<void> {
    let client: pg.PoolClient | undefined;
    let discard = false;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2s'");
      await client.query("SET LOCAL statement_timeout='5s'");
      await client.query(
        `UPDATE e_ondiris_profile_refresh
        SET state='deferred',attempt_count=attempt_count+1,last_attempt_at=now()
        WHERE bin=$1 AND requested_observed_at=$2 AND requested_scope_hash=$3
          AND last_attempt_at IS NOT DISTINCT FROM $4::timestamptz
          AND state IN ('pending','deferred','ambiguous')`,
        [request.bin, request.requested_observed_at, request.requested_scope_hash, request.last_attempt_at],
      );
      await client.query('COMMIT');
    } catch {
      // A failed retry stamp leaves the original request retryable. It never acknowledges
      // applied source facts or cancels the remaining batch when the database recovers.
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
      }
    } finally {
      client?.release(discard);
    }
  }
}
