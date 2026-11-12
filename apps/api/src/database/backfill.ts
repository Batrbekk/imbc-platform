/**
 * Перенос данных к спецификации v1.3 (раздел 3.1, UPD-06): spectator → observer,
 * inactive → unresponsive. Шаг migrate правила expand → migrate → contract (NFR-06):
 * выполняется после фиксации миграции 0003, которая только добавляет значения enum —
 * в её транзакции новые значения использовать нельзя.
 *
 * Идемпотентно: повторный запуск ничего не меняет. Условие сравнивает текст, чтобы
 * запросы оставались корректными и после миграции contract, удаляющей прежние значения.
 */
import type pg from 'pg';

export interface BackfillSpecV13Result {
  organizations: number;
  userAccounts: number;
  manufacturerProfiles: number;
  catalogVisible: number;
}

export async function backfillSpecV13(db: Pick<pg.Pool, 'query'>): Promise<BackfillSpecV13Result> {
  const run = async (statement: string) => (await db.query(statement)).rowCount ?? 0;
  return {
    organizations: await run("UPDATE organizations SET type = 'observer' WHERE type::text = 'spectator'"),
    userAccounts: await run("UPDATE user_accounts SET role = 'observer' WHERE role::text = 'spectator'"),
    manufacturerProfiles: await run(
      "UPDATE manufacturer_profiles SET update_status = 'unresponsive' WHERE update_status::text = 'inactive'",
    ),
    catalogVisible: await run(
      "UPDATE catalog_visible SET update_status = 'unresponsive' WHERE update_status::text = 'inactive'",
    ),
  };
}
