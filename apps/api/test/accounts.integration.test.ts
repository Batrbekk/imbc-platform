import { adminAccountsSchema } from '@imbc/contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { seedDemo } from '../src/database/seed.js';
import { AccountsService } from '../src/modules/admin/accounts.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

const SIGNED_IN = 'admin@imbc.local';
const SIGNED_IN_AT = '2026-11-12T08:30:00.000Z';

// Организации и аккаунты для администратора на демо-данных: только organizations и user_accounts (ADM-02, ADM-06).
describe.skipIf(!process.env.TEST_DATABASE_URL)('организации и аккаунты администратора', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;
  let accounts: AccountsService;

  const count = async (table: string) =>
    Number((await pool.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]!.n);

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    await seedDemo(pool);
    // Демо-аккаунты не входили; один вход — чтобы отличить дату от null.
    await pool.query('update user_accounts set last_sign_in_at = $1 where lower(email) = $2', [
      SIGNED_IN_AT,
      SIGNED_IN,
    ]);
    const db: Database = drizzle(pool, { schema, casing: 'snake_case' });
    accounts = new AccountsService(db);
  }, 60000);

  afterAll(async () => {
    await pool?.end();
  });

  it('18 организаций, 6 аккаунтов, last sign-in null у невошедших (ADM-02)', async () => {
    const { organizations } = await accounts.list();
    // 15 организаций seed и NCOC, TCO, KPO из 0008 (GEN-05); IMBC из 0008 seed находит по типу.
    expect(organizations).toHaveLength(18);
    expect(organizations).toHaveLength(await count('organizations'));
    const all = organizations.flatMap((o) => o.accounts);
    expect(all).toHaveLength(6);
    expect(all).toHaveLength(await count('user_accounts'));

    for (const account of all)
      expect(account.lastSignInAt, account.email).toBe(account.email === SIGNED_IN ? SIGNED_IN_AT : null);
    // Организации без аккаунтов (производители каталога и очереди, операторы из 0008) тоже в списке.
    const withoutAccounts = organizations.filter((o) => o.accounts.length === 0);
    expect(withoutAccounts.length).toBe(
      Number(
        (
          await pool.query<{ n: string }>(
            'select count(*) as n from organizations o where not exists (select 1 from user_accounts a where a.organization_id = o.id)',
          )
        ).rows[0]!.n,
      ),
    );
    expect(
      withoutAccounts
        .filter((o) => o.type !== 'manufacturer')
        .map((o) => o.name)
        .sort(),
    ).toEqual(['KPO', 'NCOC', 'TCO']);
  });

  it('порядок: по типу imbc, operator, observer, manufacturer, затем по имени; аккаунты — по email', async () => {
    const { organizations } = await accounts.list();
    const types = ['imbc', 'operator', 'observer', 'manufacturer'] as const;
    const rank = organizations.map((o) => types.indexOf(o.type));
    expect(rank).toEqual([...rank].sort((a, b) => a - b));
    expect(new Set(organizations.map((o) => o.type))).toEqual(new Set(types));

    // Имена внутри типа — в порядке сортировки той же базы.
    for (const type of types) {
      const expected = await pool.query<{ name: string }>(
        'select name from organizations where type = $1 order by name, id',
        [type],
      );
      expect(
        organizations.filter((o) => o.type === type).map((o) => o.name),
        type,
      ).toEqual(expected.rows.map((r) => r.name));
    }

    const imbc = organizations[0]!;
    expect(imbc.name).toBe('IMBC');
    expect(imbc.accounts.map((a) => a.email)).toEqual(['admin@imbc.local', 'director@imbc.local', 'expert@imbc.local']);
    expect(imbc.accounts.map((a) => a.role)).toEqual(['administrator', 'director', 'expert']);
    // Операторы: демо-оператор seed и NCOC, TCO, KPO из 0008 — все major (GEN-05).
    const operators = organizations.filter((o) => o.type === 'operator');
    expect(operators.map((o) => o.name).sort()).toEqual(['KPO', 'NCOC', 'TCO', 'Оператор (демо)'].sort());
    expect(operators.every((o) => o.isMajorOperator)).toBe(true);
  });

  it('в ответе нет ключей профиля: status, bin, updateStatus, tier, completenessPct (ADM-06)', async () => {
    const result = await accounts.list();
    expect(() => adminAccountsSchema.strict().parse(result)).not.toThrow();
    expect(Object.keys(result)).toEqual(['organizations', 'imbcMailbox']);
    // Ящик IMBC seed не задаёт (раздел 8.2).
    expect(result.imbcMailbox).toBeNull();

    const profileKeys = ['status', 'bin', 'updateStatus', 'tier', 'completenessPct'];
    for (const organization of result.organizations) {
      expect(Object.keys(organization).sort(), organization.name).toEqual([
        'accounts',
        'id',
        'isMajorOperator',
        'name',
        'type',
      ]);
      for (const account of organization.accounts)
        // Ни профиля, ни служебных полей аккаунта (idp_subject, locale, auth_version).
        expect(Object.keys(account).sort(), account.email).toEqual([
          'email',
          'fullName',
          'id',
          'lastSignInAt',
          'role',
          'state',
        ]);
    }
    const text = JSON.stringify(result);
    for (const key of profileKeys) expect(text, key).not.toContain(`"${key}"`);
    // БИН производителя не попадает ни в одно поле.
    const bins = await pool.query<{ bin: string }>('select bin from organizations where bin is not null');
    expect(bins.rows.length).toBeGreaterThan(0);
    for (const { bin } of bins.rows) expect(text).not.toContain(bin);
  });
});
