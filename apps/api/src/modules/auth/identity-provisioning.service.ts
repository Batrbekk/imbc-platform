import type { Locale } from '@imbc/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { ProblemException } from '../../common/problem.js';
import { PG_POOL, type Database } from '../../database/database.module.js';
import { boundLockWaits } from '../../database/lock-waits.js';
import { uniqueViolation } from '../../database/pg-errors.js';
import { userAccounts } from '../../database/schema/index.js';
import { withQueueTransaction, type QueueDb } from '../../database/transaction.js';
import { QUEUE } from '../../infra/infra.module.js';
import { QUEUES } from '../../jobs/queues.js';
import { KeycloakAdminService, KeycloakRequestError } from './keycloak-admin.service.js';
import { registrationBinExists } from '../registration/registration-problems.js';

const identityUnavailable = () =>
  new ProblemException(503, 'identity_unavailable', 'Сервис учётных записей временно недоступен. Попробуйте позже.');

/** Database scope must have been checked under the organization/account locks in the callback. */
export interface InitialInvitationCandidate {
  subject: string;
  email: string;
}

/** Shared with orphan cleanup: business rows are written only after taking this identity lock. */
export async function lockRegistrationIdentity(tx: Database, subject: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(2146711109, hashtext(${subject}))`);
}

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
      throw new ProblemException(
        503,
        'identity_unavailable',
        'Сервис учётных записей временно недоступен. Попробуйте позже.',
      );
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

  /**
   * MAN-02: serialize the BIN before creating IdP identity, including concurrent initial signup.
   * The existing-account callback never treats email alone as permission to accept new NDA evidence.
   * IdP creation is still before business writes; failed commits compensate only identities we created.
   */
  async provisionRegistration(
    identity: { email: string; firstName: string | null; locale: Locale },
    bin: string,
    existing: (tx: Database) => Promise<InitialInvitationCandidate | null>,
    writeRows: (tx: Database, subject: string) => Promise<void>,
  ): Promise<void> {
    let createdSubject: string | undefined;
    const resend = async (candidate: InitialInvitationCandidate, queueDb: QueueDb) => {
      let pending: boolean;
      try {
        pending = await this.keycloak.awaitingInitialPasswordSetup(candidate.subject, candidate.email);
      } catch {
        throw identityUnavailable();
      }
      if (!pending) throw registrationBinExists();
      await this.queue.send(
        QUEUES.sendPasswordEmail,
        { subject: candidate.subject, initialOnly: true },
        { db: queueDb, singletonKey: candidate.subject, singletonSeconds: 60 },
      );
    };
    const locked = async <T>(run: (tx: Database, queueDb: QueueDb) => Promise<T>) =>
      withQueueTransaction(this.pool, async (tx, queueDb) => {
        // A wait must not pin a pre-commit snapshot even if the deployment changes its default isolation.
        await tx.execute(sql`set transaction isolation level read committed`);
        await boundLockWaits(tx);
        // Hash collisions only serialize unrelated BINs; the exact BIN predicate remains authoritative.
        await tx.execute(sql`select pg_advisory_xact_lock(2146711107, hashtext(${bin}))`);
        return run(tx, queueDb);
      });
    try {
      await locked(async (tx, queueDb) => {
        const candidate = await existing(tx);
        if (candidate) return resend(candidate, queueDb);
        try {
          createdSubject = await this.keycloak.createUser({
            email: identity.email,
            firstName: identity.firstName ?? undefined,
            locale: identity.locale,
          });
        } catch (error) {
          if (error instanceof KeycloakRequestError && error.status === 409) {
            // Another provisioning path may have committed since the first lookup. Re-read exact scope.
            const committed = await existing(tx);
            if (committed) return resend(committed, queueDb);
            throw new ProblemException(409, 'email_exists', 'Этот email уже используется');
          }
          throw identityUnavailable();
        }
        await lockRegistrationIdentity(tx, createdSubject);
        await writeRows(tx, createdSubject);
        await this.queue.send(
          QUEUES.sendPasswordEmail,
          { subject: createdSubject, initialOnly: true },
          { db: queueDb, singletonKey: createdSubject, singletonSeconds: 60 },
        );
      });
    } catch (error) {
      if (createdSubject) {
        try {
          const subject = createdSubject;
          await locked(async (tx) => {
            // A thrown COMMIT acknowledgment may follow a successful commit. Wait for the original
            // BIN/identity transaction, then obtain a fresh snapshot; absence before the wait is unsafe.
            await lockRegistrationIdentity(tx, subject);
            const [referenced] = await tx
              .select({ id: userAccounts.id })
              .from(userAccounts)
              .where(eq(userAccounts.idpSubject, subject));
            if (!referenced) await this.keycloak.deleteUser(subject);
          });
        } catch {
          // Unknown database/lock outcome is not proof of an orphan. Cleanup repeats the identity lock
          // and exact-reference check; its payload contains no BIN/email/registration answers.
          await this.queue.send(QUEUES.cleanupIdentity, { subject: createdSubject }).catch(() => {
            this.logger.error('Failed to enqueue identity cleanup');
          });
        }
      }
      if (provisioningConflict(error)) {
        // A uniqueness failure aborts its transaction. Only a fresh locked transaction can resolve it.
        const reused = await locked(async (tx, queueDb) => {
          const candidate = await existing(tx);
          if (!candidate) return false;
          await resend(candidate, queueDb);
          return true;
        });
        if (reused) return;
      }
      throw error;
    }
  }
}

/** Нарушение уникальности почты, субъекта IdP или БИН (код 23505 pg или его обёртки Drizzle) → код 409. */
export function provisioningConflict(error: unknown): 'email_exists' | 'bin_exists' | null {
  const constraint = uniqueViolation(error);
  if (constraint === 'user_accounts_email_uq' || constraint === 'user_accounts_idp_subject_uq') return 'email_exists';
  if (constraint === 'organizations_bin_uq') return 'bin_exists';
  return null;
}
