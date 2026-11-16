import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  certificateEditorChoicesSchema,
  COMPANY_ISO_CODES,
  ownCertificatesSchema,
  type ProfileCertificateWrite,
} from '@imbc/contracts';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Database } from '../src/database/database.module.js';
import { loadReferenceDirectory, REFERENCE_DATA_DIR } from '../src/database/reference-data.js';
import * as s from '../src/database/schema/index.js';
import { certificateToday, CertificatesHandler } from '../src/modules/profiles/certificates.handler.js';
import { ProfileSectionsController } from '../src/modules/profiles/profile-sections.controller.js';
import { ProfileSectionsService } from '../src/modules/profiles/profile-sections.service.js';
import { defineSectionHandler } from '../src/modules/profiles/section-handler.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp, type HttpStand } from './support/http.js';
import { join } from 'node:path';
const ROOT = '/api/v1/profiles/own/sections/certificates';
const row = (typeId: string | null = null): ProfileCertificateWrite => ({
  identityId: randomUUID(),
  group: 'company',
  certificateTypeId: typeId,
  customTypeName: null,
  notHeld: false,
  number: null,
  issuingBody: null,
  issuedOn: null,
  expiresOn: null,
  fileId: null,
});
describe.skipIf(!process.env.TEST_DATABASE_URL)('MAN-33–36 certificates through actual HTTP and PostgreSQL', () => {
  let pool: pg.Pool;
  let db: Database;
  let http: HttpStand;
  let profile: typeof s.manufacturerProfile.$inferSelect;
  let actorId: string;
  let isoIds: string[];
  let asmeId: string;
  let otherId: string;
  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema: s, casing: 'snake_case' });
    await loadReferenceDirectory(db, join(REFERENCE_DATA_DIR, 'release'), 'release');
    const entries = await db
      .select()
      .from(s.dictionaryEntry)
      .innerJoin(s.dictionary, eq(s.dictionary.id, s.dictionaryEntry.dictionaryId));
    const id = (code: string) =>
      entries.find((item) => item.dictionary.code === 'certificate_type' && item.dictionary_entry.code === code)!
        .dictionary_entry.id;
    isoIds = COMPANY_ISO_CODES.map(id);
    asmeId = id('ASME');
    otherId = id('Other');
  }, 60000);
  beforeEach(async () => {
    const [org] = await db.insert(s.organizations).values({ type: 'manufacturer', name: randomUUID() }).returning();
    const [actor] = await db
      .insert(s.userAccounts)
      .values({
        organizationId: org!.id,
        role: 'manufacturer',
        state: 'active',
        email: `${randomUUID()}@certificate.local`,
      })
      .returning();
    actorId = actor!.id;
    const [created] = await db.insert(s.manufacturerProfile).values({ organizationId: org!.id }).returning();
    profile = created!;
    const service = new ProfileSectionsService(pool, new AuditService(db), [
      defineSectionHandler(new CertificatesHandler()),
    ]);
    http = await startHttp({
      controllers: [ProfileSectionsController],
      providers: [{ provide: ProfileSectionsService, useValue: service }],
      organizationId: org!.id,
      accountIds: { manufacturer: actorId },
    });
  });
  afterEach(async () => {
    await http?.close();
  });
  afterAll(async () => {
    await pool?.end();
  });
  const read = async () => ownCertificatesSchema.parse(await (await http.get(ROOT, 'manufacturer')).json());
  const send = (certificates: ProfileCertificateWrite[], editVersion = 0) =>
    http.send('PUT', ROOT, 'manufacturer', { editVersion, data: { certificates } });
  const save = async (certificates: ProfileCertificateWrite[], editVersion = 0) => {
    const response = await send(certificates, editVersion);
    expect(response.status).toBe(200);
    return ownCertificatesSchema.parse(await response.json());
  };
  const file = async (
    scanState: 'pending' | 'passed' | 'rejected' = 'passed',
    purpose: 'certificate_file' | 'conformity_certificate' = 'certificate_file',
  ) => {
    const [object] = await db
      .insert(s.fileObject)
      .values({ organizationId: profile.organizationId, purpose, dataClass: 'b_manufacturer' })
      .returning();
    await db.insert(s.fileVersion).values({
      fileObjectId: object!.id,
      versionNumber: 1,
      originalName: 'certificate.pdf',
      byteSize: 10,
      declaredMediaType: 'application/pdf',
      checksum: 'a'.repeat(64),
      storageKey: randomUUID(),
      scanState,
      rejectionReason: scanState === 'rejected' ? 'malware' : null,
    });
    return object!.id;
  };
  const held = async (
    typeId: string,
    scanState: 'pending' | 'passed' | 'rejected' = 'passed',
  ): Promise<ProfileCertificateWrite> => ({
    ...row(typeId),
    number: '001',
    issuingBody: 'Issuer',
    issuedOn: '2026-01-01',
    fileId: await file(scanState),
  });
  const absences = () => isoIds.map((id) => ({ ...row(id), notHeld: true }));
  it('empty list is incomplete; three explicit absences yield 100 and never held/verified claims', async () => {
    expect((await read()).completeness.percent).toBe(0);
    const saved = await save(absences());
    expect(saved.completeness.percent).toBe(100);
    expect(saved.data.certificates.every((item) => item.status === null && item.file === null)).toBe(true);
  });
  it('editor choices expose current mandatory types without changing a frozen revision and remain unavailable during review', async () => {
    const first = await save(absences());
    const [section] = await db
      .select()
      .from(s.profileSection)
      .where(and(eq(s.profileSection.profileId, profile.id), eq(s.profileSection.kind, 'certificates')));
    await db.transaction(async (tx) => {
      await tx.insert(s.submissionRequirement).values(
        isoIds.map((dictionaryEntryId) => ({
          sectionRevisionId: first.revisionId!,
          organizationId: profile.organizationId,
          dictionaryEntryId,
          capturedAt: new Date(),
        })),
      );
      await tx
        .update(s.sectionRevision)
        .set({ state: 'submitted', submittedAt: new Date() })
        .where(eq(s.sectionRevision.id, first.revisionId!));
      await tx
        .update(s.profileSection)
        .set({ workingRevisionId: null, pendingRevisionId: first.revisionId! })
        .where(eq(s.profileSection.id, section!.id));
      await tx
        .update(s.manufacturerProfile)
        .set({ status: 'submitted' })
        .where(eq(s.manufacturerProfile.id, profile.id));
    });
    const locked = await http.get(`${ROOT}/choices`, 'manufacturer');
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({ code: 'profile_locked' });
    await db.transaction(async (tx) => {
      await tx
        .update(s.profileSection)
        .set({ pendingRevisionId: null, verifiedRevisionId: first.revisionId! })
        .where(eq(s.profileSection.id, section!.id));
      await tx.update(s.sectionRevision).set({ state: 'verified' }).where(eq(s.sectionRevision.id, first.revisionId!));
      await tx
        .update(s.manufacturerProfile)
        .set({ status: 'verified' })
        .where(eq(s.manufacturerProfile.id, profile.id));
    });
    await db.update(s.dictionaryEntry).set({ mandatory: true }).where(eq(s.dictionaryEntry.id, asmeId));
    try {
      const response = await http.get(`${ROOT}/choices`, 'manufacturer');
      expect(response.status).toBe(200);
      const choices = certificateEditorChoicesSchema.parse(await response.json());
      expect(choices.requiredTypes.map((type) => type.id).sort()).toEqual([...isoIds, asmeId].sort());
      expect(choices.requiredTypes.find((type) => type.id === asmeId)?.code).toBe('ASME');
      const frozen = await read();
      expect(frozen).toMatchObject({
        revisionId: first.revisionId,
        editVersion: first.editVersion,
        hasWorkingChanges: false,
        data: { requirementSource: 'submission' },
      });
      expect(frozen.data.requiredTypes.map((type) => type.id).sort()).toEqual([...isoIds].sort());
      const withSelector = await http.get(`${ROOT}/choices?organizationId=${randomUUID()}`, 'manufacturer');
      expect(withSelector.status).toBe(200);
      expect(certificateEditorChoicesSchema.parse(await withSelector.json())).toEqual(choices);
    } finally {
      await db.update(s.dictionaryEntry).set({ mandatory: false }).where(eq(s.dictionaryEntry.id, asmeId));
    }
  });
  it('only company ISO supports absence, with no conflicting held row of that company type', async () => {
    for (const item of [
      { ...row(asmeId), notHeld: true },
      { ...row(isoIds[0]!), group: 'product' as const, notHeld: true },
    ])
      expect((await send([item])).status).toBe(400);
    expect((await send([{ ...row(isoIds[0]!), notHeld: true }, await held(isoIds[0]!)])).status).toBe(400);
  });
  it('full held company ISO counts only PASSED files; partial and optional certificates can be saved', async () => {
    const items = [await held(isoIds[0]!), await held(isoIds[1]!, 'pending'), await held(isoIds[2]!, 'rejected')];
    const first = await save(items);
    expect(first.completeness.percent).toBeCloseTo(100 / 3);
    const optional = { ...row(otherId), group: 'other' as const, customTypeName: null };
    expect((await save([...absences(), optional], 1)).completeness.percent).toBe(100);
  });
  it('custom names follow the selected type; company compatibility conformity files cannot bind', async () => {
    expect((await send([{ ...row(asmeId), customTypeName: 'Invalid custom' }])).status).toBe(400);
    expect(
      (await save([{ ...row(otherId), group: 'other', customTypeName: 'Named certificate' }])).data.editable
        .certificates[0]!.customTypeName,
    ).toBe('Named certificate');
    expect(
      (await send([{ ...row(isoIds[0]!), fileId: await file('passed', 'conformity_certificate') }], 1)).status,
    ).toBe(400);
  });
  it('expiry is derived already in draft and follows Almaty midnight; perpetual validity stays uploaded', async () => {
    expect(certificateToday(new Date('2026-01-01T18:59:59Z'))).toBe('2026-01-01');
    expect(certificateToday(new Date('2026-01-01T19:00:00Z'))).toBe('2026-01-02');
    const expired = { ...(await held(asmeId)), issuedOn: '2000-01-01', expiresOn: '2001-01-01' };
    const saved = await save([expired, await held(isoIds[0]!)]);
    expect(saved.data.certificates.map((item) => item.status)).toEqual(['expired', 'uploaded']);
  });
  it('normalized no-op preserves order/editVersion; foreign or wrong-kind identities cannot be adopted', async () => {
    const items = absences();
    await save(items);
    expect(
      (
        await save(
          items.map((item) => ({ ...item, identityId: item.identityId.toUpperCase() })),
          1,
        )
      ).editVersion,
    ).toBe(1);
    const [other] = await db.insert(s.organizations).values({ type: 'manufacturer', name: randomUUID() }).returning();
    const [otherProfile] = await db.insert(s.manufacturerProfile).values({ organizationId: other!.id }).returning();
    const [identity] = await db
      .insert(s.certificateIdentity)
      .values({ profileId: otherProfile!.id, organizationId: other!.id })
      .returning();
    expect((await send([{ ...row(), identityId: identity!.id }], 1)).status).toBe(400);
    const [wrongKind] = await db
      .insert(s.documentIdentity)
      .values({ profileId: profile.id, organizationId: profile.organizationId })
      .returning();
    expect((await send([{ ...row(), identityId: wrongKind!.id }], 1)).status).toBe(400);
  });
  it('current product links prevent removal/group change; historical links allow removal after current unlink', async () => {
    const productCert = { ...(await held(asmeId)), group: 'product' as const };
    await save([productCert]);
    const [section] = await db
      .select()
      .from(s.profileSection)
      .where(and(eq(s.profileSection.profileId, profile.id), eq(s.profileSection.kind, 'products')));
    const [identity] = await db
      .insert(s.productLineIdentity)
      .values({ profileId: profile.id, organizationId: profile.organizationId })
      .returning();
    const [product] = await db
      .insert(s.productLine)
      .values({
        sectionRevisionId: section!.workingRevisionId!,
        organizationId: profile.organizationId,
        identityId: identity!.id,
      })
      .returning();
    await db.insert(s.productLineCertificate).values({
      productLineId: product!.id,
      organizationId: profile.organizationId,
      certificateIdentityId: productCert.identityId,
    });
    expect((await send([], 1)).status).toBe(400);
    expect((await send([{ ...productCert, group: 'company' }], 1)).status).toBe(400);
    const replacement = { ...productCert, fileId: await file() };
    expect((await save([replacement], 1)).editVersion).toBe(2);
    await db.transaction(async (tx) => {
      await tx
        .update(s.sectionRevision)
        .set({ state: 'submitted', submittedAt: new Date() })
        .where(eq(s.sectionRevision.id, section!.workingRevisionId!));
      await tx
        .update(s.profileSection)
        .set({ workingRevisionId: null, verifiedRevisionId: section!.workingRevisionId })
        .where(eq(s.profileSection.id, section!.id));
      await tx
        .update(s.sectionRevision)
        .set({ state: 'verified' })
        .where(eq(s.sectionRevision.id, section!.workingRevisionId!));
      const [working] = await tx
        .insert(s.sectionRevision)
        .values({ profileSectionId: section!.id, organizationId: profile.organizationId, revisionNumber: 2 })
        .returning();
      await tx
        .update(s.profileSection)
        .set({ workingRevisionId: working!.id })
        .where(eq(s.profileSection.id, section!.id));
    });
    expect((await save([], 2)).editVersion).toBe(3);
    expect(
      (await db.select().from(s.productLineCertificate).where(eq(s.productLineCertificate.productLineId, product!.id)))
        .length,
    ).toBe(1);
  });
});
