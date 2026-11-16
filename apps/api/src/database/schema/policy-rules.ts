import { sql } from 'drizzle-orm';
import { check, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { id } from './_shared.js';
import { dataClass, role } from './enums.js';

/** GEN-10 / canonical DBML: release data, read-only to the application role. */
export const policyRule = pgTable(
  'policy_rule',
  {
    id: id(),
    role: role('role').notNull(),
    dataClass: dataClass('data_class').notNull(),
    action: text('action').notNull(),
    condition: text('condition').notNull(),
    effect: text('effect').notNull(),
  },
  (t) => [
    uniqueIndex('policy_rule_role_class_action_condition_uq').on(t.role, t.dataClass, t.action, t.condition),
    check('policy_rule_action_ck', sql`nullif(btrim(${t.action}), '') is not null`),
    check('policy_rule_effect_ck', sql`${t.effect} in ('allow', 'deny')`),
    check(
      'policy_rule_condition_ck',
      sql`${t.condition} in
      ('own_organisation', 'visible_profile', 'owner', 'nda_accepted', 'account_events', 'none')`,
    ),
  ],
);
