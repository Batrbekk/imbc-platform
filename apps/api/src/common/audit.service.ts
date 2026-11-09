import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { DB, type Database } from '../database/database.module.js';
import { auditEntries } from '../database/schema/index.js';

export interface AuditEvent {
  userId?: string | null;
  organizationId?: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  outcome?: 'ok' | 'denied' | 'failed';
  diff?: unknown;
  isAccountEvent?: boolean;
  ip?: string | null;
}

/**
 * Журнал аудита (AUD-01): каждое действие, вход, отказ, решение, выгрузка и скачивание.
 * Запись идёт в той же транзакции, что и изменение, когда передан `tx`.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async record(event: AuditEvent, tx: Pick<Database, 'insert'> = this.db): Promise<void> {
    await tx.insert(auditEntries).values({
      userId: event.userId ?? null,
      organizationId: event.organizationId ?? null,
      action: event.action,
      objectType: event.objectType,
      objectId: event.objectId ?? null,
      outcome: event.outcome ?? 'ok',
      diff: event.diff ?? null,
      isAccountEvent: event.isAccountEvent ?? false,
      ip: event.ip ?? null,
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
