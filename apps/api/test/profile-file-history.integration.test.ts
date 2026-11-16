import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ownPersonnelSchema, profileFileHistorySchema, type PersonnelWrite } from '@imbc/contracts';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { captureRevisionFileVersions } from '../src/modules/files/revision-file-snapshot.js';
import { PersonnelHandler } from '../src/modules/profiles/personnel.handler.js';
import { ProfileSectionsController } from '../src/modules/profiles/profile-sections.controller.js';
import { ProfileSectionsService } from '../src/modules/profiles/profile-sections.service.js';
import { defineSectionHandler } from '../src/modules/profiles/section-handler.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp, type HttpStand } from './support/http.js';

const ROOT = '/api/v1/profiles/own/sections/personnel';
const data = (organisationChartIds: string[]): PersonnelWrite => ({
  managersCount: 1, engineersCount: 1, productionWorkersCount: 1, nonresidentCount: 0,
  organisationChartIds, cvFileIds: [],
});
describe.skipIf(!process.env.TEST_DATABASE_URL)('MAN-36 immutable exact file history through HTTP and PostgreSQL', () => {
  let pool: pg.Pool;
  let db: Database;
  let http: HttpStand;
  let profile: typeof s.manufacturerProfile.$inferSelect;
  let actorId: string;
  beforeAll(async () => {
    pool = openTestPool(); await resetDatabase(pool); await migrateThrough(pool);
    db = drizzle(pool, { schema: s, casing: 'snake_case' });
  }, 60000);
  beforeEach(async () => {
    const [org] = await db.insert(s.organizations).values({ type: 'manufacturer', name: randomUUID() }).returning();
    const [actor] = await db.insert(s.userAccounts).values({ organizationId: org!.id, role: 'manufacturer',
      state: 'active', email: `${randomUUID()}@history.local` }).returning();
    actorId = actor!.id;
    const [created] = await db.insert(s.manufacturerProfile).values({ organizationId: org!.id }).returning();
    profile = created!;
    const sections = new ProfileSectionsService(pool, new AuditService(db), [defineSectionHandler(new PersonnelHandler())]);
    http = await startHttp({ controllers: [ProfileSectionsController], providers: [{ provide: ProfileSectionsService,
      useValue: sections }], organizationId: org!.id, accountIds: { manufacturer: actorId } });
  });
  afterEach(async () => { await http?.close(); });
  afterAll(async () => { await pool?.end(); });
  const version = async (fileId: string, number = 1, scanState: 'pending' | 'passed' | 'rejected' = 'passed') => {
    const [row] = await db.insert(s.fileVersion).values({ fileObjectId: fileId, versionNumber: number,
      originalName: `file-${number}.pdf`, byteSize: 123, declaredMediaType: 'application/pdf', checksum: 'a'.repeat(64),
      scanState, storageKey: randomUUID(), uploadedBy: actorId,
      rejectionReason: scanState === 'rejected' ? 'malware' : null }).returning();
    return row!;
  };
  const file = async (scanState: 'pending' | 'passed' | 'rejected' = 'passed') => {
    const [object] = await db.insert(s.fileObject).values({ organizationId: profile.organizationId,
      purpose: 'organisation_chart', dataClass: 'b_manufacturer' }).returning();
    return { object: object!, version: await version(object!.id, 1, scanState) };
  };
  const save = async (ids: string[], editVersion = 0) => {
    const response = await http.send('PUT', ROOT, 'manufacturer', { editVersion, data: data(ids) });
    expect(response.status).toBe(200); return ownPersonnelSchema.parse(await response.json());
  };
  const history = async (query = '') => {
    const response = await http.get(`${ROOT}/files/history${query}`, 'manufacturer');
    expect(response.status).toBe(200); return profileFileHistorySchema.parse(await response.json());
  };
  it('draft F→G retains exact earlier bytes/metadata and protects both object and version from deletion', async () => {
    const f = await file(); const g = await file();
    await save([f.object.id]); await save([g.object.id], 1);
    const result = await history();
    expect(result.total).toBe(2);
    expect(result.items.map((item) => [item.editVersion, item.file.versionId])).toEqual([
      [2, g.version.id], [1, f.version.id],
    ]);
    expect(result.items[1]!.file).toMatchObject({ originalName: 'file-1.pdf', byteSize: 123, canDownload: true });
    expect(JSON.stringify(result)).not.toContain('storageKey');
    await expect(db.delete(s.fileVersion).where(eq(s.fileVersion.id, f.version.id))).rejects.toMatchObject({ cause: { code: '23503' } });
    await expect(db.delete(s.fileObject).where(eq(s.fileObject.id, f.object.id))).rejects.toMatchObject({ cause: { code: '23503' } });
  });
  it('normalized no-op and stale save do not append evidence; failed binding rolls back before-history', async () => {
    const f = await file(); await save([f.object.id]); await save([f.object.id], 1);
    const stale = await http.send('PUT', ROOT, 'manufacturer', { editVersion: 0, data: data([]) });
    expect(stale.status).toBe(409);
    const invalid = await http.send('PUT', ROOT, 'manufacturer', { editVersion: 1, data: data([randomUUID()]) });
    expect(invalid.status).toBe(400);
    expect((await history()).total).toBe(1);
  });
  it('frozen before-state records captured Fv1 even when Fv2 exists; COW saves new object G separately', async () => {
    const f = await file(); const first = await save([f.object.id]);
    const [section] = await db.select().from(s.profileSection).where(eq(s.profileSection.workingRevisionId, first.revisionId!));
    await db.transaction(async (tx) => {
      await captureRevisionFileVersions(tx as Database, { sectionRevisionId: first.revisionId!, organizationId: profile.organizationId });
      await tx.update(s.sectionRevision).set({ state: 'submitted', submittedAt: new Date() }).where(eq(s.sectionRevision.id, first.revisionId!));
      await tx.update(s.profileSection).set({ workingRevisionId: null, verifiedRevisionId: first.revisionId }).where(eq(s.profileSection.id, section!.id));
      await tx.update(s.sectionRevision).set({ state: 'verified' }).where(eq(s.sectionRevision.id, first.revisionId!));
      await tx.update(s.manufacturerProfile).set({ status: 'verified' }).where(eq(s.manufacturerProfile.id, profile.id));
    });
    const later = await version(f.object.id, 2); const g = await file();
    const second = await save([g.object.id], 1); expect(second.revisionId).not.toBe(first.revisionId);
    const result = await history();
    expect(result.items.map((item) => item.file.versionId)).toEqual([g.version.id, f.version.id]);
    expect(result.items.some((item) => item.file.versionId === later.id)).toBe(false);
  });
  it('pending/rejected history remains visible as metadata and cannot be downloaded', async () => {
    const pending = await file('pending'); const rejected = await file('rejected');
    await save([pending.object.id]); await save([rejected.object.id], 1);
    expect((await history()).items.map((item) => [item.file.scanState, item.file.canDownload])).toEqual([
      ['rejected', false], ['pending', false],
    ]);
  });
  it('pagination is bounded, deterministic, and history has no writable operation', async () => {
    const f = await file(); const g = await file(); await save([f.object.id]); await save([g.object.id], 1);
    const page = await history('?offset=1&limit=1'); expect(page).toMatchObject({ total: 2, offset: 1, limit: 1 });
    expect(page.items[0]!.file.fileId).toBe(f.object.id);
    expect((await http.get(`${ROOT}/files/history?limit=101`, 'manufacturer')).status).toBe(400);
    const row = page.items[0]!;
    await expect(pool.query('update profile_file_history set edit_version=99 where id=$1', [row.id])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query('delete from profile_file_history where id=$1', [row.id])).rejects.toMatchObject({ code: '23514' });
  });
  it('history of a different manufacturer is not returned and non-manufacturer roles cannot read it', async () => {
    const f = await file(); await save([f.object.id]);
    await http.close();
    const [org] = await db.insert(s.organizations).values({ type: 'manufacturer', name: randomUUID() }).returning();
    const [actor] = await db.insert(s.userAccounts).values({ organizationId: org!.id, role: 'manufacturer',
      state: 'active', email: `${randomUUID()}@history.local` }).returning();
    await db.insert(s.manufacturerProfile).values({ organizationId: org!.id });
    const service = new ProfileSectionsService(pool, new AuditService(db), [defineSectionHandler(new PersonnelHandler())]);
    http = await startHttp({ controllers: [ProfileSectionsController], providers: [{ provide: ProfileSectionsService,
      useValue: service }], organizationId: org!.id, accountIds: { manufacturer: actor!.id } });
    expect((await history()).total).toBe(0);
    expect((await http.get(`${ROOT}/files/history`, 'administrator')).status).toBe(403);
  });
});
