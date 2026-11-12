import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrototypeTable, readPrototypeState, writePrototypeState } from '../src/database/prototype-store.js';
import { openTestPool, resetDatabase } from './support/database.js';

// Общее состояние прототипа кабинетов: один документ, запись поверх известной версии (оптимистичная блокировка).
describe.skipIf(!process.env.TEST_DATABASE_URL)('документ прототипа в PostgreSQL', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;
  const doc = (marker: string) => ({ version: 1, marker, profiles: [{ id: 'p01' }] });

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await createPrototypeTable(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE prototype_state');
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('таблица создаётся повторно без ошибки (CREATE TABLE IF NOT EXISTS)', async () => {
    await createPrototypeTable(pool);
    const { rows } = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'prototype_state' ORDER BY ordinal_position`,
    );
    expect(rows).toEqual([
      { column_name: 'id', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'version', data_type: 'bigint', is_nullable: 'NO' },
      { column_name: 'state', data_type: 'jsonb', is_nullable: 'NO' },
      { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
    ]);
  });

  it('пустой сервер — версия 0 и нет документа', async () => {
    expect(await readPrototypeState(pool)).toEqual({ version: 0, state: null });
  });

  it('первая запись с baseVersion 0 создаёт документ версии 1', async () => {
    expect(await writePrototypeState(pool, 0, doc('first'))).toEqual({ ok: true, version: 1 });
    expect(await readPrototypeState(pool)).toEqual({ version: 1, state: doc('first') });
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM prototype_state');
    expect(rows).toEqual([{ id: 'default' }]);
  });

  it('запись поверх текущей версии увеличивает версию', async () => {
    await writePrototypeState(pool, 0, doc('first'));
    expect(await writePrototypeState(pool, 1, doc('second'))).toEqual({ ok: true, version: 2 });
    expect(await readPrototypeState(pool)).toEqual({ version: 2, state: doc('second') });
  });

  it.each([
    ['устаревшая версия', 1],
    ['повторная первая запись', 0],
    ['версия из будущего', 7],
  ])('%s — отказ с текущими версией и документом, документ не изменён', async (_, base) => {
    await writePrototypeState(pool, 0, doc('first'));
    await writePrototypeState(pool, 1, doc('second'));
    expect(await writePrototypeState(pool, base, doc('stale'))).toEqual({
      ok: false,
      version: 2,
      state: doc('second'),
    });
    expect(await readPrototypeState(pool)).toEqual({ version: 2, state: doc('second') });
  });

  it('запись с версией при пустом сервере — отказ с версией 0', async () => {
    expect(await writePrototypeState(pool, 3, doc('x'))).toEqual({ ok: false, version: 0, state: null });
  });

  it.each([
    ['первая запись', 0],
    ['обновление', 1],
  ])('%s: две одновременные записи с одной версией — проходит ровно одна', async (_, base) => {
    if (base === 1) await writePrototypeState(pool, 0, doc('first'));
    const results = await Promise.all([
      writePrototypeState(pool, base, doc('a')),
      writePrototypeState(pool, base, doc('b')),
    ]);
    const winners = results.filter((r) => r.ok);
    expect(winners).toEqual([{ ok: true, version: base + 1 }]);
    const loser = results.find((r) => !r.ok)!;
    const stored = await readPrototypeState(pool);
    expect(stored.version).toBe(base + 1);
    expect(loser).toEqual({ ok: false, ...stored });
    expect([doc('a'), doc('b')]).toContainEqual(stored.state);
  });
});
