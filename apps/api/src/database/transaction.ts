import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import type { Database } from './database.module.js';
import * as schema from './schema/index.js';

/** Соединение транзакции для `boss.send(…, { db })`: задание pg-boss ставится в той же транзакции. */
export type QueueDb = { executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };

// Out-of-band provenance: never attach SQL/connection details to an externally visible error.
const confirmedRollbacks = new WeakSet<object>();
const errorObject = (error: unknown): error is object =>
  (typeof error === 'object' && error !== null) || typeof error === 'function';
export const transactionWasRolledBack = (error: unknown): boolean =>
  errorObject(error) && confirmedRollbacks.has(error);
export function copyTransactionOutcome<T extends object>(source: unknown, target: T): T {
  if (transactionWasRolledBack(source)) confirmedRollbacks.add(target);
  else confirmedRollbacks.delete(target);
  return target;
}

/** Business writes and pg-boss enqueue share the same PostgreSQL transaction. */
export async function withQueueTransaction<T>(
  pool: pg.Pool,
  run: (db: Database, queueDb: QueueDb) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let callbackFailed = false;
  let callbackError: unknown;
  try {
    return await drizzle(client, { schema, casing: 'snake_case' }).transaction(async (tx) => {
      try {
        return await run(tx as unknown as Database, { executeSql: (text, values) => client.query(text, values) });
      } catch (error) {
        callbackFailed = true;
        callbackError = error;
        throw error;
      }
    });
  } catch (error) {
    // Drizzle rethrows this exact callback error only after its ROLLBACK succeeds. If COMMIT
    // or ROLLBACK failed, its outcome is unknown, even if a later ROLLBACK was acknowledged.
    if (errorObject(error)) {
      if (callbackFailed && error === callbackError) confirmedRollbacks.add(error);
      else confirmedRollbacks.delete(error);
    }
    throw error;
  } finally {
    client.release();
  }
}
