import { randomUUID } from 'node:crypto';
import {
  type CompletenessInput,
  type MainInformationRead,
  type MainInformationWrite,
  mainInformationWriteSchema,
  mainInformationReadSchema,
} from '@imbc/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import {
  companyFounder,
  dictionary,
  dictionaryEntry,
  dictionaryEntryTranslation,
  mainInformation,
  mainInformationOked,
  organizations,
  productionSite,
  productionSiteIdentity,
  sectionRevision,
  userAccounts,
} from '../../database/schema/index.js';
import { assertDictionaryChoice } from './dictionary-choice.js';
import { emptyLegalInformation, storedMainSource } from './main-source.js';
import { sectionFieldError } from './section-errors.js';
import type { SectionContext, TypedSectionHandler } from './section-handler.js';
import { profileCandidateRevisionSql } from './profile-candidate.js';

@Injectable()
export class MainInformationHandler implements TypedSectionHandler<MainInformationWrite, MainInformationRead> {
  readonly kind = 'main_information' as const;
  readonly readSchema = mainInformationReadSchema;
  /** MAN-06/40: clearing a first-read editable prefill is a real correction, even if storage was null. */
  async hasUnsavedPrefill(tx: Database, context: SectionContext): Promise<boolean> {
    const [revision] = await tx
      .select({ state: sectionRevision.state, savedAt: sectionRevision.savedAt })
      .from(sectionRevision)
      .where(
        and(eq(sectionRevision.id, context.revisionId), eq(sectionRevision.organizationId, context.organizationId)),
      );
    if (revision?.state !== 'working' || revision.savedAt !== null) return false;
    if ((await this.row(tx, context))?.legalDataCheckedAt) return false;
    const source = await storedMainSource(tx, context);
    return source.contactDefaults.companyPhone !== null || source.contactDefaults.contactEmail !== null;
  }
  parse(input: unknown): MainInformationWrite {
    return mainInformationWriteSchema.parse(input);
  }

  private async row(tx: Database, context: SectionContext) {
    const [row] = await tx
      .select()
      .from(mainInformation)
      .where(
        and(
          eq(mainInformation.sectionRevisionId, context.revisionId),
          eq(mainInformation.organizationId, context.organizationId),
        ),
      );
    return row;
  }

  /** MAN-40: canonical persisted editable values, independent of source values and first-read prefills. */
  async editable(tx: Database, context: SectionContext): Promise<MainInformationWrite> {
    const row = await this.row(tx, context);
    const sites = row
      ? await tx
          .select({
            identityId: productionSite.identityId,
            address: productionSite.address,
            city: productionSite.city,
            regionId: productionSite.regionId,
          })
          .from(productionSite)
          .where(
            and(
              eq(productionSite.mainInformationId, row.id),
              eq(productionSite.organizationId, context.organizationId),
            ),
          )
          .orderBy(asc(productionSite.positionInList))
      : [];
    return {
      website: row?.website ?? null,
      companyPhone: row?.companyPhone ?? null,
      contactEmail: row?.contactEmail ?? null,
      sites,
    };
  }

  async read(tx: Database, context: SectionContext): Promise<MainInformationRead> {
    const row = await this.row(tx, context);
    const editable = await this.editable(tx, context);
    const [org] = await tx
      .select({ bin: organizations.bin })
      .from(organizations)
      .where(eq(organizations.id, context.organizationId));
    const [account] = await tx
      .select({ email: userAccounts.email })
      .from(userAccounts)
      .where(and(eq(userAccounts.organizationId, context.organizationId), eq(userAccounts.role, 'manufacturer')));
    const [revision] = await tx
      .select({ state: sectionRevision.state, savedAt: sectionRevision.savedAt })
      .from(sectionRevision)
      .where(
        and(eq(sectionRevision.id, context.revisionId), eq(sectionRevision.organizationId, context.organizationId)),
      );
    const source =
      !row?.legalDataCheckedAt && revision?.state === 'working' ? await storedMainSource(tx, context) : null;
    const legalInformation = row
      ? {
          legalName: row.legalName,
          alternativeName: row.nameEn,
          legalForm: row.legalFormSourceName,
          directorFullName: row.directorFullName,
          stateRegisteredOn: row.stateRegisteredOn,
          legalAddress: row.legalAddress,
          founders: (
            await tx
              .select({ name: companyFounder.name })
              .from(companyFounder)
              .where(
                and(
                  eq(companyFounder.mainInformationId, row.id),
                  eq(companyFounder.organizationId, context.organizationId),
                ),
              )
              .orderBy(asc(companyFounder.positionInList))
          ).map((founder) => founder.name),
          oked: await tx
            .select({ code: mainInformationOked.code, name: mainInformationOked.sourceName })
            .from(mainInformationOked)
            .where(
              and(
                eq(mainInformationOked.mainInformationId, row.id),
                eq(mainInformationOked.organizationId, context.organizationId),
              ),
            )
            .orderBy(asc(mainInformationOked.position)),
        }
      : emptyLegalInformation();
    if (row?.legalFormId && !legalInformation.legalForm) {
      const [form] = await tx
        .select({ code: dictionaryEntry.code })
        .from(dictionaryEntry)
        .where(eq(dictionaryEntry.id, row.legalFormId));
      legalInformation.legalForm = form?.code ?? null;
    }
    if (source?.source.state === 'received') {
      Object.assign(legalInformation, source.legalInformation, { alternativeName: legalInformation.alternativeName });
      // Prefill is only a first-read convenience; a saved correction or cleared value is never overwritten.
      if (revision?.savedAt === null) {
        editable.companyPhone ??= source.contactDefaults.companyPhone;
        editable.contactEmail ??= source.contactDefaults.contactEmail;
      }
    }
    const regionIds = [...new Set(editable.sites.flatMap((site) => (site.regionId ? [site.regionId] : [])))];
    const regionRows = regionIds.length
      ? await tx
          .select({
            id: dictionaryEntry.id,
            code: dictionaryEntry.code,
            language: dictionaryEntryTranslation.language,
            name: dictionaryEntryTranslation.name,
          })
          .from(dictionaryEntry)
          .leftJoin(dictionaryEntryTranslation, eq(dictionaryEntryTranslation.dictionaryEntryId, dictionaryEntry.id))
          .where(inArray(dictionaryEntry.id, regionIds))
      : [];
    const selectedRegions: MainInformationRead['selectedRegions'] = [];
    for (const region of regionRows) {
      let stored = selectedRegions.find((entry) => entry.id === region.id);
      if (!stored) {
        stored = { id: region.id, code: region.code, names: { kk: null, ru: null, en: null } };
        selectedRegions.push(stored);
      }
      if (region.language && region.name) stored.names[region.language] = region.name;
    }
    return {
      bin: org?.bin ?? null,
      loginEmail: account?.email ?? null,
      editable,
      selectedRegions,
      legalInformation,
      source: row?.legalDataCheckedAt
        ? { state: 'received', readAt: row.legalDataCheckedAt.toISOString(), provenance: 'adata' }
        : (source?.source ?? { state: 'not_requested', readAt: null, provenance: row?.legalName ? 'migration' : null }),
      registry: {
        registered: row?.unifiedRegisterRegistered ?? null,
        firstInclusionOn: row?.unifiedRegisterFirstInclusionOn ?? null,
      },
    };
  }

  /** Only normalised dictionary matches are linked; unknown source classifications retain their code/name. */
  private async sourceEntry(tx: Database, kind: string, code: string | null): Promise<string | null> {
    if (!code) return null;
    const [entry] = await tx
      .select({ id: dictionaryEntry.id })
      .from(dictionaryEntry)
      .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
      .where(and(eq(dictionary.code, kind), sql`lower(${dictionaryEntry.code}) = lower(${code})`))
      .for('share', { of: dictionaryEntry });
    return entry?.id ?? null;
  }

  async save(tx: Database, context: SectionContext, input: MainInformationWrite): Promise<void> {
    const old = await this.editable(tx, context);
    const oldSites = new Map(old.sites.map((site) => [site.identityId, site]));
    const suppliedIds = input.sites.flatMap((site) => (site.identityId ? [site.identityId] : []));
    const identities = new Set(
      suppliedIds.length
        ? (
            await tx
              .select({ id: productionSiteIdentity.id })
              .from(productionSiteIdentity)
              .where(
                and(
                  inArray(productionSiteIdentity.id, suppliedIds),
                  eq(productionSiteIdentity.profileId, context.profileId),
                  eq(productionSiteIdentity.organizationId, context.organizationId),
                ),
              )
          ).map((identity) => identity.id)
        : [],
    );
    const validatedRegions = new Set<string>();
    for (let index = 0; index < input.sites.length; index++) {
      const site = input.sites[index]!;
      if (site.identityId && !identities.has(site.identityId))
        throw sectionFieldError(`sites.${index}.identityId`, 'site_invalid');
      const previous = site.identityId ? oldSites.get(site.identityId) : undefined;
      const regionKey = `${site.regionId}:${previous?.regionId === site.regionId}`;
      if (validatedRegions.has(regionKey)) continue;
      await assertDictionaryChoice(tx, {
        id: site.regionId,
        dictionaryCode: 'region',
        path: `sites.${index}.regionId`,
        retainedIds: new Set(previous?.regionId ? [previous.regionId] : []),
      });
      validatedRegions.add(regionKey);
    }
    const kept = new Set(input.sites.flatMap((site) => (site.identityId ? [site.identityId] : [])));
    const removed = old.sites.flatMap((site) =>
      site.identityId && !kept.has(site.identityId) ? [site.identityId] : [],
    );
    if (removed.length) {
      // MAN-11: historical rows retain their identity; current product links must be removed before removing a site.
      const result = await tx.execute<{ used: boolean }>(sql`select exists (
        select 1 from product_line line join section_revision revision on revision.id=line.section_revision_id
        join profile_section section on section.id=revision.profile_section_id
        where line.organization_id=${context.organizationId} and section.profile_id=${context.profileId}
          and line.production_site_identity_id=any(${sql.param(removed)}::uuid[])
          and line.section_revision_id=${profileCandidateRevisionSql('section')}
      ) as used`);
      if (result.rows[0]?.used) throw sectionFieldError('sites', 'site_in_use');
    }
    let row = await this.row(tx, context);
    if (!row)
      [row] = await tx
        .insert(mainInformation)
        .values({ sectionRevisionId: context.revisionId, organizationId: context.organizationId })
        .returning();
    if (!row) throw new Error('Main information insertion failed');
    await tx
      .update(mainInformation)
      .set({ website: input.website, companyPhone: input.companyPhone, contactEmail: input.contactEmail })
      .where(eq(mainInformation.id, row.id));
    if (!row.legalDataCheckedAt) {
      const source = await storedMainSource(tx, context);
      if (source.source.state === 'received' && source.source.readAt) {
        const legal = source.legalInformation;
        await tx
          .update(mainInformation)
          .set({
            legalName: legal.legalName,
            legalFormId: await this.sourceEntry(tx, 'legal_form', legal.legalForm),
            legalFormSourceName: legal.legalForm,
            directorFullName: legal.directorFullName,
            stateRegisteredOn: legal.stateRegisteredOn,
            legalAddress: legal.legalAddress,
            legalDataCheckedAt: new Date(source.source.readAt),
          })
          .where(eq(mainInformation.id, row.id));
        await tx.delete(mainInformationOked).where(eq(mainInformationOked.mainInformationId, row.id));
        for (let position = 0; position < legal.oked.length; position++) {
          const activity = legal.oked[position]!;
          await tx.insert(mainInformationOked).values({
            mainInformationId: row.id,
            organizationId: context.organizationId,
            code: activity.code,
            sourceName: activity.name,
            okedEntryId: await this.sourceEntry(tx, 'oked', activity.code),
            position,
          });
        }
        await tx.delete(companyFounder).where(eq(companyFounder.mainInformationId, row.id));
        for (let start = 0; start < legal.founders.length; start += 1000)
          await tx.insert(companyFounder).values(
            legal.founders.slice(start, start + 1000).map((name, index) => ({
              mainInformationId: row.id,
              organizationId: context.organizationId,
              name,
              positionInList: start + index,
            })),
          );
      }
    }
    await tx
      .delete(productionSite)
      .where(
        and(eq(productionSite.mainInformationId, row.id), eq(productionSite.organizationId, context.organizationId)),
      );
    const sites = [];
    const newIdentities = [];
    for (let positionInList = 0; positionInList < input.sites.length; positionInList++) {
      const site = input.sites[positionInList]!;
      const identityId = site.identityId ?? randomUUID();
      if (!site.identityId)
        newIdentities.push({ id: identityId, profileId: context.profileId, organizationId: context.organizationId });
      sites.push({
        ...site,
        identityId,
        mainInformationId: row.id,
        organizationId: context.organizationId,
        positionInList,
      });
    }
    // Transport permits large valid lists; each SQL statement stays below PostgreSQL's bind-parameter budget.
    for (let start = 0; start < newIdentities.length; start += 1000)
      await tx.insert(productionSiteIdentity).values(newIdentities.slice(start, start + 1000));
    for (let start = 0; start < sites.length; start += 1000)
      await tx.insert(productionSite).values(sites.slice(start, start + 1000));
  }

  async mandatoryInputs(tx: Database, context: SectionContext): Promise<CompletenessInput[]> {
    const data = await this.editable(tx, context);
    return [
      { path: 'companyPhone', code: 'required', satisfied: Boolean(data.companyPhone) },
      { path: 'sites', code: 'site_required', satisfied: data.sites.length > 0 },
      ...data.sites.flatMap((site, index) =>
        (['address', 'city', 'regionId'] as const).map((field) => ({
          path: `sites.${index}.${field}`,
          code: 'required',
          satisfied: Boolean(site[field]),
        })),
      ),
    ];
  }
}
