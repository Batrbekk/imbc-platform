import { RELEASE_POLICY_RULES } from '@imbc/contracts';
import { PolicyEngine } from '../../src/common/policy.js';

/** Explicit offline fixture for HTTP seams. Production never falls back to the repository dataset. */
export const TEST_POLICY = new PolicyEngine(RELEASE_POLICY_RULES);
export { RELEASE_POLICY_RULES as TEST_POLICY_ROWS };
