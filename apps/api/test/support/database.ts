import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

interface Journal {
  entries: { tag: string }[];
}

/** Пул к одноразовой БД интеграционных тестов. Платформенную БД не трогаем никогда. */
export function openTestPool(): pg.Pool {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || new URL(url).pathname !== '/imbc_auth_test')
    throw new Error('TEST_DATABASE_URL must select the isolated imbc_auth_test database');
  return new pg.Pool({ connectionString: url, max: 5 });
}

/** Пустая схема public и без журнала миграций — как у новой установки. */
export async function resetDatabase(pool: pg.Pool): Promise<void> {
  await pool.query(
    'DROP SCHEMA IF EXISTS pgboss_auth_test CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE EXTENSION pg_trgm',
  );
}

/**
 * Применяет миграции до `lastTag` включительно (без него — все). Журнал обрезается
 * во временной копии каталога: так тест воспроизводит базу предыдущей версии приложения.
 */
export async function migrateThrough(pool: pg.Pool, lastTag?: string): Promise<void> {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as Journal;
  const end = lastTag === undefined ? journal.entries.length : journal.entries.findIndex((e) => e.tag === lastTag) + 1;
  if (end === 0) throw new Error(`Unknown migration tag: ${lastTag}`);
  const entries = journal.entries.slice(0, end);

  const folder = mkdtempSync(join(tmpdir(), 'imbc-migrations-'));
  try {
    mkdirSync(join(folder, 'meta'));
    for (const { tag } of entries) copyFileSync(join(MIGRATIONS, `${tag}.sql`), join(folder, `${tag}.sql`));
    writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    await migrate(drizzle(pool), { migrationsFolder: folder });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
