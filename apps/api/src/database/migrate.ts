/**
 * Одноразовый запуск миграций (сервис `migrate` в docker-compose, Job в Kubernetes).
 * Схема меняется по правилу expand → migrate → contract (NFR-13): каждая миграция
 * совместима с предыдущей версией приложения.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = process.env.MIGRATIONS_DIR ?? resolve(here, '../../drizzle');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL не задан');
  const pool = new pg.Pool({ connectionString: url, max: 1, application_name: 'imbc-migrate' });
  try {
    // Расширения создаются до миграций: pg_trgm нужен индексам каталога.
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await migrate(drizzle(pool), { migrationsFolder });

    // Журнал аудита — только добавление (AUD-02): у роли приложения нет UPDATE/DELETE.
    const appRole = process.env.DB_APP_ROLE;
    if (appRole) {
      const role = pg.escapeIdentifier(appRole);
      await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
      await pool.query(`REVOKE UPDATE, DELETE, TRUNCATE ON audit_entries FROM ${role}`);
    }
    console.log('Миграции применены');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
