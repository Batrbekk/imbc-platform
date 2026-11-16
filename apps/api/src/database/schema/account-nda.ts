import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id } from './_shared.js';
import { ndaVersion, userAccounts } from './access.js';

/** Original consent tick survives password setup, profile creation and later NDA versions (FC-02/03). */
export const accountNdaAcceptance = pgTable(
  'account_nda_acceptance',
  {
    id: id(),
    userAccountId: uuid('user_account_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    ndaVersionId: uuid('nda_version_id')
      .notNull()
      .references(() => ndaVersion.id),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'account_nda_acceptance_account_org_fk',
      columns: [t.userAccountId, t.organizationId],
      foreignColumns: [userAccounts.id, userAccounts.organizationId],
    }),
    uniqueIndex('account_nda_acceptance_account_version_uq').on(t.userAccountId, t.ndaVersionId),
    uniqueIndex('account_nda_acceptance_id_org_version_uq').on(t.id, t.organizationId, t.ndaVersionId),
    check('account_nda_acceptance_ip_ck', sql`nullif(btrim(${t.ipAddress}), '') is not null`),
  ],
);
