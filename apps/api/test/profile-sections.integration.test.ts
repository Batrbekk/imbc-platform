import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { SECTION_KINDS, ownSectionsOverviewSchema, sectionReadSchema, type Role } from '@imbc/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AuditService } from '../src/common/audit.service.js';
import type { Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { ProfileSectionsController } from '../src/modules/profiles/profile-sections.controller.js';
import { ProfileSectionsService } from '../src/modules/profiles/profile-sections.service.js';
import { ReviewsService } from '../src/modules/reviews/reviews.service.js';
import { defineSectionHandler } from '../src/modules/profiles/section-handler.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp, type HttpStand } from './support/http.js';
import { seedProfileGraph } from './support/profile-graph.js';
import { copyRevisionContent, revisionContent, SECTION_CONTENT_TABLES } from '../src/modules/profiles/revision-copy.js';

const ROOT = '/api/v1/profiles/own/sections';
const WRITE = z.strictObject({ value: z.string().trim() });
const READ = sectionReadSchema(WRITE);
type FixtureData = z.infer<typeof WRITE>;
let malformedRead = false;

/** Typed synthetic handlers exercise the core independently of the MAN-11/13 section implementations. */
const contactsHandler = defineSectionHandler<FixtureData, FixtureData>({
  kind: 'contacts',
  readSchema: WRITE,
  parse: (input: unknown) => WRITE.parse(input),
  async editable(tx, context) {
    const [row] = await tx
      .select()
      .from(s.contact)
      .where(
        and(eq(s.contact.sectionRevisionId, context.revisionId), eq(s.contact.organizationId, context.organizationId)),
      );
    return { value: row?.fullName ?? '' };
  },
  async read(tx, context) {
    const editable = await this.editable(tx, context);
    const data = malformedRead ? { ...editable, privatePayload: 'private-server-payload-marker' } : editable;
    return data;
  },
  async save(tx, context, normalized) {
    await tx
      .delete(s.contact)
      .where(
        and(eq(s.contact.sectionRevisionId, context.revisionId), eq(s.contact.organizationId, context.organizationId)),
      );
    if (normalized.value)
      await tx.insert(s.contact).values({
        sectionRevisionId: context.revisionId,
        organizationId: context.organizationId,
        fullName: normalized.value,
      });
    if (normalized.value === 'fail') throw new Error('Controlled section handler failure');
  },
  async mandatoryInputs(tx, context) {
    const { value } = await this.editable(tx, context);
    return [{ path: 'value', code: 'value_required', satisfied: value.length > 0 }];
  },
});

const mainHandler = defineSectionHandler<FixtureData, FixtureData>({
  kind: 'main_information',
  readSchema: WRITE,
  parse: (input: unknown) => WRITE.parse(input),
  async editable(tx, context) {
    const [row] = await tx
      .select()
      .from(s.mainInformation)
      .where(
        and(
          eq(s.mainInformation.sectionRevisionId, context.revisionId),
          eq(s.mainInformation.organizationId, context.organizationId),
        ),
      );
    return { value: row?.companyPhone ?? '' };
  },
  async read(tx, context) {
    return this.editable(tx, context);
  },
  async save(tx, context, normalized) {
    await tx
      .update(s.mainInformation)
      .set({ companyPhone: normalized.value || null })
      .where(
        and(
          eq(s.mainInformation.sectionRevisionId, context.revisionId),
          eq(s.mainInformation.organizationId, context.organizationId),
        ),
      );
  },
  async mandatoryInputs(tx, context) {
    const { value } = await this.editable(tx, context);
    return [{ path: 'value', code: 'value_required', satisfied: value.length > 0 }];
  },
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'GEN-11 / MAN-40 own-section core with PostgreSQL and real HTTP',
  () => {
    vi.setConfig({ testTimeout: 30000 });
    let pool: pg.Pool;
    let db: Database;
    let http: HttpStand;
    let otherHttp: HttpStand;
    let profile: typeof s.manufacturerProfile.$inferSelect;
    let otherProfile: typeof s.manufacturerProfile.$inferSelect;
    let manufacturerId: string;
    let ids: Record<Role, string>;
    let binSeed = 0;

    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool);
      db = drizzle(pool, { schema: s, casing: 'snake_case' });
    }, 60000);

    beforeEach(async () => {
      malformedRead = false;
      const suffix = randomUUID();
      const [org] = await db
        .insert(s.organizations)
        .values({ type: 'manufacturer', name: `Own ${suffix}`, bin: `2412${String(++binSeed).padStart(8, '0')}` })
        .returning();
      const [other] = await db
        .insert(s.organizations)
        .values({ type: 'manufacturer', name: `Other ${suffix}`, bin: `2412${String(++binSeed).padStart(8, '0')}` })
        .returning();
      const [imbc] = await db.select().from(s.organizations).where(eq(s.organizations.type, 'imbc'));
      ids = {} as Record<Role, string>;
      for (const role of ['manufacturer', 'expert', 'director', 'administrator', 'operator', 'observer'] as const) {
        const [account] = await db
          .insert(s.userAccounts)
          .values({
            organizationId: role === 'manufacturer' ? org!.id : imbc!.id,
            role,
            state: 'active',
            email: `${role}-${suffix}@test.local`,
          })
          .returning();
        ids[role] = account!.id;
      }
      manufacturerId = ids.manufacturer;
      const [otherAccount] = await db
        .insert(s.userAccounts)
        .values({
          organizationId: other!.id,
          role: 'manufacturer',
          state: 'active',
          email: `other-${suffix}@test.local`,
        })
        .returning();
      const [ownRow] = await db.insert(s.manufacturerProfile).values({ organizationId: org!.id }).returning();
      const [otherRow] = await db.insert(s.manufacturerProfile).values({ organizationId: other!.id }).returning();
      profile = ownRow!;
      otherProfile = otherRow!;
      const service = new ProfileSectionsService(pool, new AuditService(db), [mainHandler, contactsHandler]);
      const providers = [{ provide: ProfileSectionsService, useValue: service }];
      http = await startHttp({
        controllers: [ProfileSectionsController],
        providers,
        organizationId: org!.id,
        accountIds: ids,
      });
      otherHttp = await startHttp({
        controllers: [ProfileSectionsController],
        providers,
        organizationId: other!.id,
        accountIds: { manufacturer: otherAccount!.id },
      });
    });

    afterEach(async () => {
      await http?.close();
      await otherHttp?.close();
    });
    afterAll(async () => {
      await pool?.end();
    });

    const read = async (kind = 'contacts') =>
      READ.parse(await (await http.get(`${ROOT}/${kind}`, 'manufacturer')).json());
    const save = (value: string, editVersion = 0, kind = 'contacts') =>
      http.send('PUT', `${ROOT}/${kind}`, 'manufacturer', { editVersion, data: { value } });

    it('initializes seven sections, distinguishes unknown and unavailable, and counts only implemented mandatory sections', async () => {
      const response = await http.get(ROOT, 'manufacturer');
      expect(response.status).toBe(200);
      const overview = ownSectionsOverviewSchema.parse(await response.json());
      expect(overview.sections.map(({ kind }) => kind)).toEqual([...SECTION_KINDS]);
      expect(overview.sections.filter(({ available }) => available).map(({ kind }) => kind)).toEqual([
        'main_information',
        'contacts',
      ]);
      expect(overview.completenessPct).toBe(0);
      expect((await http.get(`${ROOT}/shareholders`, 'manufacturer')).status).toBe(404);
      expect(await (await http.get(`${ROOT}/production`, 'manufacturer')).json()).toMatchObject({
        status: 409,
        code: 'section_unavailable',
      });
      expect(await (await save('x', 0, 'production')).json()).toMatchObject({
        status: 409,
        code: 'section_unavailable',
      });
      await save('filled');
      await save('phone', 0, 'main_information');
      const filled = ownSectionsOverviewSchema.parse(await (await http.get(ROOT, 'manufacturer')).json());
      expect(filled.completenessPct).toBeCloseTo(100 / 3, 12);
      const [stored] = await db.select().from(s.manufacturerProfile).where(eq(s.manufacturerProfile.id, profile.id));
      expect(Number(stored!.completenessPercent)).toBeCloseTo(100 / 3, 12);
      expect(stored!.completenessPct).toBe(33);
    });

    it('reads the rejected sent candidate after unlock and copies that candidate when correcting it', async () => {
      await save('Published contact');
      const published = await read();
      await db.transaction(async (tx) => {
        await tx
          .update(s.profileSection)
          .set({ workingRevisionId: null })
          .where(eq(s.profileSection.profileId, profile.id));
        await tx
          .update(s.sectionRevision)
          .set({ state: 'submitted', submittedAt: new Date() })
          .where(eq(s.sectionRevision.organizationId, profile.organizationId));
        await tx
          .update(s.sectionRevision)
          .set({ state: 'verified' })
          .where(eq(s.sectionRevision.organizationId, profile.organizationId));
        await tx.execute(sql`update profile_section section set verified_revision_id=revision.id
          from section_revision revision where revision.profile_section_id=section.id and section.profile_id=${profile.id}`);
        await tx
          .update(s.manufacturerProfile)
          .set({ status: 'verified' })
          .where(eq(s.manufacturerProfile.id, profile.id));
      });
      expect((await save('Last sent candidate', published.editVersion)).status).toBe(200);
      const sent = await read();
      const at = new Date();
      await db.transaction(async (tx) => {
        const sections = await tx.select().from(s.profileSection).where(eq(s.profileSection.profileId, profile.id));
        const contact = sections.find((section) => section.kind === 'contacts')!;
        await tx.update(s.profileSection).set({ workingRevisionId: null }).where(eq(s.profileSection.id, contact.id));
        await tx
          .update(s.sectionRevision)
          .set({ state: 'submitted', submittedAt: at })
          .where(eq(s.sectionRevision.id, sent.revisionId!));
        await tx.update(s.sectionRevision).set({ state: 'rejected' }).where(eq(s.sectionRevision.id, sent.revisionId!));
        const [assignment] = await tx
          .insert(s.reviewAssignment)
          .values({
            profileId: profile.id,
            organizationId: profile.organizationId,
            submittedBy: manufacturerId,
            receivedAt: at,
            accuracyConfirmedAt: at,
            submissionMode: 'verified_changes',
            operationKey: randomUUID(),
            requestFingerprint: 'a'.repeat(64),
          })
          .returning();
        await tx.insert(s.reviewAssignmentSection).values(
          sections.map((section) => ({
            reviewAssignmentId: assignment!.id,
            profileId: profile.id,
            organizationId: profile.organizationId,
            profileSectionId: section.id,
            sectionRevisionId: section.id === contact.id ? sent.revisionId! : section.verifiedRevisionId!,
            reviewRequired: true,
          })),
        );
        await tx
          .insert(s.profileSectionCandidate)
          .values({
            profileSectionId: contact.id,
            organizationId: profile.organizationId,
            reviewAssignmentId: assignment!.id,
            sectionRevisionId: sent.revisionId!,
          });
        await tx
          .update(s.reviewAssignment)
          .set({
            closedAt: at,
            closedBy: manufacturerId,
            closeReason: 'manufacturer_unlock',
            closeOperationKey: randomUUID(),
          })
          .where(eq(s.reviewAssignment.id, assignment!.id));
      });
      expect(await read()).toMatchObject({
        revisionId: sent.revisionId,
        revisionState: 'rejected',
        data: { value: 'Last sent candidate' },
        readOnly: false,
      });
      expect(
        await (await otherHttp.get(`${ROOT}/contacts?profileId=${profile.id}`, 'manufacturer')).json(),
      ).toMatchObject({ data: { value: '' } });
      expect((await save('Corrected candidate', sent.editVersion)).status).toBe(200);
      const corrected = await read();
      expect(corrected).toMatchObject({ revisionState: 'working', data: { value: 'Corrected candidate' } });
      expect(corrected.revisionId).not.toBe(sent.revisionId);
      const retained = await pool.query(
        'select r.id,r.state,c.full_name from section_revision r join contact c on c.section_revision_id=r.id where r.id=any($1::uuid[])',
        [[published.revisionId, sent.revisionId]],
      );
      expect(retained.rows).toEqual(
        expect.arrayContaining([
          { id: published.revisionId, state: 'verified', full_name: 'Published contact' },
          { id: sent.revisionId, state: 'rejected', full_name: 'Last sent candidate' },
        ]),
      );
    });

    it('scopes reads and writes to the account organisation and rejects selectors/readonly data in a write', async () => {
      await save('First private contact');
      expect(
        await (await otherHttp.get(`${ROOT}/contacts?profileId=${profile.id}`, 'manufacturer')).json(),
      ).toMatchObject({ data: { value: '' } });
      const response = await http.get(
        `${ROOT}/contacts?profileId=${otherProfile.id}&organizationId=${otherProfile.organizationId}`,
        'manufacturer',
      );
      expect(await response.json()).toMatchObject({ data: { value: 'First private contact' } });
      expect(
        (
          await http.send('PUT', `${ROOT}/contacts`, 'manufacturer', {
            editVersion: 1,
            profileId: otherProfile.id,
            data: { value: 'hack' },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await http.send('PUT', `${ROOT}/contacts`, 'manufacturer', {
            editVersion: 1,
            data: { value: 'hack', confirmed: true },
          })
        ).status,
      ).toBe(400);
    });

    it.each(['expert', 'director', 'administrator', 'operator', 'observer'] as const)(
      '%s cannot use manufacturer-only own-section reads or writes',
      async (role) => {
        expect((await http.get(ROOT, role)).status).toBe(403);
        expect((await http.get(`${ROOT}/contacts`, role)).status).toBe(403);
        expect(
          (await http.send('PUT', `${ROOT}/contacts`, role, { editVersion: 0, data: { value: 'denied' } })).status,
        ).toBe(403);
        expect((await read()).data.value).toBe('');
      },
    );

    it('rejects foreign Origin and rechecks a blocked account after the session guard', async () => {
      const response = await fetch(`${http.base}${ROOT}/contacts`, {
        method: 'PUT',
        headers: {
          cookie: 'imbc-session=manufacturer',
          origin: 'https://foreign.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ editVersion: 0, data: { value: 'denied' } }),
      });
      expect(response.status).toBe(403);
      expect((await http.get(ROOT)).status).toBe(401);
      await db.update(s.userAccounts).set({ state: 'blocked' }).where(eq(s.userAccounts.id, manufacturerId));
      expect((await save('denied')).status).toBe(403);
      expect(await db.select().from(s.contact).where(eq(s.contact.organizationId, profile.organizationId))).toEqual([]);
    });

    it('normalized no-op preserves version/time and full before/after history restores a previous draft', async () => {
      const initial = await read();
      const first = READ.parse(await (await save(' First name ')).json());
      expect(first).toMatchObject({ revisionId: initial.revisionId, editVersion: 1, data: { value: 'First name' } });
      const noOp = await (await save('First name', 1)).json();
      expect(noOp).toMatchObject({ revisionId: first.revisionId, editVersion: 1, savedAt: first.savedAt });
      const second = READ.parse(await (await save('Second name', 1)).json());
      expect(second.editVersion).toBe(2);
      const [section] = await db
        .select()
        .from(s.profileSection)
        .where(and(eq(s.profileSection.profileId, profile.id), eq(s.profileSection.kind, 'contacts')));
      const events = await db
        .select()
        .from(s.auditEntries)
        .where(and(eq(s.auditEntries.objectId, section!.id), eq(s.auditEntries.action, 'profile.section.save')));
      expect(events).toHaveLength(2);
      const latest = events.find(
        (event) => (event.diff as { after: { editVersion: number } }).after.editVersion === 2,
      )!;
      expect(latest.diff).toMatchObject({
        operationId: expect.any(String),
        before: { editVersion: 1, content: { contact: [{ full_name: 'First name' }] } },
        after: { editVersion: 2, content: { contact: [{ full_name: 'Second name' }] } },
      });
      expect(latest.userId).toBe(manufacturerId);
      expect(latest.organizationId).toBe(profile.organizationId);
    });

    it('two concurrent saves of the same edit version produce one success and one conflict', async () => {
      const responses = await Promise.all([save('A'), save('B')]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const failed = responses.find((response) => response.status === 409)!;
      expect(await failed.json()).toMatchObject({ code: 'section_changed' });
      expect((await read()).editVersion).toBe(1);
    });

    it('editing a verified section copies content and retains the verified value, state, and pointer', async () => {
      const old = READ.parse(await (await save('Verified contact')).json());
      const [section] = await db
        .select()
        .from(s.profileSection)
        .where(and(eq(s.profileSection.profileId, profile.id), eq(s.profileSection.kind, 'contacts')));
      await db.transaction(async (tx) => {
        await tx
          .update(s.sectionRevision)
          .set({ state: 'submitted', submittedAt: new Date() })
          .where(eq(s.sectionRevision.id, old.revisionId));
        await tx
          .update(s.profileSection)
          .set({ workingRevisionId: null, verifiedRevisionId: old.revisionId })
          .where(eq(s.profileSection.id, section!.id));
        await tx.update(s.sectionRevision).set({ state: 'verified' }).where(eq(s.sectionRevision.id, old.revisionId));
        await tx
          .update(s.manufacturerProfile)
          .set({ status: 'verified' })
          .where(eq(s.manufacturerProfile.id, profile.id));
      });
      expect(await read()).toMatchObject({
        readOnly: false,
        hasWorkingChanges: false,
        data: { value: 'Verified contact' },
      });
      const changed = READ.parse(await (await save('Working contact', old.editVersion)).json());
      expect(changed.revisionId).not.toBe(old.revisionId);
      expect(changed).toMatchObject({ editVersion: 2, hasWorkingChanges: true, data: { value: 'Working contact' } });
      const [frozen] = await db.select().from(s.contact).where(eq(s.contact.sectionRevisionId, old.revisionId));
      expect(frozen!.fullName).toBe('Verified contact');
      const [now] = await db.select().from(s.profileSection).where(eq(s.profileSection.id, section!.id));
      expect(now).toMatchObject({
        verifiedRevisionId: old.revisionId,
        workingRevisionId: changed.revisionId,
        pendingRevisionId: null,
      });
      const [profileNow] = await db
        .select()
        .from(s.manufacturerProfile)
        .where(eq(s.manufacturerProfile.id, profile.id));
      expect(profileNow).toMatchObject({ status: 'verified', hasPendingChanges: false });
      // Exact R1 queue predicate: rollback and mixed versions must exclude unsent working changes too.
      const legacyQueue = await pool.query(
        'select id from manufacturer_profiles where status = $1 and has_pending_changes = true',
        ['verified'],
      );
      expect(legacyQueue.rows.map((row) => row.id)).not.toContain(profile.id);
      expect(await (await http.get(ROOT, 'manufacturer')).json()).toMatchObject({ hasPendingChanges: false });
      // MAN-45 / reply 29: saving a working copy is not sending it to SME.
      const reviews = new ReviewsService(db);
      expect((await reviews.queue({})).items.map((item) => item.profileId)).not.toContain(profile.id);
      expect((await reviews.queue({ status: ['pending_changes'] })).total).toBe(0);
      await db.transaction(async (tx) => {
        await tx
          .update(s.sectionRevision)
          .set({ state: 'submitted', submittedAt: new Date() })
          .where(eq(s.sectionRevision.id, changed.revisionId));
        await tx
          .update(s.profileSection)
          .set({ workingRevisionId: null, pendingRevisionId: changed.revisionId })
          .where(eq(s.profileSection.id, section!.id));
        // The transitional profile flag is not the source of truth for queue admission or its badge.
        await tx
          .update(s.manufacturerProfile)
          .set({ hasPendingChanges: false })
          .where(eq(s.manufacturerProfile.id, profile.id));
      });
      const sent = await reviews.queue({ status: ['pending_changes'] });
      expect(sent.total).toBe(1);
      expect(sent.items[0]).toMatchObject({ profileId: profile.id, status: 'verified', hasPendingChanges: true });
      expect((await reviews.queue({})).items.map((item) => item.profileId)).toContain(profile.id);
      expect(await (await http.get(ROOT, 'manufacturer')).json()).toMatchObject({ hasPendingChanges: true });
    });

    it.each(['submitted', 'under_review'] as const)('%s profile cannot be edited', async (status) => {
      await db.update(s.manufacturerProfile).set({ status }).where(eq(s.manufacturerProfile.id, profile.id));
      expect((await read()).readOnly).toBe(true);
      expect(await (await save('denied')).json()).toMatchObject({ status: 409, code: 'profile_locked' });
    });

    it('sent pending changes lock a verified profile while unsent working values do not', async () => {
      const current = await read();
      const [section] = await db
        .select()
        .from(s.profileSection)
        .where(and(eq(s.profileSection.profileId, profile.id), eq(s.profileSection.kind, 'contacts')));
      await db.transaction(async (tx) => {
        await tx
          .update(s.sectionRevision)
          .set({ state: 'submitted', submittedAt: new Date() })
          .where(eq(s.sectionRevision.id, current.revisionId));
        await tx
          .update(s.profileSection)
          .set({ workingRevisionId: null, pendingRevisionId: current.revisionId })
          .where(eq(s.profileSection.id, section!.id));
        await tx
          .update(s.manufacturerProfile)
          .set({ status: 'verified', hasPendingChanges: true })
          .where(eq(s.manufacturerProfile.id, profile.id));
      });
      expect(await (await save('denied')).json()).toMatchObject({ status: 409, code: 'profile_locked' });
    });

    it('handler failure rolls back content, version, and audit together', async () => {
      expect((await save('fail')).status).toBe(500);
      expect(await read()).toMatchObject({ editVersion: 0, savedAt: null, data: { value: '' } });
      const [section] = await db
        .select()
        .from(s.profileSection)
        .where(and(eq(s.profileSection.profileId, profile.id), eq(s.profileSection.kind, 'contacts')));
      expect(await db.select().from(s.auditEntries).where(eq(s.auditEntries.objectId, section!.id))).toEqual([]);
    });

    it('a malformed handler read is a server error and never leaks additional private DTO fields', async () => {
      malformedRead = true;
      const response = await http.get(`${ROOT}/contacts`, 'manufacturer');
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toMatchObject({ code: 'internal' });
      expect(JSON.stringify(body)).not.toContain('private-server-payload-marker');
      expect(JSON.stringify(body)).not.toContain('privatePayload');
      expect(JSON.stringify(body)).not.toContain('errors');
    });

    it('copies all nineteen business tables and remaps child parents while preserving stable identities/files and excluding send snapshots', async () => {
      const source = await seedProfileGraph(pool);
      const sections = await db.select().from(s.profileSection).where(eq(s.profileSection.profileId, source.profile));
      const copied: Record<string, Record<string, unknown>[]> = {};
      const targets: string[] = [];
      await db.transaction(async (tx) => {
        await tx
          .update(s.profileSection)
          .set({ workingRevisionId: null })
          .where(eq(s.profileSection.profileId, source.profile));
        for (const kind of SECTION_KINDS) {
          await tx
            .update(s.sectionRevision)
            .set({ state: 'submitted', submittedAt: new Date() })
            .where(eq(s.sectionRevision.id, source.revisions[kind]!));
          const section = sections.find((row) => row.kind === kind)!;
          const [target] = await tx
            .insert(s.sectionRevision)
            .values({ profileSectionId: section.id, organizationId: source.org, revisionNumber: 2 })
            .returning();
          targets.push(target!.id);
          await copyRevisionContent(tx as unknown as Database, kind, source.revisions[kind]!, target!.id, source.org);
          Object.assign(copied, await revisionContent(tx as unknown as Database, kind, target!.id, source.org));
          await tx
            .update(s.profileSection)
            .set({ workingRevisionId: target!.id })
            .where(eq(s.profileSection.id, section.id));
        }
      });
      const tables = Object.values(SECTION_CONTENT_TABLES).flat();
      expect(tables).toHaveLength(19);
      for (const table of tables) {
        const rows = copied[table.name]!;
        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        const original = source.rows[table.name]!;
        if (table.hasId) expect(row.id).not.toBe(original.id);
        if (table.parent) expect(row[table.parent.column]).toBe(copied[table.parent.table]![0]!.id);
        for (const [key, value] of Object.entries(original)) {
          if (key === 'id' || key === table.revisionColumn || key === table.parent?.column) continue;
          expect(row[key]).toEqual(value);
        }
      }
      expect(
        (
          await pool.query(
            'SELECT count(*)::int n FROM submission_requirement WHERE section_revision_id=ANY($1::uuid[])',
            [targets],
          )
        ).rows[0]!.n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            'SELECT count(*)::int n FROM revision_file_version WHERE section_revision_id=ANY($1::uuid[])',
            [targets],
          )
        ).rows[0]!.n,
      ).toBe(0);
      expect(
        (await pool.query('SELECT count(*)::int n FROM production_site_identity WHERE profile_id=$1', [source.profile]))
          .rows[0]!.n,
      ).toBe(1);
      expect(
        (await pool.query('SELECT count(*)::int n FROM product_line_identity WHERE profile_id=$1', [source.profile]))
          .rows[0]!.n,
      ).toBe(1);
      expect(
        (await pool.query('SELECT count(*)::int n FROM certificate_identity WHERE profile_id=$1', [source.profile]))
          .rows[0]!.n,
      ).toBe(1);
      expect(
        (
          await pool.query('SELECT count(*)::int n FROM revision_file_version WHERE section_revision_id=$1', [
            source.revisions.documents,
          ])
        ).rows[0]!.n,
      ).toBe(1);
    });
  },
);
