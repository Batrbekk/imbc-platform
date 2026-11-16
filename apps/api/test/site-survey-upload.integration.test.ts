import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import {
  MAX_FILE_BYTES,
  profileUploadSchema,
  profileUploadStateSchema,
  ROLES,
  type ProfileUpload,
  type Role,
} from '@imbc/contracts';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Env } from '../src/config/env.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { transactionWasRolledBack } from '../src/database/transaction.js';
import { FILE_SCAN_QUEUE_OPTIONS, QUEUES } from '../src/jobs/queues.js';
import type { AuthContext, AuthUser } from '../src/modules/auth/auth.types.js';
import { FilesService } from '../src/modules/files/files.service.js';
import { acceptUpload } from '../src/modules/files/upload.js';
import { UploadSlots, UPLOAD_SLOTS } from '../src/modules/files/upload-slots.js';
import { SiteSurveyUploadController } from '../src/modules/site-survey/site-survey-upload.controller.js';
import { SiteSurveyUploadService } from '../src/modules/site-survey/site-survey-upload.service.js';
import { FileScanJob } from '../src/worker/file-scan.job.js';
import { StubAntivirus } from './support/antivirus-stub.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp, type HttpStand } from './support/http.js';
import { MemoryObjectStorage } from './support/memory-storage.js';
import { ORGANIZATION_TYPE } from './support/organization-type.js';
import { seedSubmissionProfile } from './support/profile-submit.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/files/${name}`, import.meta.url));
const bytes = fixture('sample.pdf');
const env = { S3_BUCKET_QUARANTINE: 'survey-test-quarantine', S3_BUCKET_FILES: 'survey-test-files' } as Env;
type Fixture = Awaited<ReturnType<typeof seedSubmissionProfile>>;
const path = (g: Fixture) => `/api/v1/profiles/${g.profile}/site-surveys/files`;
const form = (data = bytes, name = 'signed.pdf', type = 'application/pdf') => {
  const result = new FormData();
  result.append('file', new Blob([new Uint8Array(data)], { type }), name);
  return result;
};
const accepted = () =>
  acceptUpload({ buffer: bytes, originalname: 'signed.pdf', mimetype: 'application/pdf' } as Express.Multer.File);

/** Real PostgreSQL/HTTP/FilesService/pg-boss/scan transitions; storage and antivirus stay isolated in memory. */
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'Survey report candidates: upload, scan, scope and transaction compensation',
  () => {
    vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
    let pool: pg.Pool,
      appPool: pg.Pool,
      db: Database,
      boss: PgBoss,
      files: FilesService,
      audit: AuditService,
      uploads: SiteSurveyUploadService;
    let storage: MemoryObjectStorage, antivirus: StubAntivirus, scan: FileScanJob, expert: AuthUser, other: AuthUser;
    const actors = {} as Record<Role, AuthUser>;
    const stands: HttpStand[] = [];
    const dbRole = 'survey_upload_' + randomUUID().replaceAll('-', '');
    const stand = async (actor: AuthUser, slots?: UploadSlots) => {
      const http = await startHttp({
        controllers: [SiteSurveyUploadController],
        providers: [
          { provide: SiteSurveyUploadService, useValue: uploads },
          ...(slots ? [{ provide: UPLOAD_SLOTS, useValue: slots }] : []),
        ],
        organizationId: actor.organizationId,
        accountIds: { [actor.role]: actor.id },
      });
      stands.push(http);
      return http;
    };
    const counts = async () =>
      (
        await pool.query(`select
    (select count(*)::int from file_object) as objects,
    (select count(*)::int from file_version) as versions,
    (select count(*)::int from pgboss_auth_test.job where name='file-scan') as jobs,
    (select count(*)::int from audit_entries where action='site_survey.file_uploaded') as uploads,
    (select count(*)::int from site_survey_record) as surveys,
    (select count(*)::int from site_survey_notice_outbox) as notices`)
      ).rows[0]!;
    const upload = async (g: Fixture, actor = expert): Promise<ProfileUpload> => {
      const http = await stand(actor);
      const result = await http.upload(path(g), actor.role, form());
      expect(result.status).toBe(202);
      return profileUploadSchema.parse(await result.json());
    };
    const context = (user: AuthUser): AuthContext => ({
      sessionId: randomUUID(),
      mfaPassed: true,
      responsibilityAccepted: true,
      user,
    });
    const loseAcknowledgement = (statement: 'commit' | 'rollback', occurrence: number, failure: Error): pg.Pool => {
      let seen = 0;
      return {
        connect: async () => {
          const client = await appPool.connect(),
            query = client.query,
            release = client.release;
          client.query = ((...args: unknown[]) => {
            const pending = Reflect.apply(query, client, args),
              first = args[0];
            const text = typeof first === 'string' ? first : (first as { text?: string } | undefined)?.text;
            if (text?.trim().toLowerCase() === statement && ++seen === occurrence)
              return Promise.resolve(pending).then(() => {
                throw failure;
              });
            return pending;
          }) as typeof client.query;
          client.release = (...args) => {
            client.query = query;
            client.release = release;
            Reflect.apply(release, client, args);
          };
          return client;
        },
      } as pg.Pool;
    };
    // Send headers but no multipart bytes: an authorization refusal must complete without waiting for the body.
    const prebodyStatus = (http: HttpStand, url: string, role: Role) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          http.base + url,
          {
            method: 'POST',
            headers: {
              origin: 'https://imbc.example.kz',
              cookie: `imbc-session=${role}`,
              'content-type': 'multipart/form-data; boundary=unread-body',
              'content-length': '1024',
            },
          },
          (res) => {
            res.resume();
            res.on('end', () => {
              resolve(res.statusCode!);
              req.destroy();
            });
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        req.setTimeout(3000, () => {
          req.destroy(new Error('Upload waited for an unauthorized body'));
        });
        req.flushHeaders();
      });
    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool);
      db = drizzle(pool, { schema, casing: 'snake_case' });
      const imbc = (await db.select().from(schema.organizations).where(eq(schema.organizations.type, 'imbc')))[0]!;
      for (const role of ROLES) {
        const organization =
          ORGANIZATION_TYPE[role] === 'imbc'
            ? imbc
            : (
                await db
                  .insert(schema.organizations)
                  .values({ name: `Upload ${role}`, type: ORGANIZATION_TYPE[role] })
                  .returning()
              )[0]!;
        const account = (
          await db
            .insert(schema.userAccounts)
            .values({ organizationId: organization.id, role, state: 'active', email: `${randomUUID()}@survey.local` })
            .returning()
        )[0]!;
        actors[role] = {
          id: account.id,
          organizationId: organization.id,
          organizationType: organization.type,
          role,
          email: account.email,
          fullName: null,
          locale: 'en',
        };
      }
      expert = actors.expert;
      const account = (
        await db
          .insert(schema.userAccounts)
          .values({ organizationId: imbc.id, role: 'expert', state: 'active', email: `${randomUUID()}@survey.local` })
          .returning()
      )[0]!;
      other = { ...expert, id: account.id, email: account.email };
      boss = new PgBoss({
        connectionString: process.env.TEST_DATABASE_URL,
        schema: 'pgboss_auth_test',
        supervise: false,
        schedule: false,
      });
      await boss.start();
      await boss.createQueue(QUEUES.fileScan, FILE_SCAN_QUEUE_OPTIONS);
      await pool.query(`create role "${dbRole}" nologin`);
      await applyAppRoleGrants(pool, dbRole);
      await pool.query(
        `grant usage on schema pgboss_auth_test to "${dbRole}";grant select,insert,update,delete on all tables in schema pgboss_auth_test to "${dbRole}"`,
      );
      appPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c role=${dbRole}`, max: 5 });
      const appDb = drizzle(appPool, { schema, casing: 'snake_case' });
      audit = new AuditService(appDb);
      storage = new MemoryObjectStorage();
      antivirus = new StubAntivirus();
      files = new FilesService(appDb, boss, storage, env, audit);
      uploads = new SiteSurveyUploadService(appPool, files, audit);
      scan = new FileScanJob(db, storage, antivirus, env, new AuditService(db), boss, {});
    });
    afterEach(() => vi.restoreAllMocks());
    afterAll(async () => {
      for (const http of stands) await http.close();
      await boss?.stop();
      await appPool?.end();
      if (pool) await pool.query(`drop owned by "${dbRole}";drop role "${dbRole}"`);
      await pool?.end();
    });
    it.each(ROLES)('only an actual active SME can upload or poll a candidate: %s', async (role) => {
      const g = await seedSubmissionProfile(pool),
        http = await stand(actors[role]),
        before = await counts();
      const res = await http.upload(path(g), role, form());
      expect(res.status).toBe(role === 'expert' ? 202 : 403);
      if (role === 'expert') {
        const result = profileUploadSchema.parse(await res.json());
        expect((await http.get(path(g) + `/${result.upload.fileId}/state`, role)).status).toBe(200);
      } else {
        expect((await http.get(path(g) + `/${randomUUID()}/state`, role)).status).toBe(403);
        expect(await counts()).toEqual(before);
        expect(http.audit.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'denied' }));
      }
    });
    it.each(['inactive', 'blocked'] as const)(
      'refuses stale persisted %s SME before consuming multipart or acquiring upload memory',
      async (state) => {
        const g = await seedSubmissionProfile(pool),
          slots = new UploadSlots({ process: 4, account: 2 }),
          acquire = vi.spyOn(slots, 'tryAcquire');
        const http = await stand(expert, slots),
          before = await counts(),
          stored = storage.objects.size;
        await db.update(schema.userAccounts).set({ state }).where(eq(schema.userAccounts.id, expert.id));
        try {
          expect(await prebodyStatus(http, path(g), 'expert')).toBe(403);
          expect(acquire).not.toHaveBeenCalled();
          expect(storage.objects.size).toBe(stored);
          expect(await counts()).toEqual(before);
          expect(
            (
              await pool.query(
                "select 1 from audit_entries where user_id=$1 and action='imbc_records.edit' and outcome='denied'",
                [expert.id],
              )
            ).rowCount,
          ).toBeGreaterThan(0);
        } finally {
          await db.update(schema.userAccounts).set({ state: 'active' }).where(eq(schema.userAccounts.id, expert.id));
        }
      },
    );
    it('requires a real manufacturer profile before reading multipart', async () => {
      const slots = new UploadSlots({ process: 4, account: 2 }),
        acquire = vi.spyOn(slots, 'tryAcquire'),
        http = await stand(expert, slots),
        before = await counts();
      expect(await prebodyStatus(http, `/api/v1/profiles/${randomUUID()}/site-surveys/files`, 'expert')).toBe(404);
      expect(acquire).not.toHaveBeenCalled();
      expect(await counts()).toEqual(before);
    });
    it('rechecks current role and exact persisted c_imbc edit policy before multipart', async () => {
      const g = await seedSubmissionProfile(pool),
        http = await stand(expert);
      await db.update(schema.userAccounts).set({ role: 'administrator' }).where(eq(schema.userAccounts.id, expert.id));
      try {
        expect(await prebodyStatus(http, path(g), 'expert')).toBe(403);
      } finally {
        await db.update(schema.userAccounts).set({ role: 'expert' }).where(eq(schema.userAccounts.id, expert.id));
      }
      const policy = (
        await pool.query(
          "select * from policy_rule where role='expert' and action='imbc_records.edit' and data_class='c_imbc'",
        )
      ).rows[0]!;
      await pool.query("update policy_rule set effect='deny' where id=$1", [policy.id]);
      try {
        expect(await prebodyStatus(http, path(g), 'expert')).toBe(403);
      } finally {
        await pool.query('update policy_rule set effect=$1 where id=$2', [policy.effect, policy.id]);
      }
    });
    it.each(['pdf', 'jpg', 'png', 'docx', 'xlsx'])(
      'accepts the common %s format by content and registers one pending version',
      async (extension) => {
        const g = await seedSubmissionProfile(pool),
          http = await stand(expert);
        const result = await http.upload(
          path(g),
          'expert',
          form(fixture(`sample.${extension}`), `signed.${extension}`, 'application/octet-stream'),
        );
        expect(result.status).toBe(202);
        const row = profileUploadSchema.parse(await result.json()).upload;
        expect(row.scanState).toBe('pending');
        expect(row.versionNumber).toBe(1);
        expect(row.canDownload).toBe(false);
        expect(row.mediaType).not.toBe('application/octet-stream');
      },
    );
    it('keeps new objects, upload audit, scan jobs and original metadata atomic without a survey or notice', async () => {
      const g = await seedSubmissionProfile(pool),
        before = await counts(),
        first = await upload(g),
        second = await upload(g);
      expect(second.upload.fileId).not.toBe(first.upload.fileId);
      expect(second.upload.versionNumber).toBe(1);
      const after = await counts();
      expect(after).toEqual({
        ...before,
        objects: before.objects + 2,
        versions: before.versions + 2,
        jobs: before.jobs + 2,
        uploads: before.uploads + 2,
      });
      const version = (await pool.query('select * from file_version where id=$1', [first.upload.versionId])).rows[0]!;
      const object = (await pool.query('select * from file_object where id=$1', [first.upload.fileId])).rows[0]!;
      expect(object).toMatchObject({ organization_id: g.org, purpose: 'site_survey_report', data_class: 'c_imbc' });
      expect(version).toMatchObject({
        uploaded_by: expert.id,
        version_number: 1,
        scan_state: 'pending',
        byte_size: String(bytes.length),
      });
      expect(storage.objects.get(`${env.S3_BUCKET_QUARANTINE}/${version.storage_key}`)).toEqual(bytes);
      const jobs = (
        await pool.query(
          "select data,singleton_key from pgboss_auth_test.job where name=$1 and data->>'fileVersionId'=$2",
          [QUEUES.fileScan, first.upload.versionId],
        )
      ).rows;
      expect(jobs).toEqual([
        { data: { fileVersionId: first.upload.versionId }, singleton_key: first.upload.versionId },
      ]);
      const entry = (
        await pool.query("select diff from audit_entries where object_id=$1 and action='site_survey.file_uploaded'", [
          first.upload.fileId,
        ])
      ).rows[0]!.diff;
      expect(entry).toEqual({ profileId: g.profile, purpose: 'site_survey_report', versionId: first.upload.versionId });
      expect(JSON.stringify(first)).not.toContain(version.storage_key);
      expect(JSON.stringify(entry)).not.toContain('signed.pdf');
      expect(first.upload.uploadedAt).toMatch(/\.\d{6}Z$/);
    });
    it('scan passed remains an unreadable candidate until an exact owner is saved', async () => {
      const g = await seedSubmissionProfile(pool),
        candidate = await upload(g),
        before = await counts();
      antivirus.verdict = { clean: true };
      expect(await scan.run({ fileVersionId: candidate.upload.versionId! })).toBe('passed');
      const http = await stand(expert),
        response = await http.get(path(g) + `/${candidate.upload.fileId}/state`, 'expert');
      expect(response.status).toBe(200);
      const state = profileUploadStateSchema.parse(await response.json()).upload;
      expect(state).toMatchObject({
        scanState: 'passed',
        canDownload: false,
        versionId: candidate.upload.versionId,
        versionNumber: 1,
      });
      await expect(files.open(context(expert), candidate.upload.fileId, 1, null)).rejects.toMatchObject({
        code: 'forbidden',
      });
      expect((await counts()).surveys).toBe(before.surveys);
      expect((await counts()).notices).toBe(before.notices);
    });
    it.each(['malware', 'encrypted'])(
      'polls rejected %s reason without disclosing scan signatures or bytes',
      async (reason) => {
        const g = await seedSubmissionProfile(pool),
          candidate = await upload(g);
        antivirus.verdict = {
          clean: false,
          signature: reason === 'encrypted' ? 'Heuristics.Encrypted.Doc' : 'Synthetic.Test.Malware',
        };
        expect(await scan.run({ fileVersionId: candidate.upload.versionId! })).toBe('rejected');
        const state = await uploads.metadata(expert, g.profile, candidate.upload.fileId, null);
        expect(state.upload).toMatchObject({ scanState: 'rejected', rejectionReason: reason, canDownload: false });
        expect(JSON.stringify(state)).not.toContain('Synthetic.Test.Malware');
        expect(JSON.stringify(state)).not.toContain('Heuristics.Encrypted.Doc');
      },
    );
    it('temporary scanner failure leaves the candidate pending for retry', async () => {
      const g = await seedSubmissionProfile(pool),
        candidate = await upload(g);
      antivirus.verdict = new Error('Synthetic scanner unavailable');
      await expect(scan.run({ fileVersionId: candidate.upload.versionId! })).rejects.toThrow(
        'Synthetic scanner unavailable',
      );
      expect((await uploads.metadata(expert, g.profile, candidate.upload.fileId, null)).upload.scanState).toBe(
        'pending',
      );
    });
    it('candidate metadata excludes another SME, foreign organization, incorrect purpose and purging object', async () => {
      const g = await seedSubmissionProfile(pool),
        foreign = await seedSubmissionProfile(pool),
        candidate = await upload(g);
      await expect(uploads.metadata(other, g.profile, candidate.upload.fileId, null)).rejects.toMatchObject({
        code: 'not_found',
      });
      await expect(uploads.metadata(expert, foreign.profile, candidate.upload.fileId, null)).rejects.toMatchObject({
        code: 'not_found',
      });
      const object = (
        await db
          .insert(schema.fileObject)
          .values({ organizationId: g.org, purpose: 'due_diligence_report', dataClass: 'c_imbc' })
          .returning()
      )[0]!;
      await expect(uploads.metadata(expert, g.profile, object.id, null)).rejects.toMatchObject({ code: 'not_found' });
      await db
        .update(schema.fileObject)
        .set({ purgeRequestedAt: new Date() })
        .where(eq(schema.fileObject.id, candidate.upload.fileId));
      await expect(uploads.metadata(expert, g.profile, candidate.upload.fileId, null)).rejects.toMatchObject({
        code: 'not_found',
      });
    });
    it.each([
      { bytes: Buffer.alloc(0), name: 'empty.pdf', status: 400, code: 'file_empty' },
      { bytes: fixture('program.exe'), name: 'program.exe', status: 415, code: 'file_type_not_allowed' },
      { bytes: fixture('sample.png'), name: 'wrong.pdf', status: 415, code: 'file_type_mismatch' },
      { bytes: Buffer.alloc(MAX_FILE_BYTES + 1), name: 'too-large.pdf', status: 413, code: 'file_too_large' },
    ])('rejects $code before quarantine/rows/jobs', async (input) => {
      const g = await seedSubmissionProfile(pool),
        http = await stand(expert),
        before = await counts(),
        stored = storage.objects.size;
      const res = await http.upload(path(g), 'expert', form(input.bytes, input.name));
      expect(res.status).toBe(input.status);
      expect(await res.json()).toMatchObject({ code: input.code });
      expect(await counts()).toEqual(before);
      expect(storage.objects.size).toBe(stored);
    });
    it('revalidates an actor blocked after staging and removes bytes after confirmed rollback', async () => {
      const g = await seedSubmissionProfile(pool),
        before = await counts(),
        stored = storage.objects.size,
        put = storage.put.bind(storage);
      vi.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
        await put(...args);
        await db.update(schema.userAccounts).set({ state: 'blocked' }).where(eq(schema.userAccounts.id, expert.id));
      });
      try {
        await expect(uploads.upload(expert, g.profile, await accepted(), null)).rejects.toMatchObject({
          code: 'forbidden',
        });
        expect(storage.objects.size).toBe(stored);
        expect(await counts()).toEqual(before);
      } finally {
        await db.update(schema.userAccounts).set({ state: 'active' }).where(eq(schema.userAccounts.id, expert.id));
      }
    });
    it.each(['queue', 'audit'])('rolls back candidate, job and quarantine at a failed %s write', async (phase) => {
      const g = await seedSubmissionProfile(pool),
        before = await counts(),
        stored = storage.objects.size;
      if (phase === 'queue') vi.spyOn(boss, 'send').mockRejectedValueOnce(new Error('Synthetic queue failure'));
      else vi.spyOn(audit, 'record').mockRejectedValueOnce(new Error('Synthetic audit failure'));
      await expect(uploads.upload(expert, g.profile, await accepted(), null)).rejects.toThrow(
        `Synthetic ${phase} failure`,
      );
      expect(storage.objects.size).toBe(stored);
      expect(await counts()).toEqual(before);
    });
    it('storage failure creates no registration and returns the common bounded503', async () => {
      const g = await seedSubmissionProfile(pool),
        before = await counts(),
        stored = storage.objects.size;
      storage.failNext('put');
      await expect(uploads.upload(expert, g.profile, await accepted(), null)).rejects.toMatchObject({
        code: 'storage_unavailable',
        status: 503,
      });
      expect(storage.objects.size).toBe(stored);
      expect(await counts()).toEqual(before);
    });
    it('lost successful COMMIT acknowledgment retains committed candidate, audit, job and quarantine', async () => {
      const g = await seedSubmissionProfile(pool),
        before = await counts(),
        failure = new Error('Synthetic upload COMMIT acknowledgment lost');
      const uncertain = new SiteSurveyUploadService(loseAcknowledgement('commit', 2, failure), files, audit);
      const outcome = await uncertain.upload(expert, g.profile, await accepted(), null).then(
        () => null,
        (error) => error,
      );
      expect((outcome as Error & { cause: unknown }).cause).toBe(failure);
      expect(transactionWasRolledBack(outcome)).toBe(false);
      const after = await counts();
      expect(after).toEqual({
        ...before,
        objects: before.objects + 1,
        versions: before.versions + 1,
        jobs: before.jobs + 1,
        uploads: before.uploads + 1,
      });
      const version = (
        await pool.query(
          'select v.* from file_version v join file_object o on o.id=v.file_object_id where o.organization_id=$1',
          [g.org],
        )
      ).rows[0]!;
      expect(storage.objects.get(`${env.S3_BUCKET_QUARANTINE}/${version.storage_key}`)).toEqual(bytes);
    });
    it('lost ROLLBACK acknowledgment keeps uncertain bytes rather than deleting blindly', async () => {
      const g = await seedSubmissionProfile(pool),
        before = await counts(),
        stored = storage.objects.size,
        failure = new Error('Synthetic upload ROLLBACK acknowledgment lost');
      vi.spyOn(audit, 'record').mockRejectedValueOnce(new Error('Synthetic audit before uncertain rollback'));
      const uncertain = new SiteSurveyUploadService(loseAcknowledgement('rollback', 1, failure), files, audit);
      const outcome = await uncertain.upload(expert, g.profile, await accepted(), null).then(
        () => null,
        (error) => error,
      );
      expect((outcome as Error & { cause: unknown }).cause).toBe(failure);
      expect(transactionWasRolledBack(outcome)).toBe(false);
      expect(await counts()).toEqual(before);
      expect(storage.objects.size).toBe(stored + 1);
    });
  },
);
