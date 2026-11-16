import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import {
  MAX_FILE_BYTES,
  ownPersonnelSchema,
  PROFILE_UPLOAD_PURPOSES,
  profileUploadSchema,
  profileUploadStateSchema,
  type ProfileUpload,
  type Role,
} from '@imbc/contracts';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Env } from '../src/config/env.js';
import type { Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { FILE_SCAN_QUEUE_OPTIONS, QUEUES } from '../src/jobs/queues.js';
import { FilesController } from '../src/modules/files/files.controller.js';
import { FilesService } from '../src/modules/files/files.service.js';
import { captureRevisionFileVersions } from '../src/modules/files/revision-file-snapshot.js';
import { PersonnelHandler } from '../src/modules/profiles/personnel.handler.js';
import { ProfileSectionsController } from '../src/modules/profiles/profile-sections.controller.js';
import { ProfileSectionsService } from '../src/modules/profiles/profile-sections.service.js';
import { ProfileUploadController, ProfileUploadGuard } from '../src/modules/profiles/profile-upload.controller.js';
import { ProfileUploadService } from '../src/modules/profiles/profile-upload.service.js';
import { defineSectionHandler } from '../src/modules/profiles/section-handler.js';
import { FileScanJob } from '../src/worker/file-scan.job.js';
import { StubAntivirus } from './support/antivirus-stub.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { type HttpStand, startHttp } from './support/http.js';
import { MemoryObjectStorage } from './support/memory-storage.js';

const QUARANTINE = 'upload-test-quarantine';
const FILES = 'upload-test-files';
const ROOT = '/api/v1/profiles/own/sections';
const route = (kind = 'personnel', purpose = 'organisation_chart') => `${ROOT}/${kind}/files/${purpose}`;
const fixture = (name: string) => readFileSync(new URL(`./fixtures/files/${name}`, import.meta.url));
const form = (name = 'Private evidence.pdf', bytes = fixture('sample.pdf')) => {
  const data = new FormData();
  data.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), name);
  return data;
};
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'manufacturer upload through actual HTTP, PostgreSQL, transactional queue and object storage',
  () => {
    vi.setConfig({ testTimeout: 30000 });
    let pool: pg.Pool;
    let db: Database;
    let boss: PgBoss;
    let storage: MemoryObjectStorage;
    let audit: AuditService;
    let files: FilesService;
    let uploads: ProfileUploadService;
    let antivirus: StubAntivirus;
    let scan: FileScanJob;
    let http: HttpStand;
    let profile: typeof s.manufacturerProfile.$inferSelect;
    let accountId: string;
    let binSeed = 0;
    const env = { S3_BUCKET_QUARANTINE: QUARANTINE, S3_BUCKET_FILES: FILES } as Env;

    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool);
      db = drizzle(pool, { schema: s, casing: 'snake_case' });
      boss = new PgBoss({
        connectionString: process.env.TEST_DATABASE_URL!,
        schema: 'pgboss_auth_test',
        supervise: false,
        schedule: false,
      });
      await boss.start();
      await boss.createQueue(QUEUES.fileScan, FILE_SCAN_QUEUE_OPTIONS);
    }, 60000);
    beforeEach(async () => {
      const suffix = randomUUID();
      const [org] = await db
        .insert(s.organizations)
        .values({ type: 'manufacturer', name: `Upload ${suffix}`, bin: `2415${String(++binSeed).padStart(8, '0')}` })
        .returning();
      const [account] = await db
        .insert(s.userAccounts)
        .values({
          organizationId: org!.id,
          role: 'manufacturer',
          state: 'active',
          email: `upload-${suffix}@fixture.local`,
        })
        .returning();
      accountId = account!.id;
      const [created] = await db.insert(s.manufacturerProfile).values({ organizationId: org!.id }).returning();
      profile = created!;
      storage = new MemoryObjectStorage();
      audit = new AuditService(db);
      files = new FilesService(db, boss, storage, env, audit);
      uploads = new ProfileUploadService(pool, files, audit);
      antivirus = new StubAntivirus();
      scan = new FileScanJob(db, storage, antivirus, env, audit, boss, {});
      const sections = new ProfileSectionsService(pool, audit, [defineSectionHandler(new PersonnelHandler())]);
      http = await startHttp({
        controllers: [ProfileUploadController, ProfileSectionsController, FilesController],
        providers: [
          { provide: ProfileUploadService, useValue: uploads },
          ProfileUploadGuard,
          { provide: ProfileSectionsService, useValue: sections },
          { provide: FilesService, useValue: files },
        ],
        organizationId: org!.id,
        accountIds: { manufacturer: accountId },
      });
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      await http?.close();
    });
    afterAll(async () => {
      await boss?.stop();
      await pool?.end();
    });

    const upload = async (kind = 'personnel', purpose = 'organisation_chart') => {
      const response = await http.upload(route(kind, purpose), 'manufacturer', form());
      expect(response.status).toBe(202);
      return profileUploadSchema.parse(await response.json());
    };
    const version = async (result: ProfileUpload) => {
      const [row] = await db.select().from(s.fileVersion).where(eq(s.fileVersion.id, result.upload.versionId));
      return row!;
    };
    const counts = async () => {
      const { rows } = await pool.query<{ objects: number; versions: number; jobs: number }>(
        `
      select (select count(*)::int from file_object where organization_id=$1) as objects,
        (select count(*)::int from file_version v join file_object o on o.id=v.file_object_id where o.organization_id=$1) as versions,
        (select count(*)::int from pgboss_auth_test.job where name=$2) as jobs`,
        [profile.organizationId, QUEUES.fileScan],
      );
      return rows[0]!;
    };
    /** Headers arrive with a declared body, but no body bytes are sent: buffering before denial would hang. */
    const headersOnly = (path: string, role?: Role) =>
      new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        const req = request(
          `${http.base}${path}`,
          {
            method: 'POST',
            headers: {
              origin: 'https://imbc.example.kz',
              'content-type': 'multipart/form-data; boundary=not-sent',
              'content-length': String(MAX_FILE_BYTES + 1024),
              ...(role ? { cookie: `imbc-session=${role}` } : {}),
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (part: Buffer) => chunks.push(part));
            response.on('end', () => {
              clearTimeout(timeout);
              resolve({ status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) });
              req.destroy();
            });
          },
        );
        const timeout = setTimeout(() => {
          req.destroy();
          reject(new Error('Upload authorization waited for body bytes'));
        }, 3000);
        req.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        req.flushHeaders();
      });

    it.each(
      Object.entries(PROFILE_UPLOAD_PURPOSES).flatMap(([kind, purposes]) =>
        purposes.map((purpose) => [kind, purpose] as const),
      ),
    )(
      '%s/%s registers an exact pending object/version and scan job without saving any section binding',
      async (kind, purpose) => {
        const result = await upload(kind, purpose);
        expect(result.upload).toMatchObject({
          versionNumber: 1,
          scanState: 'pending',
          canDownload: false,
          byteSize: fixture('sample.pdf').length,
          mediaType: 'application/pdf',
          rejectionReason: null,
        });
        const [object] = await db.select().from(s.fileObject).where(eq(s.fileObject.id, result.upload.fileId));
        expect(object).toMatchObject({ organizationId: profile.organizationId, purpose, dataClass: 'b_manufacturer' });
        const row = await version(result);
        expect(row).toMatchObject({ uploadedBy: accountId, versionNumber: 1, scanState: 'pending' });
        expect(storage.keys(QUARANTINE)).toEqual([row.storageKey]);
        expect(storage.keys(FILES)).toEqual([]);
        expect(storage.objects.get(`${QUARANTINE}/${row.storageKey}`)).toEqual(fixture('sample.pdf'));
        const { rows: jobs } = await pool.query<{ data: unknown }>(
          'select data from pgboss_auth_test.job where name=$1 and singleton_key=$2',
          [QUEUES.fileScan, row.id],
        );
        expect(jobs).toEqual([{ data: { fileVersionId: row.id } }]);
        const owners = await pool.query(
          'select 1 from personnel_org_chart where file_object_id=$1 union all select 1 from document where file_object_id=$1',
          [result.upload.fileId],
        );
        expect(owners.rows).toEqual([]);
        const { rows: history } = await pool.query('select 1 from profile_file_history where file_object_id=$1', [
          result.upload.fileId,
        ]);
        expect(history).toEqual([]);
        const { rows: audits } = await pool.query(
          'select object_type, diff from audit_entries where action=$1 and object_id=$2',
          ['profile.file.uploaded', result.upload.fileId],
        );
        expect(audits).toEqual([{ object_type: 'file_object', diff: { kind, purpose, versionNumber: 1 } }]);
        expect(JSON.stringify(result)).not.toContain(row.storageKey);
      },
    );

    it('a repeated producer upload always creates a new object with version 1', async () => {
      const first = await upload();
      const second = await upload();
      expect(second.upload.fileId).not.toBe(first.upload.fileId);
      expect(second.upload.versionId).not.toBe(first.upload.versionId);
      expect([first.upload.versionNumber, second.upload.versionNumber]).toEqual([1, 1]);
      expect(
        await db.select().from(s.fileVersion).where(eq(s.fileVersion.fileObjectId, first.upload.fileId)),
      ).toHaveLength(1);
    });

    it.each(['expert', 'administrator', 'director', 'operator', 'observer'] as const)(
      '%s is denied before multipart body bytes are sent',
      async (role) => {
        const result = await headersOnly(route(), role);
        expect(result).toMatchObject({ status: 403, body: { code: 'forbidden' } });
        expect(storage.keys(QUARANTINE)).toEqual([]);
        expect((await counts()).objects).toBe(0);
      },
    );
    it('an unauthenticated request is denied without waiting for multipart', async () => {
      expect(await headersOnly(route())).toMatchObject({ status: 401, body: { code: 'unauthenticated' } });
    });
    it.each([
      ['main_information', 'document_file'],
      ['contacts', 'cv'],
      ['personnel', 'document_file'],
      ['documents', 'organisation_chart_sample'],
      ['unknown', 'cv'],
    ])('unsupported %s/%s is denied before multipart', async (kind, purpose) => {
      expect(await headersOnly(route(kind, purpose), 'manufacturer')).toMatchObject({
        status: 400,
        body: { code: 'file_purpose_not_allowed' },
      });
      expect(storage.keys(QUARANTINE)).toEqual([]);
    });
    it('a manufacturer blocked since session resolution is denied before body parsing', async () => {
      await db.update(s.userAccounts).set({ state: 'blocked' }).where(eq(s.userAccounts.id, accountId));
      expect(await headersOnly(route(), 'manufacturer')).toMatchObject({ status: 403, body: { code: 'forbidden' } });
      expect(storage.keys(QUARANTINE)).toEqual([]);
    });
    it.each(['submitted', 'under_review'] as const)('%s profiles are rejected before body parsing', async (status) => {
      await db.update(s.manufacturerProfile).set({ status }).where(eq(s.manufacturerProfile.id, profile.id));
      expect(await headersOnly(route(), 'manufacturer')).toMatchObject({
        status: 409,
        body: { code: 'profile_locked' },
      });
    });

    it('enforces structural validation and size limits before object storage', async () => {
      const before = await counts();
      const missing = await http.upload(route(), 'manufacturer', new FormData());
      expect(missing.status).toBe(400);
      expect(await missing.json()).toMatchObject({ code: 'file_missing' });
      const mismatch = await http.upload(route(), 'manufacturer', form('Secret.pdf', fixture('sample.png')));
      expect(mismatch.status).toBe(415);
      expect(await mismatch.json()).toMatchObject({ code: 'file_type_mismatch' });
      const encrypted = await http.upload(route(), 'manufacturer', form('Secret.pdf', fixture('owner-password.pdf')));
      expect(encrypted.status).toBe(415);
      expect(await encrypted.json()).toMatchObject({ code: 'file_encrypted' });
      const large = await http.upload(route(), 'manufacturer', form('Secret.pdf', Buffer.alloc(MAX_FILE_BYTES + 1)));
      expect(large.status).toBe(413);
      expect(await large.json()).toMatchObject({ code: 'file_too_large' });
      expect(storage.keys(QUARANTINE)).toEqual([]);
      expect(await counts()).toEqual(before);
    });

    it('scan passes bytes into the live bucket and permits only own manufacturer preview before a saved binding', async () => {
      const result = await upload();
      const row = await version(result);
      const pending = await http.get(`/api/v1/files/${result.upload.fileId}/content`, 'manufacturer');
      expect(pending.status).toBe(409);
      expect(await pending.json()).toMatchObject({ code: 'file_pending_scan' });
      expect(await scan.run({ fileVersionId: row.id })).toBe('passed');
      expect(storage.keys(QUARANTINE)).toEqual([]);
      expect(storage.keys(FILES)).toEqual([row.storageKey]);
      const own = await http.get(`/api/v1/files/${result.upload.fileId}/content`, 'manufacturer');
      expect(own.status).toBe(200);
      expect(Buffer.from(await own.arrayBuffer())).toEqual(fixture('sample.pdf'));
      const expert = await http.get(`/api/v1/files/${result.upload.fileId}/content`, 'expert');
      expect(expert.status).toBe(403);
    });

    it('own unbound-upload metadata follows pending/passed/rejected states, including a locked-profile read', async () => {
      const result = await upload();
      const path = `${route()}/${result.upload.fileId}`;
      const pending = profileUploadStateSchema.parse(await (await http.get(path, 'manufacturer')).json());
      expect(pending).toEqual(result);
      await db
        .update(s.manufacturerProfile)
        .set({ status: 'submitted' })
        .where(eq(s.manufacturerProfile.id, profile.id));
      expect((await http.get(path, 'manufacturer')).status).toBe(200);
      await scan.run({ fileVersionId: result.upload.versionId });
      const passed = profileUploadStateSchema.parse(await (await http.get(path, 'manufacturer')).json());
      expect(passed.upload).toMatchObject({
        versionId: result.upload.versionId,
        scanState: 'passed',
        canDownload: true,
      });
      expect(JSON.stringify(passed)).not.toContain((await version(result)).storageKey);
    });

    it('unbound metadata reports a scan refusal but discloses no cross-tenant, mismatched-purpose or claimed file', async () => {
      const result = await upload();
      antivirus.verdict = { clean: false, signature: 'Heuristics.Encrypted.PDF' };
      await scan.run({ fileVersionId: result.upload.versionId });
      const state = profileUploadStateSchema.parse(
        await (await http.get(`${route()}/${result.upload.fileId}`, 'manufacturer')).json(),
      );
      expect(state.upload).toMatchObject({ scanState: 'rejected', rejectionReason: 'encrypted', canDownload: false });
      const wrongPurpose = await http.get(`${route('personnel', 'cv')}/${result.upload.fileId}`, 'manufacturer');
      expect(wrongPurpose.status).toBe(404);
      const [other] = await db
        .insert(s.organizations)
        .values({
          type: 'manufacturer',
          name: 'Metadata foreign fixture',
          bin: `2415${String(++binSeed).padStart(8, '0')}`,
        })
        .returning();
      const [foreign] = await db
        .insert(s.fileObject)
        .values({ organizationId: other!.id, purpose: 'organisation_chart', dataClass: 'b_manufacturer' })
        .returning();
      expect((await http.get(`${route()}/${foreign!.id}`, 'manufacturer')).status).toBe(404);
      await db
        .update(s.fileObject)
        .set({ purgeRequestedAt: new Date() })
        .where(eq(s.fileObject.id, result.upload.fileId));
      expect((await http.get(`${route()}/${result.upload.fileId}`, 'manufacturer')).status).toBe(404);
    });

    it.each(['expert', 'administrator', 'director', 'operator', 'observer'] as const)(
      '%s cannot poll own-producer upload metadata',
      async (role) => {
        const result = await upload();
        expect((await http.get(`${route()}/${result.upload.fileId}`, role)).status).toBe(403);
      },
    );
    it('a rejected scan removes untrusted bytes and cannot produce a downloadable preview', async () => {
      const result = await upload();
      const row = await version(result);
      antivirus.verdict = { clean: false, signature: 'Heuristics.Encrypted.PDF' };
      expect(await scan.run({ fileVersionId: row.id })).toBe('rejected');
      expect(await version(result)).toMatchObject({ scanState: 'rejected', rejectionReason: 'encrypted' });
      expect(storage.keys(QUARANTINE)).toEqual([]);
      expect(storage.keys(FILES)).toEqual([]);
      const response = await http.get(`/api/v1/files/${result.upload.fileId}/content`, 'manufacturer');
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'file_rejected' });
    });

    it('upload changes no revision until explicit Save binds the stable file ID, and scan updates read readiness', async () => {
      const first = ownPersonnelSchema.parse(await (await http.get(`${ROOT}/personnel`, 'manufacturer')).json());
      const result = await upload();
      const unchanged = ownPersonnelSchema.parse(await (await http.get(`${ROOT}/personnel`, 'manufacturer')).json());
      expect(unchanged).toMatchObject({
        revisionId: first.revisionId,
        editVersion: first.editVersion,
        savedAt: first.savedAt,
      });
      const saved = ownPersonnelSchema.parse(
        await (
          await http.send('PUT', `${ROOT}/personnel`, 'manufacturer', {
            editVersion: first.editVersion,
            data: {
              managersCount: 1,
              engineersCount: 2,
              productionWorkersCount: 3,
              nonresidentCount: 0,
              organisationChartIds: [result.upload.fileId],
              cvFileIds: [],
            },
          })
        ).json(),
      );
      expect(saved.completeness.percent).toBe(80);
      expect(saved.data.organisationCharts[0]).toMatchObject({
        fileId: result.upload.fileId,
        versionId: result.upload.versionId,
      });
      await scan.run({ fileVersionId: result.upload.versionId });
      const ready = ownPersonnelSchema.parse(await (await http.get(`${ROOT}/personnel`, 'manufacturer')).json());
      expect(ready.completeness.percent).toBe(100);
      expect(ready.data.organisationCharts[0]?.canDownload).toBe(true);
    });

    it('replacement uploads cannot change frozen evidence until explicit Save creates the working copy', async () => {
      const first = await upload();
      await scan.run({ fileVersionId: first.upload.versionId });
      const data = {
        managersCount: 1,
        engineersCount: 2,
        productionWorkersCount: 3,
        nonresidentCount: 0,
        organisationChartIds: [first.upload.fileId],
        cvFileIds: [],
      };
      const saved = ownPersonnelSchema.parse(
        await (await http.send('PUT', `${ROOT}/personnel`, 'manufacturer', { editVersion: 0, data })).json(),
      );
      const [section] = await db
        .select()
        .from(s.profileSection)
        .where(and(eq(s.profileSection.profileId, profile.id), eq(s.profileSection.kind, 'personnel')));
      await db.transaction(async (tx) => {
        await captureRevisionFileVersions(tx as Database, {
          sectionRevisionId: saved.revisionId!,
          organizationId: profile.organizationId,
        });
        await tx
          .update(s.sectionRevision)
          .set({ state: 'submitted', submittedAt: new Date() })
          .where(eq(s.sectionRevision.id, saved.revisionId!));
        await tx
          .update(s.profileSection)
          .set({ workingRevisionId: null, verifiedRevisionId: saved.revisionId! })
          .where(eq(s.profileSection.id, section!.id));
        await tx
          .update(s.sectionRevision)
          .set({ state: 'verified' })
          .where(eq(s.sectionRevision.id, saved.revisionId!));
        await tx
          .update(s.manufacturerProfile)
          .set({ status: 'verified' })
          .where(eq(s.manufacturerProfile.id, profile.id));
      });
      const replacement = await upload();
      expect(replacement.upload.fileId).not.toBe(first.upload.fileId);
      const stillFrozen = ownPersonnelSchema.parse(await (await http.get(`${ROOT}/personnel`, 'manufacturer')).json());
      expect(stillFrozen).toMatchObject({
        revisionId: saved.revisionId,
        editVersion: saved.editVersion,
        data: { organisationCharts: [{ fileId: first.upload.fileId, versionId: first.upload.versionId }] },
      });
      const changed = ownPersonnelSchema.parse(
        await (
          await http.send('PUT', `${ROOT}/personnel`, 'manufacturer', {
            editVersion: saved.editVersion,
            data: { ...data, organisationChartIds: [replacement.upload.fileId] },
          })
        ).json(),
      );
      expect(changed.revisionId).not.toBe(saved.revisionId);
      expect(changed.data.organisationCharts[0]?.fileId).toBe(replacement.upload.fileId);
    });

    it('a concurrent profile submission during staging rolls back metadata/job and discards bytes', async () => {
      const entered = gate();
      const released = gate();
      const original = storage.put.bind(storage);
      vi.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
        await original(...args);
        entered.resolve();
        await released.promise;
      });
      const before = await counts();
      const pending = http.upload(route(), 'manufacturer', form());
      await entered.promise;
      await db
        .update(s.manufacturerProfile)
        .set({ status: 'submitted' })
        .where(eq(s.manufacturerProfile.id, profile.id));
      released.resolve();
      const response = await pending;
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'profile_locked' });
      expect(storage.keys(QUARANTINE)).toEqual([]);
      expect(await counts()).toEqual(before);
    });
    it('an account blocked during staging is rechecked before metadata registration and denied atomically', async () => {
      const entered = gate();
      const released = gate();
      const original = storage.put.bind(storage);
      vi.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
        await original(...args);
        entered.resolve();
        await released.promise;
      });
      const before = await counts();
      const pending = http.upload(route(), 'manufacturer', form());
      await entered.promise;
      await db.update(s.userAccounts).set({ state: 'blocked' }).where(eq(s.userAccounts.id, accountId));
      released.resolve();
      const response = await pending;
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'forbidden' });
      expect(storage.keys(QUARANTINE)).toEqual([]);
      expect(await counts()).toEqual(before);
    });
    it('a changed account organisation during staging cannot register metadata against a stale own context', async () => {
      const [other] = await db
        .insert(s.organizations)
        .values({
          type: 'manufacturer',
          name: 'Other fixture organisation',
          bin: `2415${String(++binSeed).padStart(8, '0')}`,
        })
        .returning();
      const entered = gate();
      const released = gate();
      const original = storage.put.bind(storage);
      vi.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
        await original(...args);
        entered.resolve();
        await released.promise;
      });
      const before = await counts();
      const pending = http.upload(route(), 'manufacturer', form());
      await entered.promise;
      await db.update(s.userAccounts).set({ organizationId: other!.id }).where(eq(s.userAccounts.id, accountId));
      released.resolve();
      const response = await pending;
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'forbidden' });
      expect(storage.keys(QUARANTINE)).toEqual([]);
      expect(await counts()).toEqual(before);
    });

    it('a storage response failure after writing removes staging and commits no metadata/job', async () => {
      const original = storage.put.bind(storage);
      vi.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error('Fixture put response failure');
      });
      const before = await counts();
      const response = await http.upload(route(), 'manufacturer', form());
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'storage_unavailable' });
      expect(storage.keys(QUARANTINE)).toEqual([]);
      expect(await counts()).toEqual(before);
    });
    it('a transactional scan-queue failure rolls back rows and removes staging', async () => {
      const before = await counts();
      vi.spyOn(boss, 'send').mockRejectedValueOnce(new Error('Fixture queue failure'));
      const response = await http.upload(route(), 'manufacturer', form());
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ code: 'internal' });
      expect(storage.keys(QUARANTINE)).toEqual([]);
      expect(await counts()).toEqual(before);
    });
    it('a successful upload cannot commit without its audit entry', async () => {
      const before = await counts();
      vi.spyOn(audit, 'record').mockRejectedValueOnce(new Error('Fixture audit failure'));
      const response = await http.upload(route(), 'manufacturer', form());
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ code: 'internal' });
      expect(storage.keys(QUARANTINE)).toEqual([]);
      expect(await counts()).toEqual(before);
    });
  },
);
