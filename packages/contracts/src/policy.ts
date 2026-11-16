import type { Role } from './enums.js';
import type { PolicyAction, PolicyScope } from './policy-actions.js';
import { compilePolicyMatrix, RELEASE_POLICY_RULES, type CompiledPolicyMatrix } from './policy-rules.js';

/** GEN-10: UI hints are compiled from the same release dataset that seeds authoritative policy_rule rows.
 * Server guards load persisted rows at startup and re-check operation snapshots; these hints do not authorise HTTP.
 * Record checks additionally enforce own organisation, visible projection, current NDA and account-event scope.
 */
export type Action = PolicyAction;
export type Scope = PolicyScope;
export type PolicyMatrix = CompiledPolicyMatrix;
export const POLICY_MATRIX: PolicyMatrix = compilePolicyMatrix(RELEASE_POLICY_RULES);
export function can(role: Role, action: Action): Scope | null {
  return POLICY_MATRIX[role][action] ?? null;
}
