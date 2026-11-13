/**
 * Применение миграций (`migrate.ts`): отдельный модуль, чтобы тест вызывал тот же код, что и выкат.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';

/**
 * Предел ожидания блокировки в сеансе мигратора (NFR-06). Миграции drizzle идут одной транзакцией, и внешние
 * ключи (в 0009 — на `user_accounts` и `organizations`) берут блокировку SHARE ROW EXCLUSIVE, несовместимую с
 * записью, до фиксации всей пачки. Без предела `migrate` ждёт открытую транзакцию записи прежних `api` и `worker`
 * сколько угодно, а встав в очередь блокировки, задерживает и все новые записи в эти таблицы — выкат зависает
 * вместе со входом. С пределом худший случай — безопасный отказ выката: `migrate` падает с 55P03
 * (`lock_not_available`), пачка откатывается, прежние `api` и `worker` работают на прежней схеме, повтор
 * `migrate` безопасен.
 */
export const MIGRATION_LOCK_TIMEOUT = '10s';

/**
 * Расширения и миграции из `migrationsFolder` на одном соединении пула с `lock_timeout` этого сеанса. Параметр
 * сеанса действует только на своё соединение, а запрос через пул может уйти на другое, поэтому drizzle получает
 * этого же клиента: у клиента (не пула) drizzle и транзакцию миграций ведёт на нём. Соединение с изменённым
 * параметром в пул не возвращается — права и загрузка справочников идут на новом, с умолчанием базы.
 */
export async function applyMigrations(
  pool: pg.Pool,
  migrationsFolder: string,
  lockTimeout: string = MIGRATION_LOCK_TIMEOUT,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select set_config('lock_timeout', $1, false)", [lockTimeout]);
    // Расширения создаются до миграций: pg_trgm нужен индексам каталога.
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    client.release(true);
  }
}
