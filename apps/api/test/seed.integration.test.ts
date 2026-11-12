import { randomUUID } from 'node:crypto';
import { companyCardDataSchema } from '@imbc/contracts';
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
    expect(first).toEqual({ organizations: 15, accounts: 6, visible: 8 });
    expect((await accounts()).map((a) => a.email)).toEqual(['observer@observer.local']);
  });

  it('card каждой видимой строки проходит companyCardDataSchema, focal point есть у семи из восьми', async () => {
    const cards = async () =>
      (
        await pool.query<{ name: string; card: unknown }>(
          'select name_ru as name, card from catalog_visible order by name_ru',
        )
      ).rows;

    for (const run of ['первый', 'повторный']) {
      await seedDemo(pool);
      const rows = await cards();
      expect(rows, run).toHaveLength(8);
      const parsed = rows.map((r) => ({ name: r.name, card: companyCardDataSchema.parse(r.card) }));
      expect(
        parsed.filter((r) => r.card.focalPoint === null).map((r) => r.name),
        run,
      ).toEqual(['ТОО «Тест Химия»']);
      expect(
        parsed.every((r) => r.card.companyPhone && r.card.companyEmail?.endsWith('.demo.local')),
        run,
      ).toBe(true);
      // Адрес контактного лица — тоже вымышленный, на .demo.local.
      expect(
        parsed.every((r) => r.card.focalPoint === null || r.card.focalPoint.email.endsWith('.demo.local')),
        run,
      ).toBe(true);
      // Стенд после прежней версии: строки уже есть с card = { demo: true }; повторный запуск их перезаписывает.
      await pool.query(`update catalog_visible set card = '{"demo": true}'::jsonb`);
    }
  });

  it('очередь seed: два submitted, один under_review у эксперта, draft вне проекции', async () => {
    const queue = async () =>
      (
        await pool.query<{ name: string; status: string; expert: string | null; visible: boolean }>(
          `select o.name, p.status, a.email as expert,
                  exists (select 1 from catalog_visible c where c.organization_id = o.id) as visible
           from manufacturer_profiles p
           join organizations o on o.id = p.organization_id
           left join user_accounts a on a.id = p.assigned_expert_id
           where p.status <> 'verified'
           order by p.registered_at, o.name`,
        )
      ).rows;
    const expected = [
      { name: 'ТОО «Жаңа Демо Құрылыс»', status: 'submitted', expert: null, visible: false },
      { name: 'ТОО «Демо Агро Өнім»', status: 'submitted', expert: null, visible: false },
      { name: 'ТОО «Демо Электро Монтаж»', status: 'under_review', expert: 'expert@imbc.local', visible: false },
      { name: 'ТОО «Демо Жоба»', status: 'draft', expert: null, visible: false },
    ];

    await seedDemo(pool);
    expect(await queue(), 'первый').toEqual(expected);
    // Стенд после ручных действий: статус и назначение расходятся с seed; повторный запуск их возвращает.
    await pool.query(
      `update manufacturer_profiles set status = 'returned', assigned_expert_id = null
       where organization_id in (select id from organizations where name like 'ТОО «Демо Электро%')`,
    );
    await pool.query(
      `update manufacturer_profiles set status = 'under_review',
         assigned_expert_id = (select id from user_accounts where lower(email) = 'expert@imbc.local')
       where organization_id in (select id from organizations where name = 'ТОО «Демо Жоба»')`,
    );
    await pool.query(`update manufacturer_profiles set has_pending_changes = true where status <> 'verified'`);
    await seedDemo(pool);
    expect(await queue(), 'повторный').toEqual(expected);
    const pending = await pool.query(`select 1 from manufacturer_profiles where status <> 'verified' and has_pending_changes`);
    expect(pending.rowCount, 'has_pending_changes после повторного запуска').toBe(0);
    // У новых организаций нет аккаунтов.
    const accounts = await pool.query(
      `select a.email from user_accounts a join organizations o on o.id = a.organization_id
       where o.bin is not null and o.name in ($1, $2, $3, $4)`,
      expected.map((e) => e.name),
    );
    expect(accounts.rows).toEqual([]);
  });

  it('дата регистрации верифицированного демо-профиля раньше даты верификации — после первого и повторного запуска', async () => {
    const later = async () =>
      (
        await pool.query<{ name: string }>(
          `select o.name from manufacturer_profiles p join organizations o on o.id = p.organization_id
           where p.status = 'verified' and not (p.registered_at < p.verified_at)`,
        )
      ).rows;
    const verified = async () =>
      (
        await pool.query<{ n: number }>(
          "select count(*)::int as n from manufacturer_profiles where status = 'verified'",
        )
      ).rows[0]!.n;

    await seedDemo(pool);
    expect(await verified()).toBe(8);
    expect(await later(), 'первый').toEqual([]);
    // Стенд до исправления: registered_at — момент первого запуска seed, позже verified_at.
    await pool.query(`update manufacturer_profiles set registered_at = now() where status = 'verified'`);
    expect(await later()).toHaveLength(8);
    const before = await pool.query<{ id: string; verified_at: Date }>(
      "select id, verified_at from manufacturer_profiles where status = 'verified' order by id",
    );
    await seedDemo(pool);
    expect(await later(), 'повторный').toEqual([]);
    // verified_at существующих строк не меняется.
    const after = await pool.query<{ id: string; verified_at: Date }>(
      "select id, verified_at from manufacturer_profiles where status = 'verified' order by id",
    );
    expect(after.rows).toEqual(before.rows);
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
