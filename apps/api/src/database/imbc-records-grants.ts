import pg from 'pg';

/** Compose into applyAppRoleGrants' existing transaction after its table-wide GRANT. */
export async function applyImbcRecordsGrants(client: pg.PoolClient, role: string): Promise<void> {
  const present = await client.query<{ exists: boolean }>("select to_regclass('imbc_records_operation') is not null as exists");
  if (!present.rows[0]?.exists) return;
  const name = pg.escapeIdentifier(role);
  await client.query(`revoke update,delete,truncate on imbc_records_operation,imbc_records_operation_child from ${name}`);
  await client.query(`revoke delete,truncate on imbc_note,imbc_engagement,imbc_eoi_email_event,imbc_product_context from ${name}`);
  await client.query(`revoke truncate on imbc_engagement_source from ${name}`);
}
