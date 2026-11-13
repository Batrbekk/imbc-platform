import { type Action, can } from '@imbc/contracts';
import { Logger } from '@nestjs/common';
import { asc, inArray } from 'drizzle-orm';
import type pg from 'pg';
import { z } from 'zod';
import type { Database } from '../database/database.module.js';
import { boundLockWaits, lockWaitExceeded } from '../database/lock-waits.js';
import { databaseErrorSummary } from '../database/pg-errors.js';
import { userAccounts } from '../database/schema/index.js';
import { type QueueDb, withQueueTransaction } from '../database/transaction.js';
import type { AuthUser } from '../modules/auth/auth.types.js';
import type { AuditService } from './audit.service.js';
import { ProblemException } from './problem.js';

export type { QueueDb } from '../database/transaction.js';

export const notFound = () => new ProblemException(404, 'not_found', 'Не найдено');
/** Строка занята другим действием дольше `boundLockWaits`: повтор безопасен. */
export const busy = () => new ProblemException(503, 'busy', 'Запись занята другим действием. Попробуйте снова.');
export const isUuid = (value: string) => z.uuid().safeParse(value).success;

// Имя прежнее (этап 1): контекст журнала отказов не меняется.
const logger = new Logger('AdminActions');

/** Исполнитель потерял право действия (заблокирован, сменил роль) между guard и транзакцией действия. */
class ActorDenied extends ProblemException {
  constructor() {
    super(403, 'forbidden', 'Нет прав на это действие');
  }
}

/**
 * Транзакция изменяющего действия (план этапа 1, расхождение 18): строки исполнителя и цели блокируются
 * `for no key update` в порядке id, исполнитель всё ещё active и имеет `action` в PolicyMatrix — иначе 403,
 * как у SessionGuard (GEN-08). Взаимные действия двух исполнителей идут по очереди: второй ждёт первого
 * и перечитывает свою строку, повышения блокировки (и взаимной блокировки 40P01) нет. Внешние ключи
 * `sessions`, `otp_codes` берут KEY SHARE и с этим режимом не конфликтуют. Возвращает строку цели.
 */
export async function lockActor(tx: Database, actorId: string, targetId?: string, action: Action = 'accounts.manage') {
  const ids = targetId && targetId !== actorId ? [actorId, targetId] : [actorId];
  const rows = await tx
    .select({
      id: userAccounts.id,
      role: userAccounts.role,
      state: userAccounts.state,
      idpSubject: userAccounts.idpSubject,
    })
    .from(userAccounts)
    .where(inArray(userAccounts.id, ids))
    .orderBy(asc(userAccounts.id))
    .for('no key update');
  const actor = rows.find((r) => r.id === actorId);
  if (!actor || actor.state !== 'active' || can(actor.role, action) === null) throw new ActorDenied();
  return targetId ? rows.find((r) => r.id === targetId) : undefined;
}

/**
 * Отказ `lockActor` откатывается вместе с транзакцией действия; запрос без права пишется в аудит
 * (GEN-08, AUD-01) — здесь, после отката, той же записью, что у SessionGuard: `action`, объект — шаблон
 * пути маршрута. Сбой самой записи не подменяет 403 ошибкой 500: в журнал — сводка, наружу — исходный отказ.
 */
export async function auditActorDenial<T>(
  audit: AuditService,
  actor: AuthUser,
  route: string,
  ip: string | null,
  run: () => Promise<T>,
  action: Action = 'accounts.manage',
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ActorDenied)
      try {
        await audit.record({
          userId: actor.id,
          organizationId: actor.organizationId,
          action,
          objectType: 'route',
          objectId: route,
          outcome: 'denied',
          ip,
        });
      } catch (auditError) {
        logger.error(databaseErrorSummary(auditError) ?? auditError, 'Denied action audit failed');
      }
    throw error;
  }
}

/**
 * Изменяющее действие одной транзакцией (AUD-01, GEN-08): ограниченное ожидание блокировок
 * (`boundLockWaits`), исполнитель под блокировкой с правом `opts.action`, затем `run` — изменение, аудит
 * и задания pg-boss через `queueDb` в той же транзакции. Ожидание сверх предела — 503 `busy`; исполнитель
 * без права — 403 и запись `denied` после отката. `opts.route` — шаблон пути, как его пишет SessionGuard.
 */
export async function actorTransaction<T>(
  pool: pg.Pool,
  audit: AuditService,
  actor: AuthUser,
  opts: { route: string; ip: string | null; action: Action },
  run: (tx: Database, queueDb: QueueDb) => Promise<T>,
): Promise<T> {
  return auditActorDenial(
    audit,
    actor,
    opts.route,
    opts.ip,
    async () => {
      try {
        return await withQueueTransaction(pool, async (tx, queueDb) => {
          await boundLockWaits(tx);
          await lockActor(tx, actor.id, undefined, opts.action);
          return run(tx, queueDb);
        });
      } catch (error) {
        if (lockWaitExceeded(error)) throw busy();
        throw error;
      }
    },
    opts.action,
  );
}
