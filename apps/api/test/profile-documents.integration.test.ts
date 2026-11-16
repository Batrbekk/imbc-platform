import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  documentEditorChoicesSchema,
  ownDocumentsSchema,
  type DocumentsWrite,
  type ProfileDocumentWrite,
  type DataClass,
  type FilePurpose,
} from '@imbc/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { captureRevisionFileVersions } from '../src/modules/files/revision-file-snapshot.js';
import { DocumentsHandler } from '../src/modules/profiles/documents.handler.js';
import { ProfileSectionsController } from '../src/modules/profiles/profile-sections.controller.js';
import { ProfileSectionsService } from '../src/modules/profiles/profile-sections.service.js';
import { defineSectionHandler } from '../src/modules/profiles/section-handler.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp, type HttpStand } from './support/http.js';

const ROOT = '/api/v1/profiles/own/sections/documents';
const blank = (): ProfileDocumentWrite => ({
  identityId: randomUUID(),
  documentTypeId: null,
  customName: null,
  fileId: null,
});
const empty = (): DocumentsWrite => ({ documents: [] });

describe.skipIf(!process.env.TEST_DATABASE_URL)('MAN-37–39 documents through actual HTTP and PostgreSQL', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;
  let db: Database;
  let http: HttpStand;
  let profile: typeof s.manufacturerProfile.$inferSelect;
  let foreignProfile: typeof s.manufacturerProfile.$inferSelect;
  let accountId: string;
  let typeIds: Record<string, string>;
  let foreignTypeId: string;
  let binSeed = 0;

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema: s, casing: 'snake_case' });
    const [dictionary] = await db.select().from(s.dictionary).where(eq(s.dictionary.code, 'document_type'));
    const codes = ['registration_certificate', 'charter', 'additional_document', 'financial_statements', 'licence'];
    await db
      .insert(s.dictionaryEntry)
      .values(
        codes.map((code, index) => ({
          dictionaryId: dictionary!.id,
          code,
          mandatory: false,
          sortOrder: index,
          customNameAllowed: code === 'additional_document',
        })),
      )
      .onConflictDoNothing();
    const types = await db
      .select()
      .from(s.dictionaryEntry)
      .where(and(eq(s.dictionaryEntry.dictionaryId, dictionary!.id), inArray(s.dictionaryEntry.code, codes)));
    typeIds = Object.fromEntries(types.map((entry) => [entry.code, entry.id]));
    for (const language of ['kk', 'ru', 'en'] as const)
      await db
        .insert(s.dictionaryEntryTranslation)
        .values(
          types.map((entry) => ({ dictionaryEntryId: entry.id, language, name: `Fixture ${entry.code} ${language}` })),
        )
        .onConflictDoNothing();
    const [certificateDictionary] = await db
      .select()
      .from(s.dictionary)
      .where(eq(s.dictionary.code, 'certificate_type'));
    const [foreignType] = await db
      .insert(s.dictionaryEntry)
      .values({ dictionaryId: certificateDictionary!.id, code: `fixture_${randomUUID()}`, mandatory: false })
      .returning();
    foreignTypeId = foreignType!.id;
  }, 60000);

  beforeEach(async () => {
    await db
      .update(s.dictionaryEntry)
      .set({ mandatory: false, retiredAt: null })
      .where(inArray(s.dictionaryEntry.id, Object.values(typeIds)));
    // A historical licence type is not a new choice or mandatory Phase-1 block.
    await db
      .update(s.dictionaryEntry)
      .set({ mandatory: true, retiredAt: new Date() })
      .where(eq(s.dictionaryEntry.id, typeIds.licence!));
    const suffix = randomUUID();
    const [org] = await db
      .insert(s.organizations)
      .values({ type: 'manufacturer', name: `Documents ${suffix}`, bin: `2414${String(++binSeed).padStart(8, '0')}` })
      .returning();
    const [foreignOrg] = await db
      .insert(s.organizations)
      .values({
        type: 'manufacturer',
        name: `Other documents ${suffix}`,
        bin: `2414${String(++binSeed).padStart(8, '0')}`,
      })
      .returning();
    const [account] = await db
      .insert(s.userAccounts)
      .values({
        organizationId: org!.id,
        role: 'manufacturer',
        state: 'active',
        email: `documents-${suffix}@fixture.local`,
      })
      .returning();
    accountId = account!.id;
    const [created] = await db.insert(s.manufacturerProfile).values({ organizationId: org!.id }).returning();
    const [other] = await db.insert(s.manufacturerProfile).values({ organizationId: foreignOrg!.id }).returning();
    profile = created!;
    foreignProfile = other!;
    const service = new ProfileSectionsService(pool, new AuditService(db), [
      defineSectionHandler(new DocumentsHandler()),
    ]);
    http = await startHttp({
      controllers: [ProfileSectionsController],
      providers: [{ provide: ProfileSectionsService, useValue: service }],
      organizationId: org!.id,
      accountIds: { manufacturer: account!.id },
    });
  });
  afterEach(async () => {
    await http?.close();
  });
  afterAll(async () => {
    await pool?.end();
  });

  const read = async () => ownDocumentsSchema.parse(await (await http.get(ROOT, 'manufacturer')).json());
  const save = (data: unknown, editVersion = 0) => http.send('PUT', ROOT, 'manufacturer', { editVersion, data });
  const file = async (
    state: 'pending' | 'passed' | 'rejected' = 'passed',
    purpose: FilePurpose = 'document_file',
    organizationId = profile.organizationId,
    dataClass: DataClass = 'b_manufacturer',
  ) => {
    const [object] = await db.insert(s.fileObject).values({ organizationId, purpose, dataClass }).returning();
    const [version] = await db
      .insert(s.fileVersion)
      .values({
        fileObjectId: object!.id,
        versionNumber: 1,
        originalName: 'Private document fixture.pdf',
        byteSize: 100,
        declaredMediaType: 'application/pdf',
        detectedMediaType: 'application/pdf',
        checksum: 'a'.repeat(64),
        scanState: state,
        rejectionReason: state === 'rejected' ? 'malware' : null,
        uploadedBy: accountId,
        storageKey: randomUUID(),
      })
      .returning();
    return { object: object!, version: version! };
  };
  const baseline = async () => {
    const registration = await file();
    const charter = await file();
    return {
      files: [registration, charter],
      data: {
        documents: [
          { ...blank(), documentTypeId: typeIds.registration_certificate!, fileId: registration.object.id },
          { ...blank(), documentTypeId: typeIds.charter!, fileId: charter.object.id },
        ],
      } satisfies DocumentsWrite,
    };
  };
  const context = async (revisionId: string) => {
    const [section] = await db
      .select()
      .from(s.profileSection)
      .where(and(eq(s.profileSection.profileId, profile.id), eq(s.profileSection.kind, 'documents')));
    return { profileId: profile.id, organizationId: profile.organizationId, sectionId: section!.id, revisionId };
  };
  const freeze = async (
    revisionId: string,
    state: 'submitted' | 'verified' | 'rejected' = 'verified',
    options: { captureFiles?: boolean; requirementIds?: string[] } = {},
  ) => {
    const ctx = await context(revisionId);
    const current = await read();
    await db.transaction(async (tx) => {
      if (options.captureFiles !== false)
        await captureRevisionFileVersions(tx as Database, {
          sectionRevisionId: revisionId,
          organizationId: profile.organizationId,
        });
      const requirements = options.requirementIds ?? current.data.requiredTypes.map((type) => type.id);
      if (requirements.length > 0)
        await tx.insert(s.submissionRequirement).values(
          requirements.map((dictionaryEntryId) => ({
            sectionRevisionId: revisionId,
            organizationId: profile.organizationId,
            dictionaryEntryId,
            capturedAt: new Date(),
          })),
        );
      await tx
        .update(s.sectionRevision)
        .set({ state: 'submitted', submittedAt: new Date() })
        .where(eq(s.sectionRevision.id, revisionId));
      await tx
        .update(s.profileSection)
        .set({
          workingRevisionId: null,
          pendingRevisionId: state === 'submitted' ? revisionId : null,
          verifiedRevisionId: state === 'verified' ? revisionId : null,
        })
        .where(eq(s.profileSection.id, ctx.sectionId));
      if (state !== 'submitted')
        await tx.update(s.sectionRevision).set({ state }).where(eq(s.sectionRevision.id, revisionId));
      await tx
        .update(s.manufacturerProfile)
        .set({ status: state === 'rejected' ? 'returned' : state })
        .where(eq(s.manufacturerProfile.id, profile.id));
    });
    return ctx;
  };

  it('always requires registration and charter, independent of mutable mandatory flags, with no licence block', async () => {
    const initial = await read();
    expect(initial).toMatchObject({
      editVersion: 0,
      completeness: { percent: 0 },
      data: { editable: empty(), documents: [], requirementSource: 'current' },
    });
    expect(initial.data.requiredTypes.map((type) => type.code)).toEqual(['registration_certificate', 'charter']);
    expect(initial.data.requiredTypes[0]?.names).toMatchObject({
      kk: 'Fixture registration_certificate kk',
      ru: 'Fixture registration_certificate ru',
      en: 'Fixture registration_certificate en',
    });
    const noOp = ownDocumentsSchema.parse(await (await save(empty())).json());
    expect(noOp).toMatchObject({ editVersion: 0, savedAt: null });
  });

  it('saves partial rows and excludes optional additional row name/file from required completeness', async () => {
    const base = await baseline();
    const partial = { ...blank(), documentTypeId: typeIds.additional_document!, customName: '   ' };
    const response = await save({ documents: [...base.data.documents, partial] });
    expect(response.status).toBe(200);
    const result = ownDocumentsSchema.parse(await response.json());
    expect(result.completeness).toEqual({ percent: 100, missing: [] });
    expect(result.data.editable.documents[2]).toMatchObject({ customName: null, fileId: null });
    expect(result.data.documents[2]).toMatchObject({ identityId: partial.identityId, status: 'missing', file: null });
  });

  it.each(['pending', 'rejected'] as const)(
    'a %s required document remains incomplete and unreadable until its scan passes',
    async (state) => {
      const registration = await file(state);
      const charter = await file();
      const result = ownDocumentsSchema.parse(
        await (
          await save({
            documents: [
              { ...blank(), documentTypeId: typeIds.registration_certificate!, fileId: registration.object.id },
              { ...blank(), documentTypeId: typeIds.charter!, fileId: charter.object.id },
            ],
          })
        ).json(),
      );
      expect(result.completeness.percent).toBe(50);
      expect(result.data.documents[0]?.file).toMatchObject({
        scanState: state,
        canDownload: false,
        rejectionReason: state === 'rejected' ? 'malware' : null,
      });
      await db
        .update(s.fileVersion)
        .set({ scanState: 'passed', rejectionReason: null, scannedAt: new Date() })
        .where(eq(s.fileVersion.id, registration.version.id));
      expect((await read()).completeness).toEqual({ percent: 100, missing: [] });
    },
  );

  it('applies newly required administrator types to working drafts and requires a custom name when the type allows it', async () => {
    const base = await baseline();
    const first = ownDocumentsSchema.parse(await (await save(base.data)).json());
    expect(first.completeness.percent).toBe(100);
    await db
      .update(s.dictionaryEntry)
      .set({ mandatory: true })
      .where(eq(s.dictionaryEntry.id, typeIds.additional_document!));
    expect((await read()).completeness.percent).toBeCloseTo(66.6666666667);
    const additional = await file();
    const second = ownDocumentsSchema.parse(
      await (
        await save(
          {
            documents: [
              ...base.data.documents,
              { ...blank(), documentTypeId: typeIds.additional_document!, fileId: additional.object.id },
            ],
          },
          first.editVersion,
        )
      ).json(),
    );
    expect(second.completeness.percent).toBeCloseTo(66.6666666667);
    const rows = second.data.editable.documents.map((row, index) =>
      index === 2 ? { ...row, customName: '  Additional evidence  ' } : row,
    );
    const third = ownDocumentsSchema.parse(await (await save({ documents: rows }, second.editVersion)).json());
    expect(third.completeness.percent).toBe(100);
    expect(third.data.editable.documents[2]?.customName).toBe('Additional evidence');
  });

  it('an administrator retirement hides new requirements but a captured required type survives later flag changes and retirement', async () => {
    const base = await baseline();
    const extra = await file();
    await db
      .update(s.dictionaryEntry)
      .set({ mandatory: true })
      .where(eq(s.dictionaryEntry.id, typeIds.financial_statements!));
    const first = ownDocumentsSchema.parse(
      await (
        await save({
          documents: [
            ...base.data.documents,
            { ...blank(), documentTypeId: typeIds.financial_statements!, fileId: extra.object.id },
          ],
        })
      ).json(),
    );
    await freeze(first.revisionId!);
    await db
      .update(s.dictionaryEntry)
      .set({ mandatory: false, retiredAt: new Date() })
      .where(eq(s.dictionaryEntry.id, typeIds.financial_statements!));
    const frozen = await read();
    expect(frozen.data.requirementSource).toBe('submission');
    expect(frozen.data.requiredTypes.map((type) => type.id)).toContain(typeIds.financial_statements);
    expect(frozen.completeness.percent).toBe(100);
    const replacement = await file();
    const changed = ownDocumentsSchema.parse(
      await (
        await save(
          {
            documents: first.data.editable.documents.map((row, index) =>
              index === 0 ? { ...row, fileId: replacement.object.id } : row,
            ),
          },
          first.editVersion,
        )
      ).json(),
    );
    expect(changed.data.requirementSource).toBe('current');
    expect(changed.data.requiredTypes.map((type) => type.id)).not.toContain(typeIds.financial_statements);
    expect(changed.completeness.percent).toBe(100);
    expect(
      await db
        .select()
        .from(s.submissionRequirement)
        .where(eq(s.submissionRequirement.sectionRevisionId, changed.revisionId!)),
    ).toEqual([]);
  });

  it('a new administrator requirement never rewrites the frozen submission but applies to its next working copy', async () => {
    const base = await baseline();
    const first = ownDocumentsSchema.parse(await (await save(base.data)).json());
    await freeze(first.revisionId!);
    await db
      .update(s.dictionaryEntry)
      .set({ mandatory: true })
      .where(eq(s.dictionaryEntry.id, typeIds.financial_statements!));
    expect((await read()).data.requiredTypes.map((type) => type.id)).not.toContain(typeIds.financial_statements);
    expect((await read()).completeness.percent).toBe(100);
    const choicesResponse = await http.get(`${ROOT}/choices`, 'manufacturer');
    expect(choicesResponse.status).toBe(200);
    const choices = documentEditorChoicesSchema.parse(await choicesResponse.json());
    expect(choices.requiredTypes.map((type) => type.id)).toContain(typeIds.financial_statements);
    expect(choices.requiredTypes.map((type) => type.id)).not.toContain(typeIds.licence);
    expect(choices.requiredTypes.find((type) => type.id === typeIds.financial_statements)?.names).toEqual({
      kk: 'Fixture financial_statements kk',
      ru: 'Fixture financial_statements ru',
      en: 'Fixture financial_statements en',
    });
    const unchanged = await read();
    expect(unchanged.revisionId).toBe(first.revisionId);
    expect(unchanged.hasWorkingChanges).toBe(false);
    expect(unchanged.data.requiredTypes.map((type) => type.id)).not.toContain(typeIds.financial_statements);
    const withSelector = await http.get(`${ROOT}/choices?profileId=${foreignProfile.id}`, 'manufacturer');
    expect(withSelector.status).toBe(200);
    expect(documentEditorChoicesSchema.parse(await withSelector.json())).toEqual(choices);
    const replacement = await file();
    const changed = ownDocumentsSchema.parse(
      await (
        await save(
          {
            documents: first.data.editable.documents.map((row, index) =>
              index === 0 ? { ...row, fileId: replacement.object.id } : row,
            ),
          },
          first.editVersion,
        )
      ).json(),
    );
    expect(changed.data.requiredTypes.map((type) => type.id)).toContain(typeIds.financial_statements);
    expect(changed.completeness.percent).toBeCloseTo(66.6666666667);
  });

  it('a frozen revision without required-type or file captures fails closed without borrowing today’s state', async () => {
    const base = await baseline();
    const first = ownDocumentsSchema.parse(await (await save(base.data)).json());
    await freeze(first.revisionId!, 'verified', { captureFiles: false, requirementIds: [] });
    const frozen = await read();
    expect(frozen.completeness.percent).toBe(0);
    expect(frozen.completeness.missing.map((item) => item.code)).toEqual([
      'requirements_snapshot_missing',
      'requirements_snapshot_missing',
    ]);
    expect(frozen.data.requiredTypes).toEqual([]);
    expect(frozen.data.documents[0]?.file).toMatchObject({
      fileId: base.files[0]!.object.id,
      versionId: null,
      originalName: null,
      scanState: null,
      canDownload: false,
    });
    expect(JSON.stringify(frozen)).not.toContain(base.files[0]!.version.originalName);
  });

  it('preserves stable document identities, ordered files and exact frozen versions across copy-on-write and normalized no-ops', async () => {
    const base = await baseline();
    const additional = await file();
    const first = ownDocumentsSchema.parse(
      await (
        await save({
          documents: [
            ...base.data.documents,
            {
              ...blank(),
              documentTypeId: typeIds.additional_document!,
              customName: 'Old evidence',
              fileId: additional.object.id,
            },
          ],
        })
      ).json(),
    );
    const oldContext = await freeze(first.revisionId!);
    const [later] = await db
      .insert(s.fileVersion)
      .values({
        fileObjectId: additional.object.id,
        versionNumber: 2,
        originalName: 'Later private evidence.pdf',
        byteSize: 200,
        declaredMediaType: 'application/pdf',
        detectedMediaType: 'application/pdf',
        checksum: 'b'.repeat(64),
        scanState: 'passed',
        uploadedBy: accountId,
        storageKey: randomUUID(),
      })
      .returning();
    expect((await read()).data.documents[2]?.file).toMatchObject({
      versionId: additional.version.id,
      versionNumber: 1,
    });
    const editedRows = first.data.editable.documents
      .toReversed()
      .map((row, index) => (index === 0 ? { ...row, customName: 'New evidence' } : row));
    const changed = ownDocumentsSchema.parse(await (await save({ documents: editedRows }, first.editVersion)).json());
    expect(changed).toMatchObject({ profileStatus: 'verified', hasWorkingChanges: true });
    expect(changed.revisionId).not.toBe(first.revisionId);
    expect(changed.data.editable.documents.map((row) => row.identityId)).toEqual(
      editedRows.map((row) => row.identityId),
    );
    expect(changed.data.documents[0]?.file).toMatchObject({ versionId: later!.id, versionNumber: 2 });
    const old = await db.transaction((tx) => new DocumentsHandler().read(tx as Database, oldContext));
    expect(old.editable.documents[2]?.customName).toBe('Old evidence');
    expect(old.documents[2]?.file).toMatchObject({ versionId: additional.version.id, versionNumber: 1 });
    const noOp = ownDocumentsSchema.parse(
      await (
        await save(
          {
            documents: changed.data.editable.documents.map((row) => ({
              ...row,
              identityId: row.identityId.toUpperCase(),
              documentTypeId: row.documentTypeId?.toUpperCase() ?? null,
              fileId: row.fileId?.toUpperCase() ?? null,
              customName: row.customName ? ` ${row.customName} ` : '  ',
            })),
          },
          changed.editVersion,
        )
      ).json(),
    );
    expect(noOp).toMatchObject({
      revisionId: changed.revisionId,
      editVersion: changed.editVersion,
      savedAt: changed.savedAt,
    });
  });

  it('rejects a foreign profile identity and identities belonging to another section kind without changing content', async () => {
    const [foreign] = await db
      .insert(s.documentIdentity)
      .values({ profileId: foreignProfile.id, organizationId: foreignProfile.organizationId })
      .returning();
    const [product] = await db
      .insert(s.productLineIdentity)
      .values({ profileId: profile.id, organizationId: profile.organizationId })
      .returning();
    for (const identityId of [foreign!.id, product!.id]) {
      const response = await save({ documents: [{ ...blank(), identityId }] });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: 'validation',
        errors: [{ path: 'documents.0.identityId', code: 'identity_invalid' }],
      });
    }
    expect((await read()).data.editable).toEqual(empty());
  });

  it('validates dictionary kind, retired choices and custom-name policy before any draft changes are committed', async () => {
    for (const row of [
      { ...blank(), documentTypeId: foreignTypeId },
      { ...blank(), documentTypeId: typeIds.licence! },
      { ...blank(), documentTypeId: typeIds.charter!, customName: 'Wrong custom title' },
    ]) {
      const response = await save({ documents: [row] });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toMatchObject({
        code: 'validation',
        errors: [
          expect.objectContaining({
            code:
              row.documentTypeId === foreignTypeId
                ? 'reference_invalid'
                : row.documentTypeId === typeIds.licence
                  ? 'reference_retired'
                  : 'custom_name_not_allowed',
          }),
        ],
      });
      expect(await db.select().from(s.documentIdentity).where(eq(s.documentIdentity.id, row.identityId))).toEqual([]);
    }
    expect((await read()).editVersion).toBe(0);
  });

  it('retains a retired type only on its existing stable identity, including reorder and a later name edit', async () => {
    const old = { ...blank(), documentTypeId: typeIds.additional_document!, customName: 'Original' };
    const first = ownDocumentsSchema.parse(await (await save({ documents: [old] })).json());
    await db
      .update(s.dictionaryEntry)
      .set({ retiredAt: new Date() })
      .where(eq(s.dictionaryEntry.id, old.documentTypeId));
    const changed = ownDocumentsSchema.parse(
      await (await save({ documents: [{ ...old, customName: 'Edited' }] }, first.editVersion)).json(),
    );
    expect(changed.data.editable.documents[0]?.customName).toBe('Edited');
    const rejected = await save(
      { documents: [...changed.data.editable.documents, { ...blank(), documentTypeId: old.documentTypeId }] },
      changed.editVersion,
    );
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      errors: [{ path: 'documents.1.documentTypeId', code: 'reference_retired' }],
    });
    expect((await read()).editVersion).toBe(changed.editVersion);
  });

  it('rejects foreign, wrong-purpose and wrong-class file bindings without exposing metadata', async () => {
    const denied = [
      await file('passed', 'document_file', foreignProfile.organizationId),
      await file('passed', 'cv'),
      await file('passed', 'document_file', profile.organizationId, 'e_administration'),
    ];
    for (const value of denied) {
      const response = await save({
        documents: [{ ...blank(), documentTypeId: typeIds.charter!, fileId: value.object.id }],
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toMatchObject({ errors: [{ path: 'documents.0.fileId', code: 'file_invalid' }] });
      expect(JSON.stringify(body)).not.toContain(value.version.originalName);
    }
    expect((await read()).editVersion).toBe(0);
  });

  it('rejects duplicate identities and writable licensing/status fields through safe HTTP validation', async () => {
    const row = blank();
    const duplicate = await save({ documents: [row, { ...row, identityId: row.identityId.toUpperCase() }] });
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toMatchObject({
      errors: [{ path: 'documents.1.identityId', code: 'duplicate_document' }],
    });
    for (const extra of [{ status: 'verified' }, { noLicenceRequired: true }])
      expect((await save({ documents: [{ ...row, ...extra }] })).status).toBe(400);
    expect((await read()).editVersion).toBe(0);
  });

  it.each(['verified', 'rejected'] as const)(
    'does not fabricate document decisions from %s section status',
    async (state) => {
      const base = await baseline();
      const first = ownDocumentsSchema.parse(await (await save(base.data)).json());
      const frozenContext = await freeze(first.revisionId!, state);
      const documents =
        state === 'verified'
          ? (await read()).data
          : await db.transaction((tx) => new DocumentsHandler().read(tx as Database, frozenContext));
      expect(documents.documents.map((row) => row.status)).toEqual(['uploaded', 'uploaded']);
    },
  );

  it('submitted documents show under_review and a locked or stale edit preserves history', async () => {
    const base = await baseline();
    const first = ownDocumentsSchema.parse(await (await save(base.data)).json());
    const stale = await save({ documents: [] }, 0);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'section_changed' });
    await freeze(first.revisionId!, 'submitted');
    const submitted = await read();
    expect(submitted.readOnly).toBe(true);
    const choices = await http.get(`${ROOT}/choices`, 'manufacturer');
    expect(choices.status).toBe(409);
    expect(await choices.json()).toMatchObject({ code: 'profile_locked' });
    expect(submitted.data.documents.map((row) => row.status)).toEqual(['under_review', 'under_review']);
    const locked = await save(empty(), first.editVersion);
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({ code: 'profile_locked' });
    expect((await read()).data.editable.documents).toEqual(base.data.documents);
  });

  it('keeps legacy frozen verification but new COW business rows never inherit it', async () => {
    const base = await baseline();
    const additional = await file();
    const first = ownDocumentsSchema.parse(
      await (
        await save({
          documents: [
            ...base.data.documents,
            {
              ...blank(),
              documentTypeId: typeIds.additional_document!,
              customName: 'Original',
              fileId: additional.object.id,
            },
          ],
        })
      ).json(),
    );
    await db.update(s.document).set({ status: 'verified' }).where(eq(s.document.sectionRevisionId, first.revisionId!));
    await freeze(first.revisionId!);
    const changed = ownDocumentsSchema.parse(
      await (
        await save(
          {
            documents: first.data.editable.documents.map((row, index) =>
              index === 2 ? { ...row, customName: 'Changed' } : row,
            ),
          },
          first.editVersion,
        )
      ).json(),
    );
    expect(changed.data.documents.map((row) => row.status)).toEqual(['uploaded', 'uploaded', 'uploaded']);
    const frozenContext = await context(first.revisionId!);
    const frozen = await db.transaction((tx) => new DocumentsHandler().read(tx as Database, frozenContext));
    expect(frozen.documents.map((row) => row.status)).toEqual(['verified', 'verified', 'verified']);
  });

  it('persists 1003 ordered identities across batch inserts without imposing an arbitrary document count cap', async () => {
    const base = await baseline();
    const rows = [
      ...base.data.documents,
      ...Array.from({ length: 1001 }, (_, index) => ({
        ...blank(),
        documentTypeId: typeIds.additional_document!,
        customName: `Evidence ${index}`,
        fileId: null,
      })),
    ];
    const response = await save({ documents: rows });
    expect(response.status).toBe(200);
    const result = ownDocumentsSchema.parse(await response.json());
    expect(result.data.editable.documents).toEqual(rows);
    expect(result.data.documents.map((row) => row.identityId)).toEqual(rows.map((row) => row.identityId));
    expect(result.completeness.percent).toBe(100);
    expect(await db.select().from(s.documentIdentity).where(eq(s.documentIdentity.profileId, profile.id))).toHaveLength(
      1003,
    );
  });
});
