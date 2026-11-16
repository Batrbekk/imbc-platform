import { createHash } from 'node:crypto';
import {
  profileSubmitInputSchema,
  profileSubmitResultSchema,
  SECTION_KINDS,
  sectionCompleteness,
  type ProfileSubmitInput,
  type ProfileSubmitResult,
  type SectionKind,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { PG_POOL, type Database } from '../../database/database.module.js';
import {
  manufacturerProfile,
  organizations,
  profileSection,
  profileSectionCandidate,
  reviewAssignment,
  sectionRevision,
  userAccounts,
} from '../../database/schema/index.js';
import { QUEUE } from '../../infra/infra.module.js';
import { enqueueNotification } from '../../notifications/enqueue.js';
import { AuditService } from '../../common/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { captureRevisionFileVersions } from '../files/revision-file-snapshot.js';
import { runOwnProfileAction } from './own-profile-action.js';
import { effectiveProfileReviewDecisionId, profileSubmissionRevisions } from './profile-candidate.js';
import { validateProfileRevisionGraph, type ExactProfileRevisionMap } from './profile-publication-graph.js';
import {
  ownRevisions,
  profileIsLocked,
  selectedRevision,
  type StoredRevision,
  type StoredSection,
} from './profile-store.js';
import { copyRevisionContent } from './revision-copy.js';
import { profileLocked, sectionChanged, sectionValidationError } from './section-errors.js';
import { PROFILE_SECTION_HANDLERS, type SectionContext, type SectionHandler } from './section-handler.js';
import { validateFrozenSubmissionFiles } from './submission-file-evidence.js';
import {
  captureSubmissionRequirements,
  lockCurrentSubmissionRequirements,
  requirementSnapshotMatches,
  type RequirementSection,
} from './submission-requirements.js';

const ROUTE = '/api/v1/profiles/own/submit';
type Selected = { section: StoredSection; revision: StoredRevision; retainedDecisionId: string | null };
const operationConflict = () =>
  new ProblemException(409, 'operation_conflict', 'Эта операция уже использована для другой отправки.');
const context = (profileId: string, organizationId: string, item: Selected): SectionContext => ({
  profileId,
  organizationId,
  sectionId: item.section.id,
  revisionId: item.revision.id,
});

/** MAN-42/43/45, DATA-07: one locked own-profile transaction creates one immutable Send and queued event. */
@Injectable()
export class ProfileSubmitService {
  private readonly handlers = new Map<SectionKind, SectionHandler>();

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly audit: AuditService,
    @Inject(QUEUE) private readonly queue: PgBoss,
    @Inject(PROFILE_SECTION_HANDLERS) handlers: readonly SectionHandler[],
  ) {
    for (const handler of handlers) {
      if (!SECTION_KINDS.includes(handler.kind) || this.handlers.has(handler.kind))
        throw new Error('Invalid profile submission handler registry');
      this.handlers.set(handler.kind, handler);
    }
    if (this.handlers.size !== SECTION_KINDS.length) throw new Error('Incomplete profile submission handler registry');
  }

  async submit(actor: AuthUser, input: ProfileSubmitInput, ip: string | null = null): Promise<ProfileSubmitResult> {
    const parsed = profileSubmitInputSchema.safeParse(input);
    if (!parsed.success) throw sectionValidationError(parsed.error);
    const request = parsed.data;
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          accuracyConfirmed: request.accuracyConfirmed,
          expectedSections: [...request.expectedSections].sort((a, b) =>
            a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0,
          ),
        }),
      )
      .digest('hex');
    return runOwnProfileAction(
      this.pool,
      this.audit,
      actor,
      { route: ROUTE, action: 'profile.edit', ip },
      async (tx, queueDb, graph) => {
        const { profile, sections } = graph;
        const [replay] = await tx
          .select()
          .from(reviewAssignment)
          .where(
            and(
              eq(reviewAssignment.profileId, profile.id),
              eq(reviewAssignment.organizationId, profile.organizationId),
              eq(reviewAssignment.operationKey, request.operationKey),
            ),
          );
        if (replay) {
          if (replay.requestFingerprint !== fingerprint) throw operationConflict();
          return this.result(tx, replay);
        }
        if (profileIsLocked(profile, sections)) throw profileLocked();
        const [previous] = await tx
          .select()
          .from(reviewAssignment)
          .where(
            and(
              eq(reviewAssignment.profileId, profile.id),
              eq(reviewAssignment.organizationId, profile.organizationId),
            ),
          )
          .orderBy(desc(reviewAssignment.assignmentOrder))
          .limit(1)
          .for('share');
        if (previous && previous.closedAt === null) throw profileLocked();

        // Advisory dictionary lock comes before entry locks. The fresh statement sees a concurrent committed new required type.
        const requirements = await lockCurrentSubmissionRequirements(tx);
        const revisions = await ownRevisions(tx, sections, profile.organizationId);
        const selected: Selected[] = sections.map((section) => {
          const revision = selectedRevision(section, revisions);
          if (!revision) throw new ProblemException(409, 'section_unavailable', 'Раздел этой отправки недоступен.');
          return { section, revision, retainedDecisionId: null };
        });
        if (selected.length !== SECTION_KINDS.length)
          throw new ProblemException(409, 'section_unavailable', 'Не все разделы этой отправки доступны.');
        const lockedRevisions = await tx
          .select()
          .from(sectionRevision)
          .where(
            and(
              inArray(
                sectionRevision.id,
                selected.map((item) => item.revision.id),
              ),
              eq(sectionRevision.organizationId, profile.organizationId),
            ),
          )
          .orderBy(asc(sectionRevision.id))
          .for('update');
        for (const item of selected) {
          const locked = lockedRevisions.find((revision) => revision.id === item.revision.id);
          if (!locked || !['working', 'submitted', 'verified', 'rejected'].includes(locked.state))
            throw new ProblemException(409, 'section_unavailable', 'Редакция этой отправки недоступна.');
          item.revision = locked;
          const expected = request.expectedSections.find((section) => section.kind === item.section.kind);
          if (
            !expected ||
            expected.revisionId !== item.revision.id ||
            expected.editVersion !== item.revision.editVersion
          )
            throw sectionChanged();
        }

        const changedRequirementKinds: RequirementSection[] = [];
        for (const item of selected) {
          const kind = item.section.kind;
          const requirementKind = kind === 'certificates' || kind === 'documents' ? kind : null;
          const baselineChanged =
            item.revision.state !== 'working' &&
            requirementKind !== null &&
            !(await requirementSnapshotMatches(
              tx,
              context(profile.id, profile.organizationId, item),
              requirements[requirementKind],
            ));
          if (baselineChanged) changedRequirementKinds.push(requirementKind!);
          if (item.revision.state !== 'working' && !baselineChanged)
            item.retainedDecisionId = await this.retainedDecision(
              tx,
              profile.id,
              profile.organizationId,
              item.revision.id,
            );
          if (item.revision.state !== 'working' && item.retainedDecisionId === null) {
            const source = item.revision;
            const number =
              Math.max(
                0,
                ...revisions
                  .filter((revision) => revision.profileSectionId === item.section.id)
                  .map((revision) => revision.revisionNumber),
              ) + 1;
            const [working] = await tx
              .insert(sectionRevision)
              .values({
                profileSectionId: item.section.id,
                organizationId: profile.organizationId,
                revisionNumber: number,
                origin: 'manufacturer',
                authorId: actor.id,
                editVersion: source.editVersion,
              })
              .returning();
            if (!working) throw new Error('Submission working revision is missing');
            await copyRevisionContent(tx, kind, source.id, working.id, profile.organizationId);
            await tx
              .update(profileSection)
              .set({ workingRevisionId: working.id })
              .where(eq(profileSection.id, item.section.id));
            item.revision = working;
            revisions.push(working);
          }
        }

        if (
          profile.status === 'verified' &&
          selected.every((item) => item.revision.id === item.section.verifiedRevisionId)
        )
          throw new ProblemException(409, 'profile_no_changes', 'Нет изменений для отправки на проверку.');

        const missing: { kind: SectionKind; path: string; code: string }[] = [];
        const completeness = new Map<SectionKind, number>();
        for (const item of selected) {
          const detail = sectionCompleteness(
            await this.handlers
              .get(item.section.kind)!
              .mandatoryInputs(tx, context(profile.id, profile.organizationId, item)),
          );
          completeness.set(item.section.kind, detail.percent);
          if (item.section.kind !== 'production')
            for (const field of detail.missing)
              missing.push({ kind: item.section.kind, path: field.path, code: field.code });
        }
        if (missing.length)
          throw new ProblemException(
            400,
            'profile_incomplete',
            'Заполните обязательные данные перед отправкой.',
            undefined,
            {
              missing,
              requirements: changedRequirementKinds.map((kind) => ({ kind, requiredTypeIds: requirements[kind] })),
            },
          );
        const revisionMap = Object.fromEntries(
          selected.map((item) => [item.section.kind, item.revision.id]),
        ) as ExactProfileRevisionMap;
        const validity = await validateProfileRevisionGraph(tx, {
          profileId: profile.id,
          organizationId: profile.organizationId,
          revisions: revisionMap,
        });
        if (!validity.valid)
          throw new ProblemException(
            409,
            'submission_graph_invalid',
            'Проверьте связи между разделами профиля.',
            undefined,
            { missing: validity.issues },
          );

        const sentAt = new Date();
        for (const item of selected) {
          const sectionContext = context(profile.id, profile.organizationId, item);
          if (item.revision.state === 'working') {
            if (item.section.kind === 'certificates' || item.section.kind === 'documents')
              await captureSubmissionRequirements(tx, sectionContext, requirements[item.section.kind], sentAt);
            try {
              await captureRevisionFileVersions(tx, {
                sectionRevisionId: item.revision.id,
                organizationId: profile.organizationId,
              });
            } catch (error) {
              if (
                error instanceof ProblemException &&
                ['file_pending_scan', 'file_rejected', 'not_found', 'validation'].includes(error.code)
              )
                throw new ProblemException(
                  409,
                  'submission_file_unavailable',
                  'Файл этой отправки недоступен или не прошёл проверку.',
                  undefined,
                  { missing: [{ kind: item.section.kind, path: '', code: 'submission_file_unavailable' }] },
                );
              throw error;
            }
          } else await validateFrozenSubmissionFiles(tx, sectionContext);
        }

        for (const item of selected)
          if (item.revision.state === 'working') {
            // Working/pending state guards are immediate: clear working, freeze, then set pending.
            await tx
              .update(profileSection)
              .set({ workingRevisionId: null })
              .where(eq(profileSection.id, item.section.id));
            await tx
              .update(sectionRevision)
              .set({
                state: 'submitted',
                submittedAt: sentAt,
                completenessPct: String(completeness.get(item.section.kind)!),
              })
              .where(eq(sectionRevision.id, item.revision.id));
            await tx
              .update(profileSection)
              .set({
                pendingRevisionId: item.revision.id,
                completenessPct: String(completeness.get(item.section.kind)!),
                updatedAt: sentAt,
              })
              .where(eq(profileSection.id, item.section.id));
          }
        const mode = profile.status === 'verified' ? 'verified_changes' : previous ? 'resubmit' : 'initial';
        let reuse:
          { expertId: string; assignedBy: string; assignedAt: Date; reusedFromAssignmentId: string } | undefined;
        if (previous?.expertId && previous.assignedBy && mode !== 'initial') {
          const [expert] = await tx
            .select({ id: userAccounts.id })
            .from(userAccounts)
            .innerJoin(organizations, eq(organizations.id, userAccounts.organizationId))
            .where(
              and(
                eq(userAccounts.id, previous.expertId),
                eq(userAccounts.role, 'expert'),
                eq(userAccounts.state, 'active'),
                eq(organizations.type, 'imbc'),
              ),
            )
            .for('share');
          if (expert)
            reuse = {
              expertId: expert.id,
              assignedBy: previous.assignedBy,
              assignedAt: sentAt,
              reusedFromAssignmentId: previous.id,
            };
        }
        const [assignment] = await tx
          .insert(reviewAssignment)
          .values({
            profileId: profile.id,
            organizationId: profile.organizationId,
            submittedBy: actor.id,
            receivedAt: sentAt,
            accuracyConfirmedAt: sentAt,
            submissionMode: mode,
            operationKey: request.operationKey,
            requestFingerprint: fingerprint,
            ...reuse,
          })
          .returning();
        if (!assignment) throw new Error('Submission assignment is missing');
        const values = selected.map(
          (
            item,
          ) => sql`(${assignment.id},${profile.id},${item.section.id},${item.revision.id},${profile.organizationId},
        ${item.retainedDecisionId === null},${item.retainedDecisionId})`,
        );
        await tx.execute(sql`insert into review_assignment_section
        (review_assignment_id,profile_id,profile_section_id,section_revision_id,organization_id,review_required,retained_decision_id)
        values ${sql.join(values, sql`, `)}`);
        for (const item of selected)
          await tx
            .insert(profileSectionCandidate)
            .values({
              profileSectionId: item.section.id,
              organizationId: profile.organizationId,
              reviewAssignmentId: assignment.id,
              sectionRevisionId: item.revision.id,
              acceptedDecisionId: item.retainedDecisionId,
            })
            .onConflictDoUpdate({
              target: profileSectionCandidate.profileSectionId,
              set: {
                reviewAssignmentId: assignment.id,
                sectionRevisionId: item.revision.id,
                acceptedDecisionId: item.retainedDecisionId,
              },
            });
        await tx
          .update(manufacturerProfile)
          .set({
            status: mode === 'verified_changes' ? 'verified' : 'submitted',
            accuracyConfirmedAt: sentAt,
            completenessPct: 100,
            completenessPercent: '100',
            hasPendingChanges: mode === 'verified_changes',
            assignedExpertId: reuse?.expertId ?? null,
            updatedAt: sentAt,
          })
          .where(eq(manufacturerProfile.id, profile.id));
        await this.audit.record(
          {
            userId: actor.id,
            organizationId: profile.organizationId,
            action: 'profile.submit',
            objectType: 'review_assignment',
            objectId: assignment.id,
            ip,
            diff: {
              operationId: request.operationKey,
              mode,
              accuracyConfirmedAt: sentAt.toISOString(),
              before: {
                status: profile.status,
                sections: sections.map((section) => ({
                  kind: section.kind,
                  workingRevisionId: section.workingRevisionId,
                  pendingRevisionId: section.pendingRevisionId,
                  verifiedRevisionId: section.verifiedRevisionId,
                })),
              },
              after: {
                status: mode === 'verified_changes' ? 'verified' : 'submitted',
                sections: selected.map((item) => ({
                  kind: item.section.kind,
                  revisionId: item.revision.id,
                  retainedDecisionId: item.retainedDecisionId,
                })),
              },
            },
          },
          tx,
        );
        await enqueueNotification(
          this.queue,
          {
            rule: 'NOT-04',
            eventKey: `profile_submitted:${assignment.id}`,
            profileId: profile.id,
            organizationId: profile.organizationId,
            accountId: actor.id,
            related: { type: 'review_assignment', id: assignment.id },
            params: {},
          },
          queueDb,
        );
        return this.result(tx, assignment);
      },
    );
  }

  private async retainedDecision(
    tx: Database,
    profileId: string,
    organizationId: string,
    revisionId: string,
  ): Promise<string | null> {
    const id = await effectiveProfileReviewDecisionId(tx, {
      profileId,
      organizationId,
      subject: { kind: 'section', sectionRevisionId: revisionId },
    });
    if (!id) return null;
    const { rows } = await tx.execute<{ id: string }>(sql`select d.id from review_decision d
      join review_assignment a on a.id=d.review_assignment_id and a.organization_id=d.organization_id
      where d.id=${id} and d.section_revision_id=${revisionId} and d.outcome='verified'
        and a.profile_id=${profileId} and a.organization_id=${organizationId} and a.closed_at is not null for share of a`);
    if (rows.length !== 1) return null;
    // Repeat after acquiring the source lock: late rejection committed while waiting cannot transfer the old approval.
    if (
      id !==
      (await effectiveProfileReviewDecisionId(tx, {
        profileId,
        organizationId,
        subject: { kind: 'section', sectionRevisionId: revisionId },
      }))
    )
      return null;
    // REV-06 requires decisions on each document/held certificate. Files require PASSED scanning; an
    // existing rejection is relevant, but absent per-file decisions do not invent a review click for CVs/photos.
    const { rows: evidence } = await tx.execute<{ valid: boolean }>(sql`select not exists (
      select d.id from document d where d.section_revision_id=${revisionId} and d.organization_id=${organizationId}
        and not exists (select 1 from review_decision item where item.id=profile_review_effective_decision(
          ${profileId},${organizationId},null,null,d.id,null) and item.outcome='verified')
      union all
      select c.id from certificate c where c.section_revision_id=${revisionId} and c.organization_id=${organizationId}
        and not c.not_held and not exists (select 1 from review_decision item where item.id=profile_review_effective_decision(
          ${profileId},${organizationId},null,c.id,null,null) and item.outcome='verified')
      union all
      select snap.file_version_id from revision_file_version snap
        join review_decision item on item.id=profile_review_effective_decision(
          ${profileId},${organizationId},null,null,null,snap.file_version_id)
        where snap.section_revision_id=${revisionId} and snap.organization_id=${organizationId} and item.outcome='rejected'
      ) as valid`);
    return evidence[0]?.valid ? id : null;
  }

  private async result(tx: Database, assignment: typeof reviewAssignment.$inferSelect): Promise<ProfileSubmitResult> {
    const sections = await profileSubmissionRevisions(tx, {
      assignmentId: assignment.id,
      profileId: assignment.profileId,
      organizationId: assignment.organizationId,
    });
    return parseResponse(
      profileSubmitResultSchema,
      {
        profileId: assignment.profileId,
        profileStatus: assignment.submissionMode === 'verified_changes' ? 'verified' : 'submitted',
        assignmentId: assignment.id,
        receivedAt: assignment.receivedAt.toISOString(),
        mode: assignment.submissionMode,
        sections: sections.map(({ kind, revisionId, reviewRequired, retainedDecisionId }) => ({
          kind,
          revisionId,
          reviewRequired,
          retainedDecisionId,
        })),
      },
      'отправка профиля',
    );
  }
}
