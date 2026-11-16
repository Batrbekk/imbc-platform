import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ownProductionSchema, productionEditorChoicesSchema, type ProductionWrite, type FilePurpose, type DataClass } from '@imbc/contracts';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { revisionOwnedFiles } from '../src/modules/files/file-owner.js';
import { captureRevisionFileVersions } from '../src/modules/files/revision-file-snapshot.js';
import { ProductionHandler } from '../src/modules/profiles/production.handler.js';
import { ProfileSectionsController } from '../src/modules/profiles/profile-sections.controller.js';
import { ProfileSectionsService } from '../src/modules/profiles/profile-sections.service.js';
import { defineSectionHandler } from '../src/modules/profiles/section-handler.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp, type HttpStand } from './support/http.js';

const ROOT = '/api/v1/profiles/own/sections/production';
const empty = (): ProductionWrite => ({ areaSqm: null, workshopCount: null, utilisationPercent: null,
  processEntryIds: [], photoIds: [], equipment: [] });
const equipment = () => ({ name: null as string | null, typeId: null as string | null, quantity: null as number | null,
  photoId: null as string | null, productIdentityIds: [] as string[] });

describe.skipIf(!process.env.TEST_DATABASE_URL)('MAN-26–32 optional production actual HTTP and PostgreSQL', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool; let db: Database; let http: HttpStand;
  let profile: typeof s.manufacturerProfile.$inferSelect;
  let foreignProfile: typeof s.manufacturerProfile.$inferSelect;
  let accountId: string; let seed = 0;
  beforeAll(async () => { pool = openTestPool(); await resetDatabase(pool); await migrateThrough(pool);
    db = drizzle(pool, { schema: s, casing: 'snake_case' }); }, 60000);
  beforeEach(async () => {
    const [org] = await db.insert(s.organizations).values({ type: 'manufacturer', name: 'Production fixture',
      bin: `2613${String(++seed).padStart(8, '0')}` }).returning();
    const [foreign] = await db.insert(s.organizations).values({ type: 'manufacturer', name: 'Foreign production fixture',
      bin: `2613${String(++seed).padStart(8, '0')}` }).returning();
    const [account] = await db.insert(s.userAccounts).values({ organizationId: org!.id, role: 'manufacturer',
      state: 'active', email: `production-${randomUUID()}@fixture.local` }).returning();
    accountId = account!.id;
    [profile] = (await db.insert(s.manufacturerProfile).values({ organizationId: org!.id }).returning()) as [typeof profile];
    [foreignProfile] = (await db.insert(s.manufacturerProfile).values({ organizationId: foreign!.id }).returning()) as [typeof profile];
    const service = new ProfileSectionsService(pool, new AuditService(db), [defineSectionHandler(new ProductionHandler())]);
    http = await startHttp({ controllers: [ProfileSectionsController], providers: [{ provide: ProfileSectionsService, useValue: service }],
      organizationId: org!.id, accountIds: { manufacturer: accountId } });
  });
  afterEach(async () => { await http?.close(); });
  afterAll(async () => { await pool?.end(); });
  const read = async () => ownProductionSchema.parse(await (await http.get(ROOT, 'manufacturer')).json());
  const save = (data: unknown, editVersion = 0) => http.send('PUT', ROOT, 'manufacturer', { editVersion, data });
  const section = async (kind: 'production' | 'products', owner = profile) => {
    const [row] = await db.select().from(s.profileSection).where(and(eq(s.profileSection.profileId, owner.id), eq(s.profileSection.kind, kind)));
    return row!;
  };
  const reference = async (code: 'process' | 'equipment_type' | 'region') => {
    const [dictionary] = await db.select().from(s.dictionary).where(eq(s.dictionary.code, code));
    const [entry] = await db.insert(s.dictionaryEntry).values({ dictionaryId: dictionary!.id, code: `fixture-${randomUUID()}` }).returning();
    await db.insert(s.dictionaryEntryTranslation).values({ dictionaryEntryId: entry!.id, language: 'en', name: 'Fixture reference' });
    return entry!;
  };
  const product = async (owner = profile, persisted = true, source: 'manual' | 'e_ondiris' | 'migration' = 'manual') => {
    const [identity] = await db.insert(s.productLineIdentity).values({ profileId: owner.id, organizationId: owner.organizationId }).returning();
    const current = await section('products', owner);
    const [line] = persisted ? await db.insert(s.productLine).values({ sectionRevisionId: current.workingRevisionId!, organizationId: owner.organizationId,
      identityId: identity!.id, nameEn: `Fixture ${source} goods`, nameRu: 'Тестовый товар', source, tnVedCode: '0001234567' }).returning() : [];
    return { identity: identity!, line };
  };
  const file = async (scanState: 'pending' | 'passed' | 'rejected' = 'passed', purpose: FilePurpose = 'production_photo',
    owner = profile, dataClass: DataClass = 'b_manufacturer') => {
    const [object] = await db.insert(s.fileObject).values({ organizationId: owner.organizationId, purpose, dataClass }).returning();
    const [version] = await db.insert(s.fileVersion).values({ fileObjectId: object!.id, versionNumber: 1,
      originalName: 'Fixture production.jpg', byteSize: 100, declaredMediaType: 'image/jpeg', detectedMediaType: 'image/jpeg',
      checksum: 'a'.repeat(64), scanState, rejectionReason: scanState === 'rejected' ? 'malware' : null,
      uploadedBy: accountId, storageKey: randomUUID() }).returning();
    return { object: object!, version: version! };
  };
  const verify = async (kind: 'production' | 'products', revisionId: string, capture = true) => {
    const current = await section(kind);
    await db.transaction(async (tx) => {
      if (capture) await captureRevisionFileVersions(tx as Database, { sectionRevisionId: revisionId, organizationId: profile.organizationId });
      await tx.update(s.sectionRevision).set({ state: 'submitted', submittedAt: new Date() }).where(eq(s.sectionRevision.id, revisionId));
      await tx.update(s.profileSection).set({ workingRevisionId: null, verifiedRevisionId: revisionId }).where(eq(s.profileSection.id, current.id));
      await tx.update(s.sectionRevision).set({ state: 'verified' }).where(eq(s.sectionRevision.id, revisionId));
      await tx.update(s.manufacturerProfile).set({ status: 'verified' }).where(eq(s.manufacturerProfile.id, profile.id));
    });
  };

  it('an empty optional section has no root row, no invented source prefill and 100% completeness', async () => {
    const initial = await read();
    expect(initial.completeness).toEqual({ percent: 100, missing: [] });
    expect(initial.data).toEqual({ editable: empty(), photos: [], equipmentPhotos: [],
      selectedReferences: { processes: [], equipmentTypes: [] }, productChoices: [] });
    expect(await db.select().from(s.production).where(eq(s.production.sectionRevisionId, initial.revisionId))).toHaveLength(0);
    const noOp = ownProductionSchema.parse(await (await save(empty())).json());
    expect(noOp.editVersion).toBe(0);
    expect(noOp.savedAt).toBeNull();
  });
  it('unfinished equipment rows save independently without inventing a general production row', async () => {
    const saved = ownProductionSchema.parse(await (await save({ ...empty(), equipment: [equipment()] })).json());
    expect(saved.completeness).toEqual({ percent: 100, missing: [] });
    expect(saved.data.editable.equipment).toEqual([equipment()]);
    expect(saved.data.equipmentPhotos).toEqual([null]);
    expect(await db.select().from(s.production).where(eq(s.production.sectionRevisionId, saved.revisionId))).toHaveLength(0);
    expect(await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.sectionRevisionId, saved.revisionId))).toHaveLength(1);
  });
  it('stores exact large area, zero counts and max-range utilisation without JS rounding', async () => {
    const first = ownProductionSchema.parse(await (await save({ ...empty(), areaSqm: '0009007199254740993.00000000000000000100',
      workshopCount: 0, utilisationPercent: '100.0000', equipment: [{ ...equipment(), quantity: 0 }] })).json());
    expect(first.data.editable).toMatchObject({ areaSqm: '9007199254740993.000000000000000001', workshopCount: 0,
      utilisationPercent: '100', equipment: [{ quantity: 0 }] });
    const [stored] = await db.select().from(s.production).where(eq(s.production.sectionRevisionId, first.revisionId));
    expect(stored?.areaSqm).toBe('9007199254740993.000000000000000001');
    expect(stored?.utilisationPercent).toBe('100.00');
    const second = ownProductionSchema.parse(await (await save({ ...first.data.editable,
      workshopCount: 2_147_483_647, utilisationPercent: '099.9900', equipment: [{ ...equipment(), quantity: 2_147_483_647 }] }, first.editVersion)).json());
    expect(second.data.editable).toMatchObject({ workshopCount: 2_147_483_647, utilisationPercent: '99.99', equipment: [{ quantity: 2_147_483_647 }] });
    expect(second.completeness.percent).toBe(100);
  });
  it.each(['100.01', '0.001', '99.999', '-1', '1e1', 50])('rejects invalid/lossy utilisation %s without writing', async (value) => {
    const response = await save({ ...empty(), utilisationPercent: value });
    expect(response.status).toBe(400);
    expect((await read()).editVersion).toBe(0);
  });
  it('orders production and equipment photographs independently, including a shared photograph', async () => {
    const process = await reference('process'); const type = await reference('equipment_type');
    const photo = await file(); const other = await file(); const goods = await product();
    const rows = [{ ...equipment(), name: 'First equipment', typeId: type.id, quantity: 2, photoId: photo.object.id,
      productIdentityIds: [goods.identity.id] }, { ...equipment(), name: 'Second equipment', photoId: photo.object.id }];
    const saved = ownProductionSchema.parse(await (await save({ ...empty(), processEntryIds: [process.id],
      photoIds: [other.object.id, photo.object.id], equipment: rows })).json());
    expect(saved.data.photos.map((item) => item.fileId)).toEqual([other.object.id, photo.object.id]);
    expect(saved.data.equipmentPhotos.map((item) => item?.fileId)).toEqual([photo.object.id, photo.object.id]);
    expect(saved.data.editable.equipment.map((item) => item.name)).toEqual(['First equipment', 'Second equipment']);
    expect(saved.data.selectedReferences).toMatchObject({ processes: [{ id: process.id }], equipmentTypes: [{ id: type.id }] });
    const owners = await revisionOwnedFiles(db, saved.revisionId, profile.organizationId);
    expect(owners.filter((owner) => owner.fileObjectId === photo.object.id)).toHaveLength(3);
    expect(owners.every((owner) => owner.valid)).toBe(true);
    expect(JSON.stringify(saved.data)).not.toContain('storageKey');
  });
  it.each(['pending', 'rejected'] as const)('%s photographs remain valid partial drafts and never lower optional completeness', async (state) => {
    const photo = await file(state);
    const saved = ownProductionSchema.parse(await (await save({ ...empty(), photoIds: [photo.object.id],
      equipment: [{ ...equipment(), photoId: photo.object.id }] })).json());
    expect(saved.completeness).toEqual({ percent: 100, missing: [] });
    expect(saved.data.photos[0]).toMatchObject({ scanState: state, canDownload: false });
    expect(saved.data.equipmentPhotos[0]).toMatchObject({ scanState: state, canDownload: false });
  });
  it.each(['foreign', 'wrong_purpose', 'wrong_class'] as const)('rejects %s photographs before any row mutation', async (kind) => {
    const photo = await file('passed', kind === 'wrong_purpose' ? 'cv' : 'production_photo',
      kind === 'foreign' ? foreignProfile : profile, kind === 'wrong_class' ? 'a_register' : 'b_manufacturer');
    for (const data of [{ ...empty(), photoIds: [photo.object.id] }, { ...empty(), equipment: [{ ...equipment(), photoId: photo.object.id }] }]) {
      const response = await save(data);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ errors: [{ code: 'file_invalid' }] });
    }
    expect((await read()).editVersion).toBe(0);
  });
  it('uses only current own persisted products, retaining manual/registry/migration choices', async () => {
    const products = await Promise.all([product(profile, true, 'manual'), product(profile, true, 'e_ondiris'), product(profile, true, 'migration')]);
    await product(foreignProfile);
    const saved = ownProductionSchema.parse(await (await save({ ...empty(), equipment: [{ ...equipment(),
      productIdentityIds: products.map((row) => row.identity.id) }] })).json());
    expect(new Set(saved.data.productChoices?.map((row) => row.identityId))).toEqual(new Set(products.map((row) => row.identity.id)));
    expect(new Set(saved.data.productChoices?.map((row) => row.source))).toEqual(new Set(['manual', 'e_ondiris', 'migration']));
    expect(new Set(saved.data.editable.equipment[0]?.productIdentityIds)).toEqual(new Set(products.map((row) => row.identity.id)));
  });
  it.each(['foreign', 'identity_only', 'removed', 'wrong_kind'] as const)('rejects %s product identity links', async (kind) => {
    let id: string;
    if (kind === 'wrong_kind') {
      const [site] = await db.insert(s.productionSiteIdentity).values({ profileId: profile.id, organizationId: profile.organizationId }).returning();
      id = site!.id;
    } else {
      const selected = await product(kind === 'foreign' ? foreignProfile : profile, kind !== 'identity_only');
      id = selected.identity.id;
      if (kind === 'removed') await db.delete(s.productLine).where(eq(s.productLine.id, selected.line!.id));
    }
    const response = await save({ ...empty(), equipment: [{ ...equipment(), productIdentityIds: [id] }] });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errors: [{ code: 'product_invalid' }] });
  });
  it('does not accept a historical product whose identity remains but selected current revision is empty', async () => {
    const selected = await product();
    const current = await section('products');
    await verify('products', current.workingRevisionId!);
    await db.transaction(async (tx) => {
      const [working] = await tx.insert(s.sectionRevision).values({ profileSectionId: current.id, organizationId: profile.organizationId,
        revisionNumber: 2, state: 'working', origin: 'manufacturer' }).returning();
      await tx.update(s.profileSection).set({ workingRevisionId: working!.id }).where(eq(s.profileSection.id, current.id));
    });
    const response = await save({ ...empty(), equipment: [{ ...equipment(), productIdentityIds: [selected.identity.id] }] });
    expect(response.status).toBe(400);
    expect((await read()).data.productChoices).toEqual([]);
  });
  it('retains retired processes and equipment type usage during reorder/detail edits but rejects extra retired uses', async () => {
    const process = await reference('process'); const type = await reference('equipment_type');
    const initial = ownProductionSchema.parse(await (await save({ ...empty(), processEntryIds: [process.id],
      equipment: [{ ...equipment(), name: 'Typed equipment', typeId: type.id }, { ...equipment(), name: 'Untyped equipment' }] })).json());
    for (const entry of [process, type]) await db.update(s.dictionaryEntry).set({ retiredAt: new Date() }).where(eq(s.dictionaryEntry.id, entry.id));
    const retained = ownProductionSchema.parse(await (await save({ ...initial.data.editable, areaSqm: '12',
      equipment: [{ ...equipment(), name: 'Untyped equipment' }, { ...equipment(), name: 'Edited typed equipment', typeId: type.id, quantity: 4 }] }, initial.editVersion)).json());
    expect(retained.data.selectedReferences.processes[0]?.retired).toBe(true);
    expect(retained.data.selectedReferences.equipmentTypes[0]?.retired).toBe(true);
    const forbidden = await save({ ...retained.data.editable, equipment: [...retained.data.editable.equipment,
      { ...equipment(), typeId: type.id }] }, retained.editVersion);
    expect(forbidden.status).toBe(400);
    expect(await forbidden.json()).toMatchObject({ errors: [{ code: 'reference_retired' }] });
    const removed = ownProductionSchema.parse(await (await save({ ...retained.data.editable, processEntryIds: [],
      equipment: [{ ...equipment(), name: 'Untyped equipment' }] }, retained.editVersion)).json());
    const reselected = await save({ ...removed.data.editable, processEntryIds: [process.id] }, removed.editVersion);
    expect(reselected.status).toBe(400);
    expect(await reselected.json()).toMatchObject({ errors: [{ code: 'reference_retired' }] });
  });
  it('rejects wrong dictionary types rather than arbitrary UUID references', async () => {
    const region = await reference('region');
    for (const data of [{ ...empty(), processEntryIds: [region.id] }, { ...empty(), equipment: [{ ...equipment(), typeId: region.id }] }]) {
      const response = await save(data);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ errors: [{ code: 'reference_invalid' }] });
    }
  });
  it('clearing saved content removes the root, equipment and child links without lowering completeness', async () => {
    const photo = await file(); const goods = await product(); const process = await reference('process');
    const initial = ownProductionSchema.parse(await (await save({ ...empty(), areaSqm: '10', processEntryIds: [process.id],
      photoIds: [photo.object.id], equipment: [{ ...equipment(), photoId: photo.object.id, productIdentityIds: [goods.identity.id] }] })).json());
    const removed = ownProductionSchema.parse(await (await save(empty(), initial.editVersion)).json());
    expect(removed.completeness).toEqual({ percent: 100, missing: [] });
    expect(removed.data.editable).toEqual(empty());
    expect(await db.select().from(s.production).where(eq(s.production.sectionRevisionId, removed.revisionId))).toHaveLength(0);
    expect(await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.sectionRevisionId, removed.revisionId))).toHaveLength(0);
    expect(await revisionOwnedFiles(db, removed.revisionId, profile.organizationId)).toEqual([]);
  });
  it('freezes exact shared photograph versions and stable product links; COW exposes current choices/files only', async () => {
    const photo = await file(); const goods = await product();
    const initial = ownProductionSchema.parse(await (await save({ ...empty(), areaSqm: '20', photoIds: [photo.object.id],
      equipment: [{ ...equipment(), name: 'Frozen equipment', photoId: photo.object.id, productIdentityIds: [goods.identity.id] }] })).json());
    await verify('production', initial.revisionId);
    await db.update(s.productLine).set({ nameEn: 'Later working product' }).where(eq(s.productLine.id, goods.line!.id));
    const [latest] = await db.insert(s.fileVersion).values({ fileObjectId: photo.object.id, versionNumber: 2,
      originalName: 'Later production.jpg', byteSize: 200, declaredMediaType: 'image/jpeg', detectedMediaType: 'image/jpeg',
      checksum: 'b'.repeat(64), scanState: 'passed', uploadedBy: accountId, storageKey: randomUUID() }).returning();
    const frozen = await read();
    expect(frozen.data.productChoices).toBeNull();
    expect(frozen.data.photos[0]?.versionId).toBe(photo.version.id);
    expect(frozen.data.equipmentPhotos[0]?.versionId).toBe(photo.version.id);
    expect(frozen.data.editable.equipment[0]?.productIdentityIds).toEqual([goods.identity.id]);
    const copied = ownProductionSchema.parse(await (await save({ ...frozen.data.editable, areaSqm: '21' }, frozen.editVersion)).json());
    expect(copied.revisionId).not.toBe(frozen.revisionId);
    expect(copied.data.productChoices?.[0]?.nameEn).toBe('Later working product');
    expect(copied.data.photos[0]?.versionId).toBe(latest!.id);
    expect(copied.data.equipmentPhotos[0]?.versionId).toBe(latest!.id);
    expect(copied.data.editable.equipment[0]?.productIdentityIds).toEqual([goods.identity.id]);
    const [historical] = await db.select().from(s.production).where(eq(s.production.sectionRevisionId, frozen.revisionId));
    expect(historical?.areaSqm).toBe('20');
    const captured = await db.select().from(s.revisionFileVersion).where(eq(s.revisionFileVersion.sectionRevisionId, frozen.revisionId));
    expect(captured).toHaveLength(1);
    expect(captured[0]?.fileVersionId).toBe(photo.version.id);
  });
  it('a frozen photograph without a captured version fails closed without latest-version fallback', async () => {
    const photo = await file();
    const initial = ownProductionSchema.parse(await (await save({ ...empty(), equipment: [{ ...equipment(), photoId: photo.object.id }] })).json());
    await verify('production', initial.revisionId, false);
    const frozen = await read();
    expect(frozen.data.equipmentPhotos[0]).toMatchObject({ fileId: photo.object.id, versionId: null, canDownload: false });
    expect(frozen.completeness.percent).toBe(100);
  });
  it('returns current editor product candidates before the first COW save without changing frozen read data', async () => {
    const original = await product();
    const initial = ownProductionSchema.parse(await (await save({ ...empty(), equipment: [{ ...equipment(), name: 'Frozen equipment',
      productIdentityIds: [original.identity.id] }] })).json());
    await verify('production', initial.revisionId);
    const added = await product(); await product(foreignProfile);
    await db.update(s.productLine).set({ nameEn: 'Current renamed product' }).where(eq(s.productLine.id, original.line!.id));
    const choicesResponse = await http.get(`${ROOT}/choices`, 'manufacturer');
    expect(choicesResponse.status).toBe(200);
    const choices = productionEditorChoicesSchema.parse(await choicesResponse.json());
    expect(new Set(choices.map((row) => row.identityId))).toEqual(new Set([original.identity.id, added.identity.id]));
    expect(choices.find((row) => row.identityId === original.identity.id)?.nameEn).toBe('Current renamed product');
    const frozen = await read();
    expect(frozen.revisionId).toBe(initial.revisionId);
    expect(frozen.editVersion).toBe(initial.editVersion);
    expect(frozen.data.productChoices).toBeNull();
    expect(frozen.data.editable.equipment[0]?.productIdentityIds).toEqual([original.identity.id]);
    expect((await section('production')).workingRevisionId).toBeNull();
  });
  it.each(['submitted', 'under_review'] as const)('denies editor candidates while the profile is %s', async (status) => {
    await db.update(s.manufacturerProfile).set({ status }).where(eq(s.manufacturerProfile.id, profile.id));
    const response = await http.get(`${ROOT}/choices`, 'manufacturer');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'profile_locked' });
  });
  it('requires an authenticated manufacturer edit permission for editor choices', async () => {
    expect((await http.get(`${ROOT}/choices`)).status).toBe(401);
    expect((await http.get(`${ROOT}/choices`, 'operator')).status).toBe(403);
  });
  it('batches more than a thousand equipment rows and product associations without a business count cap', async () => {
    const goods = await product();
    const rows = Array.from({ length: 1001 }, (_, index) => ({ ...equipment(), name: `Fixture equipment ${index}`, productIdentityIds: [goods.identity.id] }));
    const response = await save({ ...empty(), equipment: rows });
    expect(response.status).toBe(200);
    const saved = ownProductionSchema.parse(await response.json());
    expect(saved.data.editable.equipment).toHaveLength(1001);
    expect(saved.data.editable.equipment[1000]?.name).toBe('Fixture equipment 1000');
    expect(saved.completeness.percent).toBe(100);
    expect(await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.sectionRevisionId, saved.revisionId))).toHaveLength(1001);
    expect(await db.select().from(s.equipmentProductLine).where(eq(s.equipmentProductLine.organizationId, profile.organizationId))).toHaveLength(1001);
  });
});
