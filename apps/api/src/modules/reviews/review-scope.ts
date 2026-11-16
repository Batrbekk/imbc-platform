import type { Action } from '@imbc/contracts';
import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { auditActorDenial, busy, lockActor } from '../../common/actor-transaction.js';
import type { AuditService } from '../../common/audit.service.js';
import { ProblemException } from '../../common/problem.js';
import type { Database } from '../../database/database.module.js';
import { boundLockWaits, lockWaitExceeded } from '../../database/lock-waits.js';
import { copyTransactionOutcome, withQueueTransaction, type QueueDb } from '../../database/transaction.js';
import type { AuthUser } from '../auth/auth.types.js';

export class ReviewScopeDenied extends ProblemException {
  constructor() {
    super(403, 'forbidden', 'Нет прав на это рассмотрение.');
  }
}
const logger = new Logger('ReviewActions');

/** Session claims never establish IMBC scope; the actor is already locked and policy-checked. */
export async function assertReviewActor(tx: Database, actor: AuthUser, expectedRole: 'expert' | 'administrator') {
  const actual = (
    await tx.execute<{ organizationId: string; role: string }>(sql`
    select a.organization_id as "organizationId",a.role from user_accounts a
    join organizations o on o.id=a.organization_id
    where a.id=${actor.id} and a.state='active' and o.type='imbc' for share of o`)
  ).rows[0];
  if (!actual || actual.role !== expectedRole || actual.organizationId !== actor.organizationId)
    throw new ReviewScopeDenied();
}

export async function runReviewAction<T>(
  pool: pg.Pool,
  audit: AuditService,
  actor: AuthUser,
  options: {
    action: Extract<Action, 'review.take' | 'review.assign' | 'profile.read' | 'profile.verify'>;
    role: 'expert' | 'administrator';
    route: string;
    ip: string | null;
    targetId?: string;
  },
  work: (tx: Database, queueDb: QueueDb) => Promise<T>,
): Promise<T> {
  try {
    return await auditActorDenial(
      audit,
      actor,
      options.route,
      options.ip,
      async () => {
        try {
          return await withQueueTransaction(pool, async (tx, queueDb) => {
            await boundLockWaits(tx);
            // Lock actor and optional target together in UUID order, before any profile lock.
            await lockActor(tx, actor.id, options.targetId, options.action);
            await assertReviewActor(tx, actor, options.role);
            return work(tx, queueDb);
          });
        } catch (error) {
          if (lockWaitExceeded(error)) throw copyTransactionOutcome(error, busy());
          throw error;
        }
      },
      options.action,
    );
  } catch (error) {
    if (error instanceof ReviewScopeDenied) {
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
      } catch {
        logger.warn('Review action denial audit unavailable');
      }
    }
    throw error;
  }
}
