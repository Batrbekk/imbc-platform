import {
  compilePolicyMatrix,
  POLICY_ACTIONS,
  policyScopeFor,
  ROLES,
  validatePolicyRules,
  type PolicyAction,
  type PolicyDataClass,
  type PolicyRuleDefinition,
  type PolicyScope,
  type Role,
} from '@imbc/contracts';
import { Global, Module } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, DatabaseModule, type Database } from '../database/database.module.js';

export const POLICY = Symbol('POLICY');

/** GEN-08/10: server evaluator is constructed only from persisted, validated policy_rule rows. */
export class PolicyEngine {
  private readonly rules: readonly PolicyRuleDefinition[];

  constructor(input: readonly unknown[]) {
    const rules = validatePolicyRules(input);
    if (rules.length === 0) throw new Error('empty_policy_rules');
    const matrix = compilePolicyMatrix(rules);
    if (ROLES.some((role) => POLICY_ACTIONS.every((action) => matrix[role][action] !== undefined)))
      throw new Error('policy_role_has_every_right');
    this.rules = Object.freeze(rules.map((rule) => Object.freeze(rule)));
  }

  can(role: Role, action: PolicyAction, dataClass?: PolicyDataClass): PolicyScope | null {
    return policyScopeFor(this.rules, role, action, dataClass);
  }
}

/** No static release fallback: missing/empty/invalid policy aborts API and worker startup. */
export async function loadDatabasePolicy(db: Database): Promise<PolicyEngine> {
  const { rows } = await db.execute(sql`
    select role, data_class as "dataClass", action, condition, effect
    from policy_rule order by role, data_class, action, condition`);
  return new PolicyEngine(rows);
}

/**
 * Re-read inside the operation snapshot, after actor locks. A release changing rows cannot leave a
 * mutating action or file read authorised by an earlier process snapshot; absence still denies.
 */
export const policyForTransaction = loadDatabasePolicy;

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [{ provide: POLICY, inject: [DB], useFactory: loadDatabasePolicy }],
  exports: [POLICY],
})
export class PolicyModule {}
