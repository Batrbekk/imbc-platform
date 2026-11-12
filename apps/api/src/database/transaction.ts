import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import type { Database } from './database.module.js';
import * as schema from './schema/index.js';

/** Business writes and pg-boss enqueue share the same PostgreSQL transaction. */
export async function withQueueTransaction<T>(
  pool: pg.Pool,
  run: (
    db: Database,
    queueDb: { executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> },
  ) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await drizzle(client, { schema, casing: 'snake_case' }).transaction((tx) =>
      run(tx as unknown as Database, { executeSql: (text, values) => client.query(text, values) }),
    );
  } finally {
    client.release();
  }
}
