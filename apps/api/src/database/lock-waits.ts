import { sql } from 'drizzle-orm';
import type { Database } from './database.module.js';

/** Код SQLSTATE из ошибки pg или из её обёртки Drizzle. */
export function sqlState(error: unknown): unknown {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code ?? e?.cause?.code;
}

/**
 * Вход, опрос событий и действия администратора не ждут чужую открытую транзакцию на своих строках:
 * отказ — у вызывающего. Первые операторы транзакции.
 */
export async function boundLockWaits(tx: Database): Promise<void> {
  await tx.execute(sql`set local lock_timeout = '2s'`);
  await tx.execute(sql`set local statement_timeout = '5s'`);
}

/** Ожидание блокировки или оператора сверх `boundLockWaits` (lock_not_available, query_canceled). */
export function lockWaitExceeded(error: unknown): boolean {
  const state = sqlState(error);
  return state === '55P03' || state === '57014';
}
