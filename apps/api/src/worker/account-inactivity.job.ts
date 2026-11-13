import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gt, type SQL, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { AuditService } from '../common/audit.service.js';
import { PG_POOL, type Database } from '../database/database.module.js';
import { boundLockWaits } from '../database/lock-waits.js';
import { databaseErrorSummary } from '../database/pg-errors.js';
import * as schema from '../database/schema/index.js';
import { sessions, userAccounts } from '../database/schema/index.js';
import { withQueueTransaction } from '../database/transaction.js';
import { QUEUE } from '../infra/infra.module.js';
import { type AccountJob, PLATFORM_TZ, QUEUES } from '../jobs/queues.js';

const BATCH = 200;

/**
 * Три календарных месяца без входа к дню `now` по Asia/Almaty (AUTH-07, DATA-08): от более поздней даты из
 * последнего входа (у ни разу не входившего — создания) и последней смены пароля — иначе возврат новым
 * паролем без входа (событие пароля) отменила бы следующая ночь. `greatest` пропускает NULL. Тот же день
 * месяца или последний день месяца, если такого дня нет (правило NOT-31): `date + interval '3 months'`
 * в PostgreSQL так и считает. Одно условие для выборки и для повторной проверки под блокировкой.
 */
const threeMonthsWithoutSignIn = (now: Date): SQL =>
  sql`(timezone(${PLATFORM_TZ}::text, greatest(coalesce(${userAccounts.lastSignInAt}, ${userAccounts.createdAt}), ${userAccounts.credentialsChangedAt}))::date + interval '3 months')::date <= timezone(${PLATFORM_TZ}::text, ${now.toISOString()}::timestamptz)::date`;

/**
 * Суточное задание неактивности (AUTH-07, NOT-26). Аккаунт `active` без входа три месяца становится
 * `inactive`: сеансы завершаются сразу, письмо NOT-01 ссылкой сброса уходит заданием `inactivity-reset`.
 * `invited` и `blocked` не меняются. Статус актуальности профиля не трогается (NOT-26, NOT-31).
 * Каждый аккаунт — своя транзакция: сбой одного не останавливает прогон. Повтор в тот же день и после
 * пропущенного дня ничего не удваивает — переведённый аккаунт уже не `active`.
 */
@Injectable()
export class AccountInactivityJob {
  private readonly logger = new Logger(AccountInactivityJob.name);
  private readonly db: Database;

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(QUEUE) private readonly queue: PgBoss,
    private readonly audit: AuditService,
  ) {
    this.db = drizzle(pool, { schema, casing: 'snake_case' });
  }

  /** `now` — момент запуска; worker вызывает без аргумента, тесты — с фиксированной датой (DATA-08). */
  async run(now: Date = new Date()): Promise<{ deactivated: number }> {
    let deactivated = 0;
    let failed = 0;
    // Пачки по id: аккаунт, которого не удалось перевести, не возвращается в следующую пачку этого прогона.
    for (let after: string | null = null; ;) {
      const batch = await this.db
        .select({ id: userAccounts.id })
        .from(userAccounts)
        .where(
          and(
            eq(userAccounts.state, 'active'),
            threeMonthsWithoutSignIn(now),
            after ? gt(userAccounts.id, after) : undefined,
          ),
        )
        .orderBy(asc(userAccounts.id))
        .limit(BATCH);
      for (const { id } of batch) {
        try {
          if (await this.deactivate(id, now)) deactivated++;
        } catch (error) {
          failed++;
          // Ошибка базы — только сводка (NFR-11): параметры запроса несут данные аккаунта.
          const reason = JSON.stringify(databaseErrorSummary(error) ?? String(error));
          this.logger.warn(`account ${id}: inactive не установлен: ${reason}`);
        }
      }
      if (batch.length < BATCH) break;
      after = batch[batch.length - 1]!.id;
    }
    this.logger.log(`неактивных: ${deactivated}${failed ? `, сбоев: ${failed}` : ''}`);
    // Сбой — повтор задания pg-boss: переведённые уже не кандидаты, повтор доделает остальных.
    if (failed) throw new Error(`account-inactivity: ${failed} аккаунт(ов) не переведено`);
    return { deactivated };
  }

  /**
   * Переход одного аккаунта. Условие проверяется снова под блокировкой строки: вход в последний момент
   * (`markSignedIn` сдвинул `last_sign_in_at`) выигрывает, а сеанс, созданный до перехода, удаляется в нём.
   */
  private async deactivate(id: string, now: Date): Promise<boolean> {
    return withQueueTransaction(this.pool, async (tx, queueDb) => {
      await boundLockWaits(tx);
      const [account] = await tx
        .select({ id: userAccounts.id, organizationId: userAccounts.organizationId })
        .from(userAccounts)
        .where(and(eq(userAccounts.id, id), eq(userAccounts.state, 'active'), threeMonthsWithoutSignIn(now)))
        .for('no key update');
      if (!account) return false;
      await tx
        .update(userAccounts)
        .set({ state: 'inactive', inactiveSince: now, authVersion: sql`${userAccounts.authVersion} + 1` })
        .where(eq(userAccounts.id, id));
      await tx.delete(sessions).where(eq(sessions.userId, id));
      await this.audit.record(
        {
          userId: id,
          organizationId: account.organizationId,
          action: 'account.became_inactive',
          objectType: 'account',
          objectId: id,
          diff: { from: 'active' },
          isAccountEvent: true,
        },
        tx,
      );
      await this.queue.send(QUEUES.inactivityReset, { accountId: id } satisfies AccountJob, {
        db: queueDb,
        singletonKey: id,
      });
      return true;
    });
  }
}
