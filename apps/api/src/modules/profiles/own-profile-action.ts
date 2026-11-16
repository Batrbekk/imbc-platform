import { Logger } from '@nestjs/common';
import type pg from 'pg';
import { actorTransaction, type QueueDb } from '../../common/actor-transaction.js';
import type { AuditService } from '../../common/audit.service.js';
import type { Database } from '../../database/database.module.js';
import { databaseErrorSummary } from '../../database/pg-errors.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ownProfile, OwnProfileDenied, ownSections, type StoredProfile, type StoredSection } from './profile-store.js';

const logger = new Logger('OwnProfileActions');
export interface OwnProfileActionGraph {
  profile: StoredProfile;
  sections: StoredSection[];
}

/** Trusted actor/profile/section locks and atomic audit/queue for manufacturer lifecycle actions. */
export async function runOwnProfileAction<T>(
  pool: pg.Pool,
  audit: AuditService,
  actor: AuthUser,
  options: { action: 'profile.read' | 'profile.edit'; route: string; ip: string | null },
  run: (tx: Database, queueDb: QueueDb, graph: OwnProfileActionGraph) => Promise<T>,
): Promise<T> {
  try {
    return await actorTransaction(pool, audit, actor, options, async (tx, queueDb) => {
      const profile = await ownProfile(tx, actor);
      const sections = await ownSections(tx, profile.id, profile.organizationId);
      return run(tx, queueDb, { profile, sections });
    });
  } catch (error) {
    if (error instanceof OwnProfileDenied) {
      try {
        await audit.record({
          userId: actor.id,
          organizationId: actor.organizationId,
          action: options.action,
          objectType: 'route',
          objectId: options.route,
          outcome: 'denied',
          ip: options.ip,
        });
      } catch (auditError) {
        logger.error(
          databaseErrorSummary(auditError) ?? { name: auditError instanceof Error ? auditError.name : 'unknown' },
          'Own-profile denial audit failed',
        );
      }
    }
    throw error;
  }
}
