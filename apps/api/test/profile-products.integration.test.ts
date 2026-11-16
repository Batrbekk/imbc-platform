import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ownProductsSchema, productsReadSchema, type ProductsWrite, type FilePurpose } from '@imbc/contracts';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { captureRevisionFileVersions } from '../src/modules/files/revision-file-snapshot.js';
import { ProductsHandler } from '../src/modules/profiles/products.handler.js';
import { ProfileSectionsController } from '../src/modules/profiles/profile-sections.controller.js';
import { ProfileSectionsService } from '../src/modules/profiles/profile-sections.service.js';
import { defineSectionHandler } from '../src/modules/profiles/section-handler.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp, type HttpStand } from './support/http.js';

const ROOT = '/api/v1/profiles/own/sections/products';
const empty = (): ProductsWrite => ({ products: [], unifiedRegisterExtractId: null });
const manual = () => ({ kind: 'manual' as const, identityId: randomUUID(), nameEn: null, nameRu: null,
  commodityTypeId: null, tnVedEntryId: null, kpvedEntryIds: [] as string[], capacityQuantity: null as string | null,
  capacityUnitId: null, productionSiteIdentityId: null, note: null, certificateIdentityIds: [] as string[] });

describe.skipIf(!process.env.TEST_DATABASE_URL)('MAN-23–25 products actual HTTP and PostgreSQL', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;
  let db: Database;
  let http: HttpStand;
  let profile: typeof s.manufacturerProfile.$inferSelect;
  let foreignProfile: typeof s.manufacturerProfile.$inferSelect;
  let accountId: string;
  let seed = 0;
  beforeAll(async () => { pool = openTestPool(); await resetDatabase(pool); await migrateThrough(pool);
    db = drizzle(pool, { schema: s, casing: 'snake_case' });
    // Standalone handler fixture; the release's reference-data tests own the unit inventory migration.
    await db.insert(s.dictionary).values({ code: 'unit', name: 'Units' }).onConflictDoNothing();
  }, 60000);
  beforeEach(async () => {
    const [org] = await db.insert(s.organizations).values({ type: 'manufacturer', name: 'Products fixture',
      bin: `2513${String(++seed).padStart(8, '0')}` }).returning();
    const [foreign] = await db.insert(s.organizations).values({ type: 'manufacturer', name: 'Foreign fixture',
      bin: `2513${String(++seed).padStart(8, '0')}` }).returning();
    const [account] = await db.insert(s.userAccounts).values({ organizationId: org!.id, role: 'manufacturer',
      state: 'active', email: `products-${randomUUID()}@fixture.local` }).returning();
    accountId = account!.id;
    [profile] = (await db.insert(s.manufacturerProfile).values({ organizationId: org!.id }).returning()) as [typeof profile];
    [foreignProfile] = (await db.insert(s.manufacturerProfile).values({ organizationId: foreign!.id }).returning()) as [typeof profile];
    const service = new ProfileSectionsService(pool, new AuditService(db), [defineSectionHandler(new ProductsHandler())]);
    http = await startHttp({ controllers: [ProfileSectionsController],
      providers: [{ provide: ProfileSectionsService, useValue: service }], organizationId: org!.id,
      accountIds: { manufacturer: account!.id } });
  });
  afterEach(async () => { await http?.close(); });
  afterAll(async () => { await pool?.end(); });
  const read = async () => ownProductsSchema.parse(await (await http.get(ROOT, 'manufacturer')).json());
  const save = (data: unknown, editVersion = 0) => http.send('PUT', ROOT, 'manufacturer', { editVersion, data });
  const section = async (kind: 'products' | 'main_information' | 'certificates' | 'production', owner = profile) => {
    const [row] = await db.select().from(s.profileSection).where(and(eq(s.profileSection.profileId, owner.id), eq(s.profileSection.kind, kind)));
    return row!;
  };
  const reference = async (code: string, value = `fixture-${randomUUID()}`, parentEntryId: string | null = null) => {
    const [dictionary] = await db.select().from(s.dictionary).where(eq(s.dictionary.code, code));
    const [existing] = await db.select().from(s.dictionaryEntry).where(and(eq(s.dictionaryEntry.dictionaryId, dictionary!.id), eq(s.dictionaryEntry.code, value)));
    if (existing) {
      if (existing.retiredAt) { await db.update(s.dictionaryEntry).set({ retiredAt: null }).where(eq(s.dictionaryEntry.id, existing.id));
        return { ...existing, retiredAt: null }; }
      return existing;
    }
    const [entry] = await db.insert(s.dictionaryEntry).values({ dictionaryId: dictionary!.id, code: value, parentEntryId }).returning();
    await db.insert(s.dictionaryEntryTranslation).values({ dictionaryEntryId: entry!.id, language: 'en', name: 'Fixture reference' });
    return entry!;
  };
  const site = async (owner = profile, persisted = true) => {
    const [identity] = await db.insert(s.productionSiteIdentity).values({ profileId: owner.id, organizationId: owner.organizationId }).returning();
    if (persisted) {
      const main = await section('main_information', owner);
      const [row] = await db.select().from(s.mainInformation).where(eq(s.mainInformation.sectionRevisionId, main.workingRevisionId!));
      await db.insert(s.productionSite).values({ mainInformationId: row!.id, organizationId: owner.organizationId,
        identityId: identity!.id, address: 'Fixture road', city: 'Fixture city' });
    }
    return identity!;
  };
  const cert = async (owner = profile, group: 'product' | 'company' = 'product', notHeld = false, fileObjectId: string | null = null) => {
    const [identity] = await db.insert(s.certificateIdentity).values({ profileId: owner.id, organizationId: owner.organizationId }).returning();
    const current = await section('certificates', owner);
    const [row] = await db.insert(s.certificate).values({ sectionRevisionId: current.workingRevisionId!, organizationId: owner.organizationId,
      identityId: identity!.id, group, notHeld, number: notHeld ? null : 'Fixture certificate', fileObjectId }).returning();
    return { identity: identity!, row: row! };
  };
  const file = async (purpose: FilePurpose = 'unified_register_extract', scanState: 'pending' | 'passed' | 'rejected' = 'passed', owner = profile) => {
    const [object] = await db.insert(s.fileObject).values({ organizationId: owner.organizationId, purpose, dataClass: 'b_manufacturer' }).returning();
    const [version] = await db.insert(s.fileVersion).values({ fileObjectId: object!.id, versionNumber: 1,
      originalName: 'Fixture evidence.pdf', byteSize: 100, declaredMediaType: 'application/pdf', detectedMediaType: 'application/pdf',
      checksum: 'a'.repeat(64), scanState, rejectionReason: scanState === 'rejected' ? 'malware' : null,
      uploadedBy: accountId, storageKey: randomUUID() }).returning();
    return { object: object!, version: version! };
  };
  const complete = async () => {
    const group = await reference('commodity_group', 'A');
    const type = await reference('commodity_type', undefined, group.id);
    const tn = await reference('tn_ved', String(++seed).padStart(10, '0'));
    const kpved = await reference('kpved', `00.${++seed}`);
    const unit = await reference('unit', 'pieces');
    const productionSite = await site();
    return { row: { ...manual(), nameEn: 'Fixture goods', nameRu: 'Тестовый товар', commodityTypeId: type.id,
      tnVedEntryId: tn.id, kpvedEntryIds: [kpved.id], capacityQuantity: '0', capacityUnitId: unit.id,
      productionSiteIdentityId: productionSite.id }, type, tn, kpved, unit, productionSite };
  };
  const sourceLine = async (source: 'e_ondiris' | 'migration' = 'e_ondiris') => {
    const current = await section('products');
    const [identity] = await db.insert(s.productLineIdentity).values({ profileId: profile.id, organizationId: profile.organizationId }).returning();
    const [line] = await db.insert(s.productLine).values({ sectionRevisionId: current.workingRevisionId!, organizationId: profile.organizationId,
      identityId: identity!.id, source, nameEn: 'Source fixture', nameRu: 'Источник', tnVedCode: '0001234567',
      capacityQuantity: '9007199254740993.000000000000000001', capacityText: 'Source capacity including units',
      inCountryValueShare: '12.34', enstruCode: '0009', enstruName: 'Source classification',
      unifiedRegisterRegistrationNumber: '0012', unifiedRegisterActive: false, unifiedRegisterIncludedOn: '2026-11-01' }).returning();
    await db.insert(s.productLineKpved).values([{ productLineId: line!.id, organizationId: profile.organizationId, code: '00.11', sourceName: 'Source one' },
      { productLineId: line!.id, organizationId: profile.organizationId, code: '00.22', sourceName: 'Source two', positionInList: 1 }]);
    return line!;
  };
  const verify = async (kind: 'products' | 'production', revisionId: string) => {
    const current = await section(kind);
    await db.transaction(async (tx) => {
      if (kind === 'products') await captureRevisionFileVersions(tx as Database, { sectionRevisionId: revisionId, organizationId: profile.organizationId });
      await tx.update(s.sectionRevision).set({ state: 'submitted', submittedAt: new Date() }).where(eq(s.sectionRevision.id, revisionId));
      await tx.update(s.profileSection).set({ workingRevisionId: null, verifiedRevisionId: revisionId }).where(eq(s.profileSection.id, current.id));
      await tx.update(s.sectionRevision).set({ state: 'verified' }).where(eq(s.sectionRevision.id, revisionId));
      await tx.update(s.manufacturerProfile).set({ status: 'verified' }).where(eq(s.manufacturerProfile.id, profile.id));
    });
  };

  it('saves partial drafts and distinguishes the mandatory product count from optional extract', async () => {
    const initial = await read();
    expect(initial.completeness).toEqual({ percent: 0, missing: [{ path: 'products', code: 'product_required' }] });
    expect(initial.data).toMatchObject({ editable: empty(), lines: [], extract: null,
      selectedReferences: { commodityTypes: [], tnVed: [], kpved: [], units: [] } });
    expect((await save(empty())).status).toBe(200);
    expect((await read()).editVersion).toBe(0);
    const saved = ownProductsSchema.parse(await (await save({ ...empty(), products: [manual()] })).json());
    expect(saved.completeness.missing.map((field) => field.path)).toContain('products.0.productionSiteIdentityId');
    expect(saved.completeness.missing.map((field) => field.path)).not.toContain('unifiedRegisterExtractId');
  });
  it('stores exact capacity, dictionary code zeros and derived A–E group; zero reaches 100%', async () => {
    const { row, tn, kpved } = await complete();
    const saved = ownProductsSchema.parse(await (await save({ ...empty(), products: [row] })).json());
    expect(saved.completeness).toEqual({ percent: 100, missing: [] });
    expect(saved.data.lines[0]).toMatchObject({ capacityQuantity: '0', inCountryValueShare: '0', tnVedCode: tn.code,
      kpved: [{ code: kpved.code, entryId: kpved.id }] });
    expect(saved.data.selectedReferences.commodityTypes[0]?.group?.code).toBe('A');
    const second = ownProductsSchema.parse(await (await save({ ...saved.data.editable,
      products: [{ ...row, capacityQuantity: '0009007199254740993.00000000000000000100' }] }, saved.editVersion)).json());
    expect(second.data.lines[0]?.capacityQuantity).toBe('9007199254740993.000000000000000001');
    const [stored] = await db.select().from(s.productLine).where(eq(s.productLine.sectionRevisionId, second.revisionId));
    expect(stored?.capacityQuantity).toBe('9007199254740993.000000000000000001');
  });
  it('does not embed huge catalogues in the product read payload', async () => {
    const { row, tn } = await complete();
    await reference('tn_ved', String(++seed).padStart(10, '0'));
    const saved = ownProductsSchema.parse(await (await save({ ...empty(), products: [row] })).json());
    expect(saved.data.selectedReferences.tnVed.map((ref) => ref.id)).toEqual([tn.id]);
  });
  it('rejects different manual identities with the same normalized name and textual TN code atomically', async () => {
    const { row } = await complete();
    const duplicate = { ...row, identityId: randomUUID(), nameEn: '  ＦＩＸＴＵＲＥ\t ＧＯＯＤＳ  ', nameRu: 'Иное имя' };
    const response = await save({ ...empty(), products: [row, duplicate] });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errors: [{ code: 'duplicate_product' }] });
    expect((await read()).editVersion).toBe(0);
    expect(await db.select().from(s.productLine).where(eq(s.productLine.organizationId, profile.organizationId))).toHaveLength(0);
    expect(await db.select().from(s.productLineIdentity).where(eq(s.productLineIdentity.organizationId, profile.organizationId))).toHaveLength(0);
  });
  it('rejects a new manual duplicate against a retained registry name alias without altering source facts', async () => {
    const source = await sourceLine();
    const { row } = await complete();
    const tn = await reference('tn_ved', source.tnVedCode!);
    const initial = await read();
    const response = await save({ ...initial.data.editable, products: [...initial.data.editable.products,
      { ...row, tnVedEntryId: tn.id, nameEn: 'Different English spelling', nameRu: '  ИСТОЧНИК  ' }] });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errors: [{ path: 'products.1', code: 'duplicate_product' }] });
    expect((await db.select().from(s.productLine).where(eq(s.productLine.id, source.id)))[0]).toEqual(source);
  });
  it('permits the same TN code with different names and the same name with a different TN code', async () => {
    const { row } = await complete();
    const otherTn = await reference('tn_ved', String(++seed).padStart(10, '0'));
    const products = [row, { ...row, identityId: randomUUID(), nameEn: 'Distinct product', nameRu: 'Отдельный товар' },
      { ...row, identityId: randomUUID(), tnVedEntryId: otherTn.id }];
    const response = await save({ ...empty(), products });
    expect(response.status).toBe(200);
    const saved = ownProductsSchema.parse(await response.json());
    expect(saved.completeness.percent).toBe(100);
    expect(saved.data.lines.map((line) => line.identityId)).toEqual(products.map((line) => line.identityId));
  });
  it('rejects an existing manual line changed to another current product pair', async () => {
    const { row } = await complete();
    const distinct = { ...row, identityId: randomUUID(), nameEn: 'Different product', nameRu: 'Другой товар' };
    const initial = ownProductsSchema.parse(await (await save({ ...empty(), products: [row, distinct] })).json());
    const response = await save({ ...initial.data.editable, products: [row, { ...distinct, nameEn: row.nameEn, nameRu: row.nameRu }] }, initial.editVersion);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errors: [{ path: 'products.1', code: 'duplicate_product' }] });
    expect((await read()).data.lines.map((line) => line.nameEn)).toEqual([row.nameEn, distinct.nameEn]);
  });
  it('keeps unchanged migration duplicates as incomplete drafts and resolves them by explicit edits', async () => {
    const { row, tn, kpved } = await complete();
    const current = await section('products');
    const products = [row, { ...row, identityId: randomUUID() }];
    await db.insert(s.productLineIdentity).values(products.map((line) => ({ id: line.identityId, profileId: profile.id, organizationId: profile.organizationId })));
    for (const [positionInList, product] of products.entries()) {
      const [line] = await db.insert(s.productLine).values({ sectionRevisionId: current.workingRevisionId!, organizationId: profile.organizationId,
        identityId: product.identityId, source: 'migration', nameEn: product.nameEn, nameRu: product.nameRu,
        commodityTypeId: product.commodityTypeId, tnVedEntryId: tn.id, tnVedCode: tn.code,
        capacityQuantity: product.capacityQuantity, capacityUnitId: product.capacityUnitId,
        productionSiteIdentityId: product.productionSiteIdentityId, positionInList }).returning();
      await db.insert(s.productLineKpved).values({ productLineId: line!.id, organizationId: profile.organizationId, code: kpved.code, kpvedEntryId: kpved.id });
    }
    const initial = await read();
    expect(initial.completeness.percent).toBeLessThan(100);
    expect(initial.completeness.missing).toEqual([{ path: 'products.0', code: 'duplicate_product' }, { path: 'products.1', code: 'duplicate_product' }]);
    const local = ownProductsSchema.parse(await (await save({ ...initial.data.editable,
      products: initial.data.editable.products.map((product) => ({ ...product, note: 'Unresolved migration note' })) })).json());
    expect(local.data.lines).toHaveLength(2);
    expect(local.completeness.missing).toEqual(initial.completeness.missing);
    const resolved = ownProductsSchema.parse(await (await save({ ...local.data.editable,
      products: [local.data.editable.products[0], { ...local.data.editable.products[1], nameEn: 'Resolved distinct product', nameRu: 'Уточнённый товар' }] }, local.editVersion)).json());
    expect(resolved.completeness).toEqual({ percent: 100, missing: [] });
    expect(resolved.data.lines.map((line) => line.identityId)).toEqual(products.map((product) => product.identityId));
  });
  it('retains duplicate registry entries as separate immutable source records', async () => {
    const one = await sourceLine(); const two = await sourceLine();
    const initial = await read();
    expect(initial.completeness.percent).toBe(100);
    const response = await save({ ...initial.data.editable,
      products: initial.data.editable.products.map((product) => ({ ...product, note: 'Source association note' })) });
    expect(response.status).toBe(200);
    const saved = ownProductsSchema.parse(await response.json());
    expect(new Set(saved.data.lines.map((line) => line.identityId))).toEqual(new Set([one.identityId, two.identityId]));
    expect(saved.data.lines.every((line) => line.source === 'e_ondiris')).toBe(true);
  });
  it('binding an unresolved migrated TN code preserves zeros and keeps unchanged duplicate drafts flagged', async () => {
    await sourceLine('migration'); await sourceLine('migration');
    const initial = await read();
    expect(initial.completeness.missing.filter((field) => field.code === 'duplicate_product')).toHaveLength(2);
    const tn = await reference('tn_ved', '0001234567');
    const kpved = await reference('kpved', '00.11');
    const response = await save({ ...initial.data.editable, products: initial.data.editable.products.map((row) =>
      row.kind === 'manual' ? { ...row, tnVedEntryId: tn.id, kpvedEntryIds: [kpved.id], note: 'Classification binding only' } : row) });
    expect(response.status).toBe(200);
    const saved = ownProductsSchema.parse(await response.json());
    expect(saved.data.lines.every((line) => line.tnVedCode === '0001234567' && line.tnVedEntryId === tn.id)).toBe(true);
    expect(saved.data.lines.every((line) => line.kpved.some((entry) => entry.entryId === kpved.id
      && entry.code === '00.11' && entry.sourceName === 'Source one'))).toBe(true);
    expect(saved.completeness.missing.filter((field) => field.code === 'duplicate_product')).toHaveLength(2);
    expect(saved.data.lines.map((line) => line.identityId)).toEqual(initial.data.lines.map((line) => line.identityId));
  });
  it('duplicate rejection during COW rolls back the copy; a valid correction retains all stable identities', async () => {
    const { row } = await complete();
    const second = { ...row, identityId: randomUUID(), nameEn: 'Distinct frozen product', nameRu: 'Отдельный опубликованный товар' };
    const initial = ownProductsSchema.parse(await (await save({ ...empty(), products: [row, second] })).json());
    await verify('products', initial.revisionId);
    const response = await save({ ...initial.data.editable, products: [row, { ...second, nameEn: row.nameEn, nameRu: row.nameRu }] }, initial.editVersion);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errors: [{ path: 'products.1', code: 'duplicate_product' }] });
    const current = await section('products');
    expect(current.workingRevisionId).toBeNull();
    const frozen = await read();
    expect(frozen.revisionId).toBe(initial.revisionId);
    expect(frozen.data.lines).toEqual(initial.data.lines);
    const changed = ownProductsSchema.parse(await (await save({ ...frozen.data.editable,
      products: [row, { ...second, nameEn: 'Corrected distinct name', nameRu: 'Уточнённый отдельный товар' }] }, frozen.editVersion)).json());
    expect(changed.revisionId).not.toBe(frozen.revisionId);
    expect(changed.data.lines.map((line) => line.identityId)).toEqual([row.identityId, second.identityId]);
    expect(changed.data.lines).toHaveLength(2);
    const historical = await db.select().from(s.productLine).where(eq(s.productLine.sectionRevisionId, frozen.revisionId));
    expect(new Set(historical.map((line) => line.nameEn))).toEqual(new Set([row.nameEn, second.nameEn]));
  });
  it('accepts shared held product certificates and pending files in a draft', async () => {
    const { row } = await complete();
    const pending = await file('certificate_file', 'pending');
    const held = await cert(profile, 'product', false, pending.object.id);
    const extract = await file('unified_register_extract', 'pending');
    const second = { ...row, identityId: randomUUID(), nameEn: 'Second fixture product', nameRu: 'Второй тестовый товар' };
    const response = await save({ products: [row, second].map((line) => ({ ...line, certificateIdentityIds: [held.identity.id] })),
      unifiedRegisterExtractId: extract.object.id });
    expect(response.status).toBe(200);
    const saved = ownProductsSchema.parse(await response.json());
    expect(saved.completeness.percent).toBe(100);
    expect(saved.data.extract).toMatchObject({ scanState: 'pending', canDownload: false });
    expect(saved.data.relatedChoices?.productCertificates.map((item) => item.identityId)).toContain(held.identity.id);
    expect(saved.data.lines.every((line) => line.certificateIdentityIds[0] === held.identity.id)).toBe(true);
  });
  it.each(['foreign', 'identity_only', 'removed'] as const)('rejects %s production sites rather than accepting identity existence', async (kind) => {
    const selected = await site(kind === 'foreign' ? foreignProfile : profile, kind !== 'identity_only');
    if (kind === 'removed') await db.delete(s.productionSite).where(eq(s.productionSite.identityId, selected.id));
    const response = await save({ ...empty(), products: [{ ...manual(), productionSiteIdentityId: selected.id }] });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errors: [{ code: 'site_invalid' }] });
  });
  it.each(['foreign', 'company', 'notHeld', 'identity_only', 'removed'] as const)('rejects %s certificates outside the held current product graph', async (kind) => {
    const selected = await cert(kind === 'foreign' ? foreignProfile : profile, kind === 'company' ? 'company' : 'product', kind === 'notHeld');
    if (kind === 'identity_only' || kind === 'removed') await db.delete(s.certificate).where(eq(s.certificate.id, selected.row.id));
    const response = await save({ ...empty(), products: [{ ...manual(), certificateIdentityIds: [selected.identity.id] }] });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errors: [{ code: 'certificate_invalid' }] });
  });
  it.each(['wrong_kind', 'foreign'] as const)('rejects %s product identities', async (kind) => {
    const identity = kind === 'wrong_kind' ? await site() : (await db.insert(s.productLineIdentity).values({
      profileId: foreignProfile.id, organizationId: foreignProfile.organizationId }).returning())[0]!;
    const response = await save({ ...empty(), products: [{ ...manual(), identityId: identity.id }] });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errors: [{ code: 'identity_invalid' }] });
  });
  it('rejects forged registry lines, converting a registry line to manual, omission, and source-owned fields', async () => {
    const line = await sourceLine();
    const initial = await read();
    for (const products of [[], [{ ...manual(), identityId: line.identityId }],
      [{ kind: 'registry', identityId: randomUUID(), note: null, productionSiteIdentityId: null, certificateIdentityIds: [] }]]) {
      const response = await save({ ...empty(), products });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ errors: [{ code: 'product_source_locked' }] });
    }
    expect((await save({ ...initial.data.editable, products: [{ ...initial.data.editable.products[0], nameEn: 'Tampered' }] })).status).toBe(400);
    expect((await read()).editVersion).toBe(0);
  });
  it('keeps every registry fact and multiple raw classifications immutable when local associations change', async () => {
    const line = await sourceLine();
    const selectedSite = await site(); const held = await cert();
    const initial = await read();
    const response = await save({ ...initial.data.editable, products: [{ ...initial.data.editable.products[0],
      productionSiteIdentityId: selectedSite.id, certificateIdentityIds: [held.identity.id], note: 'Local note' }] });
    expect(response.status).toBe(200);
    const saved = ownProductsSchema.parse(await response.json());
    expect(saved.data.lines[0]).toMatchObject({ source: 'e_ondiris', unifiedRegisterActive: false, inCountryValueShare: '12.34',
      tnVedCode: '0001234567', kpved: [{ code: '00.11', sourceName: 'Source one' }, { code: '00.22', sourceName: 'Source two' }] });
    const [after] = await db.select().from(s.productLine).where(eq(s.productLine.id, line.id));
    const facts = ({ productionSiteIdentityId: _site, note: _note, positionInList: _position, ...rest }: typeof line) => rest;
    expect(facts(after!)).toEqual(facts(line));
    expect(after?.eOndirisRecordId).toBeNull();
  });
  it('lets manufacturers complete migrated manual lines without erasing unresolved source spellings', async () => {
    const line = await sourceLine('migration');
    const initial = await read();
    expect(initial.data.editable.products[0]?.kind).toBe('manual');
    expect(initial.data.lines[0]?.inCountryValueShare).toBe('0');
    const first = ownProductsSchema.parse(await (await save({ ...initial.data.editable,
      products: [{ ...initial.data.editable.products[0], note: 'Completing migration' }] })).json());
    expect(first.data.lines[0]).toMatchObject({ source: 'migration', tnVedCode: line.tnVedCode,
      kpved: [{ code: '00.11' }, { code: '00.22' }] });
    const { row } = await complete();
    const second = ownProductsSchema.parse(await (await save({ ...first.data.editable,
      products: [{ ...row, identityId: line.identityId }] }, first.editVersion)).json());
    expect(second.completeness.percent).toBe(100);
    expect(second.data.lines[0]?.source).toBe('migration');
    expect(second.data.lines[0]?.kpved).toHaveLength(3);
  });
  it('permits retaining retired references but not selecting them on another product', async () => {
    const { row, type, tn, kpved, unit } = await complete();
    const initial = ownProductsSchema.parse(await (await save({ ...empty(), products: [row] })).json());
    for (const entry of [type, tn, kpved, unit]) await db.update(s.dictionaryEntry).set({ retiredAt: new Date() }).where(eq(s.dictionaryEntry.id, entry.id));
    expect((await save({ ...initial.data.editable, products: [{ ...row, note: 'Keep references' }] }, initial.editVersion)).status).toBe(200);
    const current = await read();
    expect(current.data.selectedReferences.tnVed[0]?.retired).toBe(true);
    const response = await save({ ...current.data.editable, products: [...current.data.editable.products, { ...row, identityId: randomUUID() }] }, current.editVersion);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errors: [{ code: 'reference_retired' }] });
  });
  it('rejects wrong dictionaries and commodity types outside A–E even for partial drafts', async () => {
    const wrong = await reference('unit');
    const badGroup = await reference('commodity_group', 'Z');
    const badType = await reference('commodity_type', undefined, badGroup.id);
    for (const row of [{ ...manual(), tnVedEntryId: wrong.id }, { ...manual(), commodityTypeId: wrong.id },
      { ...manual(), commodityTypeId: badType.id }]) {
      const response = await save({ ...empty(), products: [row] });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ errors: [{ code: 'reference_invalid' }] });
    }
  });
  it('rejects forecast-only units as manual annual capacity units', async () => {
    const unit = await reference('unit', 'litres');
    const response = await save({ ...empty(), products: [{ ...manual(), capacityUnitId: unit.id }] });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errors: [{ code: 'reference_invalid' }] });
  });
  it.each(['foreign', 'wrong_purpose'] as const)('rejects %s section extract files', async (kind) => {
    const evidence = await file(kind === 'wrong_purpose' ? 'cv' : 'unified_register_extract', 'passed', kind === 'foreign' ? foreignProfile : profile);
    expect((await save({ ...empty(), unifiedRegisterExtractId: evidence.object.id })).status).toBe(400);
  });
  it('frozen reads keep stored facts and stable links without resolving later Main/certificates; COW keeps history', async () => {
    const { row } = await complete(); const held = await cert(); const extract = await file();
    const initial = ownProductsSchema.parse(await (await save({ products: [{ ...row, certificateIdentityIds: [held.identity.id] }],
      unifiedRegisterExtractId: extract.object.id })).json());
    await verify('products', initial.revisionId);
    await db.update(s.productionSite).set({ address: 'Later working address' }).where(eq(s.productionSite.identityId, row.productionSiteIdentityId));
    await db.update(s.certificate).set({ number: 'Later certificate number' }).where(eq(s.certificate.id, held.row.id));
    const frozen = await read();
    expect(frozen.data.relatedChoices).toBeNull();
    expect(frozen.data.lines).toEqual(initial.data.lines);
    expect(frozen.data.extract?.versionId).toBe(extract.version.id);
    const changed = ownProductsSchema.parse(await (await save({ ...frozen.data.editable,
      products: [{ ...row, certificateIdentityIds: [held.identity.id], nameEn: 'New product name' }] }, frozen.editVersion)).json());
    expect(changed.revisionId).not.toBe(frozen.revisionId);
    expect(changed.data.relatedChoices?.sites[0]?.address).toBe('Later working address');
    const [historical] = await db.select().from(s.productLine).where(eq(s.productLine.sectionRevisionId, frozen.revisionId));
    expect(historical?.nameEn).toBe(row.nameEn);
    expect(historical?.identityId).toBe(changed.data.lines[0]?.identityId);
  });
  it('pre-COW editor choices use current own sites and held product certificates without changing frozen content or audit', async () => {
    const { row } = await complete(); const held = await cert();
    const initial = ownProductsSchema.parse(await (await save({ ...empty(), products: [{ ...row, certificateIdentityIds: [held.identity.id] }] })).json());
    await verify('products', initial.revisionId);
    await db.update(s.productionSite).set({ address: 'Current corrected site' }).where(eq(s.productionSite.identityId, row.productionSiteIdentityId));
    await db.update(s.certificate).set({ number: 'Current corrected certificate' }).where(eq(s.certificate.id, held.row.id));
    const addedSite = await site(); const addedHeld = await cert();
    await site(foreignProfile); await cert(foreignProfile);
    await cert(profile, 'company'); await cert(profile, 'product', true);
    await site(profile, false);
    const removedCertificate = await cert(); await db.delete(s.certificate).where(eq(s.certificate.id, removedCertificate.row.id));
    const beforeRevisions = await db.select().from(s.sectionRevision).where(eq(s.sectionRevision.organizationId, profile.organizationId));
    const beforeAudit = await db.select().from(s.auditEntries).where(eq(s.auditEntries.organizationId, profile.organizationId));
    const beforeContent = await db.select().from(s.productLine).where(eq(s.productLine.sectionRevisionId, initial.revisionId));
    const response = await http.get(`${ROOT}/choices?profileId=${foreignProfile.id}&organizationId=${foreignProfile.organizationId}`, 'manufacturer');
    expect(response.status).toBe(200);
    const choices = productsReadSchema.shape.relatedChoices.unwrap().parse(await response.json());
    expect(new Set(choices.sites.map((site) => site.identityId))).toEqual(new Set([row.productionSiteIdentityId, addedSite.id]));
    expect(choices.sites.find((site) => site.identityId === row.productionSiteIdentityId)?.address).toBe('Current corrected site');
    expect(new Set(choices.productCertificates.map((certificate) => certificate.identityId))).toEqual(new Set([held.identity.id, addedHeld.identity.id]));
    expect(choices.productCertificates.find((certificate) => certificate.identityId === held.identity.id)?.number).toBe('Current corrected certificate');
    const frozen = await read();
    expect(frozen.revisionId).toBe(initial.revisionId);
    expect(frozen.editVersion).toBe(initial.editVersion);
    expect(frozen.data.relatedChoices).toBeNull();
    expect(frozen.data.lines).toEqual(initial.data.lines);
    expect((await section('products')).workingRevisionId).toBeNull();
    expect(await db.select().from(s.productLine).where(eq(s.productLine.sectionRevisionId, initial.revisionId))).toEqual(beforeContent);
    expect(await db.select().from(s.sectionRevision).where(eq(s.sectionRevision.organizationId, profile.organizationId))).toEqual(beforeRevisions);
    expect(await db.select().from(s.auditEntries).where(eq(s.auditEntries.organizationId, profile.organizationId))).toEqual(beforeAudit);
  });
  it.each(['submitted', 'under_review'] as const)('denies product editor candidates while the profile is %s', async (status) => {
    await db.update(s.manufacturerProfile).set({ status }).where(eq(s.manufacturerProfile.id, profile.id));
    const response = await http.get(`${ROOT}/choices`, 'manufacturer');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'profile_locked' });
  });
  it('denies product editor candidates for verified profiles with sent pending changes', async () => {
    const initial = ownProductsSchema.parse(await (await save({ ...empty(), products: [manual()] })).json());
    const current = await section('products');
    await db.transaction(async (tx) => {
      await tx.update(s.sectionRevision).set({ state: 'submitted', submittedAt: new Date() }).where(eq(s.sectionRevision.id, initial.revisionId));
      await tx.update(s.profileSection).set({ workingRevisionId: null, pendingRevisionId: initial.revisionId }).where(eq(s.profileSection.id, current.id));
      await tx.update(s.manufacturerProfile).set({ status: 'verified' }).where(eq(s.manufacturerProfile.id, profile.id));
    });
    const response = await http.get(`${ROOT}/choices`, 'manufacturer');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'profile_locked' });
  });
  it('requires authentication and manufacturer own-edit permission for product editor choices', async () => {
    expect((await http.get(`${ROOT}/choices`)).status).toBe(401);
    expect((await http.get(`${ROOT}/choices`, 'operator')).status).toBe(403);
    expect((await http.get(`${ROOT}/choices`, 'expert')).status).toBe(403);
  });
  it('rechecks tenant ownership from the persisted account despite a stale authenticated session', async () => {
    await db.update(s.userAccounts).set({ organizationId: foreignProfile.organizationId }).where(eq(s.userAccounts.id, accountId));
    const response = await http.get(`${ROOT}/choices`, 'manufacturer');
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'forbidden' });
  });
  it('current equipment links block manual product removal, while unlinked historical equipment does not', async () => {
    const { row } = await complete();
    const initial = ownProductsSchema.parse(await (await save({ ...empty(), products: [row] })).json());
    const production = await section('production');
    const [item] = await db.insert(s.equipmentItem).values({ sectionRevisionId: production.workingRevisionId!,
      organizationId: profile.organizationId, name: 'Fixture equipment' }).returning();
    await db.insert(s.equipmentProductLine).values({ equipmentItemId: item!.id, organizationId: profile.organizationId, productLineIdentityId: row.identityId });
    const blocked = await save(empty(), initial.editVersion);
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toMatchObject({ errors: [{ code: 'product_in_use' }] });
    await verify('production', production.workingRevisionId!);
    await db.transaction(async (tx) => {
      const [working] = await tx.insert(s.sectionRevision).values({ profileSectionId: production.id, organizationId: profile.organizationId,
        revisionNumber: 2, state: 'working', origin: 'manufacturer' }).returning();
      await tx.update(s.profileSection).set({ workingRevisionId: working!.id }).where(eq(s.profileSection.id, production.id));
    });
    const removed = await save(empty(), initial.editVersion);
    expect(removed.status).toBe(200);
    expect(ownProductsSchema.parse(await removed.json()).data.lines).toEqual([]);
    expect(await db.select().from(s.equipmentProductLine).where(eq(s.equipmentProductLine.equipmentItemId, item!.id))).toHaveLength(1);
  });
  it('saves more than a thousand products in batches without a business count cap', async () => {
    const products = Array.from({ length: 1001 }, () => manual());
    const response = await save({ ...empty(), products });
    expect(response.status).toBe(200);
    const saved = ownProductsSchema.parse(await response.json());
    expect(saved.data.lines).toHaveLength(1001);
    expect(await db.select().from(s.productLine).where(eq(s.productLine.sectionRevisionId, saved.revisionId))).toHaveLength(1001);
  });
});
