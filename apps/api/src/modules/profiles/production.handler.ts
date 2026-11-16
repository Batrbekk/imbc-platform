import {
  productionReadSchema,
  productionWriteSchema,
  productionEditorChoicesSchema,
  productCapacitySchema,
  type ProductionWrite,
  type ProductionRead,
  type ProductReference,
  type CompletenessInput,
} from '@imbc/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import {
  dictionary,
  dictionaryEntry,
  dictionaryEntryTranslation,
  production,
  productionProcess,
  productionPhoto,
  equipmentItem,
  equipmentProductLine,
  sectionRevision,
} from '../../database/schema/index.js';
import { profileFiles, validateProfileFileBindings } from './profile-files.js';
import { sectionFieldError } from './section-errors.js';
import type { SectionContext, TypedSectionHandler } from './section-handler.js';
import { profileCandidateRevisionSql } from './profile-candidate.js';

const chunks = <T>(items: readonly T[]): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += 1000) result.push(items.slice(i, i + 1000));
  return result;
};

/** MAN-26–32: nullable manual details, shared photograph ownership and optional completeness. */
@Injectable()
export class ProductionHandler implements TypedSectionHandler<ProductionWrite, ProductionRead> {
  readonly kind = 'production' as const;
  readonly readSchema = productionReadSchema;
  readonly editorChoicesSchema = productionEditorChoicesSchema;
  parse(input: unknown): ProductionWrite {
    return productionWriteSchema.parse(input);
  }

  private async graph(tx: Database, context: SectionContext) {
    const [row] = await tx
      .select()
      .from(production)
      .where(
        and(
          eq(production.sectionRevisionId, context.revisionId),
          eq(production.organizationId, context.organizationId),
        ),
      );
    const processes = row
      ? await tx
          .select()
          .from(productionProcess)
          .where(
            and(
              eq(productionProcess.productionId, row.id),
              eq(productionProcess.organizationId, context.organizationId),
            ),
          )
          .orderBy(asc(productionProcess.processEntryId))
      : [];
    const photos = row
      ? await tx
          .select()
          .from(productionPhoto)
          .where(
            and(eq(productionPhoto.productionId, row.id), eq(productionPhoto.organizationId, context.organizationId)),
          )
          .orderBy(asc(productionPhoto.positionInList), asc(productionPhoto.id))
      : [];
    const equipment = await tx
      .select()
      .from(equipmentItem)
      .where(
        and(
          eq(equipmentItem.sectionRevisionId, context.revisionId),
          eq(equipmentItem.organizationId, context.organizationId),
        ),
      )
      .orderBy(asc(equipmentItem.positionInList), asc(equipmentItem.id));
    const ids = equipment.map((item) => item.id);
    const links = ids.length
      ? await tx
          .select()
          .from(equipmentProductLine)
          .where(
            and(
              inArray(equipmentProductLine.equipmentItemId, ids),
              eq(equipmentProductLine.organizationId, context.organizationId),
            ),
          )
          .orderBy(asc(equipmentProductLine.productLineIdentityId))
      : [];
    const products = new Map<string, string[]>();
    for (const link of links) {
      const values = products.get(link.equipmentItemId) ?? [];
      values.push(link.productLineIdentityId);
      products.set(link.equipmentItemId, values);
    }
    return { row, processes, photos, equipment, products };
  }
  private write(graph: Awaited<ReturnType<ProductionHandler['graph']>>): ProductionWrite {
    return {
      areaSqm: productCapacitySchema.parse(graph.row?.areaSqm ?? null),
      workshopCount: graph.row?.workshopCount ?? null,
      utilisationPercent: productCapacitySchema.parse(graph.row?.utilisationPercent ?? null),
      processEntryIds: graph.processes.map((row) => row.processEntryId),
      photoIds: graph.photos.map((row) => row.fileObjectId),
      equipment: graph.equipment.map((row) => ({
        name: row.name,
        typeId: row.equipmentTypeId,
        quantity: row.quantity,
        photoId: row.photoFileId,
        productIdentityIds: graph.products.get(row.id) ?? [],
      })),
    };
  }
  async editable(tx: Database, context: SectionContext): Promise<ProductionWrite> {
    return this.write(await this.graph(tx, context));
  }
  private async references(tx: Database, ids: readonly string[]) {
    const references = new Map<string, ProductReference>();
    if (ids.length === 0) return references;
    const rows = await tx
      .select({
        id: dictionaryEntry.id,
        code: dictionaryEntry.code,
        retiredAt: dictionaryEntry.retiredAt,
        language: dictionaryEntryTranslation.language,
        name: dictionaryEntryTranslation.name,
      })
      .from(dictionaryEntry)
      .leftJoin(dictionaryEntryTranslation, eq(dictionaryEntryTranslation.dictionaryEntryId, dictionaryEntry.id))
      .where(inArray(dictionaryEntry.id, [...new Set(ids)]));
    for (const row of rows) {
      let reference = references.get(row.id);
      if (!reference) {
        reference = {
          id: row.id,
          code: row.code,
          retired: row.retiredAt !== null,
          names: { en: null, ru: null, kk: null },
        };
        references.set(row.id, reference);
      }
      if (row.language && row.name) reference.names[row.language] = row.name;
    }
    return references;
  }
  private async products(
    tx: Database,
    context: SectionContext,
  ): Promise<NonNullable<ProductionRead['productChoices']>> {
    const { rows } = await tx.execute<NonNullable<ProductionRead['productChoices']>[number]>(sql`
      select line.identity_id as "identityId",line.name_en as "nameEn",line.name_ru as "nameRu",line.tn_ved_code as "tnVedCode",line.source
      from profile_section s join section_revision r
        on r.id=${profileCandidateRevisionSql('s')}
        and r.profile_section_id=s.id and r.organization_id=s.organization_id
      join product_line line on line.section_revision_id=r.id and line.organization_id=r.organization_id
      join product_line_identity identity on identity.id=line.identity_id and identity.organization_id=line.organization_id
        and identity.profile_id=s.profile_id
      where s.profile_id=${context.profileId} and s.organization_id=${context.organizationId} and s.kind='products'
      order by line.position_in_list,line.id`);
    return rows;
  }
  /** Current editor candidates are a separate authorized response, never part of a frozen revision read. */
  async editorChoices(tx: Database, context: SectionContext) {
    return this.products(tx, context);
  }
  async read(tx: Database, context: SectionContext): Promise<ProductionRead> {
    const graph = await this.graph(tx, context);
    const editable = this.write(graph);
    const [revision] = await tx
      .select({ state: sectionRevision.state, submittedAt: sectionRevision.submittedAt })
      .from(sectionRevision)
      .where(
        and(eq(sectionRevision.id, context.revisionId), eq(sectionRevision.organizationId, context.organizationId)),
      );
    const working = revision?.state === 'working' && revision.submittedAt === null;
    const references = await this.references(tx, [
      ...editable.processEntryIds,
      ...editable.equipment.flatMap((row) => (row.typeId ? [row.typeId] : [])),
    ]);
    const files = new Map(
      (
        await profileFiles(tx, context, [
          ...editable.photoIds,
          ...editable.equipment.flatMap((row) => (row.photoId ? [row.photoId] : [])),
        ])
      ).map((file) => [file.fileId, file]),
    );
    return {
      editable,
      photos: editable.photoIds.map((id) => files.get(id)!),
      equipmentPhotos: editable.equipment.map((row) => (row.photoId ? (files.get(row.photoId) ?? null) : null)),
      selectedReferences: {
        processes: editable.processEntryIds.flatMap((id) => (references.has(id) ? [references.get(id)!] : [])),
        equipmentTypes: [...new Set(editable.equipment.flatMap((row) => (row.typeId ? [row.typeId] : [])))].flatMap(
          (id) => (references.has(id) ? [references.get(id)!] : []),
        ),
      },
      productChoices: working ? await this.products(tx, context) : null,
    };
  }
  async save(tx: Database, context: SectionContext, input: ProductionWrite): Promise<void> {
    const graph = await this.graph(tx, context);
    const previous = this.write(graph);
    const retainedProcesses = new Set(previous.processEntryIds);
    const retainedTypes = new Map<string, number>();
    for (const row of previous.equipment)
      if (row.typeId) retainedTypes.set(row.typeId, (retainedTypes.get(row.typeId) ?? 0) + 1);
    const ids = [
      ...new Set([...input.processEntryIds, ...input.equipment.flatMap((row) => (row.typeId ? [row.typeId] : []))]),
    ].sort();
    const entries = ids.length
      ? await tx
          .select({ id: dictionaryEntry.id, retiredAt: dictionaryEntry.retiredAt, dictionaryCode: dictionary.code })
          .from(dictionaryEntry)
          .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
          .where(inArray(dictionaryEntry.id, ids))
          .orderBy(asc(dictionaryEntry.id))
          .for('share', { of: dictionaryEntry })
      : [];
    const choices = new Map(entries.map((row) => [row.id, row]));
    input.processEntryIds.forEach((id, index) => {
      const entry = choices.get(id);
      if (!entry || entry.dictionaryCode !== 'process')
        throw sectionFieldError(`processEntryIds.${index}`, 'reference_invalid');
      if (entry.retiredAt && !retainedProcesses.has(id))
        throw sectionFieldError(`processEntryIds.${index}`, 'reference_retired');
    });
    input.equipment.forEach((row, index) => {
      if (!row.typeId) return;
      const entry = choices.get(row.typeId);
      if (!entry || entry.dictionaryCode !== 'equipment_type')
        throw sectionFieldError(`equipment.${index}.typeId`, 'reference_invalid');
      if (entry.retiredAt) {
        const uses = retainedTypes.get(row.typeId) ?? 0;
        if (uses === 0) throw sectionFieldError(`equipment.${index}.typeId`, 'reference_retired');
        retainedTypes.set(row.typeId, uses - 1);
      }
    });
    const products = new Set((await this.products(tx, context)).map((row) => row.identityId));
    input.equipment.forEach((row, index) =>
      row.productIdentityIds.forEach((id, linkIndex) => {
        if (!products.has(id))
          throw sectionFieldError(`equipment.${index}.productIdentityIds.${linkIndex}`, 'product_invalid');
      }),
    );
    await validateProfileFileBindings(tx, context, [
      ...input.photoIds.map((fileId, index) => ({
        fileId,
        purposes: ['production_photo'] as const,
        path: `photoIds.${index}`,
      })),
      ...input.equipment.flatMap((row, index) =>
        row.photoId
          ? [{ fileId: row.photoId, purposes: ['production_photo'] as const, path: `equipment.${index}.photoId` }]
          : [],
      ),
    ]);
    const equipmentIds = graph.equipment.map((row) => row.id);
    if (equipmentIds.length) {
      await tx
        .delete(equipmentProductLine)
        .where(
          and(
            inArray(equipmentProductLine.equipmentItemId, equipmentIds),
            eq(equipmentProductLine.organizationId, context.organizationId),
          ),
        );
      await tx
        .delete(equipmentItem)
        .where(and(inArray(equipmentItem.id, equipmentIds), eq(equipmentItem.organizationId, context.organizationId)));
    }
    if (graph.row) {
      await tx
        .delete(productionProcess)
        .where(
          and(
            eq(productionProcess.productionId, graph.row.id),
            eq(productionProcess.organizationId, context.organizationId),
          ),
        );
      await tx
        .delete(productionPhoto)
        .where(
          and(
            eq(productionPhoto.productionId, graph.row.id),
            eq(productionPhoto.organizationId, context.organizationId),
          ),
        );
    }
    const hasProduction =
      input.areaSqm !== null ||
      input.workshopCount !== null ||
      input.utilisationPercent !== null ||
      input.processEntryIds.length > 0 ||
      input.photoIds.length > 0;
    if (hasProduction) {
      const fields = {
        areaSqm: input.areaSqm,
        workshopCount: input.workshopCount,
        utilisationPercent: input.utilisationPercent,
      };
      const [saved] = await tx
        .insert(production)
        .values({ sectionRevisionId: context.revisionId, organizationId: context.organizationId, ...fields })
        .onConflictDoUpdate({ target: production.sectionRevisionId, set: fields })
        .returning({ id: production.id });
      for (const batch of chunks(input.processEntryIds))
        await tx.insert(productionProcess).values(
          batch.map((processEntryId) => ({
            productionId: saved!.id,
            organizationId: context.organizationId,
            processEntryId,
          })),
        );
      for (let i = 0; i < input.photoIds.length; i += 1000)
        await tx.insert(productionPhoto).values(
          input.photoIds.slice(i, i + 1000).map((fileObjectId, index) => ({
            productionId: saved!.id,
            organizationId: context.organizationId,
            fileObjectId,
            positionInList: i + index,
          })),
        );
    } else if (graph.row)
      await tx
        .delete(production)
        .where(and(eq(production.id, graph.row.id), eq(production.organizationId, context.organizationId)));
    for (let i = 0; i < input.equipment.length; i += 1000) {
      const rows = input.equipment.slice(i, i + 1000);
      const inserted = await tx
        .insert(equipmentItem)
        .values(
          rows.map((row, index) => ({
            sectionRevisionId: context.revisionId,
            organizationId: context.organizationId,
            name: row.name,
            equipmentTypeId: row.typeId,
            quantity: row.quantity,
            photoFileId: row.photoId,
            positionInList: i + index,
          })),
        )
        .returning({ id: equipmentItem.id, positionInList: equipmentItem.positionInList });
      const itemIds = new Map(inserted.map((row) => [row.positionInList, row.id]));
      const links = rows.flatMap((row, index) =>
        row.productIdentityIds.map((productLineIdentityId) => ({
          equipmentItemId: itemIds.get(i + index)!,
          organizationId: context.organizationId,
          productLineIdentityId,
        })),
      );
      for (const batch of chunks(links)) await tx.insert(equipmentProductLine).values(batch);
    }
  }
  /** MAN-26/41: optional production details never change the six-section profile average. */
  async mandatoryInputs(_tx: Database, _context: SectionContext): Promise<CompletenessInput[]> {
    return [];
  }
}
