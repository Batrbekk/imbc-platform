import { randomUUID } from 'node:crypto';
import {
  SECTION_KINDS,
  displayCompleteness,
  profileCompleteness,
  sectionCompleteness,
  type SectionKind,
} from '@imbc/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { AuditService } from '../../common/audit.service.js';
import type { Database } from '../../database/database.module.js';
import { databaseErrorSummary } from '../../database/pg-errors.js';
import * as schema from '../../database/schema/index.js';
import { mainSourceRefreshOutbox } from '../../database/schema/main-source-ownership.js';
import { captureRevisionFileVersions } from '../files/revision-file-snapshot.js';
import { applyMainSourcePlan, planMainSource } from './main-source-materializer.js';
import { ownRevisions, ownSections, selectedRevision } from './profile-store.js';
import { copyRevisionContent, revisionContent } from './revision-copy.js';
import type { SectionContext, SectionHandler } from './section-handler.js';

/** Adata result worker invokes on its exact transaction; old events cannot requeue a different latest attempt. */
export async function requestMainSourceRefresh(
  tx: Database,
  profileId: string,
  organizationId: string,
  attemptId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    insert into main_source_refresh_outbox(profile_id,organization_id,requested_attempt_id,requested_completed_at,requested_state,state,last_attempt_at)
    select c.profile_id,c.organization_id,a.id,a.completed_at,a.state::text,'pending',NULL from external_check c
    join external_check_attempt a on a.id=c.latest_attempt_id and a.external_check_id=c.id
    where c.profile_id=${profileId} and c.organization_id=${organizationId} and c.connector='adata' and a.id=${attemptId}
      and a.state in ('received','unavailable','not_configured','quota_exhausted') and a.completed_at is not null
    on conflict(profile_id) do update set requested_attempt_id=excluded.requested_attempt_id,requested_completed_at=excluded.requested_completed_at,requested_state=excluded.requested_state,state='pending',last_attempt_at=NULL
    where (main_source_refresh_outbox.applied_attempt_id,main_source_refresh_outbox.applied_completed_at,main_source_refresh_outbox.applied_state)
      is distinct from (excluded.requested_attempt_id,excluded.requested_completed_at,excluded.requested_state)
    returning profile_id`);
  return result.rows.length > 0;
}

/** Main-only quarterly/source-result COW. No source network calls, Send, unlock or verified writes. */
export class MainSourceRefreshService {
  private readonly handlers: Map<SectionKind, SectionHandler>;
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditService,
    handlers: readonly SectionHandler[],
  ) {
    this.handlers = new Map(handlers.map((handler) => [handler.kind, handler]));
    if (SECTION_KINDS.some((kind) => !this.handlers.has(kind)))
      throw new Error('All seven real section handlers are required');
  }

  async applyProfile(profileId: string): Promise<'applied' | 'unchanged' | 'deferred' | 'not_requested'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx = drizzle(client, { schema, casing: 'snake_case' }) as Database;
      const { rows: profiles } = await tx.execute<{
        id: string;
        organizationId: string;
        status: string;
        source: string;
        migrated: boolean;
      }>(
        sql`select id,organization_id as "organizationId",status,source,migrated from manufacturer_profile where id=${profileId} for no key update`,
      );
      const profile = profiles[0];
      if (!profile) {
        await client.query('COMMIT');
        return 'not_requested';
      }
      const sections = await ownSections(tx, profile.id, profile.organizationId);
      const assignment = await tx.execute(
        sql`select id from review_assignment where profile_id=${profile.id} and organization_id=${profile.organizationId} and closed_at is null`,
      );
      const [outbox] = await tx
        .select()
        .from(mainSourceRefreshOutbox)
        .where(
          and(
            eq(mainSourceRefreshOutbox.profileId, profile.id),
            eq(mainSourceRefreshOutbox.organizationId, profile.organizationId),
          ),
        );
      if (!outbox) {
        await client.query('COMMIT');
        return 'not_requested';
      }
      const attempted = { attemptCount: outbox.attemptCount + 1, lastAttemptAt: new Date() };
      if (
        assignment.rows.length ||
        ['submitted', 'under_review'].includes(profile.status) ||
        sections.some((section) => section.pendingRevisionId !== null)
      ) {
        await tx
          .update(mainSourceRefreshOutbox)
          .set({ ...attempted, state: 'deferred' })
          .where(eq(mainSourceRefreshOutbox.profileId, profile.id));
        await client.query('COMMIT');
        return 'deferred';
      }
      const revisions = await ownRevisions(tx, sections, profile.organizationId);
      const section = sections.find((section) => section.kind === 'main_information');
      const baseline = section ? selectedRevision(section, revisions) : null;
      if (!section || !baseline) throw new Error('Main source profile graph is missing');
      const context: SectionContext = {
        profileId: profile.id,
        organizationId: profile.organizationId,
        sectionId: section.id,
        revisionId: baseline.id,
      };
      const plan = await planMainSource(
        tx,
        context,
        profile.source === 'manual' &&
          !profile.migrated &&
          baseline.state === 'working' &&
          baseline.editVersion === 0 &&
          baseline.savedAt === null &&
          baseline.revisionNumber === 1,
      );
      // Terminal result workers lock the source receipt then enqueue; never hold this outbox while waiting for that receipt.
      await tx
        .select()
        .from(mainSourceRefreshOutbox)
        .where(eq(mainSourceRefreshOutbox.profileId, profile.id))
        .for('update');
      if (
        !plan.pin.latestAttemptId ||
        !plan.pin.latestAttemptCompletedAt ||
        plan.pin.adataState === 'waiting' ||
        plan.pin.adataState === 'not_requested'
      ) {
        await tx
          .update(mainSourceRefreshOutbox)
          .set({ ...attempted, state: 'deferred' })
          .where(eq(mainSourceRefreshOutbox.profileId, profile.id));
        await client.query('COMMIT');
        return 'deferred';
      }
      let target = baseline;
      const before = plan.changed ? await revisionContent(tx, section.kind, baseline.id, profile.organizationId) : null;
      if (plan.changed) {
        if (baseline.state === 'working') {
          const captured = await captureRevisionFileVersions(tx, {
            sectionRevisionId: baseline.id,
            organizationId: profile.organizationId,
          });
          for (let start = 0; start < captured.length; start += 1000)
            await tx
              .insert(schema.profileFileHistory)
              .values(
                captured
                  .slice(start, start + 1000)
                  .map((file) => ({
                    sectionRevisionId: baseline.id,
                    organizationId: profile.organizationId,
                    editVersion: baseline.editVersion,
                    fileObjectId: file.fileObjectId,
                    fileVersionId: file.fileVersionId,
                    actorId: null,
                  })),
              )
              .onConflictDoNothing();
          await tx
            .update(schema.sectionRevision)
            .set({ state: 'superseded' })
            .where(eq(schema.sectionRevision.id, baseline.id));
        }
        const [working] = await tx
          .insert(schema.sectionRevision)
          .values({
            profileSectionId: section.id,
            organizationId: profile.organizationId,
            revisionNumber:
              Math.max(
                ...revisions
                  .filter((revision) => revision.profileSectionId === section.id)
                  .map((revision) => revision.revisionNumber),
              ) + 1,
            origin: 'source_refresh',
            editVersion: baseline.editVersion + 1,
            savedAt: new Date(),
            authorId: null,
          })
          .returning();
        if (!working) throw new Error('Main source working revision insertion failed');
        target = working;
        await copyRevisionContent(tx, section.kind, baseline.id, target.id, profile.organizationId);
        await applyMainSourcePlan(tx, { ...context, revisionId: target.id }, plan);
        await tx
          .update(schema.profileSection)
          .set({ workingRevisionId: target.id })
          .where(eq(schema.profileSection.id, section.id));
        section.workingRevisionId = target.id;
        revisions.push(target);
        const completeness = [] as {
          kind: SectionKind;
          available: boolean;
          completeness: ReturnType<typeof sectionCompleteness>;
        }[];
        for (const currentSection of sections) {
          const revision = selectedRevision(currentSection, revisions);
          if (!revision) throw new Error('Source completeness graph is missing');
          const value = sectionCompleteness(
            await this.handlers
              .get(currentSection.kind)!
              .mandatoryInputs(tx, { ...context, sectionId: currentSection.id, revisionId: revision.id }),
          );
          completeness.push({ kind: currentSection.kind, available: true, completeness: value });
          if (currentSection.id === section.id) {
            await tx
              .update(schema.sectionRevision)
              .set({ completenessPct: String(value.percent) })
              .where(eq(schema.sectionRevision.id, target.id));
            await tx
              .update(schema.profileSection)
              .set({ completenessPct: String(value.percent) })
              .where(eq(schema.profileSection.id, section.id));
          }
        }
        const percent = profileCompleteness(completeness);
        await tx
          .update(schema.manufacturerProfile)
          .set({
            completenessPercent: String(percent),
            completenessPct: displayCompleteness(percent),
            updatedAt: new Date(),
          })
          .where(eq(schema.manufacturerProfile.id, profile.id));
        const after = await revisionContent(tx, section.kind, target.id, profile.organizationId);
        await this.audit.record(
          {
            organizationId: profile.organizationId,
            action: 'profile.source.main.materialized',
            objectType: 'profile_section',
            objectId: section.id,
            diff: {
              operationId: randomUUID(),
              sourceRevisionId: baseline.id,
              targetRevisionId: target.id,
              adataAttemptId: plan.pin.latestAttemptId,
              adataSnapshotId: plan.pin.adataSnapshotId,
              eOndirisScopeHash: plan.pin.eOndirisScopeHash,
              issues: plan.issues,
              before: { editVersion: baseline.editVersion, content: before },
              after: { editVersion: target.editVersion, content: after },
            },
          },
          tx,
        );
      }
      await tx
        .update(mainSourceRefreshOutbox)
        .set({
          ...attempted,
          state: 'applied',
          appliedAttemptId: plan.pin.latestAttemptId,
          appliedCompletedAt: plan.pin.latestAttemptCompletedAt,
          appliedState: plan.pin.adataState,
          requestedAttemptId: plan.pin.latestAttemptId,
          requestedCompletedAt: plan.pin.latestAttemptCompletedAt,
          requestedState: plan.pin.adataState,
          targetRevisionId: target.id,
        })
        .where(eq(mainSourceRefreshOutbox.profileId, profile.id));
      await client.query('COMMIT');
      return plan.changed ? 'applied' : 'unchanged';
    } catch (error) {
      await client.query('ROLLBACK');
      const summary = databaseErrorSummary(error);
      if (summary) throw Object.assign(new Error('Main source refresh database operation failed'), { summary });
      throw error;
    } finally {
      client.release();
    }
  }
}
