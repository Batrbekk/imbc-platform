import type { Locale } from '@imbc/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { ProblemException } from '../../common/problem.js';
import { PG_POOL, type Database } from '../../database/database.module.js';
import { withQueueTransaction } from '../../database/transaction.js';
import { QUEUE } from '../../infra/infra.module.js';
import { QUEUES } from '../../jobs/queues.js';
import { KeycloakAdminService, KeycloakRequestError } from './keycloak-admin.service.js';

/**
 * Один поток регистрации и приглашения (AUTH-01): пользователь Keycloak → строки БД и задание письма
 * установки пароля (NOT-01) в одной транзакции → компенсация. Сначала IdP, затем БД: при сбое БД
 * пользователь Keycloak удаляется, а неудачное удаление ставится в `cleanup-identity`.
 */
@Injectable()
export class IdentityProvisioningService {
  private readonly logger = new Logger(IdentityProvisioningService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(QUEUE) private readonly queue: PgBoss,
    private readonly keycloak: KeycloakAdminService,
  ) {}

  async provision<T>(
    identity: { email: string; firstName: string | null; locale: Locale },
    writeRows: (tx: Database, subject: string) => Promise<T>,
  ): Promise<T> {
    let subject: string;
    try {
      subject = await this.keycloak.createUser({
        email: identity.email,
        firstName: identity.firstName ?? undefined,
        locale: identity.locale,
      });
    } catch (error) {
      if (error instanceof KeycloakRequestError && error.status === 409) {
        throw new ProblemException(409, 'email_exists', 'Этот email уже используется');
      }
      throw new ProblemException(503, 'identity_unavailable', 'Регистрация временно недоступна. Попробуйте снова.');
    }
    try {
      return await withQueueTransaction(this.pool, async (tx, queueDb) => {
        const result = await writeRows(tx, subject);
        // Доставка письма повторяется заданием: сбой SMTP не оставляет зафиксированную запись без письма.
        await this.queue.send(
          QUEUES.sendPasswordEmail,
          { subject },
          { db: queueDb, singletonKey: subject, singletonSeconds: 60 },
        );
        return result;
      });
    } catch (error) {
      try {
        await this.keycloak.deleteUser(subject);
      } catch {
        await this.queue.send(QUEUES.cleanupIdentity, { subject }).catch(() => {
          this.logger.error('Failed to enqueue identity cleanup');
        });
      }
      throw error;
    }
  }
}

/** Нарушение уникальности почты, субъекта IdP или БИН (код 23505 pg или его обёртки Drizzle) → код 409. */
export function provisioningConflict(error: unknown): 'email_exists' | 'bin_exists' | null {
  let cause: unknown = error;
  for (let depth = 0; cause && typeof cause === 'object' && depth < 6; depth++) {
    const item = cause as { code?: string; constraint?: string; cause?: unknown };
    if (item.code === '23505') {
      if (item.constraint === 'user_accounts_email_uq' || item.constraint === 'user_accounts_idp_subject_uq')
        return 'email_exists';
      if (item.constraint === 'organizations_bin_uq') return 'bin_exists';
    }
    cause = item.cause;
  }
  return null;
}
