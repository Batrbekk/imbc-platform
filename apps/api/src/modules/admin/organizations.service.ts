import {
  type AdminOrganizationResult,
  adminOrganizationResultSchema,
  type CreateOrganizationInput,
  type ImbcMailboxResult,
  imbcMailboxResultSchema,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service.js';
import { ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { DB, type Database } from '../../database/database.module.js';
import { boundLockWaits, lockWaitExceeded } from '../../database/lock-waits.js';
import { organizations, userAccounts } from '../../database/schema/index.js';
import type { AuthUser } from '../auth/auth.types.js';

/** Колонки организации в ответе: без БИН и ящика (ADM-06). */
const ORGANIZATION_COLUMNS = {
  id: organizations.id,
  name: organizations.name,
  type: organizations.type,
  isMajorOperator: organizations.isMajorOperator,
};

export const notFound = () => new ProblemException(404, 'not_found', 'Не найдено');
/** Строка занята другим действием дольше `boundLockWaits`: повтор безопасен. */
export const busy = () => new ProblemException(503, 'busy', 'Запись занята другим действием. Попробуйте снова.');
export const isUuid = (value: string) => z.uuid().safeParse(value).success;

/**
 * Транзакция действия администратора (план, расхождение 18): строки исполнителя и цели блокируются
 * в порядке id, исполнитель всё ещё active administrator — иначе 403, как у SessionGuard (GEN-08).
 * Возвращает строку цели, если она есть.
 */
export async function lockActor(tx: Database, actorId: string, targetId?: string) {
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
    .for('share');
  const actor = rows.find((r) => r.id === actorId);
  if (actor?.role !== 'administrator' || actor.state !== 'active')
    throw new ProblemException(403, 'forbidden', 'Нет прав на это действие');
  return targetId ? rows.find((r) => r.id === targetId) : undefined;
}

/** Нарушение уникального индекса `constraint` (23505 pg или его обёртка Drizzle). */
function uniqueViolation(error: unknown, constraint: string): boolean {
  let cause: unknown = error;
  for (let depth = 0; cause && typeof cause === 'object' && depth < 6; depth++) {
    const item = cause as { code?: string; constraint?: string; cause?: unknown };
    if (item.code === '23505' && item.constraint === constraint) return true;
    cause = item.cause;
  }
  return false;
}

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

  private async transaction<T>(run: (tx: Database) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(async (tx) => {
        const db = tx as unknown as Database;
        await boundLockWaits(db);
        return run(db);
      });
    } catch (error) {
      if (lockWaitExceeded(error)) throw busy();
      throw error;
    }
  }

  /** Новая организация оператора или наблюдателя (ADM-03); то же имя того же типа — 409 (`organizations_name_uq`). */
  async create(
    actor: AuthUser,
    input: CreateOrganizationInput,
    ip: string | null = null,
  ): Promise<AdminOrganizationResult> {
    try {
      const organization = await this.transaction(async (tx) => {
        await lockActor(tx, actor.id);
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
      if (uniqueViolation(error, 'organizations_name_uq'))
        throw new ProblemException(409, 'organization_exists', 'Организация с таким названием уже есть');
      throw error;
    }
  }

  /** Отметка major operator (ADM-03, GEN-05) — только у организации оператора; строка — `for update`. */
  async setMajorOperator(
    actor: AuthUser,
    id: string,
    value: boolean,
    ip: string | null = null,
  ): Promise<AdminOrganizationResult> {
    if (!isUuid(id)) throw notFound();
    const organization = await this.transaction(async (tx) => {
      await lockActor(tx, actor.id);
      const [row] = await tx
        .select(ORGANIZATION_COLUMNS)
        .from(organizations)
        .where(eq(organizations.id, id))
        .for('update');
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
    const imbcMailbox = await this.transaction(async (tx) => {
      await lockActor(tx, actor.id);
      const [imbc] = await tx
        .select({ id: organizations.id, mailbox: organizations.notificationMailbox })
        .from(organizations)
        .where(eq(organizations.type, 'imbc'))
        .for('update');
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
