import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { backfillSpecV13 } from '../src/database/backfill.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

// Спецификация v1.3, раздел 3.1 и UPD-06: spectator → observer, inactive → unresponsive.
// Шаги expand и migrate (NFR-06) на реальном PostgreSQL; contract — в следующем релизе.
// Каждый блок describe сам готовит базу нужной версии в beforeAll: тесты не зависят от соседних.
describe.skipIf(!process.env.TEST_DATABASE_URL)('migration to specification v1.3', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;
  const none = { organizations: 0, userAccounts: 0, manufacturerProfiles: 0, catalogVisible: 0 };

  beforeAll(() => {
    pool = openTestPool();
  });

  afterAll(async () => {
    await pool?.end();
  });

  /** Строка проекции так, как её пишет предыдущая версия приложения: без колонки tier. */
  async function insertCatalogRow(
    profileId: string,
    organizationId: string,
    bin: string,
    updateStatus: string,
    siteSurveyed?: boolean,
  ) {
    await pool.query(
      `insert into catalog_visible (profile_id, organization_id, bin, name_en, name_ru, name_normalized, region,
         commodity_groups, commodity_types, tnved_codes, kpved_codes, oked_codes, certificate_types,
         certificates_valid_until, ${siteSurveyed === undefined ? '' : 'site_surveyed, '}update_status, verified_at, card)
       values ($1, $2, $3, 'Test LLP', 'ТОО «Тест»', 'тест', 'KZ-ATY',
         '{A}', '{}', '{}', '{}', '{}', '{}', '{}'::jsonb, ${siteSurveyed === undefined ? '' : `${siteSurveyed}, `}$4, now(), '{}'::jsonb)`,
      [profileId, organizationId, bin, updateStatus],
    );
  }

  /** Верифицированный производитель прежней версии и его строка в проекции. */
  async function insertManufacturer(bin: string, updateStatus: string, siteSurveyed?: boolean) {
    const maker = await pool.query<{ id: string }>(
      "insert into organizations (type, name, bin) values ('manufacturer', 'ТОО «Тест»', $1) returning id",
      [bin],
    );
    const profile = await pool.query<{ id: string }>(
      "insert into manufacturer_profiles (organization_id, status, update_status, verified_at) values ($1, 'verified', $2, now()) returning id",
      [maker.rows[0]!.id, updateStatus],
    );
    await insertCatalogRow(profile.rows[0]!.id, maker.rows[0]!.id, bin, updateStatus, siteSurveyed);
    return { organization: maker.rows[0]!.id, profile: profile.rows[0]!.id };
  }

  /** База версии 0002 с данными v1.2: spectator и inactive. */
  async function previousVersionDatabase() {
    await resetDatabase(pool);
    await migrateThrough(pool, '0002_logout_revocation');
    const subject = randomUUID();
    const org = await pool.query<{ id: string }>(
      "insert into organizations (type, name) values ('spectator', 'Наблюдатель v1.2') returning id",
    );
    const account = await pool.query<{ id: string }>(
      "insert into user_accounts (organization_id, email, role, state, idp_subject) values ($1, 'observer@example.invalid', 'spectator', 'active', $2) returning id",
      [org.rows[0]!.id, subject],
    );
    const { profile } = await insertManufacturer('240100000001', 'inactive');
    return { organization: org.rows[0]!.id, account: account.rows[0]!.id, profile, subject };
  }

  describe('0003: expand', () => {
    beforeAll(async () => {
      await previousVersionDatabase();
      await migrateThrough(pool, '0003_spec_v13_expand');
    }, 60000);

    it('expand оставляет предыдущую версию приложения рабочей (NFR-06)', async () => {
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
  });

  describe('перенос данных', () => {
    let ids: Awaited<ReturnType<typeof previousVersionDatabase>>;

    beforeAll(async () => {
      ids = await previousVersionDatabase();
      await migrateThrough(pool);
    }, 60000);

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
      const visible = await pool.query('select update_status from catalog_visible where profile_id = $1', [
        ids.profile,
      ]);
      expect(visible.rows).toEqual([{ update_status: 'unresponsive' }]);
    });
  });

  describe('повторный запуск', () => {
    beforeAll(async () => {
      await previousVersionDatabase();
      await migrateThrough(pool);
      await backfillSpecV13(pool);
    }, 60000);

    it('повторный запуск ничего не меняет', async () => {
      await migrateThrough(pool);
      expect(await backfillSpecV13(pool)).toEqual(none);
    });
  });

  describe('чистая база', () => {
    beforeAll(async () => {
      await resetDatabase(pool);
      await migrateThrough(pool); // 0000–0004 одной транзакцией
    }, 60000);

    it('чистой базе перенос не нужен', async () => {
      expect(await backfillSpecV13(pool)).toEqual(none);
    });

    it('0004 на чистой базе: тир вычисляется при вставке без колонки (IMBC-19, IMBC-20)', async () => {
      const surveyed = await insertManufacturer('240100000002', 'active', true);
      const plain = await insertManufacturer('240100000003', 'active');
      const rows = await pool.query('select profile_id, tier from catalog_visible order by tier');
      expect(rows.rows).toEqual([
        { profile_id: plain.profile, tier: 'tier_1' },
        { profile_id: surveyed.profile, tier: 'tier_2' },
      ]);
    });
  });

  describe('0004: тир в проекции', () => {
    const profiles = { surveyed: '', plain: '' };

    beforeAll(async () => {
      await resetDatabase(pool);
      await migrateThrough(pool, '0003_spec_v13_expand');
      // Строки, которые записала предыдущая версия приложения (до колонки tier).
      profiles.surveyed = (await insertManufacturer('240100000004', 'active', true)).profile;
      profiles.plain = (await insertManufacturer('240100000005', 'outdated', false)).profile;
      await migrateThrough(pool); // применяет 0004
    }, 60000);

    it('0004: тир вычисляется для существующих строк и при вставке без колонки', async () => {
      const tierOf = async (profileId: string) =>
        (await pool.query('select tier from catalog_visible where profile_id = $1', [profileId])).rows;
      expect(await tierOf(profiles.surveyed)).toEqual([{ tier: 'tier_2' }]);
      expect(await tierOf(profiles.plain)).toEqual([{ tier: 'tier_1' }]);

      // INSERT без tier, как у прежнего seed, проходит; обследование меняет тир без записи в колонку.
      const added = await insertManufacturer('240100000006', 'active', false);
      expect(await tierOf(added.profile)).toEqual([{ tier: 'tier_1' }]);
      await pool.query('update catalog_visible set site_surveyed = true where profile_id = $1', [added.profile]);
      expect(await tierOf(added.profile)).toEqual([{ tier: 'tier_2' }]);
    });

    it('тир нельзя записать напрямую: он только вычисляется (IMBC-19)', async () => {
      await expect(
        pool.query("update catalog_visible set tier = 'tier_2' where profile_id = $1", [profiles.plain]),
      ).rejects.toThrow(/can only be updated to DEFAULT/);
    });
  });
});
