import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { isUuid } from '../../common/actor-transaction.js';
import { PG_POOL } from '../../database/database.module.js';
import { boundLockWaits } from '../../database/lock-waits.js';
import { withQueueTransaction } from '../../database/transaction.js';
import { rebuildVerifiedCatalogProjection } from './catalog-projection.js';

/** Background refresh uses the same exact verified graph and DD visibility gate as synchronous publication. */
@Injectable()
export class CatalogProjectionRefreshService {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}
  async refresh(input: unknown): Promise<boolean> {
    if (
      !input ||
      typeof input !== 'object' ||
      !('profileId' in input) ||
      typeof input.profileId !== 'string' ||
      !isUuid(input.profileId)
    )
      return false;
    const profileId = input.profileId;
    return withQueueTransaction(this.pool, async (tx) => {
      await boundLockWaits(tx);
      const profile = (
        await tx.execute<{
          organizationId: string;
        }>(sql`select organization_id as "organizationId" from manufacturer_profile
        where id=${profileId} for no key update`)
      ).rows[0];
      if (!profile) return false;
      return rebuildVerifiedCatalogProjection(tx, { profileId, organizationId: profile.organizationId });
    });
  }
}
