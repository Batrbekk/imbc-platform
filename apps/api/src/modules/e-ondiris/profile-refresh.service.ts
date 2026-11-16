import { randomUUID } from 'node:crypto';
import {
  SECTION_KINDS,
  displayCompleteness,
  profileCompleteness,
  sectionCompleteness,
  type SectionKind,
} from '@imbc/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { AuditService } from '../../common/audit.service.js';
import type { Database } from '../../database/database.module.js';
import { databaseErrorSummary } from '../../database/pg-errors.js';
import * as schema from '../../database/schema/index.js';
import { eOndirisRecord, eOndirisSyncScope } from '../../database/schema/e-ondiris.js';
import { eOndirisProfileRefresh } from '../../database/schema/e-ondiris-outbox.js';
import { captureRevisionFileVersions } from '../files/revision-file-snapshot.js';
import {
  ownRevisions,
  ownSections,
  selectedRevision,
  type StoredRevision,
  type StoredSection,
} from '../profiles/profile-store.js';
import { copyRevisionContent, revisionContent } from '../profiles/revision-copy.js';
import type { SectionContext, SectionHandler } from '../profiles/section-handler.js';
import type { EOndirisSnapshot } from './ingestion.js';
import { applyMainSourcePlan, planMainSource } from '../profiles/main-source-materializer.js';
import { planEOndirisProducts } from './reconciliation.js';

export type EOndirisProfileApplyResult =
  | { kind: 'applied' | 'unchanged'; bin: string; revisionIds: Partial<Record<SectionKind, string>> }
  | { kind: 'deferred' | 'ambiguous' | 'no_profile' | 'no_source'; bin: string };
const chunks = <T>(rows: readonly T[], size = 1000): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size));
  return result;
};

/** Internal worker service. No user-supplied source facts, status transitions, network reads, Send or unlock. */
export class EOndirisProfileRefreshService {
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

  /** Queue payload contains only BIN; read source facts/watermark after acquiring profile/section locks. */
  async applyBin(bin: string): Promise<EOndirisProfileApplyResult> {
    if (!/^\d{12}$/.test(bin)) throw new Error('Invalid source refresh scope');
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
      }>(sql`
        select p.id,p.organization_id as "organizationId",p.status,p.source,p.migrated from manufacturer_profile p
        join organizations o on o.id=p.organization_id where o.bin=${bin} for no key update of p`);
      const profile = profiles[0];
      const sections = profile ? await ownSections(tx, profile.id, profile.organizationId) : [];
      // Separate lookup after lock waits sees a just-committed all-retained Send, even without pending pointers.
      const assignment = profile
        ? (
            await tx.execute<{ id: string }>(sql`select id from review_assignment
        where profile_id=${profile.id} and organization_id=${profile.organizationId} and closed_at is null`)
          ).rows[0]
        : null;
      // Ingestion takes BIN -> scope -> outbox and never profile locks. Do not lock the outbox before this BIN lock.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('e-ondiris:bin:' || ${bin},0))`);
      const [scope] = await tx.select().from(eOndirisSyncScope).where(eq(eOndirisSyncScope.bin, bin)).for('update');
      if (!scope) {
        await client.query('COMMIT');
        return { kind: 'no_source', bin };
      }
      await tx
        .insert(eOndirisProfileRefresh)
        .values({ bin, requestedObservedAt: scope.acceptedObservedAt, requestedScopeHash: scope.acceptedScopeHash })
        .onConflictDoNothing();
      const [outbox] = await tx
        .select()
        .from(eOndirisProfileRefresh)
        .where(eq(eOndirisProfileRefresh.bin, bin))
        .for('update');
      const attempt = { lastAttemptAt: new Date(), attemptCount: (outbox?.attemptCount ?? 0) + 1 };
      const stop = async (kind: 'no_profile' | 'deferred' | 'ambiguous'): Promise<EOndirisProfileApplyResult> => {
        await tx
          .update(eOndirisProfileRefresh)
          .set({ ...attempt, state: kind })
          .where(eq(eOndirisProfileRefresh.bin, bin));
        await client.query('COMMIT');
        return { kind, bin };
      };
      if (!profile) return await stop('no_profile');
      if (
        assignment ||
        ['submitted', 'under_review'].includes(profile.status) ||
        sections.some((section) => section.pendingRevisionId !== null)
      )
        return await stop('deferred');
      const revisions = await ownRevisions(tx, sections, profile.organizationId);
      const productSection = sections.find((section) => section.kind === 'products');
      const mainSection = sections.find((section) => section.kind === 'main_information');
      const productBaseline = productSection ? selectedRevision(productSection, revisions) : null;
      const mainBaseline = mainSection ? selectedRevision(mainSection, revisions) : null;
      if (!productSection || !mainSection || !productBaseline || !mainBaseline)
        throw new Error('Missing source profile graph');
      const records = await tx
        .select()
        .from(eOndirisRecord)
        .where(and(eq(eOndirisRecord.bin, bin), eq(eOndirisRecord.isCurrent, true)));
      const snapshots: EOndirisSnapshot[] = records.map(({ id, contentHash, pulledAt, isCurrent, ...facts }) => ({
        id,
        contentHash,
        pulledAt,
        isCurrent,
        facts,
      }));
      const lines = await tx
        .select()
        .from(schema.productLine)
        .where(
          and(
            eq(schema.productLine.sectionRevisionId, productBaseline.id),
            eq(schema.productLine.organizationId, profile.organizationId),
          ),
        );
      const certificates = [] as (typeof schema.productLineCertificate.$inferSelect)[];
      for (const batch of chunks(lines)) {
        certificates.push(
          ...(await tx
            .select()
            .from(schema.productLineCertificate)
            .where(
              and(
                eq(schema.productLineCertificate.organizationId, profile.organizationId),
                inArray(
                  schema.productLineCertificate.productLineId,
                  batch.map((line) => line.id),
                ),
              ),
            )),
        );
      }
      const certificateMap = new Map<string, string[]>();
      for (const link of certificates) {
        const ids = certificateMap.get(link.productLineId) ?? [];
        ids.push(link.certificateIdentityId);
        certificateMap.set(link.productLineId, ids);
      }
      const lineMap = new Map(lines.map((line) => [line.identityId, line]));
      const plan = planEOndirisProducts(
        bin,
        lines.map((line) => ({
          identityId: line.identityId,
          source: line.source === 'e_ondiris' ? 'e_ondiris' : 'manual',
          registrationNumber: line.unifiedRegisterRegistrationNumber,
          nameEn: line.nameEn,
          nameRu: line.nameRu,
          tnVedCode: line.tnVedCode,
          productionSiteIdentityId: line.productionSiteIdentityId,
          certificateIdentityIds: certificateMap.get(line.id) ?? [],
          manufacturerNote: line.note,
          positionInList: line.positionInList,
        })),
        snapshots,
      );
      if (plan.kind === 'ambiguous') {
        await this.audit.record(
          {
            organizationId: profile.organizationId,
            action: 'profile.source.e_ondiris.ambiguous',
            objectType: 'profile_section',
            objectId: productSection.id,
            diff: { provider: 'e-ondiris', scopeHash: scope.acceptedScopeHash, issues: plan.issues },
          },
          tx,
        );
        return await stop('ambiguous');
      }
      const context = (section: StoredSection, revision: StoredRevision): SectionContext => ({
        profileId: profile.id,
        organizationId: profile.organizationId,
        sectionId: section.id,
        revisionId: revision.id,
      });
      const sourceMain = await planMainSource(
        tx,
        context(mainSection, mainBaseline),
        profile.source === 'manual' &&
          !profile.migrated &&
          mainBaseline.state === 'working' &&
          mainBaseline.editVersion === 0 &&
          mainBaseline.savedAt === null &&
          mainBaseline.revisionNumber === 1,
      );
      const [mainRow] = await tx
        .select()
        .from(schema.mainInformation)
        .where(eq(schema.mainInformation.sectionRevisionId, mainBaseline.id));
      const registered = snapshots.length > 0 ? true : (mainRow?.unifiedRegisterRegistered ?? null);
      const earliest =
        snapshots.flatMap((r) => (r.facts.includedOn === null ? [] : [r.facts.includedOn])).sort()[0] ??
        mainRow?.unifiedRegisterFirstInclusionOn ??
        null;
      const mainChanged =
        sourceMain.changed ||
        mainRow?.unifiedRegisterRegistered !== registered ||
        mainRow?.unifiedRegisterFirstInclusionOn !== earliest;
      const productChanged = plan.candidates.some(
        (candidate) =>
          candidate.identityId === null ||
          candidate.replacedManual ||
          lineMap.get(candidate.identityId!)?.eOndirisRecordId !== candidate.snapshot.id,
      );
      const operationId = randomUUID();
      const changedRevisions: Partial<Record<SectionKind, string>> = {};
      const beforeStates = new Map<
        SectionKind,
        { editVersion: number; content: Awaited<ReturnType<typeof revisionContent>>; sourceRevisionId: string }
      >();
      const cow = async (section: StoredSection, baseline: StoredRevision): Promise<StoredRevision> => {
        const before = await revisionContent(tx, section.kind, baseline.id, profile.organizationId);
        beforeStates.set(section.kind, {
          editVersion: baseline.editVersion,
          content: before,
          sourceRevisionId: baseline.id,
        });
        if (baseline.state === 'working') {
          const captured = await captureRevisionFileVersions(tx, {
            sectionRevisionId: baseline.id,
            organizationId: profile.organizationId,
          });
          for (const batch of chunks(captured))
            await tx
              .insert(schema.profileFileHistory)
              .values(
                batch.map((file) => ({
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
              Math.max(...revisions.filter((r) => r.profileSectionId === section.id).map((r) => r.revisionNumber)) + 1,
            origin: 'source_refresh',
            editVersion: baseline.editVersion + 1,
            savedAt: new Date(),
            authorId: null,
          })
          .returning();
        if (!working) throw new Error('Missing source working revision');
        await copyRevisionContent(tx, section.kind, baseline.id, working.id, profile.organizationId);
        await tx
          .update(schema.profileSection)
          .set({ workingRevisionId: working.id })
          .where(eq(schema.profileSection.id, section.id));
        section.workingRevisionId = working.id;
        revisions.push(working);
        changedRevisions[section.kind] = working.id;
        return working;
      };
      let mainTarget = mainBaseline;
      if (mainChanged) {
        mainTarget = await cow(mainSection, mainBaseline);
        const [targetRow] = await tx
          .select()
          .from(schema.mainInformation)
          .where(eq(schema.mainInformation.sectionRevisionId, mainTarget.id));
        if (!targetRow) throw new Error('Missing main source container');
        await applyMainSourcePlan(tx, context(mainSection, mainTarget), sourceMain);
        await tx
          .update(schema.mainInformation)
          .set({ unifiedRegisterRegistered: registered, unifiedRegisterFirstInclusionOn: earliest })
          .where(eq(schema.mainInformation.id, targetRow.id));
      }
      if (productChanged) {
        const productTarget = await cow(productSection, productBaseline);
        const targetLines = await tx
          .select()
          .from(schema.productLine)
          .where(eq(schema.productLine.sectionRevisionId, productTarget.id));
        const targetLineMap = new Map(targetLines.map((line) => [line.identityId, line]));
        const snapshotMap = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
        const [targetMainRow] = await tx
          .select()
          .from(schema.mainInformation)
          .where(eq(schema.mainInformation.sectionRevisionId, mainTarget.id));
        const sites = targetMainRow
          ? await tx
              .select()
              .from(schema.productionSite)
              .where(eq(schema.productionSite.mainInformationId, targetMainRow.id))
          : [];
        const siteMap = new Map<string, typeof sites>();
        for (const site of sites) {
          if (site.address === null) continue;
          const bucket = siteMap.get(site.address) ?? [];
          bucket.push(site);
          siteMap.set(site.address, bucket);
        }
        const sourceSiteBindings = new Map(
          sourceMain.siteBindings.map((binding) => [binding.registrationNumber, binding.identityId]),
        );
        const retainedSites = new Set(sites.map((site) => site.identityId));
        const exactRefs = await this.references(tx, snapshots);
        const newIdentities = new Map<string, string>();
        for (const batch of chunks(plan.candidates.filter((candidate) => candidate.identityId === null))) {
          const rows = batch.map((candidate) => {
            const id = randomUUID();
            newIdentities.set(candidate.snapshot.id, id);
            return { id, profileId: profile.id, organizationId: profile.organizationId };
          });
          await tx.insert(schema.productLineIdentity).values(rows);
        }
        for (const batch of chunks(plan.candidates)) {
          const rows = [] as (typeof schema.productLine.$inferInsert)[];
          for (const candidate of batch) {
            const identityId = candidate.identityId ?? newIdentities.get(candidate.snapshot.id)!;
            const previous = targetLineMap.get(identityId);
            const source = candidate.snapshot.facts;
            const exactSites = source.productionAddress === null ? [] : (siteMap.get(source.productionAddress) ?? []);
            rows.push({
              id: previous?.id ?? randomUUID(),
              sectionRevisionId: productTarget.id,
              organizationId: profile.organizationId,
              identityId,
              nameEn: null,
              nameRu: source.productName,
              commodityTypeId: null,
              tnVedCode: source.tnVedCode,
              tnVedEntryId: source.tnVedCode === null ? null : (exactRefs.tnVed.get(source.tnVedCode) ?? null),
              productionSiteIdentityId:
                candidate.identityId === null
                  ? sourceSiteBindings.has(source.registrationNumber)
                    ? retainedSites.has(sourceSiteBindings.get(source.registrationNumber)!)
                      ? sourceSiteBindings.get(source.registrationNumber)!
                      : null
                    : exactSites.length === 1
                      ? exactSites[0]!.identityId
                      : null
                  : candidate.productionSiteIdentityId,
              capacityQuantity: null,
              capacityUnitId: null,
              capacityText: source.productionCapacity,
              inCountryValueShare: source.inCountryValueShare,
              enstruCode: source.enstruCode,
              enstruName: source.enstruName,
              eOndirisRecordId: candidate.snapshot.id,
              unifiedRegisterRegistrationNumber: source.registrationNumber,
              unifiedRegisterActive: source.active,
              unifiedRegisterIncludedOn: source.includedOn,
              note: candidate.manufacturerNote,
              source: 'e_ondiris',
              positionInList: candidate.positionInList,
            });
          }
          const inserted = await tx
            .insert(schema.productLine)
            .values(rows)
            .onConflictDoUpdate({
              target: [schema.productLine.sectionRevisionId, schema.productLine.identityId],
              set: {
                nameEn: sql`excluded.name_en`,
                nameRu: sql`excluded.name_ru`,
                commodityTypeId: sql`excluded.commodity_type_id`,
                tnVedCode: sql`excluded.tn_ved_code`,
                tnVedEntryId: sql`excluded.tn_ved_entry_id`,
                productionSiteIdentityId: sql`excluded.production_site_identity_id`,
                capacityQuantity: sql`excluded.capacity_quantity`,
                capacityUnitId: sql`excluded.capacity_unit_id`,
                capacityText: sql`excluded.capacity_text`,
                inCountryValueShare: sql`excluded.in_country_value_share`,
                enstruCode: sql`excluded.enstru_code`,
                enstruName: sql`excluded.enstru_name`,
                eOndirisRecordId: sql`excluded.e_ondiris_record_id`,
                unifiedRegisterRegistrationNumber: sql`excluded.unified_register_registration_number`,
                unifiedRegisterActive: sql`excluded.unified_register_active`,
                unifiedRegisterIncludedOn: sql`excluded.unified_register_included_on`,
                source: sql`excluded.source`,
                note: sql`excluded.note`,
                positionInList: sql`excluded.position_in_list`,
              },
            })
            .returning({ id: schema.productLine.id, snapshotId: schema.productLine.eOndirisRecordId });
          await tx.delete(schema.productLineKpved).where(
            inArray(
              schema.productLineKpved.productLineId,
              inserted.map((line) => line.id),
            ),
          );
          const kpved = inserted.flatMap((line) => {
            const source = snapshotMap.get(line.snapshotId!)!.facts;
            return source.kpvedCode === null
              ? []
              : [
                  {
                    productLineId: line.id,
                    organizationId: profile.organizationId,
                    code: source.kpvedCode,
                    sourceName: source.kpvedName,
                    kpvedEntryId: exactRefs.kpved.get(source.kpvedCode) ?? null,
                    positionInList: 0,
                  },
                ];
          });
          if (kpved.length > 0) await tx.insert(schema.productLineKpved).values(kpved);
        }
      }
      const completeness = [] as {
        kind: SectionKind;
        available: boolean;
        completeness: ReturnType<typeof sectionCompleteness>;
      }[];
      for (const section of sections) {
        const revision = selectedRevision(section, revisions);
        if (!revision) throw new Error('Missing refreshed section revision');
        const value = sectionCompleteness(
          await this.handlers.get(section.kind)!.mandatoryInputs(tx, context(section, revision)),
        );
        completeness.push({ kind: section.kind, available: true, completeness: value });
        if (changedRevisions[section.kind]) {
          await tx
            .update(schema.sectionRevision)
            .set({ completenessPct: String(value.percent) })
            .where(eq(schema.sectionRevision.id, revision.id));
          await tx
            .update(schema.profileSection)
            .set({ completenessPct: String(value.percent) })
            .where(eq(schema.profileSection.id, section.id));
          await this.audit.record(
            {
              organizationId: profile.organizationId,
              action: 'profile.source.e_ondiris.materialized',
              objectType: 'profile_section',
              objectId: section.id,
              diff: {
                operationId,
                provider: 'e-ondiris',
                scopeHash: scope.acceptedScopeHash,
                targetRevisionId: revision.id,
                observedAt: scope.acceptedObservedAt.toISOString(),
                sourceRevisionId: beforeStates.get(section.kind)!.sourceRevisionId,
                before: {
                  editVersion: beforeStates.get(section.kind)!.editVersion,
                  content: beforeStates.get(section.kind)!.content,
                },
                sourceIssues: sourceMain.issues,
                after: {
                  editVersion: revision.editVersion,
                  content: await revisionContent(tx, section.kind, revision.id, profile.organizationId),
                },
              },
            },
            tx,
          );
        }
      }
      const percent = profileCompleteness(completeness);
      if (mainChanged || productChanged)
        await tx
          .update(schema.manufacturerProfile)
          .set({ completenessPercent: String(percent), completenessPct: displayCompleteness(percent) })
          .where(eq(schema.manufacturerProfile.id, profile.id));
      await tx
        .update(eOndirisProfileRefresh)
        .set({
          ...attempt,
          state: 'applied',
          requestedObservedAt: scope.acceptedObservedAt,
          requestedScopeHash: scope.acceptedScopeHash,
          appliedObservedAt: scope.acceptedObservedAt,
          appliedScopeHash: scope.acceptedScopeHash,
          targetRevisionId: changedRevisions.products ?? productBaseline.id,
        })
        .where(eq(eOndirisProfileRefresh.bin, bin));
      await client.query('COMMIT');
      return { kind: mainChanged || productChanged ? 'applied' : 'unchanged', bin, revisionIds: changedRevisions };
    } catch (error) {
      await client.query('ROLLBACK');
      const summary = databaseErrorSummary(error);
      throw Object.assign(new Error('e-Ondiris profile refresh failed'), summary ?? {});
    } finally {
      client.release();
    }
  }

  private async references(tx: Database, snapshots: readonly EOndirisSnapshot[]) {
    const codes = [
      ...new Set(
        snapshots.flatMap((snapshot) =>
          [snapshot.facts.tnVedCode, snapshot.facts.kpvedCode].filter((code): code is string => code !== null),
        ),
      ),
    ];
    const refs = new Map<string, string>();
    for (const batch of chunks(codes)) {
      const rows = await tx
        .select({ id: schema.dictionaryEntry.id, code: schema.dictionaryEntry.code, kind: schema.dictionary.code })
        .from(schema.dictionaryEntry)
        .innerJoin(schema.dictionary, eq(schema.dictionary.id, schema.dictionaryEntry.dictionaryId))
        .where(
          and(
            inArray(schema.dictionary.code, ['tn_ved', 'kpved']),
            inArray(schema.dictionaryEntry.code, batch),
            sql`${schema.dictionaryEntry.retiredAt} is null`,
          ),
        );
      for (const row of rows) refs.set(JSON.stringify([row.kind, row.code]), row.id);
    }
    return {
      tnVed: new Map(
        codes.flatMap((code) =>
          refs.has(JSON.stringify(['tn_ved', code])) ? [[code, refs.get(JSON.stringify(['tn_ved', code]))!]] : [],
        ),
      ),
      kpved: new Map(
        codes.flatMap((code) =>
          refs.has(JSON.stringify(['kpved', code])) ? [[code, refs.get(JSON.stringify(['kpved', code]))!]] : [],
        ),
      ),
    };
  }
}
