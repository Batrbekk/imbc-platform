import { z } from 'zod';
import { ROLES, type Role } from './enums.js';
import {
  POLICY_ACTIONS,
  POLICY_ACTION_CLASS,
  POLICY_DATA_CLASSES,
  type PolicyAction,
  type PolicyDataClass,
  type PolicyScope,
} from './policy-actions.js';

/** account_events preserves the existing narrower administrator audit scope; condition is DBML text. */
export const POLICY_CONDITIONS = [
  'own_organisation',
  'visible_profile',
  'owner',
  'nda_accepted',
  'account_events',
  'none',
] as const;
export type PolicyCondition = (typeof POLICY_CONDITIONS)[number];
export const policyRuleDefinitionSchema = z.strictObject({
  role: z.enum(ROLES),
  dataClass: z.enum(POLICY_DATA_CLASSES),
  action: z.enum(POLICY_ACTIONS),
  condition: z.enum(POLICY_CONDITIONS),
  effect: z.enum(['allow', 'deny']),
});
export type PolicyRuleDefinition = z.infer<typeof policyRuleDefinitionSchema>;

const allow = (role: Role, condition: PolicyCondition, actions: readonly PolicyAction[]): PolicyRuleDefinition[] =>
  actions.map((action) => ({ role, action, dataClass: POLICY_ACTION_CLASS[action], condition, effect: 'allow' }));

/** GEN-10 / v1.4 section 4: one release dataset, including G. Absence of a row always denies. */
export const RELEASE_POLICY_RULES: readonly PolicyRuleDefinition[] = Object.freeze(
  [
    ...allow('manufacturer', 'own_organisation', [
      'profile.read',
      'profile.edit',
      'operator_request.reply',
      'tier.read',
      'tier.read_products',
      'tier.request',
      'focal_point.read',
    ]),
    ...allow('manufacturer', 'nda_accepted', ['forecast.read']),
    ...allow('expert', 'none', [
      'profile.read',
      'profile.verify',
      'review.take',
      'imbc_records.read',
      'imbc_records.edit',
      'external_checks.run',
      'external_checks.read',
      'works_with.validate',
      'works_with.read_who',
      'catalog.search',
      'catalog.export',
      'operator_notes.read',
      'imbc_request.answer',
      'imbc_request.read',
      'operator_request.read',
      'forecast.read',
      'tier.read',
      'tier.read_products',
      'tier.edit',
      'focal_point.read',
      'lps.read',
      'lps.edit',
      'lps.dashboard',
    ]),
    ...allow('administrator', 'none', [
      'review.assign',
      'accounts.manage',
      'reference.manage',
      'reference.read',
      'forecast.manage',
      'forecast.read',
      'migration.invite',
      'pull_api.manage',
    ]),
    ...allow('administrator', 'account_events', ['audit.read']),
    ...allow('director', 'none', [
      'profile.read',
      'imbc_records.read',
      'external_checks.read',
      'works_with.read_who',
      'reference.read',
      'forecast.read',
      'catalog.search',
      'dashboard.read',
      'catalog.export',
      'operator_notes.read',
      'imbc_request.read',
      'operator_request.read',
      'audit.read',
      'tier.read',
      'tier.read_products',
      'focal_point.read',
      'lps.read',
      'lps.dashboard',
    ]),
    ...allow('operator', 'visible_profile', [
      'catalog.search',
      'dashboard.read',
      'catalog.export',
      'operator_request.send',
      'tier.read',
      'tier.read_products',
      'focal_point.read',
    ]),
    ...allow('operator', 'owner', [
      'subscriptions.manage',
      'pull_api.use',
      'operator_marks.write',
      'operator_notes.read',
      'operator_notes.write',
      'imbc_request.send',
    ]),
    ...allow('operator', 'none', ['lps.read', 'lps.dashboard']),
    ...allow('observer', 'visible_profile', ['catalog.search', 'dashboard.read', 'tier.read']),
  ].map((rule) => Object.freeze(rule)),
);

const scope: Record<PolicyCondition, PolicyScope> = {
  own_organisation: 'own',
  owner: 'own',
  visible_profile: 'visible',
  nda_accepted: 'after_nda',
  account_events: 'account_events',
  none: 'all',
};
export type CompiledPolicyMatrix = Record<Role, Partial<Record<PolicyAction, PolicyScope>>>;
export function policyRuleKey(rule: PolicyRuleDefinition): string {
  return [rule.role, rule.dataClass, rule.action, rule.condition].join(':');
}

/** Reject unknown or ambiguous release rows rather than selecting a wider scope by iteration order. */
export function validatePolicyRules(input: readonly unknown[]): PolicyRuleDefinition[] {
  const rules = input.map((rule) => policyRuleDefinitionSchema.parse(rule));
  const seen = new Set<string>();
  const allowScopes = new Map<string, Set<PolicyScope>>();
  for (const rule of rules) {
    const key = policyRuleKey(rule);
    if (seen.has(key)) throw new Error('duplicate_policy_rule');
    seen.add(key);
    if (rule.effect === 'allow') {
      const group = [rule.role, rule.action, rule.dataClass].join(':');
      const scopes = allowScopes.get(group) ?? new Set<PolicyScope>();
      scopes.add(scope[rule.condition]);
      if (scopes.size > 1) throw new Error('ambiguous_policy_scope');
      allowScopes.set(group, scopes);
    }
  }
  return rules;
}

/** Before a record is loaded, a matching explicit deny conservatively blocks that action/class. */
export function policyScopeFor(
  rules: readonly PolicyRuleDefinition[],
  role: Role,
  action: PolicyAction,
  dataClass: PolicyDataClass = POLICY_ACTION_CLASS[action],
): PolicyScope | null {
  const matches = rules.filter((rule) => rule.role === role && rule.action === action && rule.dataClass === dataClass);
  if (matches.some((rule) => rule.effect === 'deny')) return null;
  const allowed = matches.find((rule) => rule.effect === 'allow');
  return allowed ? scope[allowed.condition] : null;
}

export function compilePolicyMatrix(input: readonly unknown[]): CompiledPolicyMatrix {
  const rules = validatePolicyRules(input);
  const matrix = Object.fromEntries(ROLES.map((role) => [role, {}])) as CompiledPolicyMatrix;
  for (const role of ROLES)
    for (const action of POLICY_ACTIONS) {
      const permission = policyScopeFor(rules, role, action);
      if (permission !== null) matrix[role][action] = permission;
    }
  return matrix;
}
