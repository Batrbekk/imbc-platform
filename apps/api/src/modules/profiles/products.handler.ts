import { randomUUID } from 'node:crypto';
import { productsReadSchema, productsWriteSchema, productCapacitySchema, MANUAL_CAPACITY_UNIT_CODES,
  type ProductsRead, type ProductsWrite, type ProductReference, type CompletenessInput,
} from '@imbc/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { dictionary, dictionaryEntry, dictionaryEntryTranslation, productLine, productLineIdentity,
  productLineKpved, productLineCertificate, productsSection, sectionRevision,
} from '../../database/schema/index.js';
import { profileFiles, validateProfileFileBindings } from './profile-files.js';
import { sectionFieldError } from './section-errors.js';
import type { SectionContext, TypedSectionHandler } from './section-handler.js';

type Line = typeof productLine.$inferSelect;
type Classification = typeof productLineKpved.$inferSelect;
type Entry = { id: string; code: string; dictionaryCode: string; parentEntryId: string | null; retiredAt: Date | null };
const registry = (row: Line) => row.source === 'e_ondiris';
const capacity = (value: string | null) => productCapacitySchema.parse(value);
type ProductMatch = Pick<Line, 'identityId' | 'nameEn' | 'nameRu' | 'tnVedCode'> & { source: Line['source'] };
/** MAN-25: comparison aliases only; persisted names and classification spelling are never rewritten. */
const productNames = (row: Pick<ProductMatch, 'nameEn' | 'nameRu'>) => [...new Set([row.nameEn, row.nameRu]
  .flatMap((name) => name === null ? [] : [name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()])
  .filter(Boolean))].sort();
const sameProductKey = (a: ProductMatch, b: ProductMatch) => a.tnVedCode === b.tnVedCode
  && JSON.stringify(productNames(a)) === JSON.stringify(productNames(b));
/** A textual code alone never creates a duplicate. Multiple source records remain separate facts. */
function duplicateManualProducts(rows: readonly ProductMatch[]): Set<string> {
  const buckets = new Map<string, ProductMatch[]>();
  for (const row of rows) {
    if (row.tnVedCode === null || row.tnVedCode === '') continue;
    for (const name of productNames(row)) {
      const key = JSON.stringify([row.tnVedCode, name]);
      const bucket = buckets.get(key) ?? [];
      bucket.push(row); buckets.set(key, bucket);
    }
  }
  const duplicates = new Set<string>();
  for (const bucket of buckets.values()) if (bucket.length > 1)
    for (const row of bucket) if (row.source !== 'e_ondiris') duplicates.add(row.identityId);
  return duplicates;
}
const chunks = <T>(items: readonly T[], size = 1000): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
};

/** MAN-23–25: local associations share stable identities; registry facts belong to ingestion. */
@Injectable()
export class ProductsHandler implements TypedSectionHandler<ProductsWrite, ProductsRead> {
  readonly kind = 'products' as const;
  readonly readSchema = productsReadSchema;
  parse(input: unknown): ProductsWrite { return productsWriteSchema.parse(input); }

  private async graph(tx: Database, context: SectionContext) {
    const lines = await tx.select({ line: productLine }).from(productLine)
      .innerJoin(productLineIdentity, and(eq(productLineIdentity.id, productLine.identityId),
        eq(productLineIdentity.organizationId, productLine.organizationId), eq(productLineIdentity.profileId, context.profileId)))
      .where(and(eq(productLine.sectionRevisionId, context.revisionId), eq(productLine.organizationId, context.organizationId)))
      .orderBy(asc(productLine.positionInList), asc(productLine.id));
    const ids = lines.map(({ line }) => line.id);
    const classifications = ids.length ? await tx.select().from(productLineKpved)
      .where(and(inArray(productLineKpved.productLineId, ids), eq(productLineKpved.organizationId, context.organizationId)))
      .orderBy(asc(productLineKpved.positionInList), asc(productLineKpved.id)) : [];
    const links = ids.length ? await tx.select().from(productLineCertificate)
      .where(and(inArray(productLineCertificate.productLineId, ids), eq(productLineCertificate.organizationId, context.organizationId)))
      .orderBy(asc(productLineCertificate.certificateIdentityId)) : [];
    const kpved = new Map<string, Classification[]>();
    const certificates = new Map<string, string[]>();
    for (const row of classifications) { const list = kpved.get(row.productLineId) ?? []; list.push(row); kpved.set(row.productLineId, list); }
    for (const row of links) { const list = certificates.get(row.productLineId) ?? []; list.push(row.certificateIdentityId); certificates.set(row.productLineId, list); }
    const [section] = await tx.select().from(productsSection).where(and(eq(productsSection.sectionRevisionId, context.revisionId),
      eq(productsSection.organizationId, context.organizationId)));
    return { lines: lines.map(({ line }) => line), kpved, certificates, extractId: section?.unifiedRegisterExtractId ?? null };
  }
  private write(graph: Awaited<ReturnType<ProductsHandler['graph']>>): ProductsWrite {
    return { products: graph.lines.map((line) => {
      const common = { identityId: line.identityId, productionSiteIdentityId: line.productionSiteIdentityId,
        note: line.note, certificateIdentityIds: graph.certificates.get(line.id) ?? [] };
      return registry(line) ? { kind: 'registry' as const, ...common } : { kind: 'manual' as const, ...common,
        nameEn: line.nameEn, nameRu: line.nameRu, commodityTypeId: line.commodityTypeId, tnVedEntryId: line.tnVedEntryId,
        kpvedEntryIds: (graph.kpved.get(line.id) ?? []).flatMap((row) => row.kpvedEntryId ? [row.kpvedEntryId] : []),
        capacityQuantity: capacity(line.capacityQuantity), capacityUnitId: line.capacityUnitId };
    }), unifiedRegisterExtractId: graph.extractId };
  }
  async editable(tx: Database, context: SectionContext): Promise<ProductsWrite> { return this.write(await this.graph(tx, context)); }

  private async references(tx: Database, ids: readonly string[]) {
    const references = new Map<string, ProductReference>();
    const entries = new Map<string, Entry>();
    if (ids.length === 0) return { references, entries };
    const rows = await tx.select({ id: dictionaryEntry.id, code: dictionaryEntry.code,
      dictionaryCode: dictionary.code, parentEntryId: dictionaryEntry.parentEntryId, retiredAt: dictionaryEntry.retiredAt,
      language: dictionaryEntryTranslation.language, name: dictionaryEntryTranslation.name })
      .from(dictionaryEntry).innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
      .leftJoin(dictionaryEntryTranslation, eq(dictionaryEntryTranslation.dictionaryEntryId, dictionaryEntry.id))
      .where(inArray(dictionaryEntry.id, [...new Set(ids)]));
    for (const row of rows) {
      entries.set(row.id, row);
      let entry = references.get(row.id);
      if (!entry) { entry = { id: row.id, code: row.code, names: { en: null, ru: null, kk: null }, retired: row.retiredAt !== null }; references.set(row.id, entry); }
      if (row.language && row.name) entry.names[row.language] = row.name;
    }
    return { references, entries };
  }
  private async related(tx: Database, context: SectionContext) {
    const { rows: sites } = await tx.execute<NonNullable<ProductsRead['relatedChoices']>['sites'][number]>(sql`
      select site.identity_id as "identityId", site.address, site.city, site.region_id as "regionId"
      from profile_section s join section_revision r
        on r.id=coalesce(s.working_revision_id,s.pending_revision_id,s.verified_revision_id)
        and r.organization_id=s.organization_id and r.profile_section_id=s.id
      join main_information m on m.section_revision_id=r.id and m.organization_id=r.organization_id
      join production_site site on site.main_information_id=m.id and site.organization_id=m.organization_id
      join production_site_identity identity on identity.id=site.identity_id and identity.organization_id=site.organization_id
        and identity.profile_id=s.profile_id
      where s.profile_id=${context.profileId} and s.organization_id=${context.organizationId} and s.kind='main_information'
      order by site.position_in_list,site.id`);
    const { rows: certificates } = await tx.execute<{ identityId: string; number: string | null;
      certificateTypeId: string | null; customTypeName: string | null }>(sql`
      select c.identity_id as "identityId",c.number,c.certificate_type_id as "certificateTypeId",c.custom_type_name as "customTypeName"
      from profile_section s join section_revision r
        on r.id=coalesce(s.working_revision_id,s.pending_revision_id,s.verified_revision_id)
        and r.organization_id=s.organization_id and r.profile_section_id=s.id
      join certificate c on c.section_revision_id=r.id and c.organization_id=r.organization_id
      join certificate_identity identity on identity.id=c.identity_id and identity.organization_id=c.organization_id
        and identity.profile_id=s.profile_id
      where s.profile_id=${context.profileId} and s.organization_id=${context.organizationId} and s.kind='certificates'
        and c."group"='product' and not c.not_held order by c.position_in_list,c.id`);
    return { sites, certificates };
  }
  readonly editorChoicesSchema = productsReadSchema.shape.relatedChoices.unwrap();
  async editorChoices(tx: Database, context: SectionContext): Promise<NonNullable<ProductsRead['relatedChoices']>> {
    const related = await this.related(tx, context);
    const { references } = await this.references(tx, related.certificates.flatMap((row) => row.certificateTypeId ? [row.certificateTypeId] : []));
    return { sites: related.sites, productCertificates: related.certificates.map(({ certificateTypeId, ...row }) => ({
      ...row, certificateType: certificateTypeId ? references.get(certificateTypeId) ?? null : null,
    })) };
  }
  async read(tx: Database, context: SectionContext): Promise<ProductsRead> {
    const graph = await this.graph(tx, context);
    const [revision] = await tx.select({ state: sectionRevision.state, submittedAt: sectionRevision.submittedAt }).from(sectionRevision)
      .where(and(eq(sectionRevision.id, context.revisionId), eq(sectionRevision.organizationId, context.organizationId)));
    const working = revision?.state === 'working' && revision.submittedAt === null;
    const related = working ? await this.related(tx, context) : null;
    const ids = graph.lines.flatMap((row) => [row.commodityTypeId, row.tnVedEntryId, row.capacityUnitId,
      ...(graph.kpved.get(row.id) ?? []).map((entry) => entry.kpvedEntryId)]).filter((id): id is string => id !== null);
    const { references, entries } = await this.references(tx, [...ids,
      ...(related?.certificates.flatMap((row) => row.certificateTypeId ? [row.certificateTypeId] : []) ?? [])]);
    const groups = await this.references(tx, [...entries.values()].flatMap((row) => row.dictionaryCode === 'commodity_type' && row.parentEntryId ? [row.parentEntryId] : []));
    const selected = (code: string) => [...new Set(ids)].flatMap((id) => entries.get(id)?.dictionaryCode === code && references.has(id) ? [references.get(id)!] : []);
    return {
      editable: this.write(graph),
      lines: graph.lines.map((row) => ({ identityId: row.identityId, source: row.source,
        nameEn: row.nameEn, nameRu: row.nameRu, commodityTypeId: row.commodityTypeId,
        tnVedCode: row.tnVedCode, tnVedEntryId: row.tnVedEntryId,
        kpved: (graph.kpved.get(row.id) ?? []).map((entry) => ({ code: entry.code, sourceName: entry.sourceName, entryId: entry.kpvedEntryId })),
        capacityQuantity: capacity(row.capacityQuantity), capacityUnitId: row.capacityUnitId, capacityText: row.capacityText,
        inCountryValueShare: registry(row) ? row.inCountryValueShare : '0', enstruCode: row.enstruCode, enstruName: row.enstruName,
        unifiedRegisterRegistrationNumber: row.unifiedRegisterRegistrationNumber, unifiedRegisterActive: row.unifiedRegisterActive,
        unifiedRegisterIncludedOn: row.unifiedRegisterIncludedOn, productionSiteIdentityId: row.productionSiteIdentityId,
        note: row.note, certificateIdentityIds: graph.certificates.get(row.id) ?? [],
      })),
      extract: graph.extractId ? (await profileFiles(tx, context, [graph.extractId]))[0] ?? null : null,
      selectedReferences: { commodityTypes: selected('commodity_type').map((type) => {
        const parent = entries.get(type.id)?.parentEntryId;
        return { ...type, group: parent && groups.entries.get(parent)?.dictionaryCode === 'commodity_group' ? groups.references.get(parent) ?? null : null };
      }), tnVed: selected('tn_ved'), kpved: selected('kpved'), units: selected('unit') },
      relatedChoices: related ? { sites: related.sites, productCertificates: related.certificates.map(({ certificateTypeId, ...row }) => ({
        ...row, certificateType: certificateTypeId ? references.get(certificateTypeId) ?? null : null,
      })) } : null,
    };
  }

  async save(tx: Database, context: SectionContext, input: ProductsWrite): Promise<void> {
    const graph = await this.graph(tx, context);
    const old = new Map(graph.lines.map((line) => [line.identityId, line]));
    const nextIds = new Set(input.products.map((row) => row.identityId));
    for (const line of graph.lines) if (registry(line) && !nextIds.has(line.identityId))
      throw sectionFieldError('products', 'product_source_locked');
    input.products.forEach((row, index) => {
      const previous = old.get(row.identityId);
      if ((row.kind === 'registry' && (!previous || !registry(previous))) || (row.kind === 'manual' && previous && registry(previous)))
        throw sectionFieldError(`products.${index}.kind`, 'product_source_locked');
    });
    const removed = graph.lines.filter((line) => !nextIds.has(line.identityId));
    if (removed.length) {
      const { rows } = await tx.execute<{ used: boolean }>(sql`select exists (
        select 1 from profile_section s join section_revision r
          on r.id=coalesce(s.working_revision_id,s.pending_revision_id,s.verified_revision_id)
          and r.organization_id=s.organization_id and r.profile_section_id=s.id
        join equipment_item item on item.section_revision_id=r.id and item.organization_id=r.organization_id
        join equipment_product_line link on link.equipment_item_id=item.id and link.organization_id=item.organization_id
        where s.profile_id=${context.profileId} and s.organization_id=${context.organizationId} and s.kind='production'
          and link.product_line_identity_id=any(${sql.param(removed.map((line) => line.identityId))}::uuid[])
      ) as used`);
      if (rows[0]?.used) throw sectionFieldError('products', 'product_in_use');
    }
    const ids = input.products.map((row) => row.identityId).sort();
    const known = ids.length ? await tx.select().from(productLineIdentity).where(inArray(productLineIdentity.id, ids))
      .orderBy(asc(productLineIdentity.id)).for('share') : [];
    const identities = new Map(known.map((row) => [row.id, row]));
    const missing = ids.filter((id) => !identities.has(id));
    if (missing.length) {
      const { rows: conflicts } = await tx.execute<{ id: string }>(sql`
        select id from production_site_identity where id=any(${sql.param(missing)}::uuid[])
        union all select id from certificate_identity where id=any(${sql.param(missing)}::uuid[])
        union all select id from document_identity where id=any(${sql.param(missing)}::uuid[])`);
      const conflicting = new Set(conflicts.map((row) => row.id));
      const index = input.products.findIndex((row) => conflicting.has(row.identityId));
      if (index !== -1) throw sectionFieldError(`products.${index}.identityId`, 'identity_invalid');
      for (const batch of chunks(missing)) await tx.insert(productLineIdentity).values(batch.map((id) => ({ id,
        profileId: context.profileId, organizationId: context.organizationId }))).onConflictDoNothing();
      const created = await tx.select().from(productLineIdentity).where(inArray(productLineIdentity.id, missing))
        .orderBy(asc(productLineIdentity.id)).for('share');
      for (const row of created) identities.set(row.id, row);
    }
    input.products.forEach((row, index) => {
      const identity = identities.get(row.identityId);
      if (!identity || identity.profileId !== context.profileId || identity.organizationId !== context.organizationId)
        throw sectionFieldError(`products.${index}.identityId`, 'identity_invalid');
    });
    const related = await this.related(tx, context);
    const sites = new Set(related.sites.map((row) => row.identityId));
    const certificates = new Set(related.certificates.map((row) => row.identityId));
    input.products.forEach((row, index) => {
      if (row.productionSiteIdentityId && !sites.has(row.productionSiteIdentityId))
        throw sectionFieldError(`products.${index}.productionSiteIdentityId`, 'site_invalid');
      row.certificateIdentityIds.forEach((id, i) => {
        if (!certificates.has(id)) throw sectionFieldError(`products.${index}.certificateIdentityIds.${i}`, 'certificate_invalid');
      });
    });
    const choiceIds = [...new Set(input.products.flatMap((row) => row.kind === 'manual'
      ? [row.commodityTypeId, row.tnVedEntryId, row.capacityUnitId, ...row.kpvedEntryIds].filter((id): id is string => id !== null) : []))].sort();
    const entries = choiceIds.length ? await tx.select({ id: dictionaryEntry.id, code: dictionaryEntry.code,
      dictionaryCode: dictionary.code, parentEntryId: dictionaryEntry.parentEntryId, retiredAt: dictionaryEntry.retiredAt })
      .from(dictionaryEntry).innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
      .where(inArray(dictionaryEntry.id, choiceIds)).orderBy(asc(dictionaryEntry.id)).for('share', { of: dictionaryEntry }) : [];
    const choices = new Map(entries.map((entry) => [entry.id, entry]));
    const groupIds = [...new Set(entries.flatMap((entry) => entry.dictionaryCode === 'commodity_type' && entry.parentEntryId ? [entry.parentEntryId] : []))].sort();
    const groups = groupIds.length ? await tx.select({ id: dictionaryEntry.id, code: dictionaryEntry.code,
      dictionaryCode: dictionary.code, retiredAt: dictionaryEntry.retiredAt }).from(dictionaryEntry)
      .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId)).where(inArray(dictionaryEntry.id, groupIds))
      .orderBy(asc(dictionaryEntry.id)).for('share', { of: dictionaryEntry }) : [];
    const parents = new Map(groups.map((row) => [row.id, row]));
    input.products.forEach((row, index) => {
      if (row.kind !== 'manual') return;
      const previous = old.get(row.identityId);
      const validate = (id: string | null, code: string, path: string, retained: readonly (string | null)[]) => {
        if (id === null) return;
        const entry = choices.get(id);
        if (!entry || entry.dictionaryCode !== code) throw sectionFieldError(path, 'reference_invalid');
        if (code === 'unit' && !MANUAL_CAPACITY_UNIT_CODES.some((unit) => unit === entry.code))
          throw sectionFieldError(path, 'reference_invalid');
        if (entry.retiredAt && !retained.includes(id)) throw sectionFieldError(path, 'reference_retired');
        if (code === 'commodity_type') {
          const parent = entry.parentEntryId ? parents.get(entry.parentEntryId) : null;
          if (!parent || parent.dictionaryCode !== 'commodity_group' || !/^[A-E]$/.test(parent.code))
            throw sectionFieldError(path, 'reference_invalid');
          if (parent.retiredAt && previous?.commodityTypeId !== id) throw sectionFieldError(path, 'reference_retired');
        }
      };
      validate(row.commodityTypeId, 'commodity_type', `products.${index}.commodityTypeId`, [previous?.commodityTypeId ?? null]);
      validate(row.tnVedEntryId, 'tn_ved', `products.${index}.tnVedEntryId`, [previous?.tnVedEntryId ?? null]);
      validate(row.capacityUnitId, 'unit', `products.${index}.capacityUnitId`, [previous?.capacityUnitId ?? null]);
      row.kpvedEntryIds.forEach((id, i) => validate(id, 'kpved', `products.${index}.kpvedEntryIds.${i}`,
        previous ? (graph.kpved.get(previous.id) ?? []).map((item) => item.kpvedEntryId) : []));
    });
    const finalProducts: ProductMatch[] = input.products.map((row) => {
      const previous = old.get(row.identityId);
      if (row.kind === 'registry') return previous!;
      return { identityId: row.identityId, source: previous?.source ?? 'manual', nameEn: row.nameEn, nameRu: row.nameRu,
        tnVedCode: row.tnVedEntryId ? choices.get(row.tnVedEntryId)!.code
          : previous?.tnVedEntryId === null ? previous.tnVedCode : null };
    });
    const duplicates = duplicateManualProducts(finalProducts);
    input.products.forEach((row, index) => {
      if (row.kind !== 'manual' || !duplicates.has(row.identityId)) return;
      const previous = old.get(row.identityId);
      // Legacy ambiguous lines may still save local draft details. They cannot become complete until resolved.
      if (!previous || !sameProductKey(previous, finalProducts[index]!))
        throw sectionFieldError(`products.${index}`, 'duplicate_product');
    });
    await validateProfileFileBindings(tx, context, input.unifiedRegisterExtractId ? [{ fileId: input.unifiedRegisterExtractId,
      purposes: ['unified_register_extract'], path: 'unifiedRegisterExtractId' }] : []);
    const removedIds = removed.map((row) => row.id);
    if (removedIds.length) {
      await tx.delete(productLineCertificate).where(and(inArray(productLineCertificate.productLineId, removedIds), eq(productLineCertificate.organizationId, context.organizationId)));
      await tx.delete(productLineKpved).where(and(inArray(productLineKpved.productLineId, removedIds), eq(productLineKpved.organizationId, context.organizationId)));
      await tx.delete(productLine).where(and(inArray(productLine.id, removedIds), eq(productLine.organizationId, context.organizationId)));
    }
    const manual = input.products.flatMap((row, positionInList) => row.kind === 'manual' ? [{ row, positionInList }] : []);
    const manualIds: string[] = [];
    for (const batch of chunks(manual)) {
      const inserted = await tx.insert(productLine).values(batch.map(({ row, positionInList }) => {
        const previous = old.get(row.identityId);
        return { ...previous, id: previous?.id ?? randomUUID(), sectionRevisionId: context.revisionId,
          organizationId: context.organizationId, identityId: row.identityId, source: previous?.source ?? 'manual' as const,
          nameEn: row.nameEn, nameRu: row.nameRu, commodityTypeId: row.commodityTypeId,
          tnVedEntryId: row.tnVedEntryId, tnVedCode: row.tnVedEntryId ? choices.get(row.tnVedEntryId)!.code
            : previous?.tnVedEntryId === null ? previous.tnVedCode : null,
          capacityQuantity: row.capacityQuantity, capacityUnitId: row.capacityUnitId, inCountryValueShare: '0',
          productionSiteIdentityId: row.productionSiteIdentityId, note: row.note, positionInList };
      })).onConflictDoUpdate({ target: [productLine.sectionRevisionId, productLine.identityId], set: {
        nameEn: sql`excluded.name_en`, nameRu: sql`excluded.name_ru`, commodityTypeId: sql`excluded.commodity_type_id`,
        tnVedEntryId: sql`excluded.tn_ved_entry_id`, tnVedCode: sql`excluded.tn_ved_code`,
        capacityQuantity: sql`excluded.capacity_quantity`, capacityUnitId: sql`excluded.capacity_unit_id`,
        inCountryValueShare: sql`excluded.in_country_value_share`, productionSiteIdentityId: sql`excluded.production_site_identity_id`,
        note: sql`excluded.note`, positionInList: sql`excluded.position_in_list`,
      } }).returning({ id: productLine.id, identityId: productLine.identityId });
      for (const row of inserted) { manualIds.push(row.id); const line = old.get(row.identityId); if (!line) old.set(row.identityId, { id: row.id } as Line); }
    }
    if (manualIds.length) await tx.delete(productLineKpved).where(and(inArray(productLineKpved.productLineId, manualIds), eq(productLineKpved.organizationId, context.organizationId)));
    const classifications = manual.flatMap(({ row }) => {
      const line = old.get(row.identityId)!;
      const unresolved = (graph.kpved.get(line.id) ?? []).filter((entry) => entry.kpvedEntryId === null
        && !row.kpvedEntryIds.some((id) => choices.get(id)!.code === entry.code));
      return [...unresolved.map((entry) => ({ code: entry.code, sourceName: entry.sourceName, kpvedEntryId: null as string | null })),
        ...row.kpvedEntryIds.map((id) => ({ code: choices.get(id)!.code,
          sourceName: (graph.kpved.get(line.id) ?? []).find((entry) => entry.kpvedEntryId === id
            || entry.code === choices.get(id)!.code)?.sourceName ?? null, kpvedEntryId: id }))]
        .map((entry, positionInList) => ({ ...entry, productLineId: line.id, organizationId: context.organizationId, positionInList }));
    });
    for (const batch of chunks(classifications)) await tx.insert(productLineKpved).values(batch);
    for (const [positionInList, row] of input.products.entries()) if (row.kind === 'registry')
      await tx.update(productLine).set({ productionSiteIdentityId: row.productionSiteIdentityId, note: row.note, positionInList })
        .where(and(eq(productLine.id, old.get(row.identityId)!.id), eq(productLine.organizationId, context.organizationId)));
    const lineIds = input.products.map((row) => old.get(row.identityId)!.id);
    if (lineIds.length) await tx.delete(productLineCertificate).where(and(inArray(productLineCertificate.productLineId, lineIds), eq(productLineCertificate.organizationId, context.organizationId)));
    const links = input.products.flatMap((row) => row.certificateIdentityIds.map((certificateIdentityId) => ({
      productLineId: old.get(row.identityId)!.id, organizationId: context.organizationId, certificateIdentityId })));
    for (const batch of chunks(links)) await tx.insert(productLineCertificate).values(batch);
    await tx.insert(productsSection).values({ sectionRevisionId: context.revisionId, organizationId: context.organizationId,
      unifiedRegisterExtractId: input.unifiedRegisterExtractId }).onConflictDoUpdate({ target: productsSection.sectionRevisionId,
      set: { unifiedRegisterExtractId: input.unifiedRegisterExtractId } });
  }
  async mandatoryInputs(tx: Database, context: SectionContext): Promise<CompletenessInput[]> {
    const graph = await this.graph(tx, context);
    const data = this.write(graph);
    const duplicates = duplicateManualProducts(graph.lines);
    const fields: CompletenessInput[] = [{ path: 'products', code: 'product_required', satisfied: data.products.length > 0 }];
    data.products.forEach((row, index) => {
      if (row.kind !== 'manual') return;
      for (const field of ['nameEn', 'nameRu', 'commodityTypeId', 'tnVedEntryId', 'capacityQuantity', 'capacityUnitId', 'productionSiteIdentityId'] as const)
        fields.push({ path: `products.${index}.${field}`, code: 'required', satisfied: row[field] !== null });
      if (duplicates.has(row.identityId)) fields.push({ path: `products.${index}`, code: 'duplicate_product', satisfied: false });
    });
    return fields;
  }
}
