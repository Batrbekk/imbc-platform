import {
  type AdminOrganizationResult,
  adminOrganizationResultSchema,
  type CreateOrganizationInput,
  createOrganizationSchema,
  type ImbcMailboxResult,
  imbcMailboxResultSchema,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { auditActorDenial, busy, isUuid, lockActor, notFound } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { parseOrThrow, ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { DB, type Database } from '../../database/database.module.js';
import { boundLockWaits, lockWaitExceeded } from '../../database/lock-waits.js';
import { uniqueViolation } from '../../database/pg-errors.js';
import { organizations } from '../../database/schema/index.js';
import type { AuthUser } from '../auth/auth.types.js';

/** Колонки организации в ответе: без БИН и ящика (ADM-06). */
const ORGANIZATION_COLUMNS = {
  id: organizations.id,
  name: organizations.name,
  type: organizations.type,
  isMajorOperator: organizations.isMajorOperator,
};

// Перенесены в common/actor-transaction.ts (этап 2): прежние имена остаются для модулей и тестов этапа 1.
export { auditActorDenial, busy, isUuid, lockActor, notFound } from '../../common/actor-transaction.js';

/** Маршруты администратора, как их пишет в аудит отказ SessionGuard (`req.route.path`). */
export const ADMIN_ROUTES = {
  createOrganization: '/api/v1/admin/organizations',
  majorOperator: '/api/v1/admin/organizations/:id/major-operator',
  imbcMailbox: '/api/v1/admin/imbc-mailbox',
  invite: '/api/v1/admin/accounts',
  resend: '/api/v1/admin/accounts/:id/invitation',
  block: '/api/v1/admin/accounts/:id/block',
  unblock: '/api/v1/admin/accounts/:id/unblock',
  role: '/api/v1/admin/accounts/:id/role',
  email: '/api/v1/admin/accounts/:id/email',
} as const;

/**
 * Организации операторов и наблюдателей, отметка major operator и ящик IMBC (ADM-03, GEN-05, раздел 8.2).
 * Каждое изменение — запись аудита в той же транзакции (AUD-01); повтор без изменения записи не создаёт.
 * IP запроса — только колонка `audit_entries.ip`.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Транзакция действия: ограниченное ожидание блокировок, исполнитель под блокировкой, отказ — в аудит. */
  private async transaction<T>(
    actor: AuthUser,
    route: string,
    ip: string | null,
    run: (tx: Database) => Promise<T>,
  ): Promise<T> {
    return auditActorDenial(this.audit, actor, route, ip, async () => {
      try {
        return await this.db.transaction(async (raw) => {
          const tx = raw as unknown as Database;
          await boundLockWaits(tx);
          await lockActor(tx, actor.id);
          return run(tx);
        });
      } catch (error) {
        if (lockWaitExceeded(error)) throw busy();
        throw error;
      }
    });
  }

  /** Новая организация оператора или наблюдателя (ADM-03); то же имя того же типа — 409 (`organizations_name_uq`). */
  async create(
    actor: AuthUser,
    input: CreateOrganizationInput,
    ip: string | null = null,
  ): Promise<AdminOrganizationResult> {
    // Тип и отметку проверяет и сервис: ограничения БД — последняя линия, а не первая (ADM-03, GEN-05).
    input = parseOrThrow(createOrganizationSchema, input);
    try {
      const organization = await this.transaction(actor, ADMIN_ROUTES.createOrganization, ip, async (tx) => {
        const [row] = await tx
          .insert(organizations)
          .values({ type: input.type, name: input.name, isMajorOperator: input.isMajorOperator })
          .returning(ORGANIZATION_COLUMNS);
        await this.audit.record(
          {
            userId: actor.id,
            organizationId: actor.organizationId,
            action: 'organization.created',
            objectType: 'organization',
            objectId: row!.id,
            diff: { name: row!.name, type: row!.type, isMajorOperator: row!.isMajorOperator },
            isAccountEvent: true,
            ip,
          },
          tx,
        );
        return row!;
      });
      return parseResponse(adminOrganizationResultSchema, { organization }, 'организация');
    } catch (error) {
      if (uniqueViolation(error) === 'organizations_name_uq')
        throw new ProblemException(409, 'organization_exists', 'Организация с таким названием уже есть');
      throw error;
    }
  }

  /**
   * Отметка major operator (ADM-03, GEN-05) — только у организации оператора; строка — `for no key update`
   * (приглашения в эту организацию, берущие KEY SHARE по внешнему ключу, не ждут).
   */
  async setMajorOperator(
    actor: AuthUser,
    id: string,
    value: boolean,
    ip: string | null = null,
  ): Promise<AdminOrganizationResult> {
    if (!isUuid(id)) throw notFound();
    const organization = await this.transaction(actor, ADMIN_ROUTES.majorOperator, ip, async (tx) => {
      const [row] = await tx
        .select(ORGANIZATION_COLUMNS)
        .from(organizations)
        .where(eq(organizations.id, id))
        .for('no key update');
      if (!row) throw notFound();
      if (row.type !== 'operator')
        throw new ProblemException(409, 'not_operator', 'Отметка major operator — только у организации оператора');
      if (row.isMajorOperator === value) return row;
      const [updated] = await tx
        .update(organizations)
        .set({ isMajorOperator: value })
        .where(eq(organizations.id, id))
        .returning(ORGANIZATION_COLUMNS);
      await this.audit.record(
        {
          userId: actor.id,
          organizationId: actor.organizationId,
          action: 'organization.major_operator_changed',
          objectType: 'organization',
          objectId: id,
          diff: { from: row.isMajorOperator, to: value },
          isAccountEvent: true,
          ip,
        },
        tx,
      );
      return updated!;
    });
    return parseResponse(adminOrganizationResultSchema, { organization }, 'организация');
  }

  /** Ящик IMBC для писем платформы (раздел 8.2) — у единственной организации IMBC; null снимает. */
  async setImbcMailbox(actor: AuthUser, email: string | null, ip: string | null = null): Promise<ImbcMailboxResult> {
    const imbcMailbox = await this.transaction(actor, ADMIN_ROUTES.imbcMailbox, ip, async (tx) => {
      const [imbc] = await tx
        .select({ id: organizations.id, mailbox: organizations.notificationMailbox })
        .from(organizations)
        .where(eq(organizations.type, 'imbc'))
        .for('no key update');
      if (!imbc) throw notFound();
      if (imbc.mailbox === email) return email;
      await tx.update(organizations).set({ notificationMailbox: email }).where(eq(organizations.id, imbc.id));
      await this.audit.record(
        {
          userId: actor.id,
          organizationId: actor.organizationId,
          action: 'organization.mailbox_changed',
          objectType: 'organization',
          objectId: imbc.id,
          diff: { from: imbc.mailbox, to: email },
          isAccountEvent: true,
          ip,
        },
        tx,
      );
      return email;
    });
    return parseResponse(imbcMailboxResultSchema, { imbcMailbox }, 'ящик IMBC');
  }
}
