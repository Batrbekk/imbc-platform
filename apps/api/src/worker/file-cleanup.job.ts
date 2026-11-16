import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { isUuid } from '../common/actor-transaction.js';
import { AuditService } from '../common/audit.service.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Database } from '../database/database.module.js';
import { boundLockWaits } from '../database/lock-waits.js';
import { QUEUE } from '../infra/infra.module.js';
import { type FileCleanupJobData, QUEUES } from '../jobs/queues.js';
import {
  claimUnusedProfileUpload,
  CLEANUP_UPLOAD_PURPOSES,
  finishFilePurge,
  UNUSED_PROFILE_UPLOAD_TTL_MS,
} from '../modules/files/file-cleanup.js';
import { OBJECT_STORAGE, type ObjectStorage, storageFailureSummary } from '../modules/files/object-storage.js';

const SWEEP_BATCH = 100;

/** Claims commit before storage deletion; retries keep claims and remove either bucket idempotently. */
@Injectable()
export class FileCleanupJob {
  private readonly logger = new Logger(FileCleanupJob.name);
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    @Inject(QUEUE) private readonly queue: PgBoss,
  ) {}

  async run(data: FileCleanupJobData, now: Date = new Date()): Promise<'purged' | 'skipped'> {
    if (!data || typeof data.fileObjectId !== 'string' || !isUuid(data.fileObjectId)) return 'skipped';
    const claim = await this.db.transaction(async (tx) => {
      await boundLockWaits(tx);
      return claimUnusedProfileUpload(tx as Database, data.fileObjectId, now);
    });
    if (!claim) return 'skipped';
    try {
      for (const version of claim.versions) {
        await this.storage.remove(this.env.S3_BUCKET_QUARANTINE, version.storageKey);
        await this.storage.remove(this.env.S3_BUCKET_FILES, version.storageKey);
      }
    } catch (error) {
      this.logger.warn(
        { fileObjectId: claim.fileObjectId, ...storageFailureSummary(error) },
        'File purge storage unavailable',
      );
      throw new Error('File purge storage unavailable');
    }
    const removed = await this.db.transaction(async (tx) => {
      await boundLockWaits(tx);
      const deleted = await finishFilePurge(tx as Database, claim);
      if (deleted)
        await this.audit.record(
          {
            userId: null,
            organizationId: claim.organizationId,
            action: 'file.orphan_purged',
            objectType: 'file_object',
            objectId: claim.fileObjectId,
            diff: { versionCount: claim.versions.length },
          },
          tx,
        );
      return deleted;
    });
    return removed ? 'purged' : 'skipped';
  }

  async sweep(now: Date = new Date()): Promise<{ enqueued: number }> {
    const cutoff = new Date(now.getTime() - UNUSED_PROFILE_UPLOAD_TTL_MS);
    // Filtering owners before LIMIT prevents old bound files from starving later orphan candidates.
    const { rows } = await this.db.execute<{ id: string }>(sql`
      select f.id from file_object f where f.data_class='b_manufacturer'
        and f.purpose::text=any(${sql.param(CLEANUP_UPLOAD_PURPOSES)}::text[])
        and (f.purge_requested_at is not null or
          (coalesce((select max(v.uploaded_at) from file_version v where v.file_object_id=f.id),f.created_at)<${cutoff}::timestamptz
           and not exists(select 1 from file_version v where v.file_object_id=f.id and v.scan_state='pending')))
        and not public.file_has_references(f.id)
      order by f.purge_requested_at nulls last,f.id limit ${SWEEP_BATCH}`);
    let enqueued = 0;
    for (const { id } of rows) {
      const job = await this.queue.send(QUEUES.fileCleanup, { fileObjectId: id } satisfies FileCleanupJobData, {
        singletonKey: id,
      });
      if (job) enqueued++;
    }
    return { enqueued };
  }
}
