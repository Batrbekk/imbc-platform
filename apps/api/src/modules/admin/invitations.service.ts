import {
  type AdminAccountResult,
  adminAccountResultSchema,
  type InvitationResent,
  invitationResentSchema,
  INVITABLE_ROLES,
  type InviteAccountInput,
  type Role,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { AuditService } from '../../common/audit.service.js';
import { ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { DB, PG_POOL, type Database } from '../../database/database.module.js';
import { boundLockWaits, lockWaitExceeded } from '../../database/lock-waits.js';
import { organizations, userAccounts } from '../../database/schema/index.js';
import { withQueueTransaction } from '../../database/transaction.js';
import { QUEUE } from '../../infra/infra.module.js';
import { QUEUES } from '../../jobs/queues.js';
import type { AuthUser } from '../auth/auth.types.js';
import { IdentityProvisioningService, provisioningConflict } from '../auth/identity-provisioning.service.js';
import { ADMIN_ROUTES, auditActorDenial, busy, isUuid, lockActor, notFound } from './organizations.service.js';

const emailExists = () => new ProblemException(409, 'email_exists', 'Этот email уже используется');

/**
 * Приглашение сотрудников IMBC, операторов и наблюдателей (ADM-01, NOT-24) — тот же поток, что регистрация
 * (AUTH-01, `IdentityProvisioningService`): пользователь Keycloak → аккаунт invited, запись аудита и задание
 * письма установки пароля в одной транзакции → компенсация. Организация, её тип и роль проверяются до
 * Keycloak: отказ не создаёт пользователя. Языка в форме нет — `kk` (NOT-19).
 */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(QUEUE) private readonly queue: PgBoss,
    private readonly provisioning: IdentityProvisioningService,
    private readonly audit: AuditService,
  ) {}

  async invite(actor: AuthUser, input: InviteAccountInput, ip: string | null): Promise<AdminAccountResult> {
    const [organization] = await this.db
      .select({ id: organizations.id, type: organizations.type })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId));
    if (!organization) throw notFound();
    // Единственный аккаунт производителя создаёт регистрация (GEN-01).
    if (organization.type === 'manufacturer')
      throw new ProblemException(409, 'organization_not_invitable', 'В организацию производителя не приглашают');
    if (!(INVITABLE_ROLES[organization.type] as readonly Role[]).includes(input.role))
      throw new ProblemException(400, 'role_not_allowed', 'Роль не подходит организации');
    const [taken] = await this.db
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(sql`lower(${userAccounts.email}) = ${input.email}`);
    if (taken) throw emailExists();

    return auditActorDenial(this.audit, actor, ADMIN_ROUTES.invite, ip, () =>
      this.provision(actor, input, organization.id, ip),
    );
  }

  private async provision(
    actor: AuthUser,
    input: InviteAccountInput,
    organizationId: string,
    ip: string | null,
  ): Promise<AdminAccountResult> {
    try {
      const account = await this.provisioning.provision(
        { email: input.email, firstName: input.fullName, locale: 'kk' },
        async (tx, subject) => {
          // Одновременное приглашение того же адреса ждёт на индексе почты не дольше `boundLockWaits`.
          await boundLockWaits(tx);
          await lockActor(tx, actor.id);
          const [row] = await tx
            .insert(userAccounts)
            .values({
              organizationId,
              email: input.email,
              fullName: input.fullName,
              role: input.role,
              state: 'invited',
              locale: 'kk',
              idpSubject: subject,
            })
            .returning({
              id: userAccounts.id,
              email: userAccounts.email,
              fullName: userAccounts.fullName,
              role: userAccounts.role,
              state: userAccounts.state,
            });
          await this.audit.record(
            {
              userId: actor.id,
              organizationId: actor.organizationId,
              action: 'account.invited',
              objectType: 'account',
              objectId: row!.id,
              diff: { email: input.email, role: input.role, organizationId },
              isAccountEvent: true,
              ip,
            },
            tx,
          );
          return { ...row!, lastSignInAt: null };
        },
      );
      return parseResponse(adminAccountResultSchema, { account }, 'приглашённый аккаунт');
    } catch (error) {
      // Пользователь Keycloak к этому моменту уже удалён компенсацией (или поставлен cleanup-identity).
      if (lockWaitExceeded(error)) throw busy();
      if (provisioningConflict(error) === 'email_exists') throw emailExists();
      throw error;
    }
  }

  /**
   * Повтор письма установки пароля (NOT-24, AUTH-01) — только аккаунту invited с субъектом Keycloak.
   * Задание дедуплицируется по субъекту (`singletonKey`), как у регистрации; запись аудита — каждый раз,
   * `queued: false`, если в этом окне задание уже было и pg-boss нового не поставил.
   */
  async resend(actor: AuthUser, accountId: string, ip: string | null = null): Promise<InvitationResent> {
    if (!isUuid(accountId)) throw notFound();
    await auditActorDenial(this.audit, actor, ADMIN_ROUTES.resend, ip, () => this.queueResend(actor, accountId, ip));
    return parseResponse(invitationResentSchema, { status: 'password_email_queued' }, 'повтор приглашения');
  }

  private async queueResend(actor: AuthUser, accountId: string, ip: string | null): Promise<void> {
    try {
      await withQueueTransaction(this.pool, async (tx, queueDb) => {
        await boundLockWaits(tx);
        const target = await lockActor(tx, actor.id, accountId);
        if (!target) throw notFound();
        if (target.state !== 'invited')
          throw new ProblemException(409, 'not_invited', 'Аккаунт уже не ждёт установки пароля');
        // Аккаунт seed без входа ещё не привязан к пользователю Keycloak (план, расхождение 20).
        if (!target.idpSubject)
          throw new ProblemException(409, 'identity_not_bound', 'Аккаунт ещё не связан с учётной записью входа');
        const jobId = await this.queue.send(
          QUEUES.sendPasswordEmail,
          { subject: target.idpSubject },
          { db: queueDb, singletonKey: target.idpSubject, singletonSeconds: 60 },
        );
        await this.audit.record(
          {
            userId: actor.id,
            organizationId: actor.organizationId,
            action: 'account.invitation_resent',
            objectType: 'account',
            objectId: accountId,
            diff: { queued: jobId !== null },
            isAccountEvent: true,
            ip,
          },
          tx,
        );
      });
    } catch (error) {
      if (lockWaitExceeded(error)) throw busy();
      throw error;
    }
  }
}
