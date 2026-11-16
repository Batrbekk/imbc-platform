import { isIP } from 'node:net';
import { and, eq, sql } from 'drizzle-orm';
import { ProblemException } from '../../common/problem.js';
import type { Database } from '../../database/database.module.js';
import { accountNdaAcceptance, organizations, userAccounts } from '../../database/schema/index.js';

const denied = () => new ProblemException(403, 'forbidden', 'Нет прав на согласие этой организации.');
/** Internal trusted original tick; HTTP never supplies actor, organisation, timestamp or IP. */
export async function recordAccountNdaAcceptance(
  tx: Database,
  input: {
    accountId: string;
    organizationId: string;
    ndaVersionId: string;
    acceptedAt: Date;
    ip: string;
  },
) {
  if (!isIP(input.ip) || input.ip.includes('%') || !Number.isFinite(input.acceptedAt.getTime()))
    throw new ProblemException(400, 'nda_evidence_invalid', 'Адрес принятия согласия недоступен.');
  const [account] = await tx
    .select({ organizationId: userAccounts.organizationId, role: userAccounts.role, type: organizations.type })
    .from(userAccounts)
    .innerJoin(organizations, eq(organizations.id, userAccounts.organizationId))
    .where(eq(userAccounts.id, input.accountId))
    .for('no key update', { of: userAccounts });
  if (
    !account ||
    account.organizationId !== input.organizationId ||
    account.role !== 'manufacturer' ||
    account.type !== 'manufacturer'
  )
    throw denied();
  const [existing] = await tx
    .select()
    .from(accountNdaAcceptance)
    .where(
      and(
        eq(accountNdaAcceptance.userAccountId, input.accountId),
        eq(accountNdaAcceptance.ndaVersionId, input.ndaVersionId),
      ),
    );
  if (existing) return { acceptance: existing, created: false };
  const [acceptance] = await tx
    .insert(accountNdaAcceptance)
    .values({
      userAccountId: input.accountId,
      organizationId: input.organizationId,
      ndaVersionId: input.ndaVersionId,
      acceptedAt: input.acceptedAt,
      ipAddress: input.ip,
    })
    .returning();
  return { acceptance: acceptance!, created: true };
}

/** Compatibility SQL export: all durable versions, not only the transient R1 triplet, are linked. */
export function accountNdaLinksInsert(profileId: string, accountId: string) {
  return sql`select id from link_account_nda_acceptances(${profileId}::uuid,${accountId}::uuid)`;
}

/** Always read consent facts from canonical account evidence, including a new tick in a legacy sidecar. */
export async function currentAccountNdaEvidence(
  tx: Database,
  input: { accountId: string; organizationId: string; ndaVersionId: string },
) {
  const { rows } = await tx.execute<{
    id: string;
    acceptedAt: Date | string;
    ipAddress: string;
    profileLinked: boolean;
  }>(sql`
    select c.id,c.accepted_at as "acceptedAt",c.ip_address as "ipAddress", exists(
      select 1 from nda_acceptance n join manufacturer_profile p on p.id=n.profile_id and p.organization_id=n.organization_id
      where n.account_nda_acceptance_id=c.id and n.organization_id=c.organization_id and n.nda_version_id=c.nda_version_id
      union all
      select 1 from nda_acceptance_bridge b join manufacturer_profile p on p.id=b.profile_id and p.organization_id=b.organization_id
      where b.account_nda_acceptance_id=c.id and b.organization_id=c.organization_id and b.nda_version_id=c.nda_version_id
    ) as "profileLinked" from account_nda_acceptance c
    where c.user_account_id=${input.accountId} and c.organization_id=${input.organizationId} and c.nda_version_id=${input.ndaVersionId}`);
  return rows[0] ? { ...rows[0], acceptedAt: new Date(rows[0].acceptedAt) } : null;
}
