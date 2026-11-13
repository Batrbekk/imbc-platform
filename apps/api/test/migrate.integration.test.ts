import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyMigrations, MIGRATION_LOCK_TIMEOUT } from '../src/database/migrator.js';
import { databaseErrorSummary } from '../src/database/pg-errors.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const PROBE = '9999_lock_probe';

interface Journal {
  entries: { idx: number; when: number; tag: string; breakpoints: boolean; version: string }[];
}

/** Промис не дольше `ms`: зависание — ошибка теста, а не вечное ожидание. */
const within = <T>(ms: number, promise: Promise<T>) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`не завершилось за ${ms} мс`)), ms)),
  ]);

/**
 * Каталог миграций: все миграции репозитория и ещё одна — таблица с внешним ключом на `user_accounts` (как внешние
 * ключи 0009): она берёт на `user_accounts` блокировку, несовместимую с записью.
 */
function migrationsWithProbe(): { folder: string; when: number } {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as Journal;
  const folder = mkdtempSync(join(tmpdir(), 'imbc-migrator-'));
  mkdirSync(join(folder, 'meta'));
  for (const { tag } of journal.entries) copyFileSync(join(MIGRATIONS, `${tag}.sql`), join(folder, `${tag}.sql`));
  const last = journal.entries.at(-1)!;
  const when = last.when + 1;
  writeFileSync(
    join(folder, `${PROBE}.sql`),
    'CREATE TABLE "lock_probe" ("id" uuid PRIMARY KEY, "account_id" uuid REFERENCES "user_accounts"("id"));',
  );
  writeFileSync(
    join(folder, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries: [...journal.entries, { ...last, idx: last.idx + 1, when, tag: PROBE }] }),
  );
  return { folder, when };
}

// Выкат (NFR-06): миграции идут одной транзакцией, и внешние ключи берут блокировку, несовместимую с записью, до
// фиксации всей пачки. Мигратор ждёт блокировку не дольше lock_timeout своего сеанса: открытая транзакция записи
// прежней версии api или worker даёт отказ выката, а не зависание. База — после всех миграций репозитория.
describe.skipIf(!process.env.TEST_DATABASE_URL)('мигратор: предел ожидания блокировки (NFR-06)', () => {
  vi.setConfig({ testTimeout: 60000 });
  let pool: pg.Pool;
  let probe: { folder: string; when: number };

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    probe = migrationsWithProbe();
  }, 60000);

  afterAll(async () => {
    if (probe) rmSync(probe.folder, { recursive: true, force: true });
    await pool?.query('drop table if exists lock_probe');
    await pool?.query('delete from drizzle.__drizzle_migrations where created_at = $1', [probe?.when ?? -1]);
    await pool?.end();
  });

  const applied = async () =>
    (await pool.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations')).rows[0]!.n;
  const probeTable = async () =>
    (await pool.query<{ t: string | null }>("select to_regclass('public.lock_probe')::text as t")).rows[0]!.t;

  it(`открытая транзакция записи в user_accounts: миграция ждёт не дольше lock_timeout (в работе — ${MIGRATION_LOCK_TIMEOUT}) и падает с 55P03, ничего не применено, запись прежней версии идёт дальше; после её фиксации миграция применяется`, async () => {
    expect(MIGRATION_LOCK_TIMEOUT).toBe('10s');
    const before = await applied();
    const migrator = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    const writer = await pool.connect();
    try {
      // Прежняя версия api пишет в user_accounts и держит транзакцию открытой.
      await writer.query('begin');
      await writer.query('lock table user_accounts in row exclusive mode');
      const started = Date.now();
      const error = await within(
        15_000,
        applyMigrations(migrator, probe.folder, '500ms').then(
          () => null,
          (e: unknown) => e,
        ),
      );
      expect(databaseErrorSummary(error)?.sqlState).toBe('55P03');
      expect(Date.now() - started).toBeLessThan(10_000);
      // Пачка откатилась целиком; транзакция прежней версии не задета.
      expect(await probeTable()).toBeNull();
      expect(await applied()).toBe(before);
      await writer.query("update user_accounts set locale = locale where email = 'nobody@stage2.local'");
      await writer.query('commit');
    } finally {
      await writer.query('rollback').catch(() => undefined);
      writer.release();
    }

    await applyMigrations(migrator, probe.folder, '500ms');
    expect(await probeTable()).toBe('lock_probe');
    expect(await applied()).toBe(before + 1);
    // Соединение с изменённым lock_timeout в пул не вернулось: следующий запрос мигратора — с умолчанием базы.
    const setting = await migrator.query<{ lock_timeout: string }>('show lock_timeout');
    expect(setting.rows[0]!.lock_timeout).toBe('0');
    await migrator.end();
  });
});
