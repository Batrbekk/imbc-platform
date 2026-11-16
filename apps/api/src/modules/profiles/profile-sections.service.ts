import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  displayCompleteness,
  ownSectionsOverviewSchema,
  type ProfileFileHistory,
  profileCompleteness,
  SECTION_KINDS,
  sectionCompleteness,
  sectionReadSchema,
  type OwnSectionsOverview,
  type SectionKind,
  type SectionOverview,
  type SectionRead,
  type SectionSaveInput,
} from '@imbc/contracts';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type pg from 'pg';
import { z, ZodError } from 'zod';
import { actorTransaction } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { PG_POOL, type Database } from '../../database/database.module.js';
import { databaseErrorSummary } from '../../database/pg-errors.js';
import { manufacturerProfile, profileSection, sectionRevision } from '../../database/schema/index.js';
import type { AuthUser } from '../auth/auth.types.js';
import {
  ownProfile,
  OwnProfileDenied,
  ownRevisions,
  ownSections,
  profileIsLocked,
  selectedRevision,
  type StoredProfile,
  type StoredRevision,
  type StoredSection,
} from './profile-store.js';
import { copyRevisionContent, revisionContent } from './revision-copy.js';
import { PROFILE_SECTION_HANDLERS, type SectionContext, type SectionHandler } from './section-handler.js';
import { profileLocked, sectionChanged, sectionUnavailable, sectionValidationError } from './section-errors.js';
import { readProfileFileHistory, retainProfileFiles } from './profile-file-history.js';

interface OwnGraph {
  profile: StoredProfile;
  sections: StoredSection[];
  revisions: StoredRevision[];
}

/** MAN-40, DATA-01: one own-profile transaction covers normalized content, completeness, and full-value history. */
@Injectable()
export class ProfileSectionsService {
  private readonly logger = new Logger('ProfileSections');
  private readonly handlers = new Map<SectionKind, SectionHandler>();

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly audit: AuditService,
    @Optional() @Inject(PROFILE_SECTION_HANDLERS) handlers: readonly SectionHandler[] = [],
  ) {
    for (const handler of handlers) {
      if (!SECTION_KINDS.includes(handler.kind) || this.handlers.has(handler.kind))
        throw new Error('Invalid profile section handler registry');
      this.handlers.set(handler.kind, handler);
    }
  }

  async overview(actor: AuthUser, ip: string | null = null): Promise<OwnSectionsOverview> {
    return this.run(actor, 'profile.read', '/api/v1/profiles/own/sections', ip, async (tx, graph) =>
      this.overviewIn(tx, graph),
    );
  }

  async read(actor: AuthUser, rawKind: string, ip: string | null = null): Promise<SectionRead<unknown>> {
    const kind = this.kind(rawKind);
    return this.run(actor, 'profile.read', '/api/v1/profiles/own/sections/:kind', ip, async (tx, graph) =>
      this.readIn(tx, graph, kind),
    );
  }

  async fileHistory(
    actor: AuthUser, rawKind: string, pagination: { offset: number; limit: number }, ip: string | null = null,
  ): Promise<ProfileFileHistory> {
    const kind = this.kind(rawKind);
    return this.run(actor, 'profile.read', '/api/v1/profiles/own/sections/:kind/files/history', ip, async (tx, graph) => {
      const section = graph.sections.find((item) => item.kind === kind);
      if (!section) throw sectionUnavailable();
      return readProfileFileHistory(tx, { profileId: graph.profile.id, sectionId: section.id,
        organizationId: graph.profile.organizationId, ...pagination });
    });
  }

  async editorChoices(actor: AuthUser, rawKind: string, ip: string | null = null): Promise<unknown> {
    const kind = this.kind(rawKind);
    return this.run(actor, 'profile.edit', '/api/v1/profiles/own/sections/:kind/choices', ip, async (tx, graph) => {
      if (profileIsLocked(graph.profile, graph.sections)) throw profileLocked();
      const handler = this.handlers.get(kind);
      const section = graph.sections.find((item) => item.kind === kind);
      const revision = section ? selectedRevision(section, graph.revisions) : null;
      if (!handler?.editorChoices || !handler.editorChoicesSchema || !section || !revision) throw sectionUnavailable();
      return parseResponse(handler.editorChoicesSchema,
        await handler.editorChoices(tx, this.context(graph.profile, section, revision)), 'варианты для редактирования раздела');
    });
  }

  async save(
    actor: AuthUser,
    rawKind: string,
    input: SectionSaveInput<unknown>,
    ip: string | null = null,
  ): Promise<SectionRead<unknown>> {
    const kind = this.kind(rawKind);
    return this.run(actor, 'profile.edit', '/api/v1/profiles/own/sections/:kind', ip, async (tx, graph) => {
      if (profileIsLocked(graph.profile, graph.sections)) throw profileLocked();
      const handler = this.handlers.get(kind);
      const section = graph.sections.find((row) => row.kind === kind);
      if (!handler || !section) throw sectionUnavailable();
      const current = selectedRevision(section, graph.revisions);
      if (!current) throw sectionUnavailable();
      if (input.editVersion !== current.editVersion) throw sectionChanged();
      const normalized = handler.parse(input.data);
      const context = this.context(graph.profile, section, current);
      const editable = await handler.editable(tx, context);
      // Normalized no-op preserves history, except an explicit clear of unsaved first-read source prefills.
      if (isDeepStrictEqual(normalized, editable)) {
        const hasUnsavedPrefill = (await handler.hasUnsavedPrefill?.(tx, context)) ?? false;
        if (!hasUnsavedPrefill) return this.readIn(tx, graph, kind);
      }

      const before = await revisionContent(tx, kind, current.id, graph.profile.organizationId);
      await retainProfileFiles(tx, context, current.editVersion, actor.id);
      const working =
        current.state === 'working' ? current : await this.copyWorking(tx, graph, section, current, actor.id);
      const workingContext = this.context(graph.profile, section, working);
      await handler.save(tx, workingContext, normalized);
      await retainProfileFiles(tx, workingContext, current.editVersion + 1, actor.id);
      const completeness = sectionCompleteness(await handler.mandatoryInputs(tx, workingContext));
      const savedAt = new Date();
      const [saved] = await tx
        .update(sectionRevision)
        .set({
          editVersion: current.editVersion + 1,
          savedAt,
          authorId: actor.id,
          completenessPct: String(completeness.percent),
        })
        .where(
          and(eq(sectionRevision.id, working.id), eq(sectionRevision.organizationId, graph.profile.organizationId)),
        )
        .returning();
      if (!saved) throw new Error('Saved profile revision is missing');
      await tx
        .update(profileSection)
        .set({ workingRevisionId: saved.id, completenessPct: String(completeness.percent), updatedAt: savedAt })
        .where(and(eq(profileSection.id, section.id), eq(profileSection.organizationId, graph.profile.organizationId)));
      section.workingRevisionId = saved.id;
      section.completenessPct = String(completeness.percent);
      graph.revisions = graph.revisions.filter((revision) => revision.id !== saved.id).concat(saved);

      // MAN-45, R1 compatibility: Save creates unsent work, leaving the legacy review-queue flag unchanged.
      const overview = await this.overviewIn(tx, graph);
      await tx
        .update(manufacturerProfile)
        .set({
          completenessPercent: String(overview.completenessPct),
          // R1 reads the legacy whole-percent column; new clients use the exact numeric value.
          completenessPct: displayCompleteness(overview.completenessPct),
          updatedAt: savedAt,
        })
        .where(eq(manufacturerProfile.id, graph.profile.id));
      const after = await revisionContent(tx, kind, saved.id, graph.profile.organizationId);
      await this.audit.record(
        {
          userId: actor.id,
          organizationId: graph.profile.organizationId,
          action: 'profile.section.save',
          objectType: 'profile_section',
          objectId: section.id,
          ip,
          diff: {
            operationId: randomUUID(),
            kind,
            sourceRevisionId: current.id,
            targetRevisionId: saved.id,
            before: { editVersion: current.editVersion, content: before },
            after: { editVersion: saved.editVersion, content: after },
          },
        },
        tx,
      );
      return this.readIn(tx, graph, kind);
    });
  }

  private kind(rawKind: string): SectionKind {
    const result = z.enum(SECTION_KINDS).safeParse(rawKind);
    if (!result.success) throw new ProblemException(404, 'not_found', 'Раздел не найден.');
    return result.data;
  }

  private context(profile: StoredProfile, section: StoredSection, revision: StoredRevision): SectionContext {
    return {
      profileId: profile.id,
      organizationId: profile.organizationId,
      sectionId: section.id,
      revisionId: revision.id,
    };
  }

  private async metadata(tx: Database, graph: OwnGraph, kind: SectionKind): Promise<SectionOverview> {
    const section = graph.sections.find((row) => row.kind === kind);
    const revision = section ? selectedRevision(section, graph.revisions) : null;
    const handler = this.handlers.get(kind);
    const available = Boolean(handler && section && revision);
    const completeness = available
      ? sectionCompleteness(await handler!.mandatoryInputs(tx, this.context(graph.profile, section!, revision!)))
      : { percent: 0, missing: [{ path: '', code: 'section_unavailable' }] };
    if (revision?.state === 'superseded') throw new Error('Selected profile revision is superseded');
    return {
      kind,
      available,
      profileStatus: graph.profile.status,
      revisionId: revision?.id ?? null,
      revisionState: revision?.state ?? null,
      revisionOrigin: revision?.origin ?? null,
      editVersion: revision?.editVersion ?? 0,
      savedAt: revision?.savedAt?.toISOString() ?? null,
      readOnly: !available || profileIsLocked(graph.profile, graph.sections),
      hasWorkingChanges:
        graph.profile.status === 'verified' &&
        Boolean(section?.workingRevisionId) &&
        revision?.state === 'working' &&
        revision.editVersion > 0,
      completeness,
    };
  }

  private async overviewIn(tx: Database, graph: OwnGraph): Promise<OwnSectionsOverview> {
    const sections = await Promise.all(SECTION_KINDS.map((kind) => this.metadata(tx, graph, kind)));
    return parseResponse(
      ownSectionsOverviewSchema,
      {
        profileId: graph.profile.id,
        profileStatus: graph.profile.status,
        readOnly: profileIsLocked(graph.profile, graph.sections),
        hasPendingChanges: graph.profile.status === 'verified' && graph.sections.some((section) => section.pendingRevisionId !== null),
        completenessPct: profileCompleteness(sections),
        sections,
      },
      'обзор разделов своего профиля',
    );
  }

  private async readIn(tx: Database, graph: OwnGraph, kind: SectionKind): Promise<SectionRead<unknown>> {
    const section = graph.sections.find((row) => row.kind === kind);
    const revision = section ? selectedRevision(section, graph.revisions) : null;
    const handler = this.handlers.get(kind);
    if (!handler || !section || !revision) throw sectionUnavailable();
    const metadata = await this.metadata(tx, graph, kind);
    const data = parseResponse(
      handler.readSchema,
      await handler.read(tx, this.context(graph.profile, section, revision)),
      'данные раздела своего профиля',
    );
    return parseResponse(sectionReadSchema(z.unknown()), { ...metadata, data }, 'раздел своего профиля');
  }

  private async copyWorking(
    tx: Database,
    graph: OwnGraph,
    section: StoredSection,
    source: StoredRevision,
    authorId: string,
  ): Promise<StoredRevision> {
    const revisionNumber =
      Math.max(
        0,
        ...graph.revisions.filter((row) => row.profileSectionId === section.id).map((row) => row.revisionNumber),
      ) + 1;
    const [working] = await tx
      .insert(sectionRevision)
      .values({
        profileSectionId: section.id,
        organizationId: graph.profile.organizationId,
        revisionNumber,
        origin: 'manufacturer',
        authorId,
        editVersion: source.editVersion,
      })
      .returning();
    if (!working) throw new Error('Working profile revision is missing');
    await copyRevisionContent(tx, section.kind, source.id, working.id, graph.profile.organizationId);
    graph.revisions.push(working);
    return working;
  }

  private async run<T>(
    actor: AuthUser,
    action: 'profile.read' | 'profile.edit',
    route: string,
    ip: string | null,
    work: (tx: Database, graph: OwnGraph) => Promise<T>,
  ): Promise<T> {
    try {
      return await actorTransaction(this.pool, this.audit, actor, { action, route, ip }, async (tx) => {
        const profile = await ownProfile(tx, actor);
        const sections = await ownSections(tx, profile.id, profile.organizationId);
        const revisions = await ownRevisions(tx, sections, profile.organizationId);
        return work(tx, { profile, sections, revisions });
      });
    } catch (error) {
      if (error instanceof OwnProfileDenied) {
        try {
          await this.audit.record({
            userId: actor.id,
            organizationId: actor.organizationId,
            action,
            objectType: 'route',
            objectId: route,
            outcome: 'denied',
            ip,
          });
        } catch (auditError) {
          this.logger.error(
            databaseErrorSummary(auditError) ?? { name: auditError instanceof Error ? auditError.name : 'unknown' },
            'Own-profile denial audit failed',
          );
        }
      }
      if (error instanceof ZodError) throw sectionValidationError(error);
      throw error;
    }
  }
}
