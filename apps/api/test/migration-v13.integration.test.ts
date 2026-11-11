import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { backfillSpecV13 } from '../src/database/backfill.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

// Спецификация v1.3, раздел 3.1 и UPD-06: spectator → observer, inactive → unresponsive.
// Шаги expand и migrate (NFR-06) на реальном PostgreSQL; contract — в следующем релизе.
describe.skipIf(!process.env.TEST_DATABASE_URL)('migration to specification v1.3', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;
  const ids = { organization: '', account: '', profile: '', subject: randomUUID() };

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool, '0002_logout_revocation');
    // Данные, которые записала предыдущая версия приложения.
    const org = await pool.query<{ id: string }>(
      "insert into organizations (type, name) values ('spectator', 'Наблюдатель v1.2') returning id",
    );
    ids.organization = org.rows[0]!.id;
    const account = await pool.query<{ id: string }>(
      "insert into user_accounts (organization_id, email, role, state, idp_subject) values ($1, 'observer@example.invalid', 'spectator', 'active', $2) returning id",
      [ids.organization, ids.subject],
    );
    ids.account = account.rows[0]!.id;
    const maker = await pool.query<{ id: string }>(
      "insert into organizations (type, name, bin) values ('manufacturer', 'ТОО «Тест»', '240100000001') returning id",
    );
    const profile = await pool.query<{ id: string }>(
      "insert into manufacturer_profiles (organization_id, status, update_status, verified_at) values ($1, 'verified', 'inactive', now()) returning id",
      [maker.rows[0]!.id],
    );
    ids.profile = profile.rows[0]!.id;
    await pool.query(
      `insert into catalog_visible (profile_id, organization_id, bin, name_en, name_ru, name_normalized, region,
         commodity_groups, commodity_types, tnved_codes, kpved_codes, oked_codes, certificate_types,
         certificates_valid_until, update_status, verified_at, card)
       values ($1, $2, '240100000001', 'Test LLP', 'ТОО «Тест»', 'тест', 'KZ-ATY',
         '{A}', '{}', '{}', '{}', '{}', '{}', '{}'::jsonb, 'inactive', now(), '{}'::jsonb)`,
      [ids.profile, maker.rows[0]!.id],
    );
  }, 60000);

  afterAll(async () => {
    await pool?.end();
  });

  it('expand оставляет предыдущую версию приложения рабочей (NFR-06)', async () => {
    await migrateThrough(pool); // применяет 0003
    const labels = async (type: string) =>
      (
        await pool.query<{ enumlabel: string }>(
          'select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = $1',
          [type],
        )
      ).rows.map((r) => r.enumlabel);
    expect(await labels('role')).toEqual(expect.arrayContaining(['spectator', 'observer']));
    expect(await labels('organization_type')).toEqual(expect.arrayContaining(['spectator', 'observer']));
    expect(await labels('update_status')).toEqual(expect.arrayContaining(['inactive', 'unresponsive']));
    // запросы прежней версии выполняются, данные ещё прежние
    const old = await pool.query(
      "select count(*)::int as n from manufacturer_profiles where update_status = 'inactive'",
    );
    expect(old.rows[0].n).toBe(1);
  });

  it('перенос данных меняет значения и сохраняет идентификаторы', async () => {
    expect(await backfillSpecV13(pool)).toEqual({
      organizations: 1,
      userAccounts: 1,
      manufacturerProfiles: 1,
      catalogVisible: 1,
    });
    const org = await pool.query('select type from organizations where id = $1', [ids.organization]);
    expect(org.rows).toEqual([{ type: 'observer' }]);
    const account = await pool.query('select id, idp_subject, role from user_accounts where id = $1', [ids.account]);
    expect(account.rows).toEqual([{ id: ids.account, idp_subject: ids.subject, role: 'observer' }]);
    const profile = await pool.query('select update_status from manufacturer_profiles where id = $1', [ids.profile]);
    expect(profile.rows).toEqual([{ update_status: 'unresponsive' }]);
    const visible = await pool.query('select update_status from catalog_visible where profile_id = $1', [ids.profile]);
    expect(visible.rows).toEqual([{ update_status: 'unresponsive' }]);
  });

  it('повторный запуск ничего не меняет; чистой базе перенос не нужен', async () => {
    const none = { organizations: 0, userAccounts: 0, manufacturerProfiles: 0, catalogVisible: 0 };
    await migrateThrough(pool);
    expect(await backfillSpecV13(pool)).toEqual(none);

    await resetDatabase(pool);
    await migrateThrough(pool);
    expect(await backfillSpecV13(pool)).toEqual(none);
  });
});
