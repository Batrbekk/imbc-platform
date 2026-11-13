import { join } from 'node:path';
import { companyCardDataSchema } from '@imbc/contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadReferenceDirectory, REFERENCE_DATA_DIR } from '../src/database/reference-data.js';
import * as schema from '../src/database/schema/index.js';
import { NDA_PLACEHOLDER_BODY, seedDemo } from '../src/database/seed.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

// Демо-аккаунт наблюдателя (GEN-06, раздел 3.1 v1.3) — observer@observer.local; прежний адрес
// spectator@spectator.local seed не создаёт.
describe.skipIf(!process.env.TEST_DATABASE_URL)('demo seed', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;

  /** Аккаунты наблюдателя — прежний и новый адрес. */
  const accounts = async () =>
    (
      await pool.query<{ email: string }>(
        `select email from user_accounts
         where lower(email) in ('spectator@spectator.local', 'observer@observer.local') order by email`,
      )
    ).rows;

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
    // 15 организаций seed и NCOC, TCO, KPO из 0008; IMBC из 0008 seed находит по типу.
    expect(first).toEqual({ organizations: 18, accounts: 6, visible: 8 });
    expect((await accounts()).map((a) => a.email)).toEqual(['observer@observer.local']);
  });

  it('seed загружает временные справочники: после seed — 9 регионов, KZ-ATY есть; после одних миграций с загрузкой release — регионов 0 (ADM-08, DATA-03)', async () => {
    const perDictionary = async () =>
      Object.fromEntries(
        (
          await pool.query<{ code: string; n: number }>(
            `select d.code, count(e.id)::int as n from dictionary d
             left join dictionary_entry e on e.dictionary_id = d.id group by d.code order by d.code`,
          )
        ).rows.map((r) => [r.code, r.n]),
      );
    const regions = async () =>
      (
        await pool.query<{ code: string }>(
          `select e.code from dictionary_entry e join dictionary d on d.id = e.dictionary_id
           where d.code = 'region' order by e.code`,
        )
      ).rows.map((r) => r.code);

    // Продакшен: миграции и загрузка release — семь списков без перечня IMBC пусты (расхождение 5 плана).
    await loadReferenceDirectory(
      drizzle(pool, { schema, casing: 'snake_case' }),
      join(REFERENCE_DATA_DIR, 'release'),
      'release',
    );
    expect(await regions()).toEqual([]);
    const production = await perDictionary();
    expect(production).toEqual({
      commodity_group: 5,
      commodity_type: 0,
      contact_role: 3,
      certificate_type: 10,
      document_type: 4,
      equipment_type: 0,
      kpved: 0,
      legal_form: 3,
      oked: 0,
      process: 0,
      region: 0,
      tn_ved: 0,
    });

    // Стенд: seed добавляет временные значения прототипа.
    await seedDemo(pool);
    const found = await regions();
    expect(found).toHaveLength(9);
    expect(found).toContain('KZ-ATY');
    // Регионы компаний каталога seed покрыты списком.
    const catalog = await pool.query<{ region: string }>('select distinct region from catalog_visible order by region');
    expect(catalog.rows.length).toBeGreaterThan(0);
    for (const { region } of catalog.rows) expect(found).toContain(region);
    const demo = await perDictionary();
    expect(demo).toEqual({
      ...production,
      commodity_type: 5,
      equipment_type: 2,
      kpved: 2,
      oked: 4,
      process: 3,
      region: 9,
      tn_ved: 4,
    });
    // ТН ВЭД, ОКЭД: ведущие нули и тип text (DATA-03).
    const codes = await pool.query<{ code: string }>(
      `select e.code from dictionary_entry e join dictionary d on d.id = e.dictionary_id
       where d.code = 'tn_ved' order by e.code`,
    );
    expect(codes.rows.map((r) => r.code)).toEqual(['7308909809', '8413702100', '8481805190', '8544499108']);

    // Повторный seed: значений не прибавилось, аудит загрузки — только за первый запуск.
    const audit = async () =>
      (
        await pool.query<{ n: number }>(
          "select count(*)::int as n from audit_entries where action = 'reference.loaded'",
        )
      ).rows[0]!.n;
    const auditAfterFirst = await audit();
    // Пять списков release и семь временных.
    expect(auditAfterFirst).toBe(12);
    await seedDemo(pool);
    expect(await perDictionary()).toEqual(demo);
    expect(await audit()).toBe(auditAfterFirst);
  });

  it('seed: текущая NDA — версия 1, три абзаца заглушки (kk, ru, en), опубликовал admin@imbc.local; повторный запуск не создаёт вторую версию (FC-02, Р-5)', async () => {
    const versions = async () =>
      (
        await pool.query<{ version: number; body: string; current: boolean; publisher: string | null }>(
          `select v.version_number as version, v.body, v.is_current as current, a.email as publisher
           from nda_version v left join user_accounts a on a.id = v.published_by order by v.version_number`,
        )
      ).rows;

    await seedDemo(pool);
    const first = await versions();
    expect(first.map(({ body: _, ...v }) => v)).toEqual([{ version: 1, current: true, publisher: 'admin@imbc.local' }]);
    expect(first[0]!.body).toBe(NDA_PLACEHOLDER_BODY);
    expect(first[0]!.body.split('\n\n')).toEqual([
      'УАҚЫТША МӘТІН — ЗАҢДЫҚ ҚҰЖАТ ЕМЕС. Платформаның құпияны жария етпеу туралы келісімінің (NDA) мәтінін IMBC ұсынады. Бұл мәтін тек сынақ стендіне арналған, оған сүйенуге болмайды.',
      'ВРЕМЕННЫЙ ТЕКСТ — НЕ ЮРИДИЧЕСКИЙ ДОКУМЕНТ. Текст соглашения о неразглашении (NDA) платформы предоставит IMBC. Этот текст существует только для тестового стенда, полагаться на него нельзя.',
      'PLACEHOLDER — NOT A LEGAL TEXT. IMBC will provide the text of the platform non-disclosure agreement (NDA). This text exists only for the test environment and must not be relied on.',
    ]);

    await seedDemo(pool);
    expect(await versions()).toEqual(first);
    // Версия уже есть (например, текст IMBC из миграции) — seed свою не добавляет.
    await pool.query('delete from nda_version');
    await pool.query("insert into nda_version (version_number, body, is_current) values (2, 'IMBC', true)");
    await seedDemo(pool);
    expect((await versions()).map((v) => v.version)).toEqual([2]);
  });

  it('seed не создаёт вторую IMBC, если существующая названа иначе', async () => {
    // Организация IMBC одна (organizations_imbc_uq); seed ищет её по типу, а не по имени.
    await pool.query("update organizations set name = 'IMBC Kazakhstan' where type = 'imbc'");
    await seedDemo(pool);
    const imbc = await pool.query<{ id: string; name: string }>(
      "select id, name from organizations where type = 'imbc'",
    );
    expect(imbc.rows.map((r) => r.name)).toEqual(['IMBC Kazakhstan']);
    const staff = await pool.query<{ email: string; organization_id: string }>(
      `select email, organization_id from user_accounts where role in ('expert', 'administrator', 'director') order by email`,
    );
    expect(staff.rows).toEqual(
      ['admin@imbc.local', 'director@imbc.local', 'expert@imbc.local'].map((email) => ({
        email,
        organization_id: imbc.rows[0]!.id,
      })),
    );
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
