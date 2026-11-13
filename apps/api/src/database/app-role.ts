/**
 * Права роли приложения (`DB_APP_ROLE`, на стенде — `imbc_app`). Выдаются после каждого прогона
 * миграций (`migrate.ts`): новые таблицы получают права, повторный вызов ничего не меняет.
 */
import pg from 'pg';

export async function applyAppRoleGrants(client: pg.Pool, role: string): Promise<void> {
  const name = pg.escapeIdentifier(role);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${name}`);
  // Журнал аудита (AUD-02) и принятия NDA (FC-02, DBML: append-only) — только добавление:
  // у роли приложения нет UPDATE/DELETE.
  await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON audit_entries FROM ${name}`);
  await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON nda_acceptance FROM ${name}`);
}
