import {
  profileUnlockInputSchema,
  profileUnlockResultSchema,
  SECTION_KINDS,
  type ProfileUnlockInput,
  type ProfileUnlockResult,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { AuditService } from '../../common/audit.service.js';
import { ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { PG_POOL } from '../../database/database.module.js';
import {
  manufacturerProfile,
  profileSection,
  profileSectionCandidate,
  reviewAssignment,
} from '../../database/schema/index.js';
import { QUEUE } from '../../infra/infra.module.js';
import { enqueueNotification } from '../../notifications/enqueue.js';
import type { AuthUser } from '../auth/auth.types.js';
import { runOwnProfileAction } from './own-profile-action.js';
import { profileSubmissionRevisions } from './profile-candidate.js';
import { profileIsLocked } from './profile-store.js';

const changed = () =>
  new ProblemException(409, 'assignment_changed', 'Эта отправка уже завершена или изменена. Перечитайте профиль.');
const conflict = () =>
  new ProblemException(409, 'operation_conflict', 'Ключ операции уже использован для другого действия.');

/** MAN-43: close exactly this assignment, preserve frozen candidates and enqueue NOT-10 atomically. */
@Injectable()
export class ProfileUnlockService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly audit: AuditService,
    @Inject(QUEUE) private readonly queue: PgBoss,
  ) {}

  async unlock(actor: AuthUser, raw: ProfileUnlockInput, ip: string | null = null): Promise<ProfileUnlockResult> {
    const input = profileUnlockInputSchema.parse(raw);
    return runOwnProfileAction(
      this.pool,
      this.audit,
      actor,
      { action: 'profile.edit', route: '/api/v1/profiles/own/unlock', ip },
      async (tx, queueDb, { profile, sections }) => {
        const [replay] = await tx
          .select()
          .from(reviewAssignment)
          .where(
            and(
              eq(reviewAssignment.profileId, profile.id),
              eq(reviewAssignment.organizationId, profile.organizationId),
              eq(reviewAssignment.closeOperationKey, input.operationKey),
            ),
          );
        if (replay) {
          if (
            replay.id !== input.expectedAssignmentId ||
            replay.closeReason !== 'manufacturer_unlock' ||
            replay.closedAt === null
          )
            throw conflict();
          return this.result(replay);
        }
        const [assignment] = await tx
          .select()
          .from(reviewAssignment)
          .where(
            and(
              eq(reviewAssignment.id, input.expectedAssignmentId),
              eq(reviewAssignment.profileId, profile.id),
              eq(reviewAssignment.organizationId, profile.organizationId),
            ),
          )
          .for('update');
        if (!assignment || assignment.closedAt !== null || !profileIsLocked(profile, sections)) throw changed();
        if ((assignment.submissionMode === 'verified_changes') !== (profile.status === 'verified')) throw changed();
        const map = await profileSubmissionRevisions(tx, {
          assignmentId: assignment.id,
          profileId: profile.id,
          organizationId: profile.organizationId,
        });
        if (
          map.length !== SECTION_KINDS.length ||
          sections.some(
            (section) =>
              section.pendingRevisionId !== null &&
              !map.some(
                (subject) => subject.sectionId === section.id && subject.revisionId === section.pendingRevisionId,
              ),
          )
        )
          throw changed();
        // Keep the submitted map after pending clears. Verified partial decisions remain exact historical hints;
        // the shared effective-decision guard prevents an older acceptance surviving a later rejection.
        for (const subject of map) {
          const { rows } = await tx.execute<{ accepted: string | null }>(sql`select case
          when profile_review_effective_section_acceptance(
            profile_review_effective_decision(${profile.id},${profile.organizationId},${subject.revisionId}),
            ${subject.revisionId},${profile.id},${profile.organizationId})
          then profile_review_effective_decision(${profile.id},${profile.organizationId},${subject.revisionId}) else null end as accepted`);
          await tx
            .insert(profileSectionCandidate)
            .values({
              profileSectionId: subject.sectionId,
              organizationId: profile.organizationId,
              reviewAssignmentId: assignment.id,
              sectionRevisionId: subject.revisionId,
              acceptedDecisionId: rows[0]?.accepted ?? null,
            })
            .onConflictDoUpdate({
              target: profileSectionCandidate.profileSectionId,
              set: {
                reviewAssignmentId: assignment.id,
                sectionRevisionId: subject.revisionId,
                acceptedDecisionId: rows[0]?.accepted ?? null,
              },
            });
        }
        const unlockedAt = new Date();
        const profileStatus = assignment.submissionMode === 'verified_changes' ? 'verified' : 'draft';
        await tx
          .update(profileSection)
          .set({ pendingRevisionId: null, updatedAt: unlockedAt })
          .where(
            and(eq(profileSection.profileId, profile.id), eq(profileSection.organizationId, profile.organizationId)),
          );
        await tx
          .update(manufacturerProfile)
          .set({ status: profileStatus, hasPendingChanges: false, updatedAt: unlockedAt })
          .where(eq(manufacturerProfile.id, profile.id));
        const [closed] = await tx
          .update(reviewAssignment)
          .set({
            closedAt: unlockedAt,
            closedBy: actor.id,
            closeReason: 'manufacturer_unlock',
            closeOperationKey: input.operationKey,
          })
          .where(eq(reviewAssignment.id, assignment.id))
          .returning();
        if (!closed) throw changed();
        await this.audit.record(
          {
            userId: actor.id,
            organizationId: profile.organizationId,
            action: 'profile.unlock',
            objectType: 'review_assignment',
            objectId: assignment.id,
            ip,
            diff: {
              operationId: input.operationKey,
              before: {
                status: profile.status,
                pending: sections.map((section) => ({ sectionId: section.id, revisionId: section.pendingRevisionId })),
              },
              after: { status: profileStatus, pending: [], closedAt: unlockedAt.toISOString() },
            },
          },
          tx,
        );
        await enqueueNotification(
          this.queue,
          {
            rule: 'NOT-10',
            eventKey: `profile-unlocked:${assignment.id}`,
            profileId: profile.id,
            organizationId: profile.organizationId,
            related: { type: 'review_assignment', id: assignment.id },
            params: {},
          },
          queueDb,
        );
        return this.result(closed);
      },
    );
  }

  private result(assignment: typeof reviewAssignment.$inferSelect): ProfileUnlockResult {
    return parseResponse(
      profileUnlockResultSchema,
      {
        profileId: assignment.profileId,
        profileStatus: assignment.submissionMode === 'verified_changes' ? 'verified' : 'draft',
        assignmentId: assignment.id,
        unlockedAt: assignment.closedAt!.toISOString(),
      },
      'разблокировка своего профиля',
    );
  }
}
