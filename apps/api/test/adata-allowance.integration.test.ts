import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../src/database/schema/index.js';
import { reserveAllowance } from '../src/modules/adata/allowance.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

// Счётчик квоты периода — наша защита, не остаток Adata (IMBC-07).
describe.skipIf(!process.env.TEST_DATABASE_URL)('Квота Adata: резерв в БД (IMBC-07)', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const used = async () =>
    (
      await pool.query<{ period_start: string; used: number }>(
        "select to_char(period_start, 'YYYY-MM-DD') as period_start, used from adata_allowance order by period_start",
      )
    ).rows;

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema });
  });
  afterAll(() => pool.end());
  beforeEach(() => pool.query('delete from adata_allowance'));

  it('резерв квоты атомарен', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => reserveAllowance(db, '2026-11-04', 5)));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(await used()).toEqual([{ period_start: '2026-11-04', used: 5 }]);
    expect(await reserveAllowance(db, '2026-11-04', 5)).toBe(false);
    // Лимит подняли — резерв продолжается с прежнего счётчика.
    expect(await reserveAllowance(db, '2026-11-04', 6)).toBe(true);
    expect(await used()).toEqual([{ period_start: '2026-11-04', used: 6 }]);
  });

  it('лимит 0 — false и строки нет', async () => {
    expect(await reserveAllowance(db, '2026-11-04', 0)).toBe(false);
    expect(await used()).toEqual([]);
  });

  it('новый период — новая строка', async () => {
    expect(await reserveAllowance(db, '2026-11-04', 1)).toBe(true);
    expect(await reserveAllowance(db, '2026-11-04', 1)).toBe(false);
    expect(await reserveAllowance(db, '2026-12-04', 1)).toBe(true);
    expect(await used()).toEqual([
      { period_start: '2026-11-04', used: 1 },
      { period_start: '2026-12-04', used: 1 },
    ]);
  });

  it('резерв обновляет updated_at', async () => {
    await pool.query(
      "insert into adata_allowance (period_start, used, updated_at) values ('2026-11-04', 1, '2026-11-05T00:00:00Z')",
    );
    expect(await reserveAllowance(db, '2026-11-04', 3)).toBe(true);
    const row = await pool.query<{ fresh: boolean }>(
      "select updated_at > '2026-11-05T00:00:00Z'::timestamptz as fresh from adata_allowance",
    );
    expect(row.rows).toEqual([{ fresh: true }]);
  });
});
