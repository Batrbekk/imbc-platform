import {
  type AccountState,
  type AdminAccount,
  type AdminAccountResult,
  adminAccountResultSchema,
  changeEmailSchema,
  changeRoleSchema,
  INVITABLE_ROLES,
  type OrganizationType,
  type Role,
} from '@imbc/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { AuditService } from '../../common/audit.service.js';
import { parseOrThrow, ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { PG_POOL, type Database } from '../../database/database.module.js';
import { boundLockWaits, lockWaitExceeded } from '../../database/lock-waits.js';
import { uniqueViolation } from '../../database/pg-errors.js';
import * as schema from '../../database/schema/index.js';
import { organizations, sessions, trustedDevices, userAccounts } from '../../database/schema/index.js';
import { withQueueTransaction } from '../../database/transaction.js';
import { QUEUE } from '../../infra/infra.module.js';
import { type IdentityJob, type IdentitySyncJob, QUEUES } from '../../jobs/queues.js';
import type { AuthUser } from '../auth/auth.types.js';
import { KeycloakAdminService, KeycloakRequestError } from '../auth/keycloak-admin.service.js';
import { ADMIN_ROUTES, auditActorDenial, busy, isUuid, lockActor, notFound } from './organizations.service.js';

type QueueDb = Parameters<Parameters<typeof withQueueTransaction>[1]>[1];

/** Колонки ответа (ADM-02, ADM-06): служебных полей аккаунта нет. */
const ACCOUNT_COLUMNS = {
  id: userAccounts.id,
  email: userAccounts.email,
  fullName: userAccounts.fullName,
  role: userAccounts.role,
  state: userAccounts.state,
  lastSignInAt: userAccounts.lastSignInAt,
};

/** Строка цели под блокировкой: колонки ответа, субъект IdP и тип организации. */
interface Target {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  state: AccountState;
  lastSignInAt: Date | null;
  idpSubject: string | null;
  organizationType: OrganizationType;
}

const nextAuthVersion = () => sql`${userAccounts.authVersion} + 1`;

/** Изменение, внесённое действием: запись аудита и, если Keycloak должен догнать БД, задание identity-sync. */
interface Change {
  action: string;
  diff: Record<string, unknown>;
  /** `logout` задания identity-sync; undefined — Keycloak не меняется (роль живёт в БД). */
  sync?: boolean;
}

const emailExists = () => new ProblemException(409, 'email_exists', 'Этот email уже используется');
const notManufacturer = () =>
  new ProblemException(409, 'not_manufacturer_account', 'Почту-логин администратор меняет только у производителя');
// Аккаунт seed без входа ещё не привязан к пользователю Keycloak (план, расхождение 20).
const identityNotBound = () =>
  new ProblemException(409, 'identity_not_bound', 'Аккаунт ещё не связан с учётной записью входа');
const selfAction = () => new ProblemException(409, 'self_action', 'Нельзя заблокировать себя или сменить себе роль');

/**
 * Блокировка, разблокировка, смена роли сотрудника IMBC и почты-логина производителя (ADM-02, ADM-05,
 * AUTH-06, MAN-05). Каждое действие — одна транзакция под `lockActor`: изменение, завершение сеансов
 * (`auth_version + 1` и удаление строк `sessions` — `SessionService.resolve` отказывает по каждому),
 * запись аудита и задание identity-sync. Keycloak догоняет БД заданием, а не в транзакции: его сбой
 * не отменяет решение администратора. Исключение — почта: занятость адреса знает только Keycloak,
 * поэтому сначала он, затем транзакция, при её сбое — возврат прежнего адреса.
 * Повтор действия без изменения записи и задания не создаёт.
 */
@Injectable()
export class AccountLifecycleService {
  private readonly logger = new Logger(AccountLifecycleService.name);
  private readonly db: Database;

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(QUEUE) private readonly queue: PgBoss,
    private readonly keycloak: KeycloakAdminService,
    private readonly audit: AuditService,
  ) {
    this.db = drizzle(pool, { schema, casing: 'snake_case' });
  }

  /** Блокировка (ADM-02): открытые сеансы завершаются сразу (AUTH-06), Keycloak отключает пользователя. */
  async block(actor: AuthUser, id: string, ip: string | null = null): Promise<AdminAccountResult> {
    return this.act(actor, id, ADMIN_ROUTES.block, ip, async (tx, target) => {
      if (target.id === actor.id) throw selfAction();
      if (target.state === 'blocked') return null;
      await tx
        .update(userAccounts)
        .set({ state: 'blocked', authVersion: nextAuthVersion() })
        .where(eq(userAccounts.id, id));
      await this.endSessions(tx, id);
      return { action: 'account.blocked', diff: { from: target.state }, sync: true };
    });
  }

  /**
   * Разблокировка (ADM-02, план, расхождение 15): не входил — invited, иначе active; отметка inactive
   * снимается — три месяца без входа снова отсчитает задание неактивности. Прежних сеансов нет.
   */
  async unblock(actor: AuthUser, id: string, ip: string | null = null): Promise<AdminAccountResult> {
    return this.act(actor, id, ADMIN_ROUTES.unblock, ip, async (tx, target) => {
      if (target.state !== 'blocked') return null;
      const to = target.lastSignInAt === null ? 'invited' : 'active';
      await tx.update(userAccounts).set({ state: to, inactiveSince: null }).where(eq(userAccounts.id, id));
      return { action: 'account.unblocked', diff: { to }, sync: false };
    });
  }

  /**
   * Смена роли (AUTH-06, план, расхождение 14): только у аккаунта организации IMBC и только на роль IMBC;
   * у оператора, наблюдателя и производителя роль задана типом организации. Сеансы с прежней ролью
   * завершаются сразу. Keycloak не меняется: роль живёт в БД.
   */
  async changeRole(actor: AuthUser, id: string, role: Role, ip: string | null = null): Promise<AdminAccountResult> {
    ({ role } = parseOrThrow(changeRoleSchema, { role }));
    return this.act(actor, id, ADMIN_ROUTES.role, ip, async (tx, target) => {
      if (target.id === actor.id) throw selfAction();
      if (target.organizationType !== 'imbc')
        throw new ProblemException(409, 'role_fixed', 'Роль этого аккаунта задана типом организации');
      if (!(INVITABLE_ROLES.imbc as readonly Role[]).includes(role))
        throw new ProblemException(400, 'role_not_allowed', 'Роль не подходит организации');
      if (target.role === role) return null;
      await tx.update(userAccounts).set({ role, authVersion: nextAuthVersion() }).where(eq(userAccounts.id, id));
      await this.endSessions(tx, id);
      return { action: 'account.role_changed', diff: { from: target.role, to: role } };
    });
  }

  /**
   * Смена почты-логина производителя (ADM-05, MAN-05, план, расхождение 13). Сначала Keycloak (адрес
   * подтверждён: его вносит IMBC), затем транзакция: почта, сеансы и доверенные устройства — следующий
   * вход пришлёт код NOT-02 на новый адрес; у invited — письмо установки пароля NOT-01 туда же. Сбой
   * транзакции возвращает Keycloak к прежнему адресу, а неудачный возврат догонит identity-sync.
   */
  async changeEmail(actor: AuthUser, id: string, email: string, ip: string | null = null): Promise<AdminAccountResult> {
    if (!isUuid(id)) throw notFound();
    ({ email } = parseOrThrow(changeEmailSchema, { email }));
    const [before] = await this.db
      .select({ email: userAccounts.email, role: userAccounts.role, idpSubject: userAccounts.idpSubject })
      .from(userAccounts)
      .where(eq(userAccounts.id, id));
    if (!before) throw notFound();
    if (before.role !== 'manufacturer') throw notManufacturer();
    const subject = before.idpSubject;
    if (!subject) throw identityNotBound();
    // Тот же адрес — без Keycloak и без записи; исполнитель проверяется, как у прочих действий.
    if (before.email.toLowerCase() === email) return this.act(actor, id, ADMIN_ROUTES.email, ip, async () => null);
    const [taken] = await this.db
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(and(sql`lower(${userAccounts.email}) = ${email}`, ne(userAccounts.id, id)));
    if (taken) throw emailExists();

    const account = await auditActorDenial(this.audit, actor, ADMIN_ROUTES.email, ip, async () => {
      await this.setIdentityEmail(id, subject, email);
      try {
        return await this.transaction(async (tx, queueDb) => {
          const target = await this.lockTarget(tx, actor, id);
          if (target.role !== 'manufacturer') throw notManufacturer();
          if (target.idpSubject !== subject) throw identityNotBound();
          if (target.email !== email) {
            await tx.update(userAccounts).set({ email, authVersion: nextAuthVersion() }).where(eq(userAccounts.id, id));
            await this.endSessions(tx, id);
            await tx.delete(trustedDevices).where(eq(trustedDevices.userId, id));
            if (target.state === 'invited')
              await this.queue.send(QUEUES.sendPasswordEmail, { subject } satisfies IdentityJob, { db: queueDb });
            await this.record(tx, queueDb, actor, id, ip, {
              action: 'account.email_changed',
              diff: { from: target.email, to: email },
              sync: true,
            });
          }
          return this.read(tx, id);
        });
      } catch (error) {
        await this.restoreIdentityEmail(id, subject, before.email);
        if (uniqueViolation(error) === 'user_accounts_email_uq') throw emailExists();
        throw error;
      }
    });
    return parseResponse(adminAccountResultSchema, { account }, 'аккаунт');
  }

  /** Транзакция действия над аккаунтом: строки исполнителя и цели под блокировкой, отказ исполнителя — в аудит. */
  private async act(
    actor: AuthUser,
    id: string,
    route: string,
    ip: string | null,
    change: (tx: Database, target: Target) => Promise<Change | null>,
  ): Promise<AdminAccountResult> {
    if (!isUuid(id)) throw notFound();
    const account = await auditActorDenial(this.audit, actor, route, ip, () =>
      this.transaction(async (tx, queueDb) => {
        const applied = await change(tx, await this.lockTarget(tx, actor, id));
        if (applied) await this.record(tx, queueDb, actor, id, ip, applied);
        return this.read(tx, id);
      }),
    );
    return parseResponse(adminAccountResultSchema, { account }, 'аккаунт');
  }

  private async transaction<T>(run: (tx: Database, queueDb: QueueDb) => Promise<T>): Promise<T> {
    try {
      return await withQueueTransaction(this.pool, async (tx, queueDb) => {
        await boundLockWaits(tx);
        return run(tx, queueDb);
      });
    } catch (error) {
      if (lockWaitExceeded(error)) throw busy();
      throw error;
    }
  }

  /** `lockActor` (исполнитель — active administrator), затем строка цели с типом её организации. */
  private async lockTarget(tx: Database, actor: AuthUser, id: string): Promise<Target> {
    if (!(await lockActor(tx, actor.id, id))) throw notFound();
    const [row] = await tx
      .select({ ...ACCOUNT_COLUMNS, idpSubject: userAccounts.idpSubject, organizationType: organizations.type })
      .from(userAccounts)
      .innerJoin(organizations, eq(organizations.id, userAccounts.organizationId))
      .where(eq(userAccounts.id, id));
    return row!;
  }

  /** Завершить сеансы сразу (AUTH-06): строк нет, а сеанс «в полёте» не пройдёт проверку auth_version. */
  private async endSessions(tx: Database, id: string): Promise<void> {
    await tx.delete(sessions).where(eq(sessions.userId, id));
  }

  /** Запись аудита (AUD-01) и задание identity-sync — в транзакции изменения. IP — только колонка `ip`. */
  private async record(tx: Database, queueDb: QueueDb, actor: AuthUser, id: string, ip: string | null, change: Change) {
    await this.audit.record(
      {
        userId: actor.id,
        organizationId: actor.organizationId,
        action: change.action,
        objectType: 'account',
        objectId: id,
        diff: change.diff,
        isAccountEvent: true,
        ip,
      },
      tx,
    );
    if (change.sync !== undefined)
      await this.queue.send(QUEUES.identitySync, { accountId: id, logout: change.sync } satisfies IdentitySyncJob, {
        db: queueDb,
      });
  }

  private async read(tx: Database, id: string): Promise<AdminAccount> {
    const [row] = await tx.select(ACCOUNT_COLUMNS).from(userAccounts).where(eq(userAccounts.id, id));
    return { ...row!, lastSignInAt: row!.lastSignInAt?.toISOString() ?? null };
  }

  /** Новый адрес в Keycloak до транзакции: 409 — адрес занят там; иной сбой — исход неизвестен. */
  private async setIdentityEmail(id: string, subject: string, email: string): Promise<void> {
    try {
      await this.keycloak.updateUser(subject, { email, emailVerified: true });
    } catch (error) {
      if (error instanceof KeycloakRequestError && error.status === 409) throw emailExists();
      // Ответа нет (например, тайм-аут после записи): задание вернёт Keycloak к адресу из БД.
      this.logger.warn('Keycloak: email change failed, identity-sync queued');
      await this.queueSync(id, false);
      throw new ProblemException(
        503,
        'identity_unavailable',
        'Сервис учётных записей временно недоступен. Попробуйте позже.',
      );
    }
  }

  /** Компенсация: прежний адрес в Keycloak; не удалось — identity-sync приведёт Keycloak к строке БД. */
  private async restoreIdentityEmail(id: string, subject: string, previous: string): Promise<void> {
    try {
      await this.keycloak.updateUser(subject, { email: previous });
    } catch {
      this.logger.warn('Keycloak: email change compensation failed, identity-sync queued');
      await this.queueSync(id, true);
    }
  }

  private async queueSync(accountId: string, logout: boolean): Promise<void> {
    await this.queue
      .send(QUEUES.identitySync, { accountId, logout } satisfies IdentitySyncJob)
      .catch(() => this.logger.error('Failed to enqueue identity-sync'));
  }
}
