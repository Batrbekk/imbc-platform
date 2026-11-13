import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

// Спецификация v1.3, раздел 3.1 и UPD-06: spectator → observer, inactive → unresponsive.
// Шаги expand (0003) и contract (0006) правила NFR-06 на реальном PostgreSQL.
// Каждый блок describe сам готовит базу нужной версии в beforeAll: тесты не зависят от соседних.
describe.skipIf(!process.env.TEST_DATABASE_URL)('migration to specification v1.3', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;

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

  describe('чистая база', () => {
    beforeAll(async () => {
      await resetDatabase(pool);
      await migrateThrough(pool); // все миграции одной транзакцией
    }, 60000);

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
      await migrateThrough(pool, '0005_adata_prefill'); // применяет 0004 и 0005
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

  describe('0006: contract', () => {
    /** Значения типа в порядке объявления, как текст массива PostgreSQL. */
    const enumRange = async (type: string) =>
      (await pool.query<{ labels: string }>(`select enum_range(null::${type})::text as labels`)).rows[0]!.labels;

    /** Ошибка из RAISE в теле 0006: Drizzle оборачивает её, текст и код — в cause. */
    const contractRefusal = (message: RegExp) => ({
      cause: expect.objectContaining({ code: 'P0001', message: expect.stringMatching(message) }),
    });

    /** Попытка чтения Adata у профиля: строки Adata переживают 0006 вместе с профилем. */
    async function insertAdataCheck(profileId: string, organizationId: string, bin: string) {
      const check = await pool.query<{ id: string }>(
        "insert into external_check (profile_id, organization_id, connector) values ($1, $2, 'adata') returning id",
        [profileId, organizationId],
      );
      const attempt = await pool.query<{ id: string }>(
        "insert into external_check_attempt (external_check_id, trigger, state, bin, is_test_data) values ($1, 'profile_created', 'received', $2, true) returning id",
        [check.rows[0]!.id, bin],
      );
      await pool.query('update external_check set latest_attempt_id = $2 where id = $1', [
        check.rows[0]!.id,
        attempt.rows[0]!.id,
      ]);
      return { check: check.rows[0]!.id, attempt: attempt.rows[0]!.id };
    }

    describe('на базе 0005 с данными v1.3', () => {
      const ids = {
        organization: '',
        account: '',
        inactiveAccount: '',
        profile: '',
        maker: '',
        check: '',
        attempt: '',
      };

      beforeAll(async () => {
        await resetDatabase(pool);
        await migrateThrough(pool, '0005_adata_prefill');
        // Данные после переноса v1.3: observer и unresponsive; inactive — состояние аккаунта (AUTH-07).
        ids.organization = (
          await pool.query<{ id: string }>(
            "insert into organizations (type, name) values ('observer', 'Наблюдатель') returning id",
          )
        ).rows[0]!.id;
        ids.account = (
          await pool.query<{ id: string }>(
            "insert into user_accounts (organization_id, email, role, state) values ($1, 'observer@observer.local', 'observer', 'active') returning id",
            [ids.organization],
          )
        ).rows[0]!.id;
        ids.inactiveAccount = (
          await pool.query<{ id: string }>(
            "insert into user_accounts (organization_id, email, role, state) values ($1, 'inactive@observer.local', 'observer', 'inactive') returning id",
            [ids.organization],
          )
        ).rows[0]!.id;
        const maker = await insertManufacturer('240100000007', 'unresponsive');
        ids.maker = maker.organization;
        ids.profile = maker.profile;
        Object.assign(ids, await insertAdataCheck(maker.profile, maker.organization, '240100000007'));
        await migrateThrough(pool, '0006_spec_v13_contract');
      }, 60000);

      it('0006 на базе 0005 с данными v1.3: в role, organization_type, update_status нет spectator и inactive, account_state сохраняет inactive (AUTH-07); строки и id целы', async () => {
        expect(await enumRange('role')).toBe('{manufacturer,expert,administrator,director,operator,observer}');
        expect(await enumRange('organization_type')).toBe('{manufacturer,operator,observer,imbc}');
        expect(await enumRange('update_status')).toBe('{active,outdated,unresponsive}');
        expect(await enumRange('account_state')).toBe('{invited,active,inactive,blocked}');

        const org = await pool.query('select id, type from organizations where id = $1', [ids.organization]);
        expect(org.rows).toEqual([{ id: ids.organization, type: 'observer' }]);
        const accounts = await pool.query(
          'select id, role, state from user_accounts where organization_id = $1 order by email',
          [ids.organization],
        );
        expect(accounts.rows).toEqual([
          { id: ids.inactiveAccount, role: 'observer', state: 'inactive' },
          { id: ids.account, role: 'observer', state: 'active' },
        ]);
        const profile = await pool.query(
          'select id, organization_id, update_status from manufacturer_profiles where id = $1',
          [ids.profile],
        );
        expect(profile.rows).toEqual([{ id: ids.profile, organization_id: ids.maker, update_status: 'unresponsive' }]);
        const visible = await pool.query(
          'select profile_id, update_status, tier from catalog_visible where profile_id = $1',
          [ids.profile],
        );
        expect(visible.rows).toEqual([{ profile_id: ids.profile, update_status: 'unresponsive', tier: 'tier_1' }]);
        const adata = await pool.query(
          `select c.id as check, a.id as attempt from external_check c
           join external_check_attempt a on a.id = c.latest_attempt_id where c.profile_id = $1`,
          [ids.profile],
        );
        expect(adata.rows).toEqual([{ check: ids.check, attempt: ids.attempt }]);
      });

      it('0006 удаляет пустые таблицы каркаса', async () => {
        const gone = await pool.query(
          `select to_regclass('external_checks') as external_checks, to_regclass('nda_versions') as nda_versions,
                  to_regclass('nda_acceptances') as nda_acceptances, to_regtype('check_status') as check_status`,
        );
        expect(gone.rows).toEqual([
          { external_checks: null, nda_versions: null, nda_acceptances: null, check_status: null },
        ]);
      });

      it('после 0006 значение v1.3 пишется, прежнее — 22P02', async () => {
        await pool.query(
          "insert into user_accounts (organization_id, email, role) values ($1, 'second@observer.local', 'observer')",
          [ids.organization],
        );
        await expect(
          pool.query(
            "insert into user_accounts (organization_id, email, role) values ($1, 'third@observer.local', 'spectator')",
            [ids.organization],
          ),
        ).rejects.toMatchObject({ code: '22P02' });
        await expect(
          pool.query("insert into organizations (type, name) values ('spectator', 'Наблюдатель v1.2')"),
        ).rejects.toMatchObject({ code: '22P02' });
        await expect(
          pool.query("update manufacturer_profiles set update_status = 'inactive' where id = $1", [ids.profile]),
        ).rejects.toMatchObject({ code: '22P02' });
      });
    });

    describe('предусловие', () => {
      /** Одна строка с прежним значением на базе 0005; значения ещё есть в типах. */
      const legacyRows: [string, () => Promise<unknown>][] = [
        [
          'organizations.type',
          () => pool.query("insert into organizations (type, name) values ('spectator', 'Наблюдатель v1.2')"),
        ],
        [
          'user_accounts.role',
          async () => {
            const org = await pool.query<{ id: string }>(
              "insert into organizations (type, name) values ('observer', 'Наблюдатель') returning id",
            );
            await pool.query(
              "insert into user_accounts (organization_id, email, role) values ($1, 'legacy@observer.local', 'spectator')",
              [org.rows[0]!.id],
            );
          },
        ],
        [
          'manufacturer_profiles.update_status',
          async () => {
            const maker = await pool.query<{ id: string }>(
              "insert into organizations (type, name, bin) values ('manufacturer', 'ТОО «Тест»', '240100000008') returning id",
            );
            await pool.query(
              "insert into manufacturer_profiles (organization_id, status, update_status, verified_at) values ($1, 'verified', 'inactive', now())",
              [maker.rows[0]!.id],
            );
          },
        ],
        [
          'catalog_visible.update_status',
          async () => {
            const { profile, organization } = await insertManufacturer('240100000009', 'active');
            await pool.query('delete from catalog_visible where profile_id = $1', [profile]);
            await insertCatalogRow(profile, organization, '240100000009', 'inactive');
          },
        ],
      ];

      it.each(legacyRows)('0006 останавливается, если осталось прежнее значение: %s', async (_column, insert) => {
        await resetDatabase(pool);
        await migrateThrough(pool, '0005_adata_prefill');
        await insert();

        await expect(migrateThrough(pool)).rejects.toMatchObject(
          contractRefusal(/^spec v1\.3 contract: 1 rows still hold spectator or inactive$/),
        );
        // После отказа типы и журнал — как у базы 0005: 0006 не записан и ничего не изменил
        // (проверка — первый оператор миграции; транзакцию пачки даёт мигратор).
        expect(await enumRange('role')).toContain('spectator');
        expect(await enumRange('update_status')).toContain('inactive');
        const journal = await pool.query('select count(*)::int as n from drizzle.__drizzle_migrations');
        expect(journal.rows).toEqual([{ n: 6 }]);
      });

      it.each(['nda_versions', 'external_checks'])(
        '0006 останавливается на непустой таблице каркаса: %s',
        async (table) => {
          await resetDatabase(pool);
          await migrateThrough(pool, '0005_adata_prefill');
          if (table === 'nda_versions')
            await pool.query(
              "insert into nda_versions (version, text_kk, text_ru, text_en) values (1, 'kk', 'ru', 'en')",
            );
          else {
            const { profile } = await insertManufacturer('240100000010', 'active');
            await pool.query(
              "insert into external_checks (profile_id, connector, bin, status, source) values ($1, 'adata', '240100000010', 'clean', 'stub')",
              [profile],
            );
          }

          await expect(migrateThrough(pool)).rejects.toMatchObject(
            contractRefusal(
              /^spec v1\.3 contract: skeleton tables external_checks, nda_versions, nda_acceptances are not empty$/,
            ),
          );
          const kept = await pool.query(
            'select to_regclass($1) is not null as kept, (select count(*)::int from ' + table + ') as n',
            [table],
          );
          expect(kept.rows).toEqual([{ kept: true, n: 1 }]);
          expect(await enumRange('role')).toContain('spectator');
        },
      );
    });
  });
});
