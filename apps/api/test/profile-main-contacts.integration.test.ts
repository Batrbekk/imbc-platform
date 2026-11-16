import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  displayCompleteness,
  ownContactsSchema,
  ownMainInformationSchema,
  ownSectionsOverviewSchema,
  PROFILE_JSON_MAX_BYTES,
  type ContactsWrite,
  type MainInformationWrite,
  type ProfileContact,
} from '@imbc/contracts';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { ContactsHandler } from '../src/modules/profiles/contacts.handler.js';
import { MainInformationHandler } from '../src/modules/profiles/main-information.handler.js';
import { ProfileSectionsController } from '../src/modules/profiles/profile-sections.controller.js';
import { ProfileSectionsService } from '../src/modules/profiles/profile-sections.service.js';
import { defineSectionHandler } from '../src/modules/profiles/section-handler.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp, type HttpStand } from './support/http.js';

const ROOT = '/api/v1/profiles/own/sections';
const PHONE = '+44 20 1234 5678';
const CHECKED_A = new Date('2026-11-15T10:00:00Z');
const CHECKED_B = new Date('2026-11-16T10:00:00Z');

/** Saved source fixtures only: no connector, pg-boss enqueue, email, or quota call. */
function sourcePayload(name = 'Source company', count = 75) {
  return {
    basic: {
      name_ru: name,
      legal_form: 'Unmapped legal form as supplied',
      legal_address: 'Source legal address',
      fullname_director: 'Source director',
      date_registration: '2020-02-29',
      okeds: Array.from({ length: count }, (_, index) => ({
        i: `0${String(index).padStart(4, '0')}`,
        name_ru: `Source OKED ${index}`,
      })),
    },
    founders: { founders_dtl: Array.from({ length: count }, (_, index) => ({ name: `Source founder ${index}` })) },
    kzCoContact: { phones: [{ contact: PHONE }], emails: [{ contact: 'Source@company.local' }] },
  };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('MAN-06–15 main information and contacts with real handlers', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;
  let db: Database;
  let http: HttpStand;
  let profile: typeof s.manufacturerProfile.$inferSelect;
  let foreign: typeof s.manufacturerProfile.$inferSelect;
  let region: string;
  let role: string;
  let binSeed = 0;

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema: s, casing: 'snake_case' });
  }, 60000);

  const entry = async (kind: string, code: string) => {
    const [dictionary] = await db.select().from(s.dictionary).where(eq(s.dictionary.code, kind));
    const [existing] = await db
      .select()
      .from(s.dictionaryEntry)
      .where(and(eq(s.dictionaryEntry.dictionaryId, dictionary!.id), eq(s.dictionaryEntry.code, code)));
    if (existing) return existing.id;
    const [row] = await db.insert(s.dictionaryEntry).values({ dictionaryId: dictionary!.id, code }).returning();
    return row!.id;
  };

  beforeEach(async () => {
    const suffix = randomUUID();
    const [org] = await db
      .insert(s.organizations)
      .values({ type: 'manufacturer', name: `Main ${suffix}`, bin: `2412${String(++binSeed).padStart(8, '0')}` })
      .returning();
    const [other] = await db
      .insert(s.organizations)
      .values({ type: 'manufacturer', name: `Foreign ${suffix}`, bin: `2412${String(++binSeed).padStart(8, '0')}` })
      .returning();
    const [account] = await db
      .insert(s.userAccounts)
      .values({ organizationId: org!.id, role: 'manufacturer', state: 'active', email: `owner-${suffix}@test.local` })
      .returning();
    const [own] = await db.insert(s.manufacturerProfile).values({ organizationId: org!.id }).returning();
    const [otherProfile] = await db.insert(s.manufacturerProfile).values({ organizationId: other!.id }).returning();
    profile = own!;
    foreign = otherProfile!;
    region = await entry('region', `KZ-${suffix}`);
    role = await entry('contact_role', 'management');
    const service = new ProfileSectionsService(pool, new AuditService(db), [
      defineSectionHandler(new MainInformationHandler()),
      defineSectionHandler(new ContactsHandler()),
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

  const mainRead = async () =>
    ownMainInformationSchema.parse(await (await http.get(`${ROOT}/main_information`, 'manufacturer')).json());
  const contactsRead = async () =>
    ownContactsSchema.parse(await (await http.get(`${ROOT}/contacts`, 'manufacturer')).json());
  const mainSave = (data: MainInformationWrite, editVersion = 0) =>
    http.send('PUT', `${ROOT}/main_information`, 'manufacturer', { editVersion, data });
  const contactsSave = (data: ContactsWrite, editVersion = 0) =>
    http.send('PUT', `${ROOT}/contacts`, 'manufacturer', { editVersion, data });
  const main = (sites = 2): MainInformationWrite => ({
    website: 'https://company.example',
    companyPhone: PHONE,
    contactEmail: 'Company@Test.local',
    sites: Array.from({ length: sites }, (_, index) => ({
      identityId: null,
      address: `Production address ${index}`,
      city: `Production city ${index}`,
      regionId: region,
    })),
  });
  const contact = (index: number, focal = index === 0): ProfileContact => ({
    fullName: `Contact ${index}`,
    position: `Position ${index}`,
    email: `Contact${index}@Test.local`,
    phone: `+44 1234 ${String(index + 1).padStart(6, '0')}`,
    roleId: role,
    isFocalPoint: focal,
  });

  const storedSource = async (target: typeof profile, value: unknown, completedAt = CHECKED_A) => {
    let [check] = await db
      .select()
      .from(s.externalCheck)
      .where(and(eq(s.externalCheck.profileId, target.id), eq(s.externalCheck.connector, 'adata')));
    if (!check)
      [check] = await db
        .insert(s.externalCheck)
        .values({ profileId: target.id, organizationId: target.organizationId, connector: 'adata' })
        .returning();
    const [org] = await db.select().from(s.organizations).where(eq(s.organizations.id, target.organizationId));
    const [attempt] = await db
      .insert(s.externalCheckAttempt)
      .values({
        externalCheckId: check!.id,
        trigger: check!.latestAttemptId ? 'quarterly' : 'profile_created',
        state: 'received',
        bin: org!.bin!,
        requestedAt: new Date(completedAt.getTime() - 60000),
        completedAt,
        value,
        source: 'adata.companyInfo',
      })
      .returning();
    await db.update(s.externalCheck).set({ latestAttemptId: attempt!.id }).where(eq(s.externalCheck.id, check!.id));
    return { check: check!, attempt: attempt! };
  };

  const freezeMain = async (revisionId: string) => {
    const [section] = await db
      .select()
      .from(s.profileSection)
      .where(and(eq(s.profileSection.profileId, profile.id), eq(s.profileSection.kind, 'main_information')));
    await db.transaction(async (tx) => {
      await tx
        .update(s.sectionRevision)
        .set({ state: 'submitted', submittedAt: new Date() })
        .where(eq(s.sectionRevision.id, revisionId));
      await tx
        .update(s.profileSection)
        .set({ workingRevisionId: null, verifiedRevisionId: revisionId })
        .where(eq(s.profileSection.id, section!.id));
      await tx.update(s.sectionRevision).set({ state: 'verified' }).where(eq(s.sectionRevision.id, revisionId));
      await tx
        .update(s.manufacturerProfile)
        .set({ status: 'verified' })
        .where(eq(s.manufacturerProfile.id, profile.id));
    });
  };

  it('two complete production sites and an international phone reach 100 without source data; identities survive correction and no-op', async () => {
    const firstResponse = await mainSave(main());
    expect(firstResponse.status).toBe(200);
    const first = ownMainInformationSchema.parse(await firstResponse.json());
    expect(first.completeness).toEqual({ percent: 100, missing: [] });
    expect(first.data.source.state).toBe('not_requested');
    expect(first.data.legalInformation.legalName).toBeNull();
    expect(first.data.editable).toMatchObject({
      companyPhone: '+442012345678',
      contactEmail: 'company@test.local',
      website: 'https://company.example/',
    });
    expect(new Set(first.data.editable.sites.map(({ identityId }) => identityId)).size).toBe(2);
    const ids = first.data.editable.sites.map(({ identityId }) => identityId);
    const corrected = structuredClone(first.data.editable);
    corrected.sites[0]!.address = 'Corrected production address';
    const next = ownMainInformationSchema.parse(await (await mainSave(corrected, first.editVersion)).json());
    expect(next.data.editable.sites.map(({ identityId }) => identityId)).toEqual(ids);
    const noOp = ownMainInformationSchema.parse(await (await mainSave(next.data.editable, next.editVersion)).json());
    expect(noOp).toMatchObject({ editVersion: next.editVersion, revisionId: next.revisionId, savedAt: next.savedAt });
    expect((await mainRead()).data.editable).toEqual(next.data.editable);
  });

  it('partial drafts save; source fields, BIN/login, OKED and founders are refused rather than overwritten', async () => {
    const partial: MainInformationWrite = {
      website: null,
      companyPhone: null,
      contactEmail: null,
      sites: [{ identityId: null, address: null, city: null, regionId: null }],
    };
    expect((await mainSave(partial)).status).toBe(200);
    const before = await mainRead();
    expect(before.completeness.percent).toBeLessThan(100);
    for (const key of ['bin', 'loginEmail', 'legalInformation', 'legalName', 'oked', 'founders']) {
      const response = await http.send('PUT', `${ROOT}/main_information`, 'manufacturer', {
        editVersion: before.editVersion,
        data: { ...partial, [key]: 'cannot write' },
      });
      expect(response.status).toBe(400);
    }
    expect(await mainRead()).toEqual(before);
  });

  it('unavailable Adata is a source state, never a completeness requirement or leaked diagnostic payload', async () => {
    const source = await storedSource(profile, sourcePayload('Unavailable private payload', 1));
    await db
      .update(s.externalCheckAttempt)
      .set({ state: 'unavailable', failure: 'private-diagnostic-marker' })
      .where(eq(s.externalCheckAttempt.id, source.attempt.id));
    const result = ownMainInformationSchema.parse(await (await mainSave(main())).json());
    expect(result.completeness.percent).toBe(100);
    expect(result.data.source.state).toBe('unavailable');
    expect(result.data.legalInformation.legalName).toBeNull();
    expect(JSON.stringify(result)).not.toContain('Unavailable private payload');
    expect(JSON.stringify(result)).not.toContain('private-diagnostic-marker');
  });

  it('clearing unsaved source phone/email records the explicit blank choice once and never re-applies prefills', async () => {
    await storedSource(profile, sourcePayload());
    const initial = await mainRead();
    expect(initial.data.editable).toMatchObject({
      companyPhone: '+442012345678',
      contactEmail: 'source@company.local',
    });
    const blank: MainInformationWrite = { website: null, companyPhone: null, contactEmail: null, sites: [] };
    const cleared = ownMainInformationSchema.parse(await (await mainSave(blank, initial.editVersion)).json());
    expect(cleared).toMatchObject({ editVersion: 1, savedAt: expect.any(String), revisionId: initial.revisionId });
    expect(cleared.data.editable).toEqual(blank);
    expect((await mainRead()).data.editable).toEqual(blank);
    const repeated = ownMainInformationSchema.parse(await (await mainSave(blank, cleared.editVersion)).json());
    expect(repeated).toMatchObject({
      editVersion: cleared.editVersion,
      savedAt: cleared.savedAt,
      revisionId: cleared.revisionId,
    });
  });

  it('wrong dictionary kind and another profile site identity are rejected with field paths', async () => {
    const wrong = main(1);
    wrong.sites[0]!.regionId = role;
    expect(await (await mainSave(wrong)).json()).toMatchObject({
      status: 400,
      code: 'validation',
      errors: [{ path: 'sites.0.regionId', code: 'reference_invalid' }],
    });
    const [identity] = await db
      .insert(s.productionSiteIdentity)
      .values({ profileId: foreign.id, organizationId: foreign.organizationId })
      .returning();
    wrong.sites[0]!.regionId = region;
    wrong.sites[0]!.identityId = identity!.id;
    expect(await (await mainSave(wrong)).json()).toMatchObject({
      status: 400,
      code: 'validation',
      errors: [{ path: 'sites.0.identityId', code: 'site_invalid' }],
    });
    expect((await mainRead()).editVersion).toBe(0);
  });

  it('retired region can be retained on an existing site but cannot be selected for a new site', async () => {
    const first = ownMainInformationSchema.parse(await (await mainSave(main(1))).json());
    await db.update(s.dictionaryEntry).set({ retiredAt: new Date() }).where(eq(s.dictionaryEntry.id, region));
    const retained = structuredClone(first.data.editable);
    retained.sites[0]!.city = 'Corrected city';
    const second = ownMainInformationSchema.parse(await (await mainSave(retained, first.editVersion)).json());
    second.data.editable.sites.push({ identityId: null, address: 'New address', city: 'New city', regionId: region });
    expect(await (await mainSave(second.data.editable, second.editVersion)).json()).toMatchObject({
      status: 400,
      errors: [{ path: 'sites.1.regionId', code: 'reference_retired' }],
    });
  });

  it('current product links preserve a site identity and prevent removing the site', async () => {
    const first = ownMainInformationSchema.parse(await (await mainSave(main())).json());
    const [products] = await db
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
        sectionRevisionId: products!.workingRevisionId!,
        organizationId: profile.organizationId,
        identityId: identity!.id,
        productionSiteIdentityId: first.data.editable.sites[0]!.identityId,
      })
      .returning();
    const correction = structuredClone(first.data.editable);
    correction.sites[0]!.address = 'Shared corrected address';
    const updated = ownMainInformationSchema.parse(await (await mainSave(correction, first.editVersion)).json());
    const remove = structuredClone(updated.data.editable);
    remove.sites.shift();
    expect(await (await mainSave(remove, updated.editVersion)).json()).toMatchObject({
      status: 400,
      errors: [{ path: 'sites', code: 'site_in_use' }],
    });
    expect((await mainRead()).data.editable.sites).toEqual(updated.data.editable.sites);
    const [stillLinked] = await db.select().from(s.productLine).where(eq(s.productLine.id, product!.id));
    expect(stillLinked!.productionSiteIdentityId).toBe(first.data.editable.sites[0]!.identityId);
  });

  it('reads complete source lists, anchors the first save, and never replaces a frozen or copied legal snapshot with a newer source response', async () => {
    await storedSource(profile, sourcePayload());
    const initial = await mainRead();
    expect(initial.data.legalInformation.oked).toHaveLength(75);
    expect(initial.data.legalInformation.founders).toHaveLength(75);
    expect(initial.data.legalInformation.oked[0]).toEqual({ code: '00000', name: 'Source OKED 0' });
    expect(initial.data.source).toEqual({ state: 'received', readAt: CHECKED_A.toISOString(), provenance: 'adata' });
    const first = ownMainInformationSchema.parse(await (await mainSave(main())).json());
    expect(first.completeness.percent).toBe(100);
    const [anchored] = await db
      .select()
      .from(s.mainInformation)
      .where(eq(s.mainInformation.sectionRevisionId, first.revisionId));
    expect(anchored).toMatchObject({ legalFormId: null, legalFormSourceName: 'Unmapped legal form as supplied' });
    expect(anchored!.legalDataCheckedAt?.toISOString()).toBe(CHECKED_A.toISOString());
    await freezeMain(first.revisionId);
    await storedSource(profile, sourcePayload('New source company', 1), CHECKED_B);
    const frozen = await mainRead();
    expect(frozen.data.legalInformation).toEqual(first.data.legalInformation);
    const workingInput = structuredClone(frozen.data.editable);
    workingInput.sites[0]!.address = 'Working corrected address';
    const copy = ownMainInformationSchema.parse(await (await mainSave(workingInput, frozen.editVersion)).json());
    expect(copy.revisionId).not.toBe(first.revisionId);
    expect(copy.data.legalInformation).toEqual(first.data.legalInformation);
    expect(copy.data.source.readAt).toBe(CHECKED_A.toISOString());
    const [oldSite] = await db
      .select()
      .from(s.productionSite)
      .where(eq(s.productionSite.mainInformationId, anchored!.id));
    expect(oldSite!.address).toBe('Production address 0');
    expect(copy.data.editable.sites[0]!.identityId).toBe(first.data.editable.sites[0]!.identityId);
  });

  it('a frozen revision without a source snapshot never reads a later global Adata response', async () => {
    const first = ownMainInformationSchema.parse(await (await mainSave(main())).json());
    await freezeMain(first.revisionId);
    await storedSource(profile, sourcePayload('Later source'));
    const frozen = await mainRead();
    expect(frozen.data.legalInformation.legalName).toBeNull();
    expect(frozen.data.legalInformation.founders).toEqual([]);
    expect(frozen.data.source.state).toBe('not_requested');
  });

  it('a legacy latest-attempt pointer to another check fails closed instead of exposing that company source payload', async () => {
    const otherSource = await storedSource(foreign, sourcePayload('Other private company', 1));
    await db.insert(s.externalCheck).values({
      profileId: profile.id,
      organizationId: profile.organizationId,
      connector: 'adata',
      latestAttemptId: otherSource.attempt.id,
    });
    const result = await mainRead();
    expect(result.data.legalInformation.legalName).toBeNull();
    expect(result.data.legalInformation.founders).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('Other private company');
  });

  it('two full contacts save with missing minimum count; three repeated roles and one focal point reach 100', async () => {
    const two = ownContactsSchema.parse(await (await contactsSave({ contacts: [contact(0), contact(1)] })).json());
    expect(two.completeness.missing).toEqual([{ path: 'contacts', code: 'contacts_too_few' }]);
    expect(two.data.contacts[0]).toMatchObject({ email: 'contact0@test.local', phone: '+441234000001' });
    const three = ownContactsSchema.parse(
      await (await contactsSave({ contacts: [...two.data.contacts, contact(2)] }, two.editVersion)).json(),
    );
    expect(three.completeness).toEqual({ percent: 100, missing: [] });
    expect(new Set(three.data.contacts.map(({ roleId }) => roleId)).size).toBe(1);
    await mainSave(main());
    const overview = ownSectionsOverviewSchema.parse(await (await http.get(ROOT, 'manufacturer')).json());
    expect(displayCompleteness(overview.completenessPct)).toBe(33);
  });

  it('more than fifty contacts are supported and their saved order is retained', async () => {
    const contacts = Array.from({ length: 75 }, (_, index) => contact(index));
    const response = await contactsSave({ contacts });
    expect(response.status).toBe(200);
    const result = ownContactsSchema.parse(await response.json());
    expect(result.data.contacts).toHaveLength(75);
    expect(result.completeness).toEqual({ percent: 100, missing: [] });
    expect((await contactsRead()).data.contacts.map(({ fullName }) => fullName)).toEqual(
      contacts.map(({ fullName }) => fullName),
    );
  });

  it('a valid HTTP draft with 8000 partial contacts is saved despite exceeding a single-query PostgreSQL bind budget', async () => {
    const data: ContactsWrite = {
      contacts: Array.from({ length: 8000 }, () => ({
        fullName: null,
        position: null,
        email: null,
        phone: null,
        roleId: null,
        isFocalPoint: false,
      })),
    };
    expect(Buffer.byteLength(JSON.stringify({ editVersion: 0, data }))).toBeLessThan(PROFILE_JSON_MAX_BYTES);
    const response = await contactsSave(data);
    expect(response.status).toBe(200);
    const result = ownContactsSchema.parse(await response.json());
    expect(result.editVersion).toBe(1);
    expect(result.data.contacts).toHaveLength(8000);
    expect(result.completeness.percent).toBeLessThan(100);
    expect(result.completeness.missing).toContainEqual({ path: 'contacts', code: 'focal_point_required' });
    expect((await contactsRead()).data.contacts).toHaveLength(8000);
  });

  it('a valid HTTP draft with 10000 partial sites is saved despite exceeding a single-query PostgreSQL bind budget', async () => {
    const data: MainInformationWrite = {
      website: null,
      companyPhone: null,
      contactEmail: null,
      sites: Array.from({ length: 10000 }, () => ({ identityId: null, address: null, city: null, regionId: null })),
    };
    expect(Buffer.byteLength(JSON.stringify({ editVersion: 0, data }))).toBeLessThan(PROFILE_JSON_MAX_BYTES);
    const response = await mainSave(data);
    expect(response.status).toBe(200);
    const result = ownMainInformationSchema.parse(await response.json());
    expect(result.editVersion).toBe(1);
    expect(result.data.editable.sites).toHaveLength(10000);
    expect(new Set(result.data.editable.sites.map(({ identityId }) => identityId)).size).toBe(10000);
    expect(result.completeness.percent).toBeLessThan(100);
    expect(result.completeness.missing).toContainEqual({ path: 'companyPhone', code: 'required' });
    expect((await mainRead()).data.editable.sites).toHaveLength(10000);
  });

  it.each([
    [
      'email',
      'duplicate_email',
      (rows: ProfileContact[]) => {
        rows[1]!.email = ' CONTACT0@TEST.LOCAL ';
      },
    ],
    [
      'phone',
      'duplicate_phone',
      (rows: ProfileContact[]) => {
        rows[1]!.phone = '00 44 (1234) 000001';
      },
    ],
    [
      'isFocalPoint',
      'multiple_focal_points',
      (rows: ProfileContact[]) => {
        rows[1]!.isFocalPoint = true;
      },
    ],
  ] as const)('rejects normalized duplicate/focal %s before any row is saved', async (field, code, change) => {
    const rows = [contact(0), contact(1), contact(2)];
    change(rows);
    const response = await contactsSave({ contacts: rows });
    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error).toMatchObject({ code: 'validation', errors: [{ path: `contacts.1.${field}`, code }] });
    expect(JSON.stringify(error)).not.toContain('Contact 0');
    expect((await contactsRead()).data.contacts).toEqual([]);
    expect((await contactsRead()).editVersion).toBe(0);
  });

  it('saves incomplete contact fields but rejects invalid phone format and reference kind with stable field errors', async () => {
    const row: ProfileContact = {
      fullName: null,
      position: null,
      email: null,
      phone: null,
      roleId: null,
      isFocalPoint: false,
    };
    const partial = ownContactsSchema.parse(await (await contactsSave({ contacts: [row] })).json());
    expect(partial.data.contacts).toEqual([row]);
    const invalid = { ...row, phone: '87010000000' };
    expect(await (await contactsSave({ contacts: [invalid] }, partial.editVersion)).json()).toMatchObject({
      status: 400,
      errors: [{ path: 'contacts.0.phone', code: 'phone_format' }],
    });
    expect(
      await (await contactsSave({ contacts: [{ ...row, roleId: region }] }, partial.editVersion)).json(),
    ).toMatchObject({ status: 400, errors: [{ path: 'contacts.0.roleId', code: 'reference_invalid' }] });
    expect((await contactsRead()).data.contacts).toEqual([row]);
  });
});
