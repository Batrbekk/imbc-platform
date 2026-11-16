import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { eOndirisSyncScope } from './e-ondiris.js';
import { sectionRevision } from './profile.js';

/** Durable local-copy refresh outbox; a deferred profile remains untouched until its review lock closes. */
export const eOndirisProfileRefresh = pgTable(
  'e_ondiris_profile_refresh',
  {
    bin: text('bin')
      .primaryKey()
      .references(() => eOndirisSyncScope.bin),
    requestedObservedAt: timestamp('requested_observed_at', { withTimezone: true }).notNull(),
    requestedScopeHash: text('requested_scope_hash').notNull(),
    state: text('state').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    appliedObservedAt: timestamp('applied_observed_at', { withTimezone: true }),
    appliedScopeHash: text('applied_scope_hash'),
    targetRevisionId: uuid('target_revision_id').references(() => sectionRevision.id),
  },
  (t) => [
    index('e_ondiris_profile_refresh_pending_idx').on(t.state, t.lastAttemptAt),
    check(
      'e_ondiris_profile_refresh_state_ck',
      sql`${t.state} IN ('pending','applied','deferred','ambiguous','no_profile')`,
    ),
    check('e_ondiris_profile_refresh_attempt_ck', sql`${t.attemptCount} >= 0`),
    check('e_ondiris_profile_refresh_requested_hash_ck', sql`${t.requestedScopeHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'e_ondiris_profile_refresh_applied_hash_ck',
      sql`${t.appliedScopeHash} IS NULL OR ${t.appliedScopeHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'e_ondiris_profile_refresh_applied_pair_ck',
      sql`(${t.appliedObservedAt} IS NULL) = (${t.appliedScopeHash} IS NULL)`,
    ),
  ],
);
