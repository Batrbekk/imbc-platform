import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { actorTransaction, isUuid } from '../../common/actor-transaction.js';
import type { AuditService } from '../../common/audit.service.js';
import { policyForTransaction } from '../../common/policy.js';
import { ProblemException } from '../../common/problem.js';
import type { Database } from '../../database/database.module.js';
import type { AuthUser } from '../auth/auth.types.js';

export type ImbcRecordsScope = { profileId: string; organizationId: string; organizationName: string };
class RecordsDenied extends ProblemException { constructor() { super(403, 'forbidden', 'Нет прав на записи IMBC.'); } }
class RecordsScopeMissing extends ProblemException { constructor() { super(404, 'not_found', 'Не найдено'); } }
export const recordsNotFound = () => new RecordsScopeMissing();
const logger = new Logger('ImbcRecords');

/** Persisted actor -> organisation -> manufacturer lock. The original author never grants access. */
export async function runRecordsAction<T>(pool: pg.Pool, audit: AuditService, actor: AuthUser,
  options: { edit: boolean; route: string; ip: string | null; profileId: string },
  work: (tx: Database, scope: ImbcRecordsScope) => Promise<T>): Promise<T> {
  const action = options.edit ? 'imbc_records.edit' : 'imbc_records.read';
  try {
    return await actorTransaction(pool, audit, actor, { action, route: options.route, ip: options.ip }, async tx => {
      const actual = (await tx.execute<{ role: AuthUser['role']; organizationId: string; type: string }>(sql`
        select a.role,a.organization_id as "organizationId",o.type from user_accounts a
        join organizations o on o.id=a.organization_id where a.id=${actor.id} and a.state='active' for share of o`)).rows[0];
      if (!actual || actual.role !== actor.role || actual.organizationId !== actor.organizationId || actual.type !== 'imbc'
        || (options.edit ? actual.role !== 'expert' : !['expert','director'].includes(actual.role))) throw new RecordsDenied();
      const policy = await policyForTransaction(tx);
      if (policy.can(actual.role, action, 'c_imbc') !== 'all') throw new RecordsDenied();
      if (!isUuid(options.profileId)) throw recordsNotFound();
      const scope = (await tx.execute<ImbcRecordsScope>(sql`
        select p.id as "profileId",p.organization_id as "organizationId",o.name as "organizationName"
        from manufacturer_profile p join organizations o on o.id=p.organization_id and o.type='manufacturer'
        where p.id=${options.profileId} for no key update of p`)).rows[0];
      if (!scope) throw new RecordsScopeMissing();
      return work(tx, scope);
    });
  } catch (error) {
    if (error instanceof RecordsDenied || error instanceof RecordsScopeMissing) {
      try { await audit.record({ userId: actor.id, organizationId: actor.organizationId, action,
        objectType: 'route', objectId: options.route, outcome: 'denied', ip: options.ip }); }
      catch { logger.warn('IMBC records denial audit unavailable'); }
    }
    throw error;
  }
}
