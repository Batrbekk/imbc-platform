import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { computeBinCheckDigit, ownMainInformationSchema, type MainInformationWrite } from '@imbc/contracts';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import {
  adataMainSnapshot,
  mainContactOwnership,
  mainSourcePin,
  mainSiteOwnership,
} from '../src/database/schema/main-source-ownership.js';
import { validateEOndirisCapture, type EOndirisCaptureMetadata } from '../src/modules/e-ondiris/capture.js';
import { EOndirisSnapshotStore } from '../src/modules/e-ondiris/ingestion.js';
import { requestEOndirisProfileRefresh } from '../src/modules/e-ondiris/profile-outbox.js';
import { EOndirisProfileRefreshService } from '../src/modules/e-ondiris/profile-refresh.service.js';
import { DisabledEOndirisFeedConnector, EOndirisWorker } from '../src/modules/e-ondiris/worker.js';
import { ProfileSectionsService } from '../src/modules/profiles/profile-sections.service.js';
import { MainInformationHandler } from '../src/modules/profiles/main-information.handler.js';
import {
  MainSourceRefreshService,
  requestMainSourceRefresh,
} from '../src/modules/profiles/main-source-refresh.service.js';
import { MainSourceWorker } from '../src/modules/profiles/main-source-worker.js';
import { AdataPrefillJob } from '../src/worker/adata-prefill.job.js';
import { AdataScheduler } from '../src/modules/adata/adata.scheduler.js';
import { AdataClient, type AdataTiming } from '../src/modules/adata/adata.client.js';
import type { Env } from '../src/config/env.js';
import { startAdataStub } from './support/adata-stub.js';
import { revisionContent } from '../src/modules/profiles/revision-copy.js';
import { submissionHandlers } from './support/profile-submit.js';
import { migrateThrough, resetDatabase } from './support/database.js';

// Real source/queue transactions use bounded waits; keep this local to this suite.
vi.setConfig({ testTimeout: 30000 });

const url = process.env.EONDIRIS_TEST_DATABASE_URL;
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/e-ondiris/synthetic-capture.json', import.meta.url), 'utf8'),
) as { metadata: EOndirisCaptureMetadata; rows: Record<string, unknown>[] };
const payload = (version = 'A', count = 75, sourceBin?: string) => ({
  basic: {
    biin: sourceBin,
    name_ru: `Legal ${version}`,
    legal_form: 'Unknown source form',
    legal_address: `Legal address ${version}`,
    fullname_director: `Director ${version}`,
    date_registration: '29.02.2020',
    okeds: Array.from({ length: count }, (_, i) => ({
      i: `0${String(i).padStart(4, '0')}`,
      name_ru: `OKED ${version} ${i}`,
    })),
  },
  founders: { founders_dtl: Array.from({ length: count }, (_, i) => ({ name: `Founder ${version} ${i}` })) },
  kzCoContact: {
    phones: [{ contact: version === 'A' ? '+77001234567' : '+77007654321' }],
    emails: [{ contact: `${version}@synthetic.local` }],
  },
});

describe.skipIf(!url)('Stage 4b actual Main source pins, per-field saves and COW', () => {
  let pool: pg.Pool,
    db: Database,
    sections: ProfileSectionsService,
    refresh: MainSourceRefreshService,
    eoRefresh: EOndirisProfileRefreshService,
    store: EOndirisSnapshotStore;
  let profileId: string, orgId: string, ownerId: string, bin: string;
  let sequence = 100;
  const nextBin = () => {
    let first = '',
      digit: number | null = null;
    while (digit === null) {
      first = `000001${String(++sequence).padStart(5, '0')}`;
      digit = computeBinCheckDigit(first);
    }
    return first + digit;
  };
  const actor = () => ({
    id: ownerId,
    organizationId: orgId,
    email: 'producer@synthetic.local',
    fullName: null,
    role: 'manufacturer' as const,
    organizationType: 'manufacturer' as const,
    locale: 'en' as const,
  });
  const read = async () => ownMainInformationSchema.parse(await sections.read(actor(), 'main_information'));
  const save = async (editVersion: number, data: MainInformationWrite) =>
    ownMainInformationSchema.parse(await sections.save(actor(), 'main_information', { editVersion, data }));
  const sourceResult = async (
    value: unknown = payload(),
    state: 'received' | 'unavailable' = 'received',
    enqueue = true,
    bindIdentity = true,
  ) => {
    const [check] = await db
      .insert(schema.externalCheck)
      .values({ profileId, organizationId: orgId, connector: 'adata' })
      .onConflictDoUpdate({
        target: [schema.externalCheck.profileId, schema.externalCheck.connector],
        set: { isMock: false },
      })
      .returning();
    const [attempt] = await db
      .insert(schema.externalCheckAttempt)
      .values({
        externalCheckId: check!.id,
        trigger: 'quarterly',
        state,
        bin,
        value:
          state === 'received' && bindIdentity
            ? {
                ...(value as Record<string, unknown>),
                basic: { ...((value as { basic?: Record<string, unknown> }).basic ?? {}), biin: bin },
              }
            : state === 'received'
              ? value
              : null,
        completedAt: new Date(),
      })
      .returning();
    await db
      .update(schema.externalCheck)
      .set({ latestAttemptId: attempt!.id })
      .where(eq(schema.externalCheck.id, check!.id));
    if (enqueue) await requestMainSourceRefresh(db, profileId, orgId, attempt!.id);
    return attempt!.id;
  };
  const eo = async (change: Record<string, unknown> = {}, observedAt = fixture.metadata.observedAt) => {
    const result = validateEOndirisCapture([{ ...fixture.rows[0], bin_iin: bin, ...change }], {
      ...fixture.metadata,
      bin,
      observedAt,
    });
    if (result.kind !== 'received') throw new Error('Invalid source fixture');
    return store.ingest(result.capture, undefined, requestEOndirisProfileRefresh);
  };
  const context = async (revisionId: string) => ({
    profileId,
    organizationId: orgId,
    revisionId,
    sectionId: (
      await db.select().from(schema.profileSection).where(eq(schema.profileSection.profileId, profileId))
    ).find((section) => section.kind === 'main_information')!.id,
  });
  const captured = async (revisionId: string) => revisionContent(db, 'main_information', revisionId, orgId);

  beforeAll(async () => {
    const target = new URL(url!);
    if (target.hostname !== '127.0.0.1' || target.port !== '55435' || target.pathname !== '/imbc_eondiris_test')
      throw new Error('Isolated source database required');
    pool = new pg.Pool({ connectionString: url, max: 8 });
    await resetDatabase(pool);
    // These cases call the current terminal worker, including its registered DD receipt dependency.
    await migrateThrough(pool);
    db = drizzle(pool, { schema, casing: 'snake_case' });
    const audit = new AuditService(db);
    sections = new ProfileSectionsService(pool, audit, submissionHandlers());
    refresh = new MainSourceRefreshService(pool, audit, submissionHandlers());
    store = new EOndirisSnapshotStore(pool, { allowSynthetic: true });
    eoRefresh = new EOndirisProfileRefreshService(pool, audit, submissionHandlers());
  }, 60000);
  beforeEach(async () => {
    bin = nextBin();
    const [org] = await db
      .insert(schema.organizations)
      .values({ type: 'manufacturer', name: 'Synthetic Main company', bin })
      .returning();
    orgId = org!.id;
    const [owner] = await db
      .insert(schema.userAccounts)
      .values({
        organizationId: orgId,
        role: 'manufacturer',
        state: 'active',
        email: `${randomUUID()}@synthetic.local`,
      })
      .returning();
    ownerId = owner!.id;
    const [profile] = await db.insert(schema.manufacturerProfiles).values({ organizationId: orgId }).returning();
    profileId = profile!.id;
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('first GET atomically pins exact Adata facts, source contacts, legal lists and metadata', async () => {
    await sourceResult();
    const first = await read();
    expect(first.editVersion).toBe(1);
    expect(first.revisionOrigin).toBe('source_refresh');
    expect(first.data.editable).toMatchObject({ companyPhone: '+77001234567', contactEmail: 'a@synthetic.local' });
    expect(first.data.legalInformation).toMatchObject({ legalName: 'Legal A', stateRegisteredOn: '2020-02-29' });
    expect(first.data.legalInformation.oked).toHaveLength(75);
    expect(first.data.legalInformation.oked[0]?.code).toBe('00000');
    expect(first.data.legalInformation.founders).toHaveLength(75);
    const snapshots = await db.select().from(adataMainSnapshot).where(eq(adataMainSnapshot.profileId, profileId));
    expect(snapshots).toHaveLength(1);
    const content = await captured(first.revisionId!);
    expect(content.main_contact_ownership).toHaveLength(2);
    expect(content.main_source_pin).toHaveLength(1);
    const audit = await pool.query<{ user_id: string | null; diff: { before: unknown; after: unknown } }>(
      "select user_id,diff from audit_entries where organization_id=$1 and action='profile.source.initial'",
      [orgId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.user_id).toBeNull();
    expect(audit.rows[0]?.diff).toHaveProperty('before');
    expect(audit.rows[0]?.diff).toHaveProperty('after');
  });
  it('wrong, missing and numeric returned BIN cannot materialize or pin another company', async () => {
    for (const biin of [nextBin(), undefined, Number(bin)]) {
      const attempt = await sourceResult();
      const value = payload('Wrong');
      value.basic.biin = biin as string | undefined;
      await pool.query('update external_check_attempt set value=$2::jsonb where id=$1', [
        attempt,
        JSON.stringify(value),
      ]);
      await expect(read()).rejects.toThrow('identity');
      expect(await db.select().from(adataMainSnapshot).where(eq(adataMainSnapshot.profileId, profileId))).toEqual([]);
    }
    expect(
      (
        await pool.query(
          "select edit_version from section_revision r join profile_section s on s.id=r.profile_section_id where s.profile_id=$1 and s.kind='main_information'",
          [profileId],
        )
      ).rows[0]?.edit_version,
    ).toBe(0);
  });
  it('database snapshot guard rejects a receipt for another returned company', async () => {
    const attempt = await sourceResult();
    const value = payload('Wrong', 75, nextBin());
    await pool.query('update external_check_attempt set value=$2::jsonb where id=$1', [attempt, JSON.stringify(value)]);
    await expect(
      pool.query(
        `insert into adata_main_snapshot(profile_id,organization_id,bin,attempt_id,observed_at,content_hash,legal)
      select $1,$2,$3,id,completed_at,repeat('a',64),'{"legalName":null,"legalForm":null,"directorFullName":null,"stateRegisteredOn":null,"legalAddress":null,"founders":[],"oked":[]}'::jsonb from external_check_attempt where id=$4`,
        [profileId, orgId, bin, attempt],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('repeated GET is a canonical no-op and does not repin a newer unsaved Adata result', async () => {
    await sourceResult();
    const first = await read();
    const before = await captured(first.revisionId!);
    await sourceResult(payload('B'), 'received', false);
    const again = await read();
    expect(again.editVersion).toBe(first.editVersion);
    expect(again.data).toEqual(first.data);
    expect(await captured(first.revisionId!)).toEqual(before);
    expect(
      (
        await pool.query("select id from audit_entries where organization_id=$1 and action='profile.source.initial'", [
          orgId,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it('website-only save retains field source ownership and quarterly refresh updates untouched contacts', async () => {
    await sourceResult();
    const first = await read();
    const saved = await save(first.editVersion, {
      ...first.data.editable,
      website: 'https://manufacturer.synthetic.local',
    });
    const before = await captured(saved.revisionId!);
    await sourceResult(payload('B'));
    expect(await refresh.applyProfile(profileId)).toBe('applied');
    const next = await read();
    expect(next.data.editable).toMatchObject({
      website: 'https://manufacturer.synthetic.local/',
      companyPhone: '+77007654321',
      contactEmail: 'b@synthetic.local',
    });
    expect(next.data.legalInformation.legalName).toBe('Legal B');
    expect(next.revisionId).not.toBe(saved.revisionId);
    expect(await captured(saved.revisionId!)).toEqual(before);
    expect(
      (await db.select().from(schema.sectionRevision).where(eq(schema.sectionRevision.id, saved.revisionId!)))[0]
        ?.state,
    ).toBe('superseded');
  });
  it('save compares against exact editor A even when latest source B already exists', async () => {
    await sourceResult();
    const first = await read();
    await sourceResult(payload('B'));
    const saved = await save(first.editVersion, {
      ...first.data.editable,
      website: 'https://accepted-a.synthetic.local',
    });
    expect(saved.data.editable.companyPhone).toBe('+77001234567');
    const owners = await db.select().from(mainContactOwnership);
    const savedMainId = (await captured(saved.revisionId!)).main_information![0]!.id;
    expect(owners.filter((row) => row.mainInformationId === savedMainId).every((row) => row.owner === 'adata')).toBe(
      true,
    );
    await refresh.applyProfile(profileId);
    expect((await read()).data.editable.companyPhone).toBe('+77007654321');
  });
  it('explicit phone clear persists while untouched email continues to refresh', async () => {
    await sourceResult();
    const first = await read();
    await save(first.editVersion, { ...first.data.editable, companyPhone: null });
    await sourceResult(payload('B'));
    await refresh.applyProfile(profileId);
    const next = await read();
    expect(next.data.editable).toMatchObject({ companyPhone: null, contactEmail: 'b@synthetic.local' });
    const content = await captured(next.revisionId!);
    expect(content.main_contact_ownership?.find((row) => row.field === 'companyPhone')).toMatchObject({
      owner: 'manufacturer',
      value: null,
    });
  });
  it('cold pre-pin Save returns 409 instead of interpreting blank values against a source result it never showed', async () => {
    await sourceResult();
    await expect(save(0, { website: null, companyPhone: null, contactEmail: null, sites: [] })).rejects.toMatchObject({
      status: 409,
    });
    const current = await read();
    expect(current.editVersion).toBe(1);
    expect(current.data.editable.companyPhone).toBe('+77001234567');
  });
  it('new source COW invalidates an editor version without accepting its stale clear', async () => {
    await sourceResult();
    const first = await read();
    await sourceResult(payload('B'));
    await refresh.applyProfile(profileId);
    await expect(save(first.editVersion, { ...first.data.editable, companyPhone: null })).rejects.toMatchObject({
      status: 409,
    });
    expect((await read()).data.editable.companyPhone).toBe('+77007654321');
  });
  it('failed source result preserves captured facts and reports unavailable on a new working revision', async () => {
    await sourceResult();
    const first = await read();
    await sourceResult(null, 'unavailable');
    await refresh.applyProfile(profileId);
    const next = await read();
    expect(next.data.source.state).toBe('unavailable');
    expect(next.data.legalInformation).toEqual(first.data.legalInformation);
    expect(next.data.editable.companyPhone).toBe(first.data.editable.companyPhone);
    expect(await new MainInformationHandler().read(db, await context(first.revisionId!))).toEqual(first.data);
  });
  it('verified legal facts and their readAt survive new empty/all-null no-data receipts while recovery advances the event', async () => {
    await sourceResult();
    const first = await read();
    const before = await captured(first.revisionId!);
    const firstPin = before.main_source_pin![0]!;
    await db.transaction(async (tx) => {
      await tx
        .update(schema.sectionRevision)
        .set({ state: 'submitted', submittedAt: new Date() })
        .where(eq(schema.sectionRevision.id, first.revisionId!));
      await tx
        .update(schema.profileSection)
        .set({ workingRevisionId: null, verifiedRevisionId: first.revisionId! })
        .where(eq(schema.profileSection.id, (await context(first.revisionId!)).sectionId));
      await tx
        .update(schema.sectionRevision)
        .set({ state: 'verified' })
        .where(eq(schema.sectionRevision.id, first.revisionId!));
      await tx
        .update(schema.manufacturerProfile)
        .set({ status: 'verified' })
        .where(eq(schema.manufacturerProfile.id, profileId));
    });
    for (const noData of [{}, { basic: null, founders: null, kzCoContact: null }]) {
      const attempt = await sourceResult(noData, 'received', true, false);
      expect(await refresh.applyProfile(profileId)).toBe('applied');
      const next = await read();
      expect(next.revisionId).not.toBe(first.revisionId);
      expect(next.data.legalInformation).toEqual(first.data.legalInformation);
      expect(next.data.source).toEqual(first.data.source);
      expect(next.data.editable).toEqual(first.data.editable);
      expect((await captured(next.revisionId!)).main_source_pin![0]).toMatchObject({
        adata_snapshot_id: firstPin.adata_snapshot_id,
        latest_attempt_id: attempt,
        adata_state: 'received',
      });
      expect(
        (
          await pool.query(
            'select applied_attempt_id,applied_state from main_source_refresh_outbox where profile_id=$1',
            [profileId],
          )
        ).rows[0],
      ).toMatchObject({ applied_attempt_id: attempt, applied_state: 'received' });
      expect(await captured(first.revisionId!)).toEqual(before);
    }
    expect(await db.select().from(adataMainSnapshot).where(eq(adataMainSnapshot.profileId, profileId))).toHaveLength(1);
  });
  it('a matching returned BIN with explicit blank legal facts remains a real source change', async () => {
    await sourceResult();
    const first = await read();
    const firstSnapshot = (await captured(first.revisionId!)).main_source_pin![0]!.adata_snapshot_id;
    const attempt = await sourceResult({
      basic: {
        biin: bin,
        name_ru: null,
        legal_form: null,
        legal_address: null,
        fullname_director: null,
        date_registration: null,
        okeds: [],
      },
      founders: { founders_dtl: [] },
    });
    expect(await refresh.applyProfile(profileId)).toBe('applied');
    const next = await read();
    expect(next.data.legalInformation).toMatchObject({
      legalName: null,
      legalForm: null,
      directorFullName: null,
      legalAddress: null,
      stateRegisteredOn: null,
      founders: [],
      oked: [],
    });
    expect(next.data.editable).toEqual(first.data.editable);
    const pin = (await captured(next.revisionId!)).main_source_pin![0]!;
    expect(pin.latest_attempt_id).toBe(attempt);
    expect(pin.adata_snapshot_id).not.toBe(firstSnapshot);
  });
  for (const path of ['initial_get', 'e_ondiris', 'main_only'] as const)
    it(`terminal attempt → outbox FK does not deadlock with profile → receipt in ${path}`, async () => {
      const attempt = await sourceResult(payload(), 'received', path === 'main_only');
      if (path === 'e_ondiris') await eo();
      const writer = await pool.connect();
      let reader: Promise<{ error?: unknown; result?: unknown }> | undefined;
      try {
        await writer.query('BEGIN');
        await writer.query("SET LOCAL lock_timeout='2s'");
        await writer.query("SET LOCAL statement_timeout='3s'");
        const writerPid = (await writer.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid;
        await writer.query(
          'update external_check_attempt set value=$2::jsonb,completed_at=clock_timestamp() where id=$1',
          [attempt, JSON.stringify(payload('B', 75, bin))],
        );
        reader = (
          path === 'initial_get'
            ? sections.read(actor(), 'main_information')
            : path === 'e_ondiris'
              ? eoRefresh.applyBin(bin)
              : refresh.applyProfile(profileId)
        ).then(
          (result) => ({ result }),
          (error) => ({ error }),
        );
        const deadline = Date.now() + 3000;
        let blocked = false;
        while (Date.now() < deadline) {
          blocked = (
            await pool.query<{ blocked: boolean }>(
              'select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and query like $2) as blocked',
              [writerPid, '%from external_check c join external_check_attempt a%'],
            )
          ).rows[0]!.blocked;
          if (blocked) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        expect(await db.select().from(adataMainSnapshot).where(eq(adataMainSnapshot.profileId, profileId))).toEqual([]);
        expect(
          await requestMainSourceRefresh(drizzle(writer, { schema, casing: 'snake_case' }), profileId, orgId, attempt),
        ).toBe(true);
        await writer.query('COMMIT');
        const outcome = await reader;
        expect(outcome.error).toBeUndefined();
        const current = await read();
        expect(current.data.legalInformation.legalName).toBe('Legal B');
        expect(
          await db.select().from(adataMainSnapshot).where(eq(adataMainSnapshot.profileId, profileId)),
        ).toHaveLength(1);
        expect((await captured(current.revisionId!)).main_source_pin![0]?.latest_attempt_id).toBe(attempt);
      } finally {
        await writer.query('ROLLBACK');
        writer.release();
        await reader;
      }
    }, 10000);
  it('e-Ondiris owns valid contacts ahead of Adata and does not replace a manufacturer correction', async () => {
    await sourceResult();
    await eo({ phone: '+18005551234', email: 'eo@synthetic.local' });
    const first = await read();
    expect(first.data.editable).toMatchObject({ companyPhone: '+18005551234', contactEmail: 'eo@synthetic.local' });
    await save(first.editVersion, { ...first.data.editable, contactEmail: 'corrected@synthetic.local' });
    await eo({ phone: '+18005554321', email: 'next@synthetic.local' }, '2026-11-17T00:00:00.000Z');
    await eoRefresh.applyBin(bin);
    const next = await read();
    expect(next.data.editable).toMatchObject({
      companyPhone: '+18005554321',
      contactEmail: 'corrected@synthetic.local',
    });
  });
  it('source site keeps identity after a city correction and daily address relocation', async () => {
    await eo({ production_address: 'Factory A' });
    const first = await read();
    const sourceSite = first.data.editable.sites.find((site) => site.address === 'Factory A')!;
    await save(first.editVersion, {
      ...first.data.editable,
      sites: first.data.editable.sites.map((site) =>
        site.identityId === sourceSite.identityId ? { ...site, city: 'Producer city' } : site,
      ),
    });
    await eo({ production_address: 'Factory B' }, '2026-11-17T00:00:00.000Z');
    await eoRefresh.applyBin(bin);
    const next = await read();
    expect(next.data.editable.sites.find((site) => site.identityId === sourceSite.identityId)).toMatchObject({
      address: 'Factory B',
      city: 'Producer city',
      regionId: null,
    });
  });
  for (const peer of ['NULL', 'missing'] as const)
    it(`shared source site relocation with a ${peer} peer commits independent legal changes and preserves verified associations`, async () => {
      const ingest = async (rows: { registration: string; address: string | null }[], observedAt: string) => {
        const capture = validateEOndirisCapture(
          rows.map((row) => ({
            ...fixture.rows[0],
            bin_iin: bin,
            registration_number: row.registration,
            product_name: `Synthetic shared product ${row.registration}`,
            production_address: row.address,
          })),
          { ...fixture.metadata, bin, observedAt },
        );
        if (capture.kind !== 'received') throw new Error('Invalid shared-site fixture');
        expect((await store.ingest(capture.capture, undefined, requestEOndirisProfileRefresh)).kind).toBe('accepted');
      };
      await sourceResult();
      await ingest(
        [
          { registration: '000901', address: 'Factory A' },
          { registration: '000902', address: 'Factory A' },
        ],
        fixture.metadata.observedAt,
      );
      expect((await eoRefresh.applyBin(bin)).kind).toBe('applied');
      const first = await read();
      const site = first.data.editable.sites[0]!;
      const sectionsBefore = await db
        .select()
        .from(schema.profileSection)
        .where(eq(schema.profileSection.profileId, profileId));
      const products = sectionsBefore.find((section) => section.kind === 'products')!;
      const oldProductsId = products.workingRevisionId!;
      const [manual] = await db
        .insert(schema.productLineIdentity)
        .values({ profileId, organizationId: orgId })
        .returning();
      await db.insert(schema.productLine).values({
        sectionRevisionId: oldProductsId,
        organizationId: orgId,
        identityId: manual!.id,
        source: 'manual',
        nameRu: 'Manual linked product',
        productionSiteIdentityId: site.identityId,
        note: 'Manufacturer association',
        positionInList: 2,
      });
      const beforeMain = await captured(first.revisionId!);
      const beforeProducts = await revisionContent(db, 'products', oldProductsId, orgId);
      await db.transaction(async (tx) => {
        for (const section of sectionsBefore.filter(
          (section) => section.kind === 'main_information' || section.kind === 'products',
        )) {
          const revision = section.workingRevisionId!;
          await tx
            .update(schema.sectionRevision)
            .set({ state: 'submitted', submittedAt: new Date() })
            .where(eq(schema.sectionRevision.id, revision));
          await tx
            .update(schema.profileSection)
            .set({ workingRevisionId: null, verifiedRevisionId: revision })
            .where(eq(schema.profileSection.id, section.id));
          await tx
            .update(schema.sectionRevision)
            .set({ state: 'verified' })
            .where(eq(schema.sectionRevision.id, revision));
        }
        await tx
          .update(schema.manufacturerProfile)
          .set({ status: 'verified' })
          .where(eq(schema.manufacturerProfile.id, profileId));
      });
      await sourceResult(payload('B'));
      await ingest(
        [
          { registration: '000901', address: 'Factory B' },
          ...(peer === 'NULL' ? [{ registration: '000902', address: null }] : []),
        ],
        '2026-11-17T00:00:00.000Z',
      );
      const worker = new EOndirisWorker(pool, new DisabledEOndirisFeedConnector(), store, eoRefresh);
      expect((await worker.refreshPending(1000)).failed).toBe(0);
      const next = await read();
      expect(next.data.legalInformation.legalName).toBe('Legal B');
      expect(next.data.editable.sites).toEqual(first.data.editable.sites);
      expect(
        [...((await captured(next.revisionId!)).main_site_source_binding ?? [])]
          .sort((a, b) => String(a.registration_number).localeCompare(String(b.registration_number)))
          .map((row) => [row.registration_number, row.identity_id, row.snapshot_id]),
      ).toEqual(
        [...(beforeMain.main_site_source_binding ?? [])]
          .sort((a, b) => String(a.registration_number).localeCompare(String(b.registration_number)))
          .map((row) => [row.registration_number, row.identity_id, row.snapshot_id]),
      );
      expect(await captured(first.revisionId!)).toEqual(beforeMain);
      expect(await revisionContent(db, 'products', oldProductsId, orgId)).toEqual(beforeProducts);
      expect(await new MainInformationHandler().read(db, await context(first.revisionId!))).toEqual(first.data);
      const currentProducts = (
        await db.select().from(schema.profileSection).where(eq(schema.profileSection.profileId, profileId))
      ).find((section) => section.kind === 'products')!;
      const afterProducts = await revisionContent(db, 'products', currentProducts.workingRevisionId!, orgId);
      expect(afterProducts.product_line?.find((row) => row.identity_id === manual!.id)).toMatchObject({
        source: 'manual',
        production_site_identity_id: site.identityId,
        note: 'Manufacturer association',
      });
      const current = await store.current(bin);
      expect(current.find((row) => row.facts.registrationNumber === '000902')?.facts.productionAddress).toBe(
        peer === 'NULL' ? null : 'Factory A',
      );
      const state = (
        await pool.query(
          'select o.state,o.applied_scope_hash,s.accepted_scope_hash from e_ondiris_profile_refresh o join e_ondiris_sync_scope s on s.bin=o.bin where o.bin=$1',
          [bin],
        )
      ).rows[0]!;
      expect(state.state).toBe('applied');
      expect(state.applied_scope_hash).toBe(state.accepted_scope_hash);
      const audit = (
        await pool.query(
          "select diff from audit_entries where organization_id=$1 and action='profile.source.e_ondiris.materialized' order by at desc limit 1",
          [orgId],
        )
      ).rows[0]!.diff;
      expect(audit.sourceIssues).toEqual(
        expect.arrayContaining([{ code: 'source_site_ambiguous', registrationNumbers: ['000901', '000902'] }]),
      );
    }, 15000);
  it('explicit source-address clear remains NULL after a changed daily source address', async () => {
    await eo({ production_address: 'Factory A' });
    const first = await read();
    const id = first.data.editable.sites[0]!.identityId;
    await save(first.editVersion, {
      ...first.data.editable,
      sites: first.data.editable.sites.map((site) => ({ ...site, address: null })),
    });
    await eo({ production_address: 'Factory B' }, '2026-11-17T00:00:00.000Z');
    await eoRefresh.applyBin(bin);
    expect((await read()).data.editable.sites.find((site) => site.identityId === id)?.address).toBeNull();
  });
  it('mutable source site constraints reject changed source facts and missing ownership', async () => {
    await eo({ production_address: 'Factory A' });
    const first = await read();
    const content = await captured(first.revisionId!);
    const site = content.production_site![0]!;
    await expect(
      pool.query('update production_site set address=$2 where id=$1', [site.id, 'Forged source address']),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('delete from main_site_ownership where main_information_id=$1 and identity_id=$2', [
        site.main_information_id,
        site.identity_id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    expect((await read()).data.editable.sites[0]?.address).toBe('Factory A');
  });
  it('removed source site is not re-added and a newly materialized product respects the suppression', async () => {
    await eo({ production_address: 'Factory A' });
    const first = await read();
    const id = first.data.editable.sites[0]!.identityId;
    await save(first.editVersion, { ...first.data.editable, sites: [] });
    await eo({ production_address: 'Factory B' }, '2026-11-17T00:00:00.000Z');
    await eoRefresh.applyBin(bin);
    const next = await read();
    expect(next.data.editable.sites).toEqual([]);
    expect((await captured(next.revisionId!)).main_site_ownership?.find((row) => row.identity_id === id)?.deleted).toBe(
      true,
    );
    const products = await pool.query<{ production_site_identity_id: string | null }>(
      "select production_site_identity_id from product_line where organization_id=$1 and source='e_ondiris'",
      [orgId],
    );
    expect(products.rows.every((row) => row.production_site_identity_id === null)).toBe(true);
  });
  it('legacy saved NULL ownership is unknown and cannot be adopted by a new source event', async () => {
    await pool.query(
      "update section_revision set edit_version=2,saved_at=now() where profile_section_id in (select id from profile_section where profile_id=$1 and kind='main_information')",
      [profileId],
    );
    await sourceResult();
    await refresh.applyProfile(profileId);
    const next = await read();
    expect(next.data.editable.companyPhone).toBeNull();
    expect(
      (await captured(next.revisionId!)).main_contact_ownership?.find((row) => row.field === 'companyPhone')?.owner,
    ).toBe('legacy_unknown');
    expect(next.data.legalInformation.legalName).toBe('Legal A');
  });
  it('Adata snapshot UPDATE/DELETE are rejected and a rolled-back terminal callback leaves no outbox', async () => {
    await sourceResult();
    await read();
    const snapshot = (await db.select().from(adataMainSnapshot).where(eq(adataMainSnapshot.profileId, profileId)))[0]!;
    await expect(
      pool.query('update adata_main_snapshot set phones=$1 where id=$2', [['+18005551234'], snapshot.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query('delete from adata_main_snapshot where id=$1', [snapshot.id])).rejects.toMatchObject({
      code: '23514',
    });
    await pool.query('delete from main_source_refresh_outbox where profile_id=$1', [profileId]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requestMainSourceRefresh(
        drizzle(client, { schema, casing: 'snake_case' }),
        profileId,
        orgId,
        snapshot.attemptId,
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(
      (await pool.query('select * from main_source_refresh_outbox where profile_id=$1', [profileId])).rows,
    ).toEqual([]);
  });
  it('append-only source pin/ownership remains immutable after a revision is superseded', async () => {
    await sourceResult();
    const first = await read();
    await sourceResult(payload('B'));
    await refresh.applyProfile(profileId);
    const content = await captured(first.revisionId!);
    const owner = content.main_contact_ownership![0]!;
    await expect(
      pool.query("update main_contact_ownership set owner='legacy_unknown',adata_snapshot_id=NULL where id=$1", [
        owner.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('delete from main_source_pin where main_information_id=$1', [content.main_information![0]!.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('source callback rejects a wrong profile/org and an old attempt without changing the pending pointer', async () => {
    const a = await sourceResult();
    const b = await sourceResult(payload('B'));
    expect(await requestMainSourceRefresh(db, profileId, randomUUID(), b)).toBe(false);
    expect(await requestMainSourceRefresh(db, randomUUID(), orgId, b)).toBe(false);
    expect(await requestMainSourceRefresh(db, profileId, orgId, a)).toBe(false);
    expect(
      (
        await pool.query<{ requested_attempt_id: string }>(
          'select requested_attempt_id from main_source_refresh_outbox where profile_id=$1',
          [profileId],
        )
      ).rows[0]?.requested_attempt_id,
    ).toBe(b);
  });
  it('preserves actual PostgreSQL microsecond source timestamps through initial materialization and COW', async () => {
    const a = await sourceResult();
    await pool.query("update external_check_attempt set completed_at='2026-11-16T00:00:00.123456Z' where id=$1", [a]);
    const first = await read();
    const before = await captured(first.revisionId!);
    expect(String(before.main_information![0]!.legal_data_checked_at)).toContain('.123456');
    const b = await sourceResult(payload('B'));
    await pool.query("update external_check_attempt set completed_at='2026-11-17T00:00:00.234567Z' where id=$1", [b]);
    await refresh.applyProfile(profileId);
    expect(String((await captured((await read()).revisionId!)).main_information![0]!.legal_data_checked_at)).toContain(
      '.234567',
    );
    expect(await captured(first.revisionId!)).toEqual(before);
  });
  it('runtime application role can capture/materialize sources but cannot rewrite immutable snapshot facts', async () => {
    const role = 'imbc_main_source_runtime_test';
    await pool.query(`DO $$ BEGIN CREATE ROLE ${role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await applyAppRoleGrants(pool, role);
    await sourceResult();
    const runtime = new pg.Pool({ connectionString: url, options: `-c role=${role}`, max: 5 });
    try {
      const runtimeDb = drizzle(runtime, { schema, casing: 'snake_case' });
      const runtimeAudit = new AuditService(runtimeDb);
      const runtimeSections = new ProfileSectionsService(runtime, runtimeAudit, submissionHandlers());
      const first = ownMainInformationSchema.parse(await runtimeSections.read(actor(), 'main_information'));
      expect(first.data.legalInformation.legalName).toBe('Legal A');
      await sourceResult(payload('B'));
      expect(
        await new MainSourceRefreshService(runtime, runtimeAudit, submissionHandlers()).applyProfile(profileId),
      ).toBe('applied');
      await expect(
        runtime.query('update adata_main_snapshot set phones=$1 where profile_id=$2', [['+18005551234'], profileId]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        runtime.query('delete from main_source_refresh_outbox where profile_id=$1', [profileId]),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await runtime.end();
    }
  });
  it('recovery continues after one profile fails and orders fresh requests before deferred retries', async () => {
    await pool.query("update main_source_refresh_outbox set last_attempt_at=now()+interval '1 day'");
    const fresh = await sourceResult(payload('B'));
    const [otherOrg] = await db
      .insert(schema.organizations)
      .values({ type: 'manufacturer', name: 'Other synthetic queue company', bin: nextBin() })
      .returning();
    const [otherProfile] = await db
      .insert(schema.manufacturerProfiles)
      .values({ organizationId: otherOrg!.id })
      .returning();
    const [otherCheck] = await db
      .insert(schema.externalCheck)
      .values({ profileId: otherProfile!.id, organizationId: otherOrg!.id, connector: 'adata' })
      .returning();
    const [otherAttempt] = await db
      .insert(schema.externalCheckAttempt)
      .values({
        externalCheckId: otherCheck!.id,
        trigger: 'quarterly',
        state: 'received',
        bin: otherOrg!.bin!,
        completedAt: new Date(),
        value: payload('A', 75, otherOrg!.bin!),
      })
      .returning();
    await db
      .update(schema.externalCheck)
      .set({ latestAttemptId: otherAttempt!.id })
      .where(eq(schema.externalCheck.id, otherCheck!.id));
    await requestMainSourceRefresh(db, otherProfile!.id, otherOrg!.id, otherAttempt!.id);
    await pool.query(
      "update main_source_refresh_outbox set last_attempt_at='2000-01-01',state='deferred' where profile_id=$1",
      [otherProfile!.id],
    );
    const run = vi.fn(async (id: string) => {
      if (id === profileId) throw new Error('synthetic failure');
      return 'unchanged';
    });
    const worker = new MainSourceWorker(pool, { applyProfile: run } as never);
    const result = await worker.refreshPending(2);
    expect(result).toEqual({ failed: 1, processed: 1, deferred: 0 });
    expect(run.mock.calls.map(([id]) => id)).toEqual([profileId, otherProfile!.id]);
    const row = (
      await pool.query<{ requested_attempt_id: string; last_attempt_at: string | null; state: string }>(
        'select requested_attempt_id,last_attempt_at::text,state from main_source_refresh_outbox where profile_id=$1',
        [profileId],
      )
    ).rows[0]!;
    expect(row.requested_attempt_id).toBe(fresh);
    expect(row.last_attempt_at).not.toBeNull();
    expect(row.state).toBe('deferred');
  });
  it('a stale failure stamp cannot delay or overwrite a newer source attempt', async () => {
    await sourceResult();
    await pool.query('update main_source_refresh_outbox set last_attempt_at=NULL where profile_id=$1', [profileId]);
    let newest = '';
    const worker = new MainSourceWorker(pool, {
      applyProfile: async (id: string) => {
        if (id === profileId) {
          newest = await sourceResult(payload('B'));
          throw new Error('old request failed');
        }
        return 'unchanged';
      },
    } as never);
    await worker.refreshPending(1000);
    const row = (
      await pool.query<{ requested_attempt_id: string; last_attempt_at: string | null; state: string }>(
        'select requested_attempt_id,last_attempt_at::text,state from main_source_refresh_outbox where profile_id=$1',
        [profileId],
      )
    ).rows[0]!;
    expect(row.requested_attempt_id).toBe(newest);
    expect(row.last_attempt_at).toBeNull();
    expect(row.state).toBe('pending');
  });
  it('applied same-attempt recovery is idempotent and terminal replay does not requeue it', async () => {
    const attempt = await sourceResult();
    await refresh.applyProfile(profileId);
    const current = await read();
    expect(await requestMainSourceRefresh(db, profileId, orgId, attempt)).toBe(false);
    expect(await refresh.applyProfile(profileId)).toBe('unchanged');
    expect((await read()).revisionId).toBe(current.revisionId);
  });
  it('an old worker failure cannot defer a new terminal event on the same attempt ID', async () => {
    const attempt = await sourceResult();
    await pool.query(
      "update external_check_attempt set state='not_configured',value=NULL,completed_at='2026-11-16T10:00:00.000001Z' where id=$1",
      [attempt],
    );
    await requestMainSourceRefresh(db, profileId, orgId, attempt);
    const worker = new MainSourceWorker(pool, {
      applyProfile: async (id: string) => {
        if (id !== profileId) return 'unchanged';
        await pool.query(
          "update external_check_attempt set state='received',value=$2::jsonb,completed_at='2026-11-16T10:00:00.000002Z' where id=$1",
          [attempt, JSON.stringify(payload('B', 75, bin))],
        );
        await requestMainSourceRefresh(db, profileId, orgId, attempt);
        throw new Error('Previous terminal event failed');
      },
    } as never);
    expect(await worker.refreshPending(1000)).toMatchObject({ failed: 1 });
    const row = (
      await pool.query(
        'select requested_attempt_id,requested_state,state,last_attempt_at from main_source_refresh_outbox where profile_id=$1',
        [profileId],
      )
    ).rows[0]!;
    expect(row).toMatchObject({
      requested_attempt_id: attempt,
      requested_state: 'received',
      state: 'pending',
      last_attempt_at: null,
    });
    expect(await refresh.applyProfile(profileId)).toBe('applied');
    expect((await read()).data.legalInformation.legalName).toBe('Legal B');
  });
  for (const failure of ['not_configured', 'quota_exhausted'] as const)
    it(`a real ${failure}→same-ID scheduler retry→received result requeues and refreshes Main`, async () => {
      const token = 'synthetic-main-retry-token';
      const stub = await startAdataStub({ token });
      try {
        stub.scenario(bin, { kind: 'ready', afterPolls: 0 });
        const audit = new AuditService(db);
        const scheduler = new AdataScheduler(pool, { send: async () => randomUUID() } as never, audit);
        expect(await scheduler.requestOnProfileCreated(ownerId, 'password_set')).toBe('scheduled');
        const attempt = (
          await pool.query<{ id: string }>(
            'select a.id from external_check_attempt a join external_check c on c.id=a.external_check_id where c.profile_id=$1',
            [profileId],
          )
        ).rows[0]!.id;
        const timing: AdataTiming = {
          firstPollDelayMs: 0,
          pollIntervalMs: 1,
          deadlineMs: 10000,
          requestTimeoutMs: 1000,
        };
        const job = (bad: boolean) =>
          new AdataPrefillJob(
            db,
            {
              ADATA_API_TOKEN: bad && failure === 'not_configured' ? undefined : token,
              ADATA_MONTHLY_LIMIT: bad && failure === 'quota_exhausted' ? 0 : 3000,
            } as Env,
            audit,
            (clientToken) => new AdataClient({ baseUrl: stub.baseUrl, token: clientToken, requestTimeoutMs: 1000 }),
            timing,
          );
        await job(true).run({ attemptId: attempt });
        expect(await refresh.applyProfile(profileId)).toBe('applied');
        const failed = (
          await pool.query<{ applied_state: string; applied_attempt_id: string }>(
            'select applied_state,applied_attempt_id from main_source_refresh_outbox where profile_id=$1',
            [profileId],
          )
        ).rows[0]!;
        expect(failed).toMatchObject({ applied_state: failure, applied_attempt_id: attempt });
        expect(await scheduler.requestOnProfileCreated(ownerId, 'sign_in')).toBe('requeued');
        expect(
          (
            await pool.query(
              'select a.id from external_check_attempt a join external_check c on c.id=a.external_check_id where c.profile_id=$1',
              [profileId],
            )
          ).rows,
        ).toHaveLength(1);
        await job(false).run({ attemptId: attempt });
        const received = (
          await pool.query<{ state: string; requested_state: string; requested_attempt_id: string }>(
            'select state,requested_state,requested_attempt_id from main_source_refresh_outbox where profile_id=$1',
            [profileId],
          )
        ).rows[0]!;
        expect(received).toMatchObject({
          state: 'pending',
          requested_state: 'received',
          requested_attempt_id: attempt,
        });
        expect(await refresh.applyProfile(profileId)).toBe('applied');
        expect((await read()).data.source.state).toBe('received');
        expect(
          (
            await pool.query(
              'select applied_state,applied_attempt_id from main_source_refresh_outbox where profile_id=$1',
              [profileId],
            )
          ).rows[0],
        ).toMatchObject({ applied_state: 'received', applied_attempt_id: attempt });
      } finally {
        await stub.close();
      }
    });
});
