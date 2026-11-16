import {
  DOCUMENT_REQUIRED_CODES,
  documentsReadSchema,
  documentsWriteSchema,
  type CompletenessInput,
  type DocumentsRead,
  type DocumentsWrite,
  type ProfileDocumentType,
} from '@imbc/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import {
  dictionary,
  dictionaryEntry,
  dictionaryEntryTranslation,
  document,
  documentIdentity,
  sectionRevision,
  submissionRequirement,
} from '../../database/schema/index.js';
import { profileFileComplete, profileFiles, validateProfileFileBindings } from './profile-files.js';
import { sectionFieldError } from './section-errors.js';
import type { SectionContext, TypedSectionHandler } from './section-handler.js';

/** MAN-37–40 / ADM-09: ordered partial drafts, stable own-profile identities and immutable submitted requirements. */
@Injectable()
export class DocumentsHandler implements TypedSectionHandler<DocumentsWrite, DocumentsRead> {
  readonly kind = 'documents' as const;
  readonly readSchema = documentsReadSchema;

  parse(input: unknown): DocumentsWrite {
    return documentsWriteSchema.parse(input);
  }

  private rows(tx: Database, context: SectionContext) {
    return tx
      .select({
        identityId: document.identityId,
        documentTypeId: document.documentTypeId,
        customName: document.customName,
        fileId: document.fileObjectId,
        status: document.status,
      })
      .from(document)
      .innerJoin(
        documentIdentity,
        and(
          eq(documentIdentity.id, document.identityId),
          eq(documentIdentity.organizationId, document.organizationId),
          eq(documentIdentity.profileId, context.profileId),
        ),
      )
      .where(
        and(eq(document.sectionRevisionId, context.revisionId), eq(document.organizationId, context.organizationId)),
      )
      .orderBy(asc(document.positionInList), asc(document.id));
  }

  async editable(tx: Database, context: SectionContext): Promise<DocumentsWrite> {
    return { documents: (await this.rows(tx, context)).map(({ status: _status, ...row }) => row) };
  }

  private async types(tx: Database, ids: readonly string[]): Promise<Map<string, ProfileDocumentType>> {
    const result = new Map<string, ProfileDocumentType>();
    if (ids.length === 0) return result;
    const rows = await tx
      .select({
        id: dictionaryEntry.id,
        code: dictionaryEntry.code,
        customNameAllowed: dictionaryEntry.customNameAllowed,
        language: dictionaryEntryTranslation.language,
        name: dictionaryEntryTranslation.name,
      })
      .from(dictionaryEntry)
      .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
      .leftJoin(dictionaryEntryTranslation, eq(dictionaryEntryTranslation.dictionaryEntryId, dictionaryEntry.id))
      .where(and(eq(dictionary.code, 'document_type'), inArray(dictionaryEntry.id, [...new Set(ids)])));
    for (const row of rows) {
      let entry = result.get(row.id);
      if (!entry) {
        entry = {
          id: row.id,
          code: row.code,
          customNameAllowed: row.customNameAllowed,
          names: { kk: null, ru: null, en: null },
        };
        result.set(row.id, entry);
      }
      if (row.language && row.name) entry.names[row.language] = row.name;
    }
    return result;
  }

  async read(tx: Database, context: SectionContext): Promise<DocumentsRead> {
    const rows = await this.rows(tx, context);
    const [revision] = await tx
      .select({ state: sectionRevision.state, submittedAt: sectionRevision.submittedAt })
      .from(sectionRevision)
      .where(
        and(eq(sectionRevision.id, context.revisionId), eq(sectionRevision.organizationId, context.organizationId)),
      );
    const isWorking = revision?.state === 'working' && revision.submittedAt === null;
    // Mandatory flags are read only for a new working submission. Frozen membership comes solely from its capture.
    const requirements = isWorking
      ? await tx
          .select({ id: dictionaryEntry.id })
          .from(dictionaryEntry)
          .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
          .where(
            and(
              eq(dictionary.code, 'document_type'),
              or(
                inArray(sql`lower(${dictionaryEntry.code})`, [...DOCUMENT_REQUIRED_CODES]),
                and(eq(dictionaryEntry.mandatory, true), isNull(dictionaryEntry.retiredAt)),
              ),
            ),
          )
          .orderBy(asc(dictionaryEntry.sortOrder), asc(dictionaryEntry.code), asc(dictionaryEntry.id))
      : await tx
          .select({ id: submissionRequirement.dictionaryEntryId })
          .from(submissionRequirement)
          .innerJoin(dictionaryEntry, eq(dictionaryEntry.id, submissionRequirement.dictionaryEntryId))
          .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
          .where(
            and(
              eq(submissionRequirement.sectionRevisionId, context.revisionId),
              eq(submissionRequirement.organizationId, context.organizationId),
              eq(dictionary.code, 'document_type'),
            ),
          )
          .orderBy(asc(dictionaryEntry.sortOrder), asc(dictionaryEntry.code), asc(dictionaryEntry.id));
    const types = await this.types(tx, [
      ...requirements.map(({ id }) => id),
      ...rows.flatMap((row) => (row.documentTypeId ? [row.documentTypeId] : [])),
    ]);
    const files = new Map(
      (
        await profileFiles(
          tx,
          context,
          rows.flatMap((row) => (row.fileId ? [row.fileId] : [])),
        )
      ).map((file) => [file.fileId, file]),
    );
    return {
      editable: { documents: rows.map(({ status: _status, ...row }) => row) },
      documents: rows.map((row) => ({
        identityId: row.identityId,
        documentType: row.documentTypeId ? (types.get(row.documentTypeId) ?? null) : null,
        status: row.fileId === null ? 'missing' : revision?.state === 'submitted' ? 'under_review' : row.status,
        file: row.fileId ? (files.get(row.fileId) ?? null) : null,
      })),
      requiredTypes: requirements.flatMap(({ id }) => (types.get(id) ? [types.get(id)!] : [])),
      requirementSource: isWorking ? 'current' : 'submission',
    };
  }

  async save(tx: Database, context: SectionContext, input: DocumentsWrite): Promise<void> {
    const previous = new Map((await this.rows(tx, context)).map((row) => [row.identityId, row]));
    const ids = input.documents.map((row) => row.identityId).sort();
    if (ids.length > 0) {
      const found = await tx
        .select()
        .from(documentIdentity)
        .where(inArray(documentIdentity.id, ids))
        .orderBy(asc(documentIdentity.id))
        .for('share');
      const identities = new Map(found.map((row) => [row.id, row]));
      for (let index = 0; index < input.documents.length; index++) {
        const row = identities.get(input.documents[index]!.identityId);
        if (row && (row.profileId !== context.profileId || row.organizationId !== context.organizationId))
          throw sectionFieldError(`documents.${index}.identityId`, 'identity_invalid');
      }
      const missing = ids.filter((id) => !identities.has(id));
      if (missing.length > 0) {
        // An existing identity of another section kind must not become a new document identity.
        const { rows: otherKinds } = await tx.execute<{ id: string }>(sql`
          select id from production_site_identity where id = any(${sql.param(missing)}::uuid[])
          union all select id from product_line_identity where id = any(${sql.param(missing)}::uuid[])
          union all select id from certificate_identity where id = any(${sql.param(missing)}::uuid[])`);
        const conflicting = new Set(otherKinds.map(({ id }) => id));
        const index = input.documents.findIndex((row) => conflicting.has(row.identityId));
        if (index !== -1) throw sectionFieldError(`documents.${index}.identityId`, 'identity_invalid');
        for (let start = 0; start < missing.length; start += 1000)
          await tx
            .insert(documentIdentity)
            .values(
              missing.slice(start, start + 1000).map((id) => ({
                id,
                profileId: context.profileId,
                organizationId: context.organizationId,
              })),
            )
            .onConflictDoNothing();
        // The PK may have been inserted concurrently by another tenant while this new UUID was absent.
        const created = await tx
          .select()
          .from(documentIdentity)
          .where(inArray(documentIdentity.id, missing))
          .orderBy(asc(documentIdentity.id))
          .for('share');
        const checked = new Map(created.map((row) => [row.id, row]));
        for (let index = 0; index < input.documents.length; index++) {
          const item = input.documents[index]!;
          if (identities.has(item.identityId)) continue;
          const row = checked.get(item.identityId);
          if (!row || row.profileId !== context.profileId || row.organizationId !== context.organizationId)
            throw sectionFieldError(`documents.${index}.identityId`, 'identity_invalid');
        }
      }
    }
    const typeIds = [
      ...new Set(input.documents.flatMap((row) => (row.documentTypeId ? [row.documentTypeId] : []))),
    ].sort();
    const entries =
      typeIds.length === 0
        ? []
        : await tx
            .select({
              id: dictionaryEntry.id,
              retiredAt: dictionaryEntry.retiredAt,
              customNameAllowed: dictionaryEntry.customNameAllowed,
            })
            .from(dictionaryEntry)
            .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
            .where(and(eq(dictionary.code, 'document_type'), inArray(dictionaryEntry.id, typeIds)))
            .orderBy(asc(dictionaryEntry.id))
            .for('share', { of: dictionaryEntry });
    const selectedTypes = new Map(entries.map((row) => [row.id, row]));
    for (let index = 0; index < input.documents.length; index++) {
      const row = input.documents[index]!;
      if (!row.documentTypeId) continue;
      const type = selectedTypes.get(row.documentTypeId);
      if (!type) throw sectionFieldError(`documents.${index}.documentTypeId`, 'reference_invalid');
      if (type.retiredAt !== null && previous.get(row.identityId)?.documentTypeId !== row.documentTypeId)
        throw sectionFieldError(`documents.${index}.documentTypeId`, 'reference_retired');
      if (row.customName !== null && !type.customNameAllowed)
        throw sectionFieldError(`documents.${index}.customName`, 'custom_name_not_allowed');
    }
    await validateProfileFileBindings(
      tx,
      context,
      input.documents.flatMap((row, index) =>
        row.fileId
          ? [
              {
                fileId: row.fileId,
                purposes: ['document_file'] as const,
                path: `documents.${index}.fileId`,
              },
            ]
          : [],
      ),
    );
    await tx
      .delete(document)
      .where(
        and(eq(document.sectionRevisionId, context.revisionId), eq(document.organizationId, context.organizationId)),
      );
    for (let start = 0; start < input.documents.length; start += 1000)
      await tx.insert(document).values(
        input.documents.slice(start, start + 1000).map((row, index) => {
          const old = previous.get(row.identityId);
          const unchanged =
            old &&
            old.documentTypeId === row.documentTypeId &&
            old.customName === row.customName &&
            old.fileId === row.fileId;
          return {
            sectionRevisionId: context.revisionId,
            organizationId: context.organizationId,
            identityId: row.identityId,
            positionInList: start + index,
            documentTypeId: row.documentTypeId,
            customName: row.customName,
            fileObjectId: row.fileId,
            status: unchanged ? old.status : ('uploaded' as const),
          };
        }),
      );
  }

  async mandatoryInputs(tx: Database, context: SectionContext): Promise<CompletenessInput[]> {
    const data = await this.read(tx, context);
    const fields: CompletenessInput[] = [];
    const presentCodes = new Set(data.requiredTypes.map((type) => type.code.toLowerCase()));
    for (const code of DOCUMENT_REQUIRED_CODES)
      if (!presentCodes.has(code))
        fields.push({
          path: `requiredTypes.${code}`,
          code: data.requirementSource === 'submission' ? 'requirements_snapshot_missing' : 'document_type_unavailable',
          satisfied: false,
        });
    data.requiredTypes.forEach((type, requirementIndex) => {
      const satisfied = data.editable.documents.some(
        (row, index) =>
          row.documentTypeId === type.id &&
          (!type.customNameAllowed || row.customName !== null) &&
          Boolean(data.documents[index]?.file && profileFileComplete(data.documents[index]!.file!)),
      );
      fields.push({ path: `requiredTypes.${requirementIndex}`, code: 'document_type_required', satisfied });
    });
    // Optional additional documents do not lower MAN-41 completeness; Send validates selected row semantics separately.
    return fields;
  }
}
