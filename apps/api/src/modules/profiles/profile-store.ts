import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { manufacturerProfile, profileSection, sectionRevision, userAccounts } from '../../database/schema/index.js';
import { ProblemException } from '../../common/problem.js';
import type { AuthUser } from '../auth/auth.types.js';

export class OwnProfileDenied extends ProblemException {
  constructor() {
    super(403, 'forbidden', 'Нет прав на этот профиль.');
  }
}

/** GEN-08, GEN-11: account role and organisation are checked again under the actor transaction lock. */
export async function ownProfile(tx: Database, actor: AuthUser) {
  const [account] = await tx
    .select({ role: userAccounts.role, organizationId: userAccounts.organizationId })
    .from(userAccounts)
    .where(eq(userAccounts.id, actor.id));
  if (account?.role !== 'manufacturer' || account.organizationId !== actor.organizationId) throw new OwnProfileDenied();

  const [profile] = await tx
    .select()
    .from(manufacturerProfile)
    .where(eq(manufacturerProfile.organizationId, account.organizationId))
    .for('no key update');
  if (!profile) throw new ProblemException(404, 'not_found', 'Профиль не найден.');
  return profile;
}

export async function ownSections(tx: Database, profileId: string, organizationId: string) {
  return tx
    .select()
    .from(profileSection)
    .where(and(eq(profileSection.profileId, profileId), eq(profileSection.organizationId, organizationId)))
    .orderBy(asc(profileSection.kind))
    .for('no key update');
}

/** Read only revisions belonging to the already scoped section graph. */
export async function ownRevisions(tx: Database, sections: readonly { id: string }[], organizationId: string) {
  if (sections.length === 0) return [];
  return tx
    .select()
    .from(sectionRevision)
    .where(
      and(
        inArray(
          sectionRevision.profileSectionId,
          sections.map(({ id }) => id),
        ),
        eq(sectionRevision.organizationId, organizationId),
      ),
    );
}

export type StoredProfile = Awaited<ReturnType<typeof ownProfile>>;
export type StoredSection = Awaited<ReturnType<typeof ownSections>>[number];
export type StoredRevision = Awaited<ReturnType<typeof ownRevisions>>[number];

export function selectedRevision(section: StoredSection, revisions: readonly StoredRevision[]): StoredRevision | null {
  const revisionId = section.workingRevisionId ?? section.pendingRevisionId ?? section.verifiedRevisionId;
  return revisions.find((revision) => revision.id === revisionId && revision.profileSectionId === section.id) ?? null;
}

/** MAN-43, MAN-45: pending pointers denote sent changes, not a manufacturer's unsubmitted working copy. */
export function profileIsLocked(profile: StoredProfile, sections: readonly StoredSection[]): boolean {
  return (
    profile.status === 'submitted' ||
    profile.status === 'under_review' ||
    (profile.status === 'verified' && sections.some((section) => section.pendingRevisionId !== null))
  );
}
