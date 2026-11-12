import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const BEFORE = '0006_spec_v13_contract';
const migrationText = (tag: string) => readFileSync(join(MIGRATIONS, `${tag}.sql`), 'utf8');
const statements = (tag: string) =>
  migrationText(tag)
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);

// Этап 1: модель регистрации и организаций. 0007 — expand (NFR-06), 0008 — данные: организация IMBC
// и major operators NCOC, TCO, KPO (GEN-05).
describe('0007: текст миграции', () => {
  it('в 0007 нет DROP, RENAME, SET NOT NULL и ALTER TYPE', () => {
    const text = migrationText('0007_accounts_registration');
    expect(text).not.toMatch(/\bDROP\s/i);
    expect(text).not.toMatch(/\bRENAME\b/i);
    expect(text).not.toMatch(/SET NOT NULL/i);
    expect(text).not.toMatch(/ALTER TYPE/i);
    // Только CREATE TABLE, ADD COLUMN без NOT NULL, ADD CONSTRAINT и CREATE INDEX; ни одного UPDATE и DELETE.
    for (const statement of statements('0007_accounts_registration')) {
      expect(statement).toMatch(
        /^(CREATE TABLE "\w+"|ALTER TABLE "\w+" ADD COLUMN "\w+" [\w "]+;$|ALTER TABLE "\w+" ADD CONSTRAINT "\w+" |CREATE (UNIQUE )?INDEX "\w+" ON )/,
      );
      if (/ADD COLUMN/.test(statement)) expect(statement).not.toMatch(/NOT NULL/);
    }
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('этап 1: миграции 0007 и 0008', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;

  beforeAll(() => {
    pool = openTestPool();
  });

  afterAll(async () => {
    await pool?.end();
  });

  /** Код ошибки PostgreSQL и имя ограничения из отказа. */
  const refusal = (code: string, constraint: string) => expect.objectContaining({ code, constraint });

  /**
   * Регистрация так, как её пишет предыдущая версия приложения (`20d0431`, `registration.controller.ts`
   * и `ProfilesService.ensureDraft`): списки колонок — те же, новых колонок 0007 в них нет.
   */
  async function previousRegistration(bin: string) {
    const org = await pool.query<{ id: string }>(
      "insert into organizations (type, name, bin) values ('manufacturer', 'ТОО «Прежняя»', $1) returning id",
      [bin],
    );
    const account = await pool.query<{ id: string }>(
      "insert into user_accounts (organization_id, email, role, idp_subject, locale) values ($1, $2, 'manufacturer', $3, 'kk') returning id",
      [org.rows[0]!.id, `${bin}@example.local`, randomUUID()],
    );
    const profile = await pool.query<{ id: string }>(
      'insert into manufacturer_profiles (organization_id, heard_about_us) values ($1, $2) returning id',
      [org.rows[0]!.id, 'Выставка'],
    );
    const section = await pool.query<{ id: string }>(
      "insert into profile_sections (profile_id, kind) values ($1, 'main') returning id",
      [profile.rows[0]!.id],
    );
    const revision = await pool.query<{ id: string }>(
      'insert into section_revisions (section_id, number, author_id) values ($1, 1, $2) returning id',
      [section.rows[0]!.id, account.rows[0]!.id],
    );
    await pool.query('update profile_sections set working_revision_id = $2 where id = $1', [
      section.rows[0]!.id,
      revision.rows[0]!.id,
    ]);
    return { organization: org.rows[0]!.id, account: account.rows[0]!.id, profile: profile.rows[0]!.id };
  }

  /** Строка целиком (jsonb) без перечисленных колонок. */
  const row = async (table: string, id: string, without: string[] = []) =>
    (
      await pool.query<{ row: Record<string, unknown> }>(
        `select to_jsonb(t) - $2::text[] as row from ${table} t where id = $1`,
        [id, without],
      )
    ).rows[0]!.row;

  const NEW_ACCOUNT_COLUMNS = [
    'platform_terms_accepted_at',
    'personal_data_accepted_at',
    'registration_nda_version_id',
    'registration_nda_accepted_at',
    'registration_ip',
    'registration_heard_about_us',
    'inactive_since',
  ];

  describe('база 0006 с данными предыдущей версии', () => {
    const before: Record<string, Record<string, unknown>> = {};
    let first: Awaited<ReturnType<typeof previousRegistration>>;

    beforeAll(async () => {
      await resetDatabase(pool);
      await migrateThrough(pool, BEFORE);
      first = await previousRegistration('240100000101');
      before.organization = await row('organizations', first.organization);
      before.account = await row('user_accounts', first.account);
      before.profile = await row('manufacturer_profiles', first.profile);
      await migrateThrough(pool);
    }, 60000);

    it('0007 и 0008 — expand: база 0006 с данными предыдущей версии мигрирует, строки целы; запись предыдущей версии проходит (NFR-06)', async () => {
      // Прежние колонки не изменились, новые пусты.
      expect(await row('organizations', first.organization, ['notification_mailbox'])).toEqual(before.organization);
      expect(await row('user_accounts', first.account, NEW_ACCOUNT_COLUMNS)).toEqual(before.account);
      expect(await row('manufacturer_profiles', first.profile)).toEqual(before.profile);
      const added = await row('user_accounts', first.account);
      for (const column of NEW_ACCOUNT_COLUMNS) expect(added[column], column).toBeNull();
      expect((await row('organizations', first.organization)).notification_mailbox).toBeNull();

      // Ещё одна регистрация теми же запросами предыдущей версии.
      const second = await previousRegistration('240100000102');
      const account = await row('user_accounts', second.account);
      for (const column of NEW_ACCOUNT_COLUMNS) expect(account[column], column).toBeNull();
      const tables = await pool.query(
        `select to_regclass('nda_version') is not null as nda_version, to_regclass('nda_acceptance') is not null as nda_acceptance,
                (select count(*)::int from nda_version) as versions`,
      );
      expect(tables.rows).toEqual([{ nda_version: true, nda_acceptance: true, versions: 0 }]);
    });
  });

  describe('чистая база', () => {
    let imbc: string;

    beforeAll(async () => {
      await resetDatabase(pool);
      await migrateThrough(pool);
      imbc = (await pool.query<{ id: string }>("select id from organizations where type = 'imbc'")).rows[0]!.id;
    }, 60000);

    const organization = async (type: string, name: string, bin: string | null = null) =>
      (
        await pool.query<{ id: string }>(
          'insert into organizations (type, name, bin) values ($1, $2, $3) returning id',
          [type, name, bin],
        )
      ).rows[0]!.id;
    const account = (organizationId: string, role: string) =>
      pool.query('insert into user_accounts (organization_id, email, role) values ($1, $2, $3)', [
        organizationId,
        `${randomUUID()}@example.local`,
        role,
      ]);
    const ndaVersion = async (versionNumber: number, isCurrent = false) =>
      (
        await pool.query<{ id: string }>(
          'insert into nda_version (version_number, body, is_current) values ($1, $2, $3) returning id',
          [versionNumber, `NDA ${versionNumber}`, isCurrent],
        )
      ).rows[0]!.id;

    it('второй аккаунт с ролью manufacturer в одной организации — 23505 user_accounts_manufacturer_org_uq; у оператора аккаунтов сколько угодно (GEN-01, GEN-02)', async () => {
      const maker = await organization('manufacturer', 'ТОО «Один аккаунт»', '240100000201');
      await account(maker, 'manufacturer');
      await expect(account(maker, 'manufacturer')).rejects.toMatchObject(
        refusal('23505', 'user_accounts_manufacturer_org_uq'),
      );

      const operator = await organization('operator', 'Оператор GEN-02');
      for (let i = 0; i < 3; i++) await account(operator, 'operator');
      for (let i = 0; i < 2; i++) await account(imbc, 'expert');
      const n = await pool.query('select count(*)::int as n from user_accounts where organization_id = $1', [operator]);
      expect(n.rows).toEqual([{ n: 3 }]);
    });

    it('вторая организация imbc, второй оператор с тем же именем без учёта регистра, вторая текущая NDA, второе принятие той же версии профилем — 23505; два производителя с одним названием — можно', async () => {
      await expect(organization('imbc', 'IMBC второй')).rejects.toMatchObject(
        refusal('23505', 'organizations_imbc_uq'),
      );
      await expect(organization('operator', 'ncoc')).rejects.toMatchObject(refusal('23505', 'organizations_name_uq'));
      await organization('observer', 'Наблюдатель NCOC');
      await expect(organization('observer', 'наблюдатель ncoc')).rejects.toMatchObject(
        refusal('23505', 'organizations_name_uq'),
      );
      // Тип входит в ключ: наблюдатель может называться как оператор.
      await organization('observer', 'NCOC');

      const current = await ndaVersion(1, true);
      await expect(ndaVersion(2, true)).rejects.toMatchObject(refusal('23505', 'nda_version_current_uq'));
      await expect(ndaVersion(1)).rejects.toMatchObject(refusal('23505', 'nda_version_number_uq'));
      await ndaVersion(2);

      const maker = await organization('manufacturer', 'ТОО «Одноимённое»', '240100000202');
      const profile = (
        await pool.query<{ id: string }>(
          'insert into manufacturer_profiles (organization_id) values ($1) returning id',
          [maker],
        )
      ).rows[0]!.id;
      const accept = () =>
        pool.query(
          "insert into nda_acceptance (profile_id, nda_version_id, accepted_at, ip_address) values ($1, $2, now(), '192.0.2.1')",
          [profile, current],
        );
      await accept();
      await expect(accept()).rejects.toMatchObject(refusal('23505', 'nda_acceptance_uq'));

      // Названия производителей не уникальны: их различает БИН.
      await organization('manufacturer', 'ТОО «Одноимённое»', '240100000203');
      const same = await pool.query("select count(*)::int as n from organizations where name = 'ТОО «Одноимённое»'");
      expect(same.rows).toEqual([{ n: 2 }]);
    });

    it('ящик только у организации IMBC; принятие NDA у аккаунта — всё или ничего — 23514', async () => {
      await pool.query("update organizations set notification_mailbox = 'imbc@imbc.local' where id = $1", [imbc]);
      const operator = await organization('operator', 'Оператор с ящиком');
      await expect(
        pool.query("update organizations set notification_mailbox = 'op@operator.local' where id = $1", [operator]),
      ).rejects.toMatchObject(refusal('23514', 'organizations_mailbox_imbc_ck'));

      await expect(ndaVersion(0)).rejects.toMatchObject(refusal('23514', 'nda_version_number_ck'));
      const version = (await pool.query<{ id: string }>('select id from nda_version where version_number = 1')).rows[0]
        ?.id;
      const nda = version ?? (await ndaVersion(1, true));

      /** Аккаунт производителя в новой организации с указанными колонками ожидающего принятия NDA. */
      let n = 0;
      const register = async (versionId: string | null, acceptedAt: string | null, ip: string | null) =>
        pool.query(
          `insert into user_accounts (organization_id, email, role, registration_nda_version_id, registration_nda_accepted_at, registration_ip)
           values ($1, $2, 'manufacturer', $3, $4, $5)`,
          [
            await organization('manufacturer', 'ТОО «Регистрация»', `24010000030${++n}`),
            `${randomUUID()}@example.local`,
            versionId,
            acceptedAt,
            ip,
          ],
        );
      const at = '2026-11-12T10:00:00+05:00';
      const ip = '192.0.2.1';
      const partial: [string | null, string | null, string | null][] = [
        [nda, null, null],
        [null, at, null],
        [null, null, ip],
        [nda, at, null],
        [nda, null, ip],
        [null, at, ip],
      ];
      for (const values of partial)
        await expect(register(...values), JSON.stringify(values)).rejects.toMatchObject(
          refusal('23514', 'user_accounts_registration_nda_ck'),
        );
      // Всё или ничего: обе строки проходят.
      await register(nda, at, ip);
      await register(null, null, null);
      const pending = await pool.query(
        'select count(*)::int as n from user_accounts where registration_nda_version_id = $1 and registration_ip = $2',
        [nda, ip],
      );
      expect(pending.rows).toEqual([{ n: 1 }]);
    });
  });

  describe('0008', () => {
    /** Организации IMBC и операторов в порядке имени. */
    const reference = async () =>
      (
        await pool.query<{ id: string; type: string; name: string; major: boolean }>(
          `select id, type, name, is_major_operator as major from organizations
           where type in ('imbc', 'operator') order by type::text, lower(name)`,
        )
      ).rows;
    const shape = (rows: Awaited<ReturnType<typeof reference>>) =>
      rows.map(({ type, name, major }) => ({ type, name, major }));

    it('0008: одна IMBC и NCOC, TCO, KPO с отметкой major (GEN-05); существующая IMBC не дублируется; повторный прогон SQL 0008 ничего не добавляет', async () => {
      // Пустая база.
      await resetDatabase(pool);
      await migrateThrough(pool);
      expect(shape(await reference())).toEqual([
        { type: 'imbc', name: 'IMBC', major: false },
        { type: 'operator', name: 'KPO', major: true },
        { type: 'operator', name: 'NCOC', major: true },
        { type: 'operator', name: 'TCO', major: true },
      ]);

      // База стенда: IMBC и демо-оператор из seed, оператор `ncoc` без отметки.
      await resetDatabase(pool);
      await migrateThrough(pool, BEFORE);
      const ids = {
        imbc: (
          await pool.query<{ id: string }>(
            "insert into organizations (type, name) values ('imbc', 'IMBC') returning id",
          )
        ).rows[0]!.id,
        demo: (
          await pool.query<{ id: string }>(
            "insert into organizations (type, name, is_major_operator) values ('operator', 'Оператор (демо)', true) returning id",
          )
        ).rows[0]!.id,
        ncoc: (
          await pool.query<{ id: string }>(
            "insert into organizations (type, name) values ('operator', 'ncoc') returning id",
          )
        ).rows[0]!.id,
      };
      await migrateThrough(pool);
      const after = await reference();
      expect(shape(after)).toEqual([
        { type: 'imbc', name: 'IMBC', major: false },
        { type: 'operator', name: 'KPO', major: true },
        { type: 'operator', name: 'ncoc', major: true },
        { type: 'operator', name: 'TCO', major: true },
        { type: 'operator', name: 'Оператор (демо)', major: true },
      ]);
      expect(after.find((o) => o.type === 'imbc')!.id).toBe(ids.imbc);
      expect(after.find((o) => o.name === 'ncoc')!.id).toBe(ids.ncoc);
      expect(after.find((o) => o.name === 'Оператор (демо)')!.id).toBe(ids.demo);

      // Тело 0008 ещё раз: ни строк, ни изменений.
      const body = statements('0008_reference_organizations');
      expect(body).toHaveLength(3);
      for (const statement of body) await pool.query(statement);
      expect(await reference()).toEqual(after);
      const all = await pool.query('select count(*)::int as n from organizations');
      expect(all.rows).toEqual([{ n: 5 }]);
    });
  });
});
