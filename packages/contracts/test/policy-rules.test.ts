import { describe, expect, it } from 'vitest';
import { ROLES } from '../src/enums.js';
import { POLICY_ACTIONS, POLICY_ACTION_CLASS } from '../src/policy-actions.js';
import { POLICY_MATRIX } from '../src/policy.js';
import {
  compilePolicyMatrix,
  policyRuleKey,
  policyScopeFor,
  RELEASE_POLICY_RULES,
  validatePolicyRules,
} from '../src/policy-rules.js';

describe('GEN-10 release policy dataset / LPS-01–08', () => {
  const compiled = compilePolicyMatrix(RELEASE_POLICY_RULES);
  it('exports UI permission hints generated from the exact release rows', () => {
    expect(POLICY_MATRIX).toEqual(compiled);
  });
  it.each(RELEASE_POLICY_RULES.map((rule) => [policyRuleKey(rule), rule] as const))(
    'evaluates release row %s in its exact data class',
    (_key, rule) => {
      expect(policyScopeFor(RELEASE_POLICY_RULES, rule.role, rule.action, rule.dataClass)).toBe(
        compiled[rule.role][rule.action],
      );
      expect(rule.dataClass).toBe(POLICY_ACTION_CLASS[rule.action]);
    },
  );
  it('gives LPS read/dashboard only to expert, operator and director; only expert may mutate', () => {
    for (const role of ROLES) {
      expect(compiled[role]['lps.read']).toBe(['expert', 'operator', 'director'].includes(role) ? 'all' : undefined);
      expect(compiled[role]['lps.dashboard']).toBe(
        ['expert', 'operator', 'director'].includes(role) ? 'all' : undefined,
      );
      expect(compiled[role]['lps.edit']).toBe(role === 'expert' ? 'all' : undefined);
    }
    expect(policyScopeFor(RELEASE_POLICY_RULES, 'administrator', 'lps.edit', 'e_administration')).toBeNull();
    expect(policyScopeFor(RELEASE_POLICY_RULES, 'operator', 'lps.read', 'a_register')).toBeNull();
  });
  it('keeps forecast NDA, operator ownership and administrator account-event audit conditions distinct', () => {
    expect(compiled.manufacturer['forecast.read']).toBe('after_nda');
    expect(compiled.operator['operator_notes.write']).toBe('own');
    expect(compiled.administrator['audit.read']).toBe('account_events');
    expect(compiled.observer['catalog.export']).toBeUndefined();
  });
  it('rejects duplicate/unknown/ambiguous persisted policy rows instead of broadening access', () => {
    const rule = RELEASE_POLICY_RULES[0]!;
    expect(() => validatePolicyRules([rule, rule])).toThrow('duplicate_policy_rule');
    expect(() => validatePolicyRules([{ ...rule, condition: 'anything' }])).toThrow();
    expect(() => validatePolicyRules([{ ...rule, action: 'system.admin' }])).toThrow();
    expect(() => validatePolicyRules([rule, { ...rule, condition: 'none' }])).toThrow('ambiguous_policy_scope');
  });
  it('explicit deny wins and no role receives every action', () => {
    const read = RELEASE_POLICY_RULES.find((rule) => rule.role === 'expert' && rule.action === 'profile.read')!;
    expect(
      compilePolicyMatrix([read, { ...read, condition: 'owner', effect: 'deny' }]).expert['profile.read'],
    ).toBeUndefined();
    for (const role of ROLES) expect(Object.keys(compiled[role]).length).toBeLessThan(POLICY_ACTIONS.length);
  });
});
