import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { AuditService } from '../../common/audit.service.js';
import { PG_POOL, type Database } from '../../database/database.module.js';
import {
  externalCheck,
  externalCheckAttempt,
  manufacturerProfiles,
  organizations,
  userAccounts,
} from '../../database/schema/index.js';
import { withQueueTransaction } from '../../database/transaction.js';
import { QUEUE } from '../../infra/infra.module.js';
import { QUEUES, type AdataPrefillJob } from '../../jobs/queues.js';

export type AdataReadOrigin = 'password_set' | 'sign_in';

type QueueDb = { executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };

/** Конечные состояния, в которых запроса к Adata не было: попытку можно поставить снова. */
const NOT_SENT = ['not_configured', 'quota_exhausted'] as const;

/** Код SQLSTATE из ошибки pg или из её обёртки Drizzle. */
function sqlState(error: unknown): unknown {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code ?? e?.cause?.code;
}

/**
 * Одно чтение Adata, когда профиль производителя появился: пароль установлен (MAN-03, NOT-23) или,
 * если событие Keycloak ещё не пришло, первый вход. Регистрация, повтор письма и открытие профиля
 * сюда не обращаются: БИН регистрации, не ставшей профилем, не читается (IMBC-07).
 * Попытка profile_created у профиля одна; строка профиля блокируется for update, поэтому событие
 * пароля и вход не ставят двух попыток. Токен Adata планировщику не нужен — его читает только worker.
 */
@Injectable()
export class AdataScheduler {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(QUEUE) private readonly queue: PgBoss,
    private readonly audit: AuditService,
  ) {}

  async requestOnProfileCreated(
    accountId: string,
    origin: AdataReadOrigin,
  ): Promise<'scheduled' | 'requeued' | 'skipped'> {
    try {
      return await withQueueTransaction(this.pool, (tx, queueDb) => this.request(tx, queueDb, accountId, origin));
    } catch (error) {
      // Запасная граница — частичный уникальный индекс попытки profile_created: гонка кончается skipped.
      if (sqlState(error) === '23505') return 'skipped';
      throw error;
    }
  }

  private async request(
    tx: Database,
    queueDb: QueueDb,
    accountId: string,
    origin: AdataReadOrigin,
  ): Promise<'scheduled' | 'requeued' | 'skipped'> {
    // Вход и опрос событий не ждут чужую открытую транзакцию на строке профиля: отказ — warn у входа.
    await tx.execute(sql`set local lock_timeout = '2s'`);
    await tx.execute(sql`set local statement_timeout = '5s'`);
    const [target] = await tx
      .select({
        profileId: manufacturerProfiles.id,
        organizationId: manufacturerProfiles.organizationId,
        status: manufacturerProfiles.status,
        bin: organizations.bin,
      })
      .from(userAccounts)
      .innerJoin(organizations, eq(organizations.id, userAccounts.organizationId))
      .innerJoin(manufacturerProfiles, eq(manufacturerProfiles.organizationId, organizations.id))
      .where(
        and(
          eq(userAccounts.id, accountId),
          eq(userAccounts.role, 'manufacturer'),
          isNotNull(organizations.bin),
          // Мигрированный профиль проверяется при импорте (IMBC-07), не здесь.
          eq(manufacturerProfiles.source, 'manual'),
        ),
      )
      .for('update', { of: manufacturerProfiles });
    if (!target?.bin) return 'skipped';

    const [existing] = await tx
      .select({ id: externalCheckAttempt.id, state: externalCheckAttempt.state })
      .from(externalCheckAttempt)
      .innerJoin(externalCheck, eq(externalCheck.id, externalCheckAttempt.externalCheckId))
      .where(
        and(
          eq(externalCheck.profileId, target.profileId),
          eq(externalCheck.connector, 'adata'),
          eq(externalCheckAttempt.trigger, 'profile_created'),
        ),
      );

    if (!existing) {
      // MAN-03: профиль при установке пароля — Draft. Так отсекаются seed-профили (демо Verified).
      if (target.status !== 'draft') return 'skipped';
      await tx
        .insert(externalCheck)
        .values({ profileId: target.profileId, organizationId: target.organizationId, connector: 'adata' })
        .onConflictDoNothing({ target: [externalCheck.profileId, externalCheck.connector] });
      const [check] = await tx
        .select({ id: externalCheck.id })
        .from(externalCheck)
        .where(and(eq(externalCheck.profileId, target.profileId), eq(externalCheck.connector, 'adata')));
      const [attempt] = await tx
        .insert(externalCheckAttempt)
        .values({ externalCheckId: check!.id, trigger: 'profile_created', state: 'queued', bin: target.bin })
        .returning({ id: externalCheckAttempt.id });
      await tx.update(externalCheck).set({ latestAttemptId: attempt!.id }).where(eq(externalCheck.id, check!.id));
      await this.enqueue(tx, queueDb, attempt!.id, accountId, target.organizationId, origin);
      return 'scheduled';
    }

    if ((NOT_SENT as readonly string[]).includes(existing.state)) {
      const [requeued] = await tx
        .update(externalCheckAttempt)
        .set({ state: 'queued', requestedAt: sql`now()`, completedAt: null })
        .where(and(eq(externalCheckAttempt.id, existing.id), inArray(externalCheckAttempt.state, [...NOT_SENT])))
        .returning({ id: externalCheckAttempt.id });
      if (!requeued) return 'skipped';
      await this.enqueue(tx, queueDb, existing.id, accountId, target.organizationId, origin);
      return 'requeued';
    }
    // queued, polling, received, unavailable: запрос в пути или результат есть (IMBC-07).
    return 'skipped';
  }

  private async enqueue(
    tx: Database,
    queueDb: QueueDb,
    attemptId: string,
    accountId: string,
    organizationId: string,
    origin: AdataReadOrigin,
  ): Promise<void> {
    const job: AdataPrefillJob = { attemptId };
    await this.queue.send(QUEUES.adataPrefill, job, { db: queueDb, singletonKey: attemptId });
    await this.audit.record(
      {
        userId: accountId,
        organizationId,
        action: 'adata.read_requested',
        objectType: 'external_check_attempt',
        objectId: attemptId,
        diff: { origin },
      },
      tx,
    );
  }
}
