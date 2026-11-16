import {
  certificateEditorChoicesSchema,
  certificatesReadSchema,
  certificatesWriteSchema,
  COMPANY_ISO_CODES,
  PLATFORM_TIMEZONE,
  type CertificatesRead,
  type CertificatesWrite,
  type CompletenessInput,
  type ProfileCertificateType,
} from '@imbc/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import {
  certificate,
  certificateIdentity,
  dictionary,
  dictionaryEntry,
  dictionaryEntryTranslation,
  sectionRevision,
  submissionRequirement,
} from '../../database/schema/index.js';
import { profileFiles, validateProfileFileBindings } from './profile-files.js';
import { sectionFieldError } from './section-errors.js';
import type { SectionContext, TypedSectionHandler } from './section-handler.js';
import { profileCandidateRevisionSql } from './profile-candidate.js';
import { currentRequirementIds } from './submission-requirements.js';
import { profileItemReviews, profileItemStatus } from './profile-item-review.js';

const companyIso = (code: string) => COMPANY_ISO_CODES.some((item) => item.toLowerCase() === code.toLowerCase());
const calendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: PLATFORM_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export function certificateToday(at: Date): string {
  const parts = calendar.formatToParts(at);
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)!.value).join('-');
}

/** MAN-33–36: stable shared certificates, immutable submitted evidence, and explicit company ISO absence. */
@Injectable()
export class CertificatesHandler implements TypedSectionHandler<CertificatesWrite, CertificatesRead> {
  readonly kind = 'certificates' as const;
  readonly readSchema = certificatesReadSchema;
  readonly editorChoicesSchema = certificateEditorChoicesSchema;
  parse(input: unknown): CertificatesWrite {
    return certificatesWriteSchema.parse(input);
  }

  private rows(tx: Database, context: SectionContext) {
    return tx
      .select({
        identityId: certificate.identityId,
        group: certificate.group,
        certificateTypeId: certificate.certificateTypeId,
        customTypeName: certificate.customTypeName,
        notHeld: certificate.notHeld,
        number: certificate.number,
        issuingBody: certificate.issuingBody,
        issuedOn: certificate.issuedOn,
        expiresOn: certificate.expiresOn,
        fileId: certificate.fileObjectId,
        status: certificate.status,
      })
      .from(certificate)
      .innerJoin(
        certificateIdentity,
        and(
          eq(certificateIdentity.id, certificate.identityId),
          eq(certificateIdentity.organizationId, certificate.organizationId),
          eq(certificateIdentity.profileId, context.profileId),
        ),
      )
      .where(
        and(
          eq(certificate.sectionRevisionId, context.revisionId),
          eq(certificate.organizationId, context.organizationId),
        ),
      )
      .orderBy(asc(certificate.positionInList), asc(certificate.id));
  }
  async editable(tx: Database, context: SectionContext): Promise<CertificatesWrite> {
    return { certificates: (await this.rows(tx, context)).map(({ status: _status, ...row }) => row) };
  }
  private async types(tx: Database, ids: readonly string[]) {
    const types = new Map<string, ProfileCertificateType>();
    if (ids.length === 0) return types;
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
      .where(and(eq(dictionary.code, 'certificate_type'), inArray(dictionaryEntry.id, [...new Set(ids)])));
    for (const row of rows) {
      let type = types.get(row.id);
      if (!type) {
        type = {
          id: row.id,
          code: row.code,
          customNameAllowed: row.customNameAllowed,
          names: { en: null, ru: null, kk: null },
        };
        types.set(row.id, type);
      }
      if (row.language && row.name) type.names[row.language] = row.name;
    }
    return types;
  }
  async editorChoices(tx: Database) {
    const ids = await currentRequirementIds(tx, 'certificates');
    const types = await this.types(tx, ids);
    return { requiredTypes: ids.flatMap((id) => (types.get(id) ? [types.get(id)!] : [])) };
  }
  async read(tx: Database, context: SectionContext): Promise<CertificatesRead> {
    const rows = await this.rows(tx, context);
    const [revision] = await tx
      .select({ state: sectionRevision.state, submittedAt: sectionRevision.submittedAt })
      .from(sectionRevision)
      .where(
        and(eq(sectionRevision.id, context.revisionId), eq(sectionRevision.organizationId, context.organizationId)),
      );
    const working = revision?.state === 'working' && revision.submittedAt === null;
    const requirements = working
      ? (await currentRequirementIds(tx, 'certificates')).map((id) => ({ id }))
      : await tx
          .select({ id: submissionRequirement.dictionaryEntryId })
          .from(submissionRequirement)
          .innerJoin(dictionaryEntry, eq(dictionaryEntry.id, submissionRequirement.dictionaryEntryId))
          .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
          .where(
            and(
              eq(submissionRequirement.sectionRevisionId, context.revisionId),
              eq(submissionRequirement.organizationId, context.organizationId),
              eq(dictionary.code, 'certificate_type'),
            ),
          )
          .orderBy(asc(dictionaryEntry.sortOrder), asc(dictionaryEntry.code), asc(dictionaryEntry.id));
    const types = await this.types(tx, [
      ...requirements.map((row) => row.id),
      ...rows.flatMap((row) => (row.certificateTypeId ? [row.certificateTypeId] : [])),
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
    const today = certificateToday(new Date());
    const reviews = working ? new Map() : await profileItemReviews(tx, context, 'certificate');
    return {
      editable: { certificates: rows.map(({ status: _status, ...row }) => row) },
      certificates: rows.map((row) => ({
        identityId: row.identityId,
        certificateType: row.certificateTypeId ? (types.get(row.certificateTypeId) ?? null) : null,
        // Expiry is a projection, including drafts. No scheduled job rewrites frozen certificate rows.
        status: row.notHeld
          ? null
          : row.expiresOn !== null && row.expiresOn < today
            ? 'expired'
            : profileItemStatus({
                fileId: row.fileId,
                file: row.fileId ? (files.get(row.fileId) ?? null) : null,
                state: revision?.state,
                legacyStatus: row.status,
                review: reviews.get(row.identityId),
              }),
        file: row.fileId ? (files.get(row.fileId) ?? null) : null,
      })),
      requiredTypes: requirements.flatMap((row) => (types.get(row.id) ? [types.get(row.id)!] : [])),
      requirementSource: working ? 'current' : 'submission',
    };
  }
  async save(tx: Database, context: SectionContext, input: CertificatesWrite): Promise<void> {
    const previous = new Map((await this.rows(tx, context)).map((row) => [row.identityId, row]));
    // The current producer graph includes retained candidates; historical copies do not block edits.
    const { rows: linked } = await tx.execute<{ identityId: string }>(sql`
      select distinct link.certificate_identity_id as "identityId" from profile_section s
      join section_revision r on r.id=${profileCandidateRevisionSql('s')}
        and r.organization_id=s.organization_id and r.profile_section_id=s.id
      join product_line p on p.section_revision_id=r.id and p.organization_id=r.organization_id
      join product_line_certificate link on link.product_line_id=p.id and link.organization_id=p.organization_id
      where s.profile_id=${context.profileId} and s.organization_id=${context.organizationId} and s.kind='products'`);
    const next = new Map(input.certificates.map((row) => [row.identityId, row]));
    for (const { identityId } of linked) {
      const row = next.get(identityId);
      if (!row || row.group !== 'product' || row.notHeld) throw sectionFieldError('certificates', 'certificate_in_use');
    }
    const ids = input.certificates.map((row) => row.identityId).sort();
    if (ids.length > 0) {
      const known = await tx
        .select()
        .from(certificateIdentity)
        .where(inArray(certificateIdentity.id, ids))
        .orderBy(asc(certificateIdentity.id))
        .for('share');
      const identities = new Map(known.map((row) => [row.id, row]));
      const missing = ids.filter((id) => !identities.has(id));
      if (missing.length > 0) {
        const { rows: conflicts } = await tx.execute<{ id: string }>(sql`
          select id from production_site_identity where id=any(${sql.param(missing)}::uuid[])
          union all select id from product_line_identity where id=any(${sql.param(missing)}::uuid[])
          union all select id from document_identity where id=any(${sql.param(missing)}::uuid[])`);
        const conflictIds = new Set(conflicts.map((row) => row.id));
        const index = input.certificates.findIndex((row) => conflictIds.has(row.identityId));
        if (index !== -1) throw sectionFieldError(`certificates.${index}.identityId`, 'identity_invalid');
        for (let i = 0; i < missing.length; i += 1000)
          await tx
            .insert(certificateIdentity)
            .values(
              missing
                .slice(i, i + 1000)
                .map((id) => ({ id, profileId: context.profileId, organizationId: context.organizationId })),
            )
            .onConflictDoNothing();
        const created = await tx
          .select()
          .from(certificateIdentity)
          .where(inArray(certificateIdentity.id, missing))
          .orderBy(asc(certificateIdentity.id))
          .for('share');
        for (const row of created) identities.set(row.id, row);
      }
      input.certificates.forEach((item, index) => {
        const identity = identities.get(item.identityId);
        if (!identity || identity.profileId !== context.profileId || identity.organizationId !== context.organizationId)
          throw sectionFieldError(`certificates.${index}.identityId`, 'identity_invalid');
      });
    }
    const typeIds = [
      ...new Set(input.certificates.flatMap((row) => (row.certificateTypeId ? [row.certificateTypeId] : []))),
    ].sort();
    const entries =
      typeIds.length === 0
        ? []
        : await tx
            .select({
              id: dictionaryEntry.id,
              code: dictionaryEntry.code,
              retiredAt: dictionaryEntry.retiredAt,
              customNameAllowed: dictionaryEntry.customNameAllowed,
            })
            .from(dictionaryEntry)
            .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
            .where(and(eq(dictionary.code, 'certificate_type'), inArray(dictionaryEntry.id, typeIds)))
            .orderBy(asc(dictionaryEntry.id))
            .for('share', { of: dictionaryEntry });
    const types = new Map(entries.map((row) => [row.id, row]));
    const companyTypeCounts = new Map<string, number>();
    for (const row of input.certificates)
      if (row.group === 'company' && row.certificateTypeId)
        companyTypeCounts.set(row.certificateTypeId, (companyTypeCounts.get(row.certificateTypeId) ?? 0) + 1);
    input.certificates.forEach((row, index) => {
      const type = row.certificateTypeId ? types.get(row.certificateTypeId) : null;
      if (row.certificateTypeId && !type)
        throw sectionFieldError(`certificates.${index}.certificateTypeId`, 'reference_invalid');
      if (type?.retiredAt && previous.get(row.identityId)?.certificateTypeId !== row.certificateTypeId)
        throw sectionFieldError(`certificates.${index}.certificateTypeId`, 'reference_retired');
      if (type && !type.customNameAllowed && row.customTypeName !== null)
        throw sectionFieldError(`certificates.${index}.customTypeName`, 'custom_name_not_allowed');
      if (row.notHeld && (row.group !== 'company' || !type || !companyIso(type.code)))
        throw sectionFieldError(`certificates.${index}.notHeld`, 'absence_not_allowed');
      if (row.notHeld && (companyTypeCounts.get(row.certificateTypeId!) ?? 0) > 1)
        throw sectionFieldError(`certificates.${index}.notHeld`, 'absence_conflict');
    });
    await validateProfileFileBindings(
      tx,
      context,
      input.certificates.flatMap((row, index) =>
        row.fileId
          ? [
              {
                fileId: row.fileId,
                purposes:
                  row.group === 'product'
                    ? (['certificate_file', 'conformity_certificate'] as const)
                    : (['certificate_file'] as const),
                path: `certificates.${index}.fileId`,
              },
            ]
          : [],
      ),
    );
    await tx
      .delete(certificate)
      .where(
        and(
          eq(certificate.sectionRevisionId, context.revisionId),
          eq(certificate.organizationId, context.organizationId),
        ),
      );
    for (let i = 0; i < input.certificates.length; i += 1000)
      await tx.insert(certificate).values(
        input.certificates.slice(i, i + 1000).map((row, index) => {
          const old = previous.get(row.identityId);
          const unchanged = old && Object.entries(row).every(([key, value]) => old[key as keyof typeof old] === value);
          const { fileId, ...fields } = row;
          return {
            ...fields,
            sectionRevisionId: context.revisionId,
            organizationId: context.organizationId,
            positionInList: i + index,
            fileObjectId: fileId,
            status: unchanged ? old.status : ('uploaded' as const),
          };
        }),
      );
  }
  async mandatoryInputs(tx: Database, context: SectionContext): Promise<CompletenessInput[]> {
    const data = await this.read(tx, context);
    const fields: CompletenessInput[] = [];
    const requiredCodes = new Set(data.requiredTypes.map((row) => row.code.toLowerCase()));
    const byType = new Map<
      string,
      { row: CertificatesWrite['certificates'][number]; file: CertificatesRead['certificates'][number]['file'] }[]
    >();
    data.editable.certificates.forEach((row, rowIndex) => {
      if (row.group !== 'company' || row.certificateTypeId === null) return;
      const list = byType.get(row.certificateTypeId) ?? [];
      list.push({ row, file: data.certificates[rowIndex]?.file ?? null });
      byType.set(row.certificateTypeId, list);
    });
    for (const code of COMPANY_ISO_CODES)
      if (!requiredCodes.has(code.toLowerCase()))
        fields.push({
          path: `requiredTypes.${code}`,
          code:
            data.requirementSource === 'submission' ? 'requirements_snapshot_missing' : 'certificate_type_unavailable',
          satisfied: false,
        });
    data.requiredTypes.forEach((type, index) => {
      const candidates = byType.get(type.id) ?? [];
      if (companyIso(type.code) && candidates.some(({ row }) => row.notHeld)) return;
      fields.push({
        path: `requiredTypes.${index}`,
        code: 'certificate_type_required',
        satisfied: candidates.some(
          ({ row, file }) =>
            !row.notHeld &&
            row.number !== null &&
            row.issuingBody !== null &&
            row.issuedOn !== null &&
            (!type.customNameAllowed || row.customTypeName !== null) &&
            Boolean(file?.canDownload),
        ),
      });
    });
    return fields;
  }
}
