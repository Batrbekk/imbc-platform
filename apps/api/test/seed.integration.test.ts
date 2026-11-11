import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedDemo } from '../src/database/seed.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

// Демо-аккаунт наблюдателя (GEN-06, раздел 3.1 v1.3): spectator@spectator.local → observer@observer.local.
// На стенде строка аккаунта переименовывается на месте: id и idp_subject сохраняются.
describe.skipIf(!process.env.TEST_DATABASE_URL)('demo seed', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;

  /** Аккаунты наблюдателя — прежний и новый адрес. */
  const accounts = async () =>
    (
      await pool.query<{ id: string; email: string; organization_id: string; idp_subject: string | null }>(
        `select id, email, organization_id, idp_subject from user_accounts
         where lower(email) in ('spectator@spectator.local', 'observer@observer.local') order by email`,
      )
    ).rows;

  /** Демо-организация и аккаунт наблюдателя, как их оставила предыдущая версия после переноса данных. */
  const legacyObserver = async (email = 'spectator@spectator.local') => {
    const org = await pool.query<{ id: string }>(
      "insert into organizations (type, name) values ('observer', 'Наблюдатель (демо)') returning id",
    );
    const subject = randomUUID();
    const account = await pool.query<{ id: string }>(
      "insert into user_accounts (organization_id, email, role, state, idp_subject) values ($1, $2, 'observer', 'active', $3) returning id",
      [org.rows[0]!.id, email, subject],
    );
    return { organization: org.rows[0]!.id, account: account.rows[0]!.id, subject };
  };

  beforeAll(() => {
    pool = openTestPool();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    await migrateThrough(pool);
  }, 60000);

  afterAll(async () => {
    await pool?.end();
  });

  it('переименовывает прежний демо-аккаунт на месте', async () => {
    const legacy = await legacyObserver();

    await seedDemo(pool);

    expect(await accounts()).toEqual([
      {
        id: legacy.account,
        email: 'observer@observer.local',
        organization_id: legacy.organization,
        idp_subject: legacy.subject,
      },
    ]);
    const orgs = await pool.query("select id from organizations where name = 'Наблюдатель (демо)'");
    expect(orgs.rows).toEqual([{ id: legacy.organization }]);
  });

  it('находит прежний адрес без учёта регистра', async () => {
    const legacy = await legacyObserver('Spectator@Spectator.local');

    await seedDemo(pool);

    expect(await accounts()).toEqual([
      {
        id: legacy.account,
        email: 'observer@observer.local',
        organization_id: legacy.organization,
        idp_subject: legacy.subject,
      },
    ]);
  });

  it('не трогает аккаунты, если observer@observer.local уже существует', async () => {
    const legacy = await legacyObserver();
    const current = await pool.query<{ id: string }>(
      "insert into user_accounts (organization_id, email, role, state) values ($1, 'observer@observer.local', 'observer', 'invited') returning id",
      [legacy.organization],
    );

    await seedDemo(pool);

    expect(await accounts()).toEqual([
      {
        id: current.rows[0]!.id,
        email: 'observer@observer.local',
        organization_id: legacy.organization,
        idp_subject: null,
      },
      {
        id: legacy.account,
        email: 'spectator@spectator.local',
        organization_id: legacy.organization,
        idp_subject: legacy.subject,
      },
    ]);
  });

  it('повторный запуск не создаёт дублей', async () => {
    const counts = async () =>
      (
        await pool.query<{ organizations: number; accounts: number; visible: number }>(
          `select (select count(*)::int from organizations) as organizations,
                  (select count(*)::int from user_accounts) as accounts,
                  (select count(*)::int from catalog_visible) as visible`,
        )
      ).rows[0];

    await seedDemo(pool);
    const first = await counts();
    await seedDemo(pool);

    expect(await counts()).toEqual(first);
    expect(first).toEqual({ organizations: 11, accounts: 6, visible: 8 });
    expect((await accounts()).map((a) => a.email)).toEqual(['observer@observer.local']);
  });

  it('статус актуальности профиля и его строки в проекции совпадают после первого и повторного запуска (UPD-04, UPD-06)', async () => {
    const statuses = async () =>
      (
        await pool.query<{ name: string; profile: string; visible: string }>(
          `select o.name, p.update_status as profile, c.update_status as visible
           from catalog_visible c
           join manufacturer_profiles p on p.id = c.profile_id
           join organizations o on o.id = p.organization_id
           order by o.name`,
        )
      ).rows;
    const byStatus = (rows: { name: string; visible: string }[], status: string) =>
      rows.filter((r) => r.visible === status).map((r) => r.name);

    for (const run of ['первый', 'повторный']) {
      await seedDemo(pool);
      const rows = await statuses();
      expect(rows, run).toHaveLength(8);
      expect(
        rows.filter((r) => r.profile !== r.visible),
        run,
      ).toEqual([]);
      // Компании, которые seed объявляет unresponsive и outdated; остальные — active.
      expect(byStatus(rows, 'unresponsive'), run).toEqual(['ТОО «Тест Химия»']);
      expect(byStatus(rows, 'outdated'), run).toEqual(['ТОО «Степь Пластик»']);
      expect(byStatus(rows, 'active'), run).toHaveLength(6);
    }
  });
});
