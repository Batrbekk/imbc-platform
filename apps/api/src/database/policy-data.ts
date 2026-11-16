import { RELEASE_POLICY_RULES, policyRuleKey, policyRuleDefinitionSchema, validatePolicyRules } from '@imbc/contracts';
import type pg from 'pg';

/**
 * GEN-10: this release writes the single repository dataset after the DDL transaction commits.
 * PostgreSQL cannot use a newly added enum label before that commit. An empty/invalid table fails
 * API/worker startup; the migrator completes this atomic data step before reporting success.
 */
export async function applyReleasePolicyRules(client: pg.PoolClient): Promise<void> {
  const existence = await client.query<{ exists: boolean }>(
    "select to_regclass('public.policy_rule') is not null as exists",
  );
  if (!existence.rows[0]?.exists) return;
  const release = validatePolicyRules(RELEASE_POLICY_RULES);
  await client.query('BEGIN');
  try {
    await client.query('LOCK TABLE policy_rule IN SHARE ROW EXCLUSIVE MODE');
    const current = await client.query(
      'select role, data_class as "dataClass", action, condition, effect from policy_rule',
    );
    const expected = new Map(release.map((row) => [policyRuleKey(row), row.effect]));
    const same =
      current.rows.length === release.length &&
      current.rows.every((row: unknown) => {
        const parsed = policyRuleDefinitionSchema.safeParse(row);
        return parsed.success && expected.get(policyRuleKey(parsed.data)) === parsed.data.effect;
      });
    if (!same) {
      await client.query('DELETE FROM policy_rule');
      for (const row of release)
        await client.query('insert into policy_rule(role,data_class,action,condition,effect) values($1,$2,$3,$4,$5)', [
          row.role,
          row.dataClass,
          row.action,
          row.condition,
          row.effect,
        ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
