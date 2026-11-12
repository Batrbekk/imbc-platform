import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../src/database/schema/index.js';
import { ProfilesService } from '../src/modules/profiles/profiles.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const TAG = '0005_adata_prefill';

// Таблицы чтения Adata (EXT-01, IMBC-07, MAN-07): миграция только expand — предыдущая версия приложения
// работает на новой схеме (NFR-06).
describe('0005: текст миграции', () => {
  const sql = () => readFileSync(join(MIGRATIONS, `${TAG}.sql`), 'utf8');

  it('в 0005 нет DROP, RENAME, SET NOT NULL и ALTER TYPE существующих типов', () => {
    const text = sql();
    expect(text).not.toMatch(/\bDROP\s/i);
    expect(text).not.toMatch(/\bRENAME\b/i);
    expect(text).not.toMatch(/SET NOT NULL/i);

    // Типы и таблицы прежних миграций 0000–0004.
    const earlier = readdirSync(MIGRATIONS)
      .filter((f) => /^000[0-4]_.*\.sql$/.test(f))
      .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
      .join('\n');
    const types = [...earlier.matchAll(/CREATE TYPE "public"\."(\w+)"/g)].map((m) => m[1]!);
    expect(types).toEqual(expect.arrayContaining(['role', 'organization_type', 'update_status', 'value_source']));
    expect(text).not.toMatch(new RegExp(`ALTER TYPE "(public"\\.")?(${types.join('|')})"`));

    // ALTER TABLE — только внешние ключи новых таблиц этой миграции.
    const created = new Set([...text.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]!));
    expect([...created].sort()).toEqual([
      'adata_allowance',
      'external_check',
      'external_check_attempt',
      'prefilled_value',
    ]);
    for (const [, table, rest] of text.matchAll(/ALTER TABLE "(\w+)" (.*)/g)) {
      expect(created.has(table!), table).toBe(true);
      expect(rest).toMatch(/^ADD CONSTRAINT "\w+" FOREIGN KEY/);
    }
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('0005: таблицы чтения Adata', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;
  const ids = { organization: '', profile: '' };

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool, '0004_catalog_tier');
    // Строки, которые записала предыдущая версия приложения.
    const org = await pool.query<{ id: string }>(
      "insert into organizations (type, name, bin) values ('manufacturer', 'ТОО «Тест»', '240100000011') returning id",
    );
    const profile = await pool.query<{ id: string }>(
      'insert into manufacturer_profiles (organization_id) values ($1) returning id',
      [org.rows[0]!.id],
    );
    ids.organization = org.rows[0]!.id;
    ids.profile = profile.rows[0]!.id;
    await migrateThrough(pool); // применяет 0005
  }, 60000);

  afterAll(async () => {
    await pool?.end();
  });

  it('0005 — только expand: база 0004 с данными предыдущей версии мигрирует, строки целы, ProfilesService.own работает', async () => {
    const org = await pool.query('select name, bin from organizations where id = $1', [ids.organization]);
    expect(org.rows).toEqual([{ name: 'ТОО «Тест»', bin: '240100000011' }]);
    const db = drizzle(pool, { schema, casing: 'snake_case' });
    expect(await new ProfilesService(db).own(ids.organization)).toMatchObject({
      profileId: ids.profile,
      bin: '240100000011',
      status: 'draft',
    });
    // Запись предыдущей версии после миграции: профиль без строк чтения Adata.
    const another = await pool.query<{ id: string }>(
      "insert into organizations (type, name, bin) values ('manufacturer', 'ТОО «Второй»', '240100000012') returning id",
    );
    await pool.query('insert into manufacturer_profiles (organization_id) values ($1)', [another.rows[0]!.id]);
  });

  it('второй external_check (профиль, adata) и вторая попытка profile_created — 23505, вторая попытка quarterly — можно', async () => {
    const check = await pool.query<{ id: string; is_mock: boolean }>(
      "insert into external_check (profile_id, organization_id, connector) values ($1, $2, 'adata') returning id, is_mock",
      [ids.profile, ids.organization],
    );
    expect(check.rows[0]!.is_mock).toBe(false);
    await expect(
      pool.query("insert into external_check (profile_id, organization_id, connector) values ($1, $2, 'adata')", [
        ids.profile,
        ids.organization,
      ]),
    ).rejects.toMatchObject({ code: '23505' });

    const attempt = (trigger: string) =>
      pool.query<{ id: string; state: string; is_test_data: boolean }>(
        `insert into external_check_attempt (external_check_id, "trigger", bin) values ($1, $2, '240100000011')
         returning id, state, is_test_data`,
        [check.rows[0]!.id, trigger],
      );
    const first = await attempt('profile_created');
    expect(first.rows[0]).toMatchObject({ state: 'queued', is_test_data: false });
    await expect(attempt('profile_created')).rejects.toMatchObject({ code: '23505' });
    await attempt('quarterly');
    await attempt('quarterly');

    await pool.query('update external_check set latest_attempt_id = $1 where id = $2', [
      first.rows[0]!.id,
      check.rows[0]!.id,
    ]);
    const value = (position: number) =>
      pool.query(
        `insert into prefilled_value (profile_id, organization_id, attempt_id, source, field, position, value, read_at)
         values ($1, $2, $3, 'adata', 'shareholders', $4, 'Иванов Иван', now())`,
        [ids.profile, ids.organization, first.rows[0]!.id, position],
      );
    await value(0);
    await value(1);
    await expect(value(1)).rejects.toMatchObject({ code: '23505' });
  });

  it('adata_allowance.used < 0 — 23514', async () => {
    await pool.query("insert into adata_allowance (period_start) values ('2026-11-04')");
    const row = await pool.query("select used from adata_allowance where period_start = '2026-11-04'");
    expect(row.rows).toEqual([{ used: 0 }]);
    await expect(
      pool.query("update adata_allowance set used = -1 where period_start = '2026-11-04'"),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
