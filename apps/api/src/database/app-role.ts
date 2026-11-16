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
    // Table privileges alone cannot resolve public relations when schema USAGE was removed/recreated.
    await client.query(`GRANT USAGE ON SCHEMA public TO ${name}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${name}`);
    // DATA-01: TRUNCATE bypasses row-level frozen-revision triggers and is never an application operation.
    await client.query(`REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM ${name}`);
    // GEN-10: policy rows change only through a release owner, never runtime CRUD or UI.
    const policy = await client.query<{ exists: boolean }>("SELECT to_regclass('policy_rule') IS NOT NULL AS exists");
    if (policy.rows[0]?.exists)
      await client.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON policy_rule FROM ${name}`);
    const registry = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('e_ondiris_record') IS NOT NULL AS exists",
    );
    // Class G supports logical deletion only: preserve company/entry facts and their audit subjects.
    const lps = await client.query<{ exists: boolean }>("SELECT to_regclass('lps_entry') IS NOT NULL AS exists");
    if (lps.rows[0]?.exists) await client.query(`REVOKE DELETE, TRUNCATE ON lps_company, lps_entry FROM ${name}`);
    if (registry.rows[0]?.exists) {
      await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON e_ondiris_record FROM ${name}`);
      await client.query(`GRANT UPDATE(is_current) ON e_ondiris_record TO ${name}`);
      await client.query(`REVOKE DELETE, TRUNCATE ON e_ondiris_sync_scope, e_ondiris_profile_refresh FROM ${name}`);
    }
    const mainSource = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('adata_main_snapshot') IS NOT NULL AS exists",
    );
    if (mainSource.rows[0]?.exists) {
      await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON adata_main_snapshot FROM ${name}`);
      await client.query(`REVOKE DELETE, TRUNCATE ON main_source_refresh_outbox FROM ${name}`);
    }
    // Журнал аудита (AUD-02) и принятия NDA (FC-02, DBML: append-only) — только добавление:
    // у роли приложения нет UPDATE/DELETE.
    await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON audit_entries FROM ${name}`);
    await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON nda_acceptance FROM ${name}`);
    const consent = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('account_nda_acceptance') IS NOT NULL AS exists",
    );
    if (consent.rows[0]?.exists) {
      await client.query(
        `REVOKE UPDATE, DELETE, TRUNCATE ON account_nda_acceptance, nda_acceptance_bridge FROM ${name}`,
      );
      await client.query(`REVOKE INSERT, UPDATE, DELETE ON nda_evidence_migration_report FROM ${name}`);
    }
    // Also usable during compatibility checks against the pre-history expand boundary.
    const history = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('profile_file_history') IS NOT NULL AS exists",
    );
    if (history.rows[0]?.exists)
      await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON profile_file_history FROM ${name}`);
    // Canonical review expand is absent at older migration boundaries. Immutable maps and decisions
    // are append-only; assignments can be assigned/closed, while the current candidate cursor is mutable.
    const review = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('review_assignment') IS NOT NULL AS exists",
    );
    if (review.rows[0]?.exists) {
      await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON review_decision, review_assignment_section FROM ${name}`);
      await client.query(`REVOKE DELETE, TRUNCATE ON review_assignment FROM ${name}`);
      for (const sequence of ['profile_review_assignment_order_seq', 'profile_review_decision_order_seq']) {
        const present = await client.query<{ exists: boolean }>('SELECT to_regclass($1) IS NOT NULL AS exists', [
          sequence,
        ]);
        if (present.rows[0]?.exists)
          await client.query(`GRANT USAGE ON SEQUENCE ${pg.escapeIdentifier(sequence)} TO ${name}`);
      }
    }
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
