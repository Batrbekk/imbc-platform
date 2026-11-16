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
  userAccounts,
} from '../../database/schema/index.js';
import { assertDictionaryChoice } from './dictionary-choice.js';
import { emptyLegalInformation, pinnedMainSource } from './main-source.js';
import { applyMainSourcePlan, planMainSource } from './main-source-materializer.js';
import { mainContactOwnership, mainSiteOwnership, mainSourcePin } from '../../database/schema/main-source-ownership.js';
import {
  initialContactOwnership,
  recordMainContactSave,
  recordMainSiteSave,
  type MainContactOwnership,
  type MainSiteOwnership,
  type ExistingMainSite,
} from './main-source-ownership.js';
import { sectionFieldError } from './section-errors.js';
import type { SectionContext, TypedSectionHandler } from './section-handler.js';
import { profileCandidateRevisionSql } from './profile-candidate.js';

@Injectable()
export class MainInformationHandler implements TypedSectionHandler<MainInformationWrite, MainInformationRead> {
  readonly kind = 'main_information' as const;
  readonly readSchema = mainInformationReadSchema;
  /** Initial local source materialization is called only by the locked section core before metadata. */
  async prepareInitialSource(tx: Database, context: SectionContext): Promise<boolean> {
    const row = await this.row(tx, context);
    if (!row) throw new Error('Initial Main content is missing');
    const [pin] = await tx.select().from(mainSourcePin).where(eq(mainSourcePin.mainInformationId, row.id));
    if (pin) return false;
    const plan = await planMainSource(tx, context, true);
    await applyMainSourcePlan(tx, context, plan);
    return true;
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
      source: await pinnedMainSource(tx, context, row),
      registry: {
        registered: row?.unifiedRegisterRegistered ?? null,
        firstInclusionOn: row?.unifiedRegisterFirstInclusionOn ?? null,
      },
    };
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
    const contactOwners = await tx
      .select()
      .from(mainContactOwnership)
      .where(eq(mainContactOwnership.mainInformationId, row.id));
    const contacts = (['companyPhone', 'contactEmail'] as const).map((field) =>
      recordMainContactSave(
        (contactOwners.find((owner) => owner.field === field) as MainContactOwnership | undefined) ??
          initialContactOwnership(field, old[field], false),
        old[field],
        input[field],
      ),
    );
    await tx.delete(mainContactOwnership).where(eq(mainContactOwnership.mainInformationId, row.id));
    await tx
      .insert(mainContactOwnership)
      .values(
        contacts.map((owner) => ({ ...owner, mainInformationId: row!.id, organizationId: context.organizationId })),
      );
    const oldOwnership = await tx
      .select()
      .from(mainSiteOwnership)
      .where(eq(mainSiteOwnership.mainInformationId, row.id));
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
    const ownedSites = recordMainSiteSave(old.sites as ExistingMainSite[], sites, oldOwnership as MainSiteOwnership[]);
    await tx.delete(mainSiteOwnership).where(eq(mainSiteOwnership.mainInformationId, row.id));
    for (let start = 0; start < ownedSites.length; start += 1000)
      await tx
        .insert(mainSiteOwnership)
        .values(
          ownedSites
            .slice(start, start + 1000)
            .map((owner) => ({ ...owner, mainInformationId: row!.id, organizationId: context.organizationId })),
        );
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
