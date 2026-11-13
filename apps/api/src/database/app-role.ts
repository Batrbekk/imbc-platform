/**
 * Права роли приложения (`DB_APP_ROLE`, на стенде — `imbc_app`). Выдаются после каждого прогона
 * миграций (`migrate.ts`): новые таблицы получают права, повторный вызов ничего не меняет.
 */
import pg from 'pg';

/**
 * Выдача прав — одной транзакцией на одном соединении пула: GRANT на все таблицы и следующие за ним REVOKE
 * у журналов и данных релиза фиксируются вместе. Сбой между ними откатывает всё, и у роли не остаются UPDATE и
 * DELETE на журналах до следующего выката (AUD-02, NOT-18); прежние права остаются как были.
 */
export async function applyAppRoleGrants(pool: pg.Pool, role: string): Promise<void> {
  const name = pg.escapeIdentifier(role);
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query('BEGIN');
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${name}`);
    // Журнал аудита (AUD-02) и принятия NDA (FC-02, DBML: append-only) — только добавление:
    // у роли приложения нет UPDATE/DELETE.
    await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON audit_entries FROM ${name}`);
    await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON nda_acceptance FROM ${name}`);
    // Журнал писем (NOT-18) — только добавление: запись и отправка идут одной транзакцией, сбой SMTP — откат.
    await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON notification FROM ${name}`);
    // Правила писем и справочники — данные релиза (миграция 0010): приложение их только читает.
    // Значения справочников (dictionary_entry) ведёт администратор — на них права обычные.
    await client.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON notification_rule, dictionary FROM ${name}`);
    await client.query('COMMIT');
  } catch (error) {
    // Соединение, на котором не прошёл и ROLLBACK, в пул не возвращается.
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      broken = rollbackError instanceof Error ? rollbackError : new Error('ROLLBACK failed');
    });
    throw error;
  } finally {
    client.release(broken);
  }
}
