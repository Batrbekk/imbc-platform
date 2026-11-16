import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { computeBinCheckDigit, productsReadSchema, mainInformationReadSchema } from '@imbc/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { eOndirisProfileRefresh } from '../src/database/schema/e-ondiris-outbox.js';
import { EOndirisSnapshotStore } from '../src/modules/e-ondiris/ingestion.js';
import { validateEOndirisCapture, type EOndirisCaptureMetadata } from '../src/modules/e-ondiris/capture.js';
import { EOndirisProfileRefreshService } from '../src/modules/e-ondiris/profile-refresh.service.js';
import { requestEOndirisProfileRefresh } from '../src/modules/e-ondiris/profile-outbox.js';
import { DisabledEOndirisFeedConnector, EOndirisWorker } from '../src/modules/e-ondiris/worker.js';
import { ProfileSectionsService } from '../src/modules/profiles/profile-sections.service.js';
import {
  MainSourceRefreshService,
  requestMainSourceRefresh,
} from '../src/modules/profiles/main-source-refresh.service.js';
import { ProductsHandler } from '../src/modules/profiles/products.handler.js';
import { MainInformationHandler } from '../src/modules/profiles/main-information.handler.js';
import { ProfileSubmitService } from '../src/modules/profiles/profile-submit.service.js';
import { profileCandidateRevisions } from '../src/modules/profiles/profile-candidate.js';
import { captureRevisionFileVersions } from '../src/modules/files/revision-file-snapshot.js';
import { copyRevisionContent, revisionContent } from '../src/modules/profiles/revision-copy.js';
import { migrateThrough, resetDatabase } from './support/database.js';
import { seedProfileGraph, type ProfileGraph } from './support/profile-graph.js';
import { seedSubmissionProfile, submissionHandlers } from './support/profile-submit.js';

const url = process.env.EONDIRIS_TEST_DATABASE_URL;
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/e-ondiris/synthetic-capture.json', import.meta.url), 'utf8'),
) as { metadata: EOndirisCaptureMetadata; rows: Record<string, unknown>[] };

describe.skipIf(!url)('Stage 4a actual profile graph, handlers and source COW', () => {
  let pool: pg.Pool,
    db: Database,
    audit: AuditService,
    source: EOndirisSnapshotStore,
    refresh: EOndirisProfileRefreshService,
    sections: ProfileSectionsService;
  let graph: ProfileGraph, bin: string, ownerId: string;
  let sequence = 0;
  const nextBin = () => {
    let digit: number | null = null,
      first = '';
    while (digit === null) {
      first = `000000${String(++sequence).padStart(5, '0')}`;
      digit = computeBinCheckDigit(first);
    }
    return `${first}${digit}`;
  };
  beforeAll(async () => {
    const target = new URL(url!);
    if (target.hostname !== '127.0.0.1' || target.port !== '55435' || target.pathname !== '/imbc_eondiris_test')
      throw new Error('Isolated source test database required');
    pool = new pg.Pool({ connectionString: url, max: 8 });
    await resetDatabase(pool);
    await migrateThrough(pool, '0026_stage4b_main_source_ownership');
    db = drizzle(pool, { schema: s, casing: 'snake_case' });
    audit = new AuditService(db);
    source = new EOndirisSnapshotStore(pool, { allowSynthetic: true });
    refresh = new EOndirisProfileRefreshService(pool, audit, submissionHandlers());
    sections = new ProfileSectionsService(pool, audit, submissionHandlers());
  }, 60000);
  beforeEach(async () => {
    graph = await seedProfileGraph(pool);
    bin = nextBin();
    await db.update(s.organizations).set({ bin }).where(eq(s.organizations.id, graph.org));
    ownerId = (
      await db
        .insert(s.userAccounts)
        .values({
          organizationId: graph.org,
          role: 'manufacturer',
          state: 'active',
          email: `${randomUUID()}@source.local`,
        })
        .returning()
    )[0]!.id;
    await db
      .update(s.productLine)
      .set({
        nameEn: 'Synthetic part',
        nameRu: String(fixture.rows[0]!.product_name),
        tnVedCode: String(fixture.rows[0]!.tnved_code_10),
        note: 'Manufacturer note',
      })
      .where(eq(s.productLine.id, String(graph.rows.product_line!.id)));
    await db
      .update(s.mainInformation)
      .set({ legalName: 'Adata canonical legal name' })
      .where(eq(s.mainInformation.id, String(graph.rows.main_information!.id)));
  });
  afterAll(async () => {
    await pool?.end();
  });
  const actor = () => ({
    id: ownerId,
    organizationId: graph.org,
    email: 'actor@source.local',
    fullName: null,
    role: 'manufacturer' as const,
    organizationType: 'manufacturer' as const,
    locale: 'en' as const,
  });
  const ingestFor = async (
    targetBin: string,
    change: Partial<Record<string, unknown>> = {},
    observedAt = fixture.metadata.observedAt,
  ) => {
    const response = validateEOndirisCapture(
      fixture.rows.map((row, index) => ({ ...row, bin_iin: targetBin, ...(index === 0 ? change : {}) })),
      { ...fixture.metadata, bin: targetBin, observedAt },
    );
    if (response.kind !== 'received') throw new Error('Invalid fixture');
    return source.ingest(response.capture, undefined, requestEOndirisProfileRefresh);
  };
  const ingest = (change: Partial<Record<string, unknown>> = {}, observedAt = fixture.metadata.observedAt) =>
    ingestFor(bin, change, observedAt);
  const coolDownEarlierFixtures = () =>
    pool.query("UPDATE e_ondiris_profile_refresh SET last_attempt_at=now()+interval '1 day'");
  const productContext = async (revisionId?: string) => ({
    profileId: graph.profile,
    organizationId: graph.org,
    sectionId: (
      await db
        .select()
        .from(s.profileSection)
        .where(and(eq(s.profileSection.profileId, graph.profile), eq(s.profileSection.kind, 'products')))
    )[0]!.id,
    revisionId:
      revisionId ??
      (
        await db
          .select()
          .from(s.profileSection)
          .where(and(eq(s.profileSection.profileId, graph.profile), eq(s.profileSection.kind, 'products')))
      )[0]!.workingRevisionId!,
  });
  const mainContext = async () => ({
    profileId: graph.profile,
    organizationId: graph.org,
    sectionId: (
      await db
        .select()
        .from(s.profileSection)
        .where(and(eq(s.profileSection.profileId, graph.profile), eq(s.profileSection.kind, 'main_information')))
    )[0]!.id,
    revisionId: (
      await db
        .select()
        .from(s.profileSection)
        .where(and(eq(s.profileSection.profileId, graph.profile), eq(s.profileSection.kind, 'main_information')))
    )[0]!.workingRevisionId!,
  });
  const readProducts = async (revisionId?: string) =>
    productsReadSchema.parse(await new ProductsHandler().read(db, await productContext(revisionId)));

  it('reconciles source facts through real handlers while keeping stable identity/site/shared certificate/note and Adata legal/full OKED', async () => {
    const before = await revisionContent(db, 'products', graph.revisions.products!, graph.org);
    await ingest();
    expect(await refresh.applyBin(bin)).toMatchObject({ kind: 'applied' });
    const read = await readProducts();
    expect(read.lines).toHaveLength(2);
    const converted = read.lines.find((line) => line.identityId === String(graph.rows.product_line!.identity_id))!;
    expect(converted).toMatchObject({
      source: 'e_ondiris',
      nameEn: null,
      nameRu: 'Синтетическая деталь',
      capacityQuantity: null,
      capacityText: fixture.rows[0]!.production_capacity,
      inCountryValueShare: '30.50',
      productionSiteIdentityId: String(graph.rows.production_site!.identity_id),
      note: 'Manufacturer note',
      certificateIdentityIds: [String(graph.rows.certificate!.identity_id)],
    });
    expect(converted.kpved).toEqual([{ code: '01.00.10', sourceName: 'Synthetic KP VED name', entryId: null }]);
    expect(await revisionContent(db, 'products', graph.revisions.products!, graph.org)).toEqual(before);
    const old = (
      await db.select().from(s.sectionRevision).where(eq(s.sectionRevision.id, graph.revisions.products!))
    )[0]!;
    expect(old.state).toBe('superseded');
    const main = mainInformationReadSchema.parse(await new MainInformationHandler().read(db, await mainContext()));
    expect(main.legalInformation).toMatchObject({
      legalName: 'Adata canonical legal name',
      oked: [{ code: '00123', name: 'Source spelling' }],
    });
    expect(main.editable).toMatchObject({ companyPhone: '+77000000000', contactEmail: 'contact@synthetic.local' });
    expect(main.editable.sites.filter((site) => site.address?.startsWith('Synthetic'))).toHaveLength(2);
    expect(
      main.editable.sites
        .filter((site) => site.address?.startsWith('Synthetic'))
        .every((site) => site.city === null && site.regionId === null),
    ).toBe(true);
    expect(
      (await db.select().from(s.manufacturerProfile).where(eq(s.manufacturerProfile.id, graph.profile)))[0]!.status,
    ).toBe('draft');
  });
  it('a replay/no fact change creates no further COW revisions or source field audit', async () => {
    await ingest();
    await refresh.applyBin(bin);
    const before = await readProducts();
    const count = (await db.select().from(s.sectionRevision).where(eq(s.sectionRevision.organizationId, graph.org)))
      .length;
    expect(await refresh.applyBin(bin)).toMatchObject({ kind: 'unchanged' });
    expect(await readProducts()).toEqual(before);
    expect(
      (await db.select().from(s.sectionRevision).where(eq(s.sectionRevision.organizationId, graph.org))).length,
    ).toBe(count);
  });
  it('manufacturer source product bodies remain readonly while local note/site/certificate edits use the real section service', async () => {
    await ingest();
    await refresh.applyBin(bin);
    const own = await sections.read(actor(), 'products');
    const data = productsReadSchema.parse(own.data);
    expect(() =>
      new ProductsHandler().parse({
        ...data.editable,
        products: [{ ...data.editable.products[0], nameRu: 'Forged source name' }],
      }),
    ).toThrow();
    const edited = data.editable.products.map((row) =>
      row.identityId === String(graph.rows.product_line!.identity_id) ? { ...row, note: 'Corrected local note' } : row,
    );
    await sections.save(actor(), 'products', {
      editVersion: own.editVersion,
      data: { ...data.editable, products: edited },
    });
    expect(
      (await readProducts()).lines.find((line) => line.identityId === String(graph.rows.product_line!.identity_id))!
        .note,
    ).toBe('Corrected local note');
    await ingest({ production_capacity: 'New source capacity' }, '2026-11-15T10:30:00.000Z');
    await refresh.applyBin(bin);
    expect(
      (await readProducts()).lines.find((line) => line.identityId === String(graph.rows.product_line!.identity_id))!,
    ).toMatchObject({ note: 'Corrected local note', capacityText: 'New source capacity' });
  });
  it('source refresh never overwrites manufacturer contact clears or corrected production addresses', async () => {
    await ingest();
    await refresh.applyBin(bin);
    const own = await sections.read(actor(), 'main_information');
    const read = mainInformationReadSchema.parse(own.data);
    await sections.save(actor(), 'main_information', {
      editVersion: own.editVersion,
      data: {
        ...read.editable,
        companyPhone: null,
        contactEmail: null,
        sites: read.editable.sites.map((site) => ({ ...site, address: `Manufacturer correction ${site.address}` })),
      },
    });
    await ingest(
      { phone: '+7 701 111 22 33', production_address: 'Changed upstream address' },
      '2026-11-15T10:30:00.000Z',
    );
    await refresh.applyBin(bin);
    const after = mainInformationReadSchema.parse(await new MainInformationHandler().read(db, await mainContext()));
    expect(after.editable.companyPhone).toBeNull();
    expect(after.editable.contactEmail).toBeNull();
    expect(after.editable.sites.every((site) => site.address?.startsWith('Manufacturer correction'))).toBe(true);
  });
  it.each(['manual', 'e_ondiris'] as const)(
    'keeps an explicitly cleared site association when an existing %s product is source-reconciled',
    async (existingSource) => {
      if (existingSource === 'e_ondiris') {
        await ingest();
        await refresh.applyBin(bin);
      }
      const own = await sections.read(actor(), 'products');
      const read = productsReadSchema.parse(own.data);
      const identityId = String(graph.rows.product_line!.identity_id);
      await sections.save(actor(), 'products', {
        editVersion: own.editVersion,
        data: {
          ...read.editable,
          products: read.editable.products.map((line) =>
            line.identityId === identityId ? { ...line, productionSiteIdentityId: null } : line,
          ),
        },
      });
      await ingest({ production_capacity: 'Updated capacity after clear' }, '2026-11-15T10:30:00.000Z');
      expect(await refresh.applyBin(bin)).toMatchObject({ kind: 'applied' });
      const after = await readProducts();
      expect(after.lines.find((line) => line.identityId === identityId)).toMatchObject({
        source: 'e_ondiris',
        productionSiteIdentityId: null,
        capacityText: 'Updated capacity after clear',
      });
      // A genuinely new identity may use a unique source-address match.
      if (existingSource === 'e_ondiris')
        expect(after.lines.find((line) => line.identityId !== identityId)!.productionSiteIdentityId).not.toBeNull();
    },
  );
  it('verified source snapshots stay frozen and catalogue/public pointers are untouched by a later local pull', async () => {
    await ingest();
    await refresh.applyBin(bin);
    const context = await productContext();
    const frozen = await readProducts();
    await db.transaction(async (raw) => {
      const tx = raw as Database;
      await captureRevisionFileVersions(tx, { sectionRevisionId: context.revisionId, organizationId: graph.org });
      await tx
        .update(s.sectionRevision)
        .set({ state: 'submitted', submittedAt: new Date() })
        .where(eq(s.sectionRevision.id, context.revisionId));
      await tx.update(s.sectionRevision).set({ state: 'verified' }).where(eq(s.sectionRevision.id, context.revisionId));
      await tx
        .update(s.profileSection)
        .set({ workingRevisionId: null, verifiedRevisionId: context.revisionId })
        .where(eq(s.profileSection.id, context.sectionId));
      await tx
        .update(s.manufacturerProfile)
        .set({ status: 'verified' })
        .where(eq(s.manufacturerProfile.id, graph.profile));
    });
    await ingest({ production_capacity: 'Unverified fresh source' }, '2026-11-15T10:30:00.000Z');
    expect(await refresh.applyBin(bin)).toMatchObject({ kind: 'applied' });
    expect(await readProducts(context.revisionId)).toEqual({ ...frozen, relatedChoices: null });
    expect(
      (await db.select().from(s.profileSection).where(eq(s.profileSection.id, context.sectionId)))[0]!
        .verifiedRevisionId,
    ).toBe(context.revisionId);
    expect((await readProducts()).lines[0]!.capacityText).toBe('Unverified fresh source');
  });
  it('submitted/under-review profiles defer and retain pending local refresh, without implicit unlock or source COW', async () => {
    await ingest();
    const before = await readProducts();
    await db
      .update(s.manufacturerProfile)
      .set({ status: 'submitted' })
      .where(eq(s.manufacturerProfile.id, graph.profile));
    expect(await refresh.applyBin(bin)).toEqual({ kind: 'deferred', bin });
    expect(await readProducts()).toEqual(before);
    expect((await db.select().from(eOndirisProfileRefresh).where(eq(eOndirisProfileRefresh.bin, bin)))[0]!.state).toBe(
      'deferred',
    );
    expect(
      (await db.select().from(s.manufacturerProfile).where(eq(s.manufacturerProfile.id, graph.profile)))[0]!.status,
    ).toBe('submitted');
  });
  it('conflicting manual matching blocks the whole candidate without losing either identity or its associations', async () => {
    const context = await productContext();
    const identity = (
      await db.insert(s.productLineIdentity).values({ profileId: graph.profile, organizationId: graph.org }).returning()
    )[0]!;
    await db.insert(s.productLine).values({
      sectionRevisionId: context.revisionId,
      organizationId: graph.org,
      identityId: identity.id,
      nameRu: 'Синтетическая деталь',
      tnVedCode: '0101000000',
    });
    await ingest();
    const before = await revisionContent(db, 'products', context.revisionId, graph.org);
    expect(await refresh.applyBin(bin)).toEqual({ kind: 'ambiguous', bin });
    expect(await revisionContent(db, 'products', context.revisionId, graph.org)).toEqual(before);
  });
  it('the database rejects cross-BIN snapshot linkage and altered source facts, while frozen IDs may reference non-current snapshots', async () => {
    await ingest();
    await refresh.applyBin(bin);
    const context = await productContext();
    const [line] = await db.select().from(s.productLine).where(eq(s.productLine.sectionRevisionId, context.revisionId));
    await expect(
      db.update(s.productLine).set({ nameRu: 'Forged' }).where(eq(s.productLine.id, line!.id)),
    ).rejects.toThrow();
    await expect(
      db.update(s.organizations).set({ bin: '000000000000' }).where(eq(s.organizations.id, graph.org)),
    ).rejects.toThrow();
    await expect(
      db.update(s.productLine).set({ unifiedRegisterRegistrationNumber: '999' }).where(eq(s.productLine.id, line!.id)),
    ).rejects.toThrow();
  });
  it('source field history contains complete before/after values and one shared operation ID across Main/products', async () => {
    await ingest();
    await refresh.applyBin(bin);
    const rows = (
      await pool.query(
        `SELECT diff FROM audit_entries WHERE organization_id=$1 AND action='profile.source.e_ondiris.materialized'`,
        [graph.org],
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.diff.operationId)).size).toBe(1);
    expect(
      rows.every((row) => row.diff.before.content && row.diff.after.content && row.diff.provider === 'e-ondiris'),
    ).toBe(true);
  });
  it('reads the newest source watermark after waiting for a profile lock rather than applying queued stale facts', async () => {
    await ingest();
    const held = await pool.connect();
    await held.query('BEGIN');
    await held.query('SELECT id FROM manufacturer_profile WHERE id=$1 FOR NO KEY UPDATE', [graph.profile]);
    const pending = refresh.applyBin(bin);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const activity = await pool.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%select p.id,p.organization_id%'",
        );
        if (activity.rows[0].n > 0) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await ingest({ production_capacity: 'Newest after queued event' }, '2026-11-15T10:30:00.000Z');
      await held.query('COMMIT');
      expect(await pending).toMatchObject({ kind: 'applied' });
      expect((await readProducts()).lines[0]!.capacityText).toBe('Newest after queued event');
      expect(
        (await db.select().from(eOndirisProfileRefresh).where(eq(eOndirisProfileRefresh.bin, bin)))[0]!
          .appliedObservedAt,
      ).toEqual(new Date('2026-11-15T10:30:00.000Z'));
    } finally {
      await held.query('ROLLBACK');
      held.release();
    }
  });
  it('source KP VED code/source-name pairs cannot be altered or split into fabricated classification rows', async () => {
    await ingest();
    await refresh.applyBin(bin);
    const context = await productContext();
    const [line] = await db
      .select()
      .from(s.productLine)
      .where(
        and(
          eq(s.productLine.sectionRevisionId, context.revisionId),
          eq(s.productLine.unifiedRegisterRegistrationNumber, '000027'),
        ),
      );
    await expect(
      db
        .update(s.productLineKpved)
        .set({ sourceName: 'Invented' })
        .where(eq(s.productLineKpved.productLineId, line!.id)),
    ).rejects.toThrow();
    await expect(db.delete(s.productLineKpved).where(eq(s.productLineKpved.productLineId, line!.id))).rejects.toThrow();
  });
  it('an unconfigured daily connector is explicit disabled and cannot advance any local watermark or create a finding', async () => {
    const worker = new EOndirisWorker(pool, new DisabledEOndirisFeedConnector(), source, refresh);
    expect(await worker.daily()).toEqual({ state: 'disabled', accepted: 0, rejected: 0 });
    expect(await source.current(bin)).toEqual([]);
  });
  it('conflicting or malformed source contacts never become arbitrary accepted initial Main defaults', async () => {
    const rows = fixture.rows.map((row, index) => ({
      ...row,
      bin_iin: bin,
      phone: index === 0 ? '+7 700 000 00 00' : '+7 701 111 22 33',
      email: index === 0 ? 'contact@synthetic.local' : 'other@synthetic.local',
    }));
    const parsed = validateEOndirisCapture(rows, { ...fixture.metadata, bin });
    if (parsed.kind !== 'received') throw new Error('Invalid fixture');
    await source.ingest(parsed.capture, undefined, requestEOndirisProfileRefresh);
    await refresh.applyBin(bin);
    const read = mainInformationReadSchema.parse(await new MainInformationHandler().read(db, await mainContext()));
    expect(read.editable.companyPhone).toBeNull();
    expect(read.editable.contactEmail).toBeNull();
    const audit = (
      await pool.query(
        `SELECT diff FROM audit_entries WHERE organization_id=$1 AND action='profile.source.e_ondiris.materialized'`,
        [graph.org],
      )
    ).rows;
    expect(audit[0].diff.sourceIssues).toEqual(
      expect.arrayContaining([
        { code: 'source_contact_ambiguous', field: 'companyPhone' },
        { code: 'source_contact_ambiguous', field: 'contactEmail' },
      ]),
    );
  });
  it('a configured recorded capture goes through the atomic outbox and actual local refresh worker, without network calls', async () => {
    const parsed = validateEOndirisCapture(
      fixture.rows.map((row) => ({ ...row, bin_iin: bin })),
      { ...fixture.metadata, bin },
    );
    if (parsed.kind !== 'received') throw new Error('Invalid fixture');
    const worker = new EOndirisWorker(
      pool,
      { configured: true, pull: async () => ({ kind: 'received', captures: [parsed.capture] }) },
      source,
      refresh,
    );
    expect(await worker.daily()).toEqual({ state: 'processed', accepted: 1, rejected: 0 });
    expect((await db.select().from(eOndirisProfileRefresh).where(eq(eOndirisProfileRefresh.bin, bin)))[0]!.state).toBe(
      'pending',
    );
    const result = await worker.refreshPending();
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect((await readProducts()).lines[0]!.source).toBe('e_ondiris');
    expect((await db.select().from(eOndirisProfileRefresh).where(eq(eOndirisProfileRefresh.bin, bin)))[0]!.state).toBe(
      'applied',
    );
  });
  it('passes retryable lower BINs to reach a healthy later BIN over two recovery batches', async () => {
    await coolDownEarlierFixtures();
    const blockedBins: string[] = [];
    for (let index = 0; index < 26; index++) {
      const targetBin = nextBin();
      const [org] = await db
        .insert(s.organizations)
        .values({ type: 'manufacturer', name: 'Queue fixture', bin: targetBin })
        .returning();
      await db.insert(s.manufacturerProfile).values({ organizationId: org!.id, status: 'submitted' });
      await ingestFor(targetBin);
      blockedBins.push(targetBin);
    }
    const healthy = await seedProfileGraph(pool);
    const healthyBin = nextBin();
    await db.update(s.organizations).set({ bin: healthyBin }).where(eq(s.organizations.id, healthy.org));
    await ingestFor(healthyBin);
    const worker = new EOndirisWorker(pool, new DisabledEOndirisFeedConnector(), source, refresh);
    expect(await worker.refreshPending()).toEqual({ processed: 0, deferred: 25, ambiguous: 0, failed: 0 });
    // Advance the retry eligibility to the next cron tick without a wall-clock sleep.
    await pool.query(
      "UPDATE e_ondiris_profile_refresh SET last_attempt_at=now()-interval '1 minute' WHERE bin=ANY($1::text[]) AND last_attempt_at IS NOT NULL",
      [blockedBins],
    );
    expect(await worker.refreshPending()).toEqual({ processed: 1, deferred: 24, ambiguous: 0, failed: 0 });
    const states = (
      await pool.query<{ bin: string; state: string; attempt_count: number }>(
        'SELECT bin,state,attempt_count FROM e_ondiris_profile_refresh WHERE bin=ANY($1::text[])',
        [[...blockedBins, healthyBin]],
      )
    ).rows;
    expect(states.find((row) => row.bin === healthyBin)!.state).toBe('applied');
    expect(blockedBins.every((value) => states.find((row) => row.bin === value)!.attempt_count >= 1)).toBe(true);
  });
  it('continues after pending extract capture rolls back one profile and retries it after the scan passes', async () => {
    await coolDownEarlierFixtures();
    const context = await productContext();
    const original = await revisionContent(db, 'products', context.revisionId, graph.org);
    const originalMain = await revisionContent(db, 'main_information', graph.revisions.main_information!, graph.org);
    const fileObjectId = String(graph.rows.products_section!.unified_register_extract_id);
    const [pendingFile] = await db
      .insert(s.fileVersion)
      .values({
        fileObjectId,
        versionNumber: 2,
        originalName: 'pending.pdf',
        byteSize: 1,
        declaredMediaType: 'application/pdf',
        checksum: 'pending-fixture',
        storageKey: randomUUID(),
        scanState: 'pending',
      })
      .returning();
    await ingest();
    const healthy = await seedProfileGraph(pool);
    const healthyBin = nextBin();
    await db.update(s.organizations).set({ bin: healthyBin }).where(eq(s.organizations.id, healthy.org));
    await ingestFor(healthyBin);
    const worker = new EOndirisWorker(pool, new DisabledEOndirisFeedConnector(), source, refresh);
    expect(await worker.refreshPending()).toEqual({ processed: 1, deferred: 0, ambiguous: 0, failed: 1 });
    expect(await revisionContent(db, 'products', context.revisionId, graph.org)).toEqual(original);
    expect((await productContext()).revisionId).toBe(context.revisionId);
    expect((await mainContext()).revisionId).toBe(graph.revisions.main_information);
    expect(await revisionContent(db, 'main_information', graph.revisions.main_information!, graph.org)).toEqual(
      originalMain,
    );
    expect(
      (await db.select().from(eOndirisProfileRefresh).where(eq(eOndirisProfileRefresh.bin, bin)))[0],
    ).toMatchObject({
      state: 'deferred',
      attemptCount: 1,
      appliedScopeHash: null,
    });
    expect(
      (await db.select().from(eOndirisProfileRefresh).where(eq(eOndirisProfileRefresh.bin, healthyBin)))[0]!.state,
    ).toBe('applied');
    // PostgreSQL now() has microseconds; compare-and-swap must retain them on a later failed attempt.
    await pool.query("UPDATE e_ondiris_profile_refresh SET last_attempt_at=now()-interval '1 minute' WHERE bin=$1", [
      bin,
    ]);
    expect(await worker.refreshPending()).toEqual({ processed: 0, deferred: 0, ambiguous: 0, failed: 1 });
    expect(
      (await db.select().from(eOndirisProfileRefresh).where(eq(eOndirisProfileRefresh.bin, bin)))[0]!.attemptCount,
    ).toBe(2);
    await db.update(s.fileVersion).set({ scanState: 'passed' }).where(eq(s.fileVersion.id, pendingFile!.id));
    await pool.query("UPDATE e_ondiris_profile_refresh SET last_attempt_at=now()-interval '1 minute' WHERE bin=$1", [
      bin,
    ]);
    expect(await worker.refreshPending()).toEqual({ processed: 1, deferred: 0, ambiguous: 0, failed: 0 });
    expect((await readProducts()).lines.every((line) => line.source === 'e_ondiris')).toBe(true);
    expect((await db.select().from(eOndirisProfileRefresh).where(eq(eOndirisProfileRefresh.bin, bin)))[0]!.state).toBe(
      'applied',
    );
  });
  it('a failed stale request never overwrites a newer accepted source reset', async () => {
    await coolDownEarlierFixtures();
    await ingest();
    const original = await revisionContent(db, 'products', graph.revisions.products!, graph.org);
    const apply = vi.spyOn(refresh, 'applyBin').mockImplementationOnce(async (targetBin) => {
      expect(targetBin).toBe(bin);
      await ingest({ production_capacity: 'New accepted scope during failure' }, '2026-11-15T10:30:00.000Z');
      throw new Error('Synthetic transaction failure');
    });
    try {
      const worker = new EOndirisWorker(pool, new DisabledEOndirisFeedConnector(), source, refresh);
      expect(await worker.refreshPending()).toEqual({ processed: 0, deferred: 0, ambiguous: 0, failed: 1 });
      const [request] = await db.select().from(eOndirisProfileRefresh).where(eq(eOndirisProfileRefresh.bin, bin));
      expect(request).toMatchObject({ state: 'pending', lastAttemptAt: null, attemptCount: 0, appliedScopeHash: null });
      expect(request!.requestedObservedAt.toISOString()).toBe('2026-11-15T10:30:00.000Z');
      expect(await revisionContent(db, 'products', graph.revisions.products!, graph.org)).toEqual(original);
    } finally {
      apply.mockRestore();
    }
    const worker = new EOndirisWorker(pool, new DisabledEOndirisFeedConnector(), source, refresh);
    expect(await worker.refreshPending()).toEqual({ processed: 1, deferred: 0, ambiguous: 0, failed: 0 });
    expect((await readProducts()).lines[0]!.capacityText).toBe('New accepted scope during failure');
  });
  it('separate pages for the same BIN are rejected before any accepted source watermark or outbox write', async () => {
    const parsed = validateEOndirisCapture(
      fixture.rows.map((row) => ({ ...row, bin_iin: bin })),
      { ...fixture.metadata, bin },
    );
    if (parsed.kind !== 'received') throw new Error('Invalid fixture');
    const worker = new EOndirisWorker(
      pool,
      { configured: true, pull: async () => ({ kind: 'received', captures: [parsed.capture, parsed.capture] }) },
      source,
      refresh,
    );
    expect(await worker.daily()).toEqual({ state: 'quarantined', accepted: 0, rejected: 0 });
    expect(await source.current(bin)).toEqual([]);
  });
  it('a real all-retained Send keeps a Verified profile with no pending pointers locked against source COW', async () => {
    await db.update(s.organizations).set({ bin: null }).where(eq(s.organizations.id, graph.org));
    const complete = await seedSubmissionProfile(pool);
    graph = complete;
    ownerId = complete.actor.id;
    await db.update(s.organizations).set({ bin }).where(eq(s.organizations.id, graph.org));
    const queue = { send: async () => randomUUID() } as unknown as import('pg-boss').PgBoss;
    const submit = new ProfileSubmitService(pool, audit, queue, submissionHandlers());
    // Retain a prior published Products revision while a distinct accepted candidate awaits publication.
    const publishedProducts = complete.revisions.products!;
    await db.transaction(async (raw) => {
      const tx = raw as Database;
      await captureRevisionFileVersions(tx, { sectionRevisionId: publishedProducts, organizationId: graph.org });
      await tx
        .update(s.sectionRevision)
        .set({ state: 'submitted', submittedAt: new Date() })
        .where(eq(s.sectionRevision.id, publishedProducts));
      await tx.update(s.sectionRevision).set({ state: 'verified' }).where(eq(s.sectionRevision.id, publishedProducts));
      await tx
        .update(s.profileSection)
        .set({ workingRevisionId: null, verifiedRevisionId: publishedProducts })
        .where(eq(s.profileSection.id, complete.sections.products));
      const [working] = await tx
        .insert(s.sectionRevision)
        .values({
          profileSectionId: complete.sections.products,
          organizationId: graph.org,
          revisionNumber: 2,
          editVersion: 1,
        })
        .returning();
      await copyRevisionContent(tx, 'products', publishedProducts, working!.id, graph.org);
      await tx
        .update(s.productLine)
        .set({ note: 'Accepted retained candidate note' })
        .where(eq(s.productLine.sectionRevisionId, working!.id));
      await tx
        .update(s.profileSection)
        .set({ workingRevisionId: working!.id })
        .where(eq(s.profileSection.id, complete.sections.products));
    });
    const input = async () => {
      const map = await profileCandidateRevisions(db, { profileId: graph.profile, organizationId: graph.org });
      const revisions = await db
        .select()
        .from(s.sectionRevision)
        .where(eq(s.sectionRevision.organizationId, graph.org));
      return {
        operationKey: randomUUID(),
        accuracyConfirmed: true as const,
        expectedSections: map.map((item) => ({
          kind: item.kind,
          revisionId: item.revisionId!,
          editVersion: revisions.find((r) => r.id === item.revisionId)!.editVersion,
        })),
      };
    };
    const first = await submit.submit(complete.actor, await input());
    const [imbc] = await db.select().from(s.organizations).where(eq(s.organizations.type, 'imbc'));
    const [expert] = await db
      .insert(s.userAccounts)
      .values({ organizationId: imbc!.id, role: 'expert', state: 'active', email: `${randomUUID()}@review.local` })
      .returning();
    await db
      .update(s.reviewAssignment)
      .set({ expertId: expert!.id, assignedBy: expert!.id, assignedAt: new Date() })
      .where(eq(s.reviewAssignment.id, first.assignmentId));
    const map = await db
      .select()
      .from(s.reviewAssignmentSection)
      .where(eq(s.reviewAssignmentSection.reviewAssignmentId, first.assignmentId));
    for (const item of map) {
      const documents = await db
        .select()
        .from(s.document)
        .where(eq(s.document.sectionRevisionId, item.sectionRevisionId));
      const certificates = await db
        .select()
        .from(s.certificate)
        .where(and(eq(s.certificate.sectionRevisionId, item.sectionRevisionId), eq(s.certificate.notHeld, false)));
      for (const subject of [
        ...documents.map((d) => ({ documentId: d.id })),
        ...certificates.map((c) => ({ certificateId: c.id })),
      ])
        await db.insert(s.reviewDecision).values({
          reviewAssignmentId: first.assignmentId,
          organizationId: graph.org,
          expertId: expert!.id,
          profileSectionId: item.profileSectionId,
          subjectRevisionId: item.sectionRevisionId,
          outcome: 'verified',
          decidedAt: new Date(),
          ...subject,
        });
      const [decision] = await db
        .insert(s.reviewDecision)
        .values({
          reviewAssignmentId: first.assignmentId,
          organizationId: graph.org,
          expertId: expert!.id,
          profileSectionId: item.profileSectionId,
          subjectRevisionId: item.sectionRevisionId,
          sectionRevisionId: item.sectionRevisionId,
          outcome: 'verified',
          decidedAt: new Date(),
        })
        .returning();
      await db
        .update(s.profileSectionCandidate)
        .set({ acceptedDecisionId: decision!.id })
        .where(eq(s.profileSectionCandidate.profileSectionId, item.profileSectionId));
    }
    await db
      .update(s.profileSection)
      .set({ pendingRevisionId: null })
      .where(eq(s.profileSection.profileId, graph.profile));
    await db
      .update(s.sectionRevision)
      .set({ state: 'verified' })
      .where(eq(s.sectionRevision.organizationId, graph.org));
    for (const item of map)
      if (item.profileSectionId !== complete.sections.products)
        await db
          .update(s.profileSection)
          .set({ verifiedRevisionId: item.sectionRevisionId })
          .where(eq(s.profileSection.id, item.profileSectionId));
    await db
      .update(s.reviewAssignment)
      .set({ closedAt: new Date(), closedBy: expert!.id, closeReason: 'review_result' })
      .where(eq(s.reviewAssignment.id, first.assignmentId));
    await db
      .update(s.manufacturerProfile)
      .set({ status: 'verified', verifiedAt: new Date(), hasPendingChanges: false })
      .where(eq(s.manufacturerProfile.id, graph.profile));
    const retained = await submit.submit(complete.actor, await input());
    expect(retained.profileStatus).toBe('verified');
    expect(retained.sections.every((item) => !item.reviewRequired)).toBe(true);
    expect(
      (await db.select().from(s.profileSection).where(eq(s.profileSection.profileId, graph.profile))).every(
        (section) => section.pendingRevisionId === null,
      ),
    ).toBe(true);
    await ingest();
    const [adataCheck] = await db
      .insert(s.externalCheck)
      .values({ profileId: graph.profile, organizationId: graph.org, connector: 'adata' })
      .returning();
    const [adataAttempt] = await db
      .insert(s.externalCheckAttempt)
      .values({
        externalCheckId: adataCheck!.id,
        trigger: 'quarterly',
        state: 'received',
        bin,
        completedAt: new Date(),
        value: { basic: { biin: bin, name_ru: 'Quarterly source legal name' } },
      })
      .returning();
    await db
      .update(s.externalCheck)
      .set({ latestAttemptId: adataAttempt!.id })
      .where(eq(s.externalCheck.id, adataCheck!.id));
    await requestMainSourceRefresh(db, graph.profile, graph.org, adataAttempt!.id);
    const mainRefresh = new MainSourceRefreshService(pool, audit, submissionHandlers());
    expect(await mainRefresh.applyProfile(graph.profile)).toBe('deferred');
    expect(await refresh.applyBin(bin)).toEqual({ kind: 'deferred', bin });
    expect(
      (await db.select().from(s.sectionRevision).where(eq(s.sectionRevision.organizationId, graph.org))).every(
        (revision) => revision.origin !== 'source_refresh',
      ),
    ).toBe(true);
    expect(
      (await db.select().from(s.reviewAssignment).where(eq(s.reviewAssignment.id, retained.assignmentId)))[0]!.closedAt,
    ).toBeNull();
    await db
      .update(s.reviewAssignment)
      .set({ closedAt: new Date(), closedBy: expert!.id, closeReason: 'review_result' })
      .where(eq(s.reviewAssignment.id, retained.assignmentId));
    expect(await mainRefresh.applyProfile(graph.profile)).toBe('applied');
    expect(await refresh.applyBin(bin)).toMatchObject({ kind: 'applied' });
    const after = await readProducts();
    expect(after.lines.find((line) => line.identityId === String(complete.rows.product_line!.identity_id))!.note).toBe(
      'Accepted retained candidate note',
    );
    expect(
      (await db.select().from(s.profileSection).where(eq(s.profileSection.id, complete.sections.products)))[0]!
        .verifiedRevisionId,
    ).toBe(publishedProducts);
  });
  it('profile creation atomically requeues an existing no-profile local scope without a source call or second connection', async () => {
    const initialBin = '000000000000';
    const parsed = validateEOndirisCapture(
      fixture.rows.map((row) => ({ ...row, bin_iin: initialBin })),
      { ...fixture.metadata, bin: initialBin },
    );
    if (parsed.kind !== 'received') throw new Error('Invalid fixture');
    await source.ingest(parsed.capture, undefined, requestEOndirisProfileRefresh);
    expect(await refresh.applyBin(initialBin)).toEqual({ kind: 'no_profile', bin: initialBin });
    const [org] = await db
      .insert(s.organizations)
      .values({ type: 'manufacturer', name: 'Local preloaded source fixture', bin: initialBin })
      .returning();
    await db.insert(s.manufacturerProfile).values({ organizationId: org!.id });
    expect(
      (await db.select().from(eOndirisProfileRefresh).where(eq(eOndirisProfileRefresh.bin, initialBin)))[0]!.state,
    ).toBe('pending');
    expect(await refresh.applyBin(initialBin)).toMatchObject({ kind: 'applied' });
  });
  it('runtime application grants permit source pointer/COW work and prohibit business-fact mutation or source deletion', async () => {
    const role = `source_runtime_${randomUUID().replaceAll('-', '')}`;
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`);
    await applyAppRoleGrants(pool, role);
    const runtimePool = new pg.Pool({ connectionString: url, options: `-c role=${role}`, max: 3 });
    try {
      const runtimeStore = new EOndirisSnapshotStore(runtimePool, { allowSynthetic: true });
      const parsed = validateEOndirisCapture(
        fixture.rows.map((row) => ({ ...row, bin_iin: bin })),
        { ...fixture.metadata, bin },
      );
      if (parsed.kind !== 'received') throw new Error('Invalid fixture');
      await runtimeStore.ingest(parsed.capture, undefined, requestEOndirisProfileRefresh);
      const runtimeDb = drizzle(runtimePool, { schema: s, casing: 'snake_case' });
      const runtimeRefresh = new EOndirisProfileRefreshService(
        runtimePool,
        new AuditService(runtimeDb),
        submissionHandlers(),
      );
      expect(await runtimeRefresh.applyBin(bin)).toMatchObject({ kind: 'applied' });
      await expect(
        runtimePool.query('UPDATE e_ondiris_record SET is_current=is_current WHERE bin=$1', [bin]),
      ).resolves.toBeTruthy();
      await expect(
        runtimePool.query("UPDATE e_ondiris_record SET product_name='Forged' WHERE bin=$1", [bin]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(runtimePool.query('DELETE FROM e_ondiris_record WHERE bin=$1', [bin])).rejects.toMatchObject({
        code: '42501',
      });
      await expect(runtimePool.query('UPDATE audit_entries SET outcome=outcome')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await runtimePool.end();
      await pool.query(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`);
    }
  });
  it('materializes 1001 source registrations in batches with exact names/classifications and keeps the separate manual identity', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      ...fixture.rows[0],
      bin_iin: bin,
      registration_number: String(i).padStart(6, '0'),
      product_name: `Synthetic product ${i}`,
    }));
    const parsed = validateEOndirisCapture(rows, { ...fixture.metadata, bin });
    if (parsed.kind !== 'received') throw new Error('Invalid fixture');
    await source.ingest(parsed.capture, undefined, requestEOndirisProfileRefresh);
    expect(await refresh.applyBin(bin)).toMatchObject({ kind: 'applied' });
    const read = await readProducts();
    expect(read.lines).toHaveLength(1002);
    const registry = read.lines.filter((line) => line.source === 'e_ondiris');
    expect(registry).toHaveLength(1001);
    expect(new Set(registry.map((line) => line.identityId)).size).toBe(1001);
    for (const index of [0, 999, 1000])
      expect(
        registry.find((line) => line.unifiedRegisterRegistrationNumber === String(index).padStart(6, '0')),
      ).toMatchObject({
        nameRu: `Synthetic product ${index}`,
        tnVedCode: '0101000000',
        kpved: [{ code: '01.00.10', sourceName: 'Synthetic KP VED name' }],
      });
    expect(read.lines.find((line) => line.identityId === String(graph.rows.product_line!.identity_id))!.source).toBe(
      'manual',
    );
  }, 30000);
});
