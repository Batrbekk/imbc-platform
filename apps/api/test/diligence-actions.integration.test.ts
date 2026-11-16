import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ROLES, profileUploadSchema, profileUploadStateSchema, type ProfileUpload } from '@imbc/contracts';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Env } from '../src/config/env.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import { transactionWasRolledBack } from '../src/database/transaction.js';
import * as s from '../src/database/schema/index.js';
import { FILE_SCAN_QUEUE_OPTIONS, QUEUES } from '../src/jobs/queues.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { DiligenceRunController } from '../src/modules/due-diligence/diligence-run.controller.js';
import { DiligenceRunService } from '../src/modules/due-diligence/diligence-run.service.js';
import {
  DiligenceUploadController,
  DiligenceUploadGuard,
} from '../src/modules/due-diligence/diligence-upload.controller.js';
import { DiligenceUploadService } from '../src/modules/due-diligence/diligence-upload.service.js';
import { DiligenceService } from '../src/modules/due-diligence/diligence.service.js';
import { FilesService } from '../src/modules/files/files.service.js';
import { FilesController } from '../src/modules/files/files.controller.js';
import { acceptUpload } from '../src/modules/files/upload.js';
import { FileScanJob } from '../src/worker/file-scan.job.js';
import { recordDiligenceSourceReceipt } from '../src/modules/due-diligence/source-snapshot-store.js';
import { ADATA_DILIGENCE_SCHEMA_SHA256 } from '../src/modules/due-diligence/adata-normalizer.js';
import { DILIGENCE_CATALOG, DILIGENCE_CATALOG_VERSION } from '../src/modules/due-diligence/catalog.js';
import { evaluateReceivedDiligence } from '../src/modules/due-diligence/scoring.js';
import { storedDiligenceState } from '../src/modules/due-diligence/diligence-operation.js';
import { StubAntivirus } from './support/antivirus-stub.js';
import { MemoryObjectStorage } from './support/memory-storage.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { seedSubmissionProfile } from './support/profile-submit.js';
import { startHttp, type HttpStand } from './support/http.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'DD reports and explicit SME requests through actual HTTP/SQL/queue',
  () => {
    vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
    let pool: pg.Pool, appPool: pg.Pool, db: Database, appDb: Database, boss: PgBoss, http: HttpStand;
    let audit: AuditService,
      expert: AuthUser,
      director: AuthUser,
      diligence: DiligenceService,
      uploads: DiligenceUploadService,
      runs: DiligenceRunService;
    let storage: MemoryObjectStorage, files: FilesService, scan: FileScanJob, antivirus: StubAntivirus;
    const role = `dd_actions_${randomUUID().replaceAll('-', '')}`;
    const env = { S3_BUCKET_QUARANTINE: 'dd-quarantine', S3_BUCKET_FILES: 'dd-files' } as Env;
    const bytes = readFileSync(new URL('./fixtures/files/sample.pdf', import.meta.url));
    const form = () => {
      const value = new FormData();
      value.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), 'Private DD evidence.pdf');
      return value;
    };
    type Fixture = Awaited<ReturnType<typeof seedSubmissionProfile>>;
    const uploadPath = (g: Fixture, purpose = 'due_diligence_report') =>
      `/api/v1/profiles/${g.profile}/due-diligence/files/${purpose}`;
    const runPath = (g: Fixture) => `/api/v1/profiles/${g.profile}/due-diligence/runs`;
    const upload = async (g: Fixture, purpose = 'due_diligence_report'): Promise<ProfileUpload> => {
      const response = await http.upload(uploadPath(g, purpose), 'expert', form());
      expect(response.status).toBe(202);
      return profileUploadSchema.parse(await response.json());
    };
    const counts = async (g: Fixture) =>
      (
        await pool.query(
          `select
    (select count(*)::integer from file_object where organization_id=$1) as files,
    (select count(*)::integer from external_check_attempt a join external_check c on c.id=a.external_check_id where c.profile_id=$2) as attempts,
    (select count(*)::integer from pgboss_auth_test.job) as jobs,
    (select count(*)::integer from audit_entries where organization_id=$1) as audits`,
          [g.org, g.profile],
        )
      ).rows[0];
    // Only this service's leased connections lose one acknowledgement, after PostgreSQL
    // actually executes the statement. Other pool users and subsequent tests stay unchanged.
    const loseAcknowledgement = (statement: 'commit' | 'rollback', occurrence: number, failure: Error): pg.Pool => {
      let seen = 0;
      return {
        connect: async () => {
          const client = await appPool.connect();
          const query = client.query;
          const release = client.release;
          client.query = ((...args: unknown[]) => {
            const pending = Reflect.apply(query, client, args);
            const first = args[0];
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
    beforeAll(async () => {
      pool = openTestPool();
      const target = new URL(process.env.TEST_DATABASE_URL!);
      if (target.hostname !== '127.0.0.1' || target.port !== '55433')
        throw new Error('DD isolated exclusive 55433 required');
      await resetDatabase(pool);
      await migrateThrough(pool);
      db = drizzle(pool, { schema: s, casing: 'snake_case' });
      const imbc = (await db.select().from(s.organizations).where(eq(s.organizations.type, 'imbc')))[0]!;
      const make = async (roleName: 'expert' | 'director'): Promise<AuthUser> => {
        const row = (
          await db
            .insert(s.userAccounts)
            .values({
              role: roleName,
              organizationId: imbc.id,
              state: 'active',
              email: `${randomUUID()}@dd-actions.local`,
            })
            .returning()
        )[0]!;
        return {
          id: row.id,
          organizationId: imbc.id,
          organizationType: 'imbc',
          role: roleName,
          email: row.email,
          fullName: null,
          locale: 'en',
        };
      };
      expert = await make('expert');
      director = await make('director');
      await pool.query(`create role "${role}" nologin`);
      await applyAppRoleGrants(pool, role);
      appPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c role=${role}`, max: 5 });
      appDb = drizzle(appPool, { schema: s, casing: 'snake_case' });
      audit = new AuditService(appDb);
      boss = new PgBoss({
        connectionString: process.env.TEST_DATABASE_URL,
        schema: 'pgboss_auth_test',
        supervise: false,
        schedule: false,
      });
      await boss.start();
      await boss.createQueue(QUEUES.fileScan, FILE_SCAN_QUEUE_OPTIONS);
      await boss.createQueue(QUEUES.adataPrefill);
      await pool.query(
        `grant usage on schema pgboss_auth_test to "${role}"; grant select,insert,update,delete on all tables in schema pgboss_auth_test to "${role}"`,
      );
      storage = new MemoryObjectStorage();
      antivirus = new StubAntivirus();
      files = new FilesService(appDb, boss, storage, env, audit);
      scan = new FileScanJob(appDb, storage, antivirus, env, audit, boss, {});
      diligence = new DiligenceService(appPool, audit);
      uploads = new DiligenceUploadService(appPool, files, audit);
      runs = new DiligenceRunService(appPool, audit, boss);
      http = await startHttp({
        controllers: [DiligenceUploadController, DiligenceRunController, FilesController],
        providers: [
          { provide: DiligenceUploadService, useValue: uploads },
          DiligenceUploadGuard,
          { provide: DiligenceRunService, useValue: runs },
          { provide: FilesService, useValue: files },
        ],
        organizationId: imbc.id,
        accountIds: { expert: expert.id, director: director.id },
      });
    });
    afterAll(async () => {
      await http?.close();
      await boss?.stop();
      await appPool?.end();
      if (pool) await pool.query(`drop owned by "${role}"; drop role "${role}"`);
      await pool?.end();
    });
    it.each(ROLES)(
      'restricts %s report uploads and provider requests with no unauthorized side effects',
      async (roleName) => {
        const g = await seedSubmissionProfile(pool),
          before = await counts(g);
        const response = await http.upload(uploadPath(g), roleName, form());
        expect(response.status).toBe(roleName === 'expert' ? 202 : 403);
        const run = await http.send('POST', runPath(g), roleName, {});
        expect(run.status).toBe(roleName === 'expert' ? 202 : 403);
        if (roleName !== 'expert') expect(await counts(g)).toEqual(before);
      },
    );
    it.each(['due_diligence_report', 'enhanced_due_diligence_report'])(
      'scans %s and only explicit current/history owner grants exact bytes',
      async (purpose) => {
        const g = await seedSubmissionProfile(pool);
        const candidate = await upload(g, purpose);
        const row = (await db.select().from(s.fileVersion).where(eq(s.fileVersion.id, candidate.upload.versionId)))[0]!;
        expect(storage.keys(env.S3_BUCKET_QUARANTINE)).toContain(row.storageKey);
        expect((await http.get(`/api/v1/files/${candidate.upload.fileId}/content`, 'director')).status).toBe(403);
        await scan.run({ fileVersionId: row.id });
        const metadata = await http.get(`${uploadPath(g, purpose)}/${candidate.upload.fileId}`, 'expert');
        expect(metadata.status).toBe(200);
        expect(profileUploadStateSchema.parse(await metadata.json()).upload).toMatchObject({
          scanState: 'passed',
          canDownload: false,
        });
        expect((await http.get(`/api/v1/files/${candidate.upload.fileId}/content`, 'director')).status).toBe(403);
        let current = await diligence.override({ actor: expert }, g.profile, {
          expectedUpdatedAt: null,
          result: 'green',
          comment: null,
          reportFileId: purpose === 'due_diligence_report' ? candidate.upload.fileId : null,
        });
        if (purpose === 'enhanced_due_diligence_report')
          current = await diligence.enhanced({ actor: expert }, g.profile, {
            expectedUpdatedAt: current.record!.updatedAt,
            enhanced: 'done',
            comment: 'Enhanced',
            reportFileId: candidate.upload.fileId,
          });
        expect(
          purpose === 'due_diligence_report'
            ? { id: current.record!.reportFileVersionId, number: current.record!.reportFileVersionNumber }
            : {
                id: current.record!.enhancedReportFileVersionId,
                number: current.record!.enhancedReportFileVersionNumber,
              },
        ).toEqual({ id: candidate.upload.versionId, number: candidate.upload.versionNumber });
        await db.insert(s.fileVersion).values({
          fileObjectId: candidate.upload.fileId,
          versionNumber: 2,
          originalName: 'Rejected later candidate.pdf',
          byteSize: 1,
          declaredMediaType: 'application/pdf',
          checksum: 'rejected-fixture',
          storageKey: randomUUID(),
          scanState: 'rejected',
          rejectionReason: 'malware',
        });
        const history = await diligence.history({ actor: director }, g.profile);
        expect(history[0]!.reports).toEqual([
          {
            fileId: candidate.upload.fileId,
            versionId: candidate.upload.versionId,
            versionNumber: candidate.upload.versionNumber,
          },
        ]);
        expect((await http.get(`/api/v1/files/${candidate.upload.fileId}/content?version=2`, 'director')).status).toBe(
          404,
        );
        const download = await http.get(
          `/api/v1/files/${candidate.upload.fileId}/content?version=${candidate.upload.versionNumber}`,
          'director',
        );
        expect(download.status).toBe(200);
        expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
        for (const roleName of ['manufacturer', 'administrator', 'operator', 'observer'] as const)
          expect((await http.get(`/api/v1/files/${candidate.upload.fileId}/content`, roleName)).status).toBe(403);
      },
    );
    it('rejects invalid scope/purpose before staging and does not expose another uploader candidate metadata', async () => {
      const g = await seedSubmissionProfile(pool);
      const before = await counts(g),
        staged = storage.objects.size;
      expect((await http.upload(uploadPath(g, 'cv'), 'expert', form())).status).toBe(400);
      expect((await http.upload(uploadPath({ ...g, profile: randomUUID() }), 'expert', form())).status).toBe(404);
      expect(await counts(g)).toEqual(before);
      expect(storage.objects.size).toBe(staged);
      const candidate = await upload(g);
      await pool.query('update file_version set uploaded_by=$2 where id=$1', [candidate.upload.versionId, director.id]);
      expect((await http.get(`${uploadPath(g)}/${candidate.upload.fileId}`, 'expert')).status).toBe(404);
    });
    it('rejects scanned threats and preserves scan rejection reason without business mutation', async () => {
      const g = await seedSubmissionProfile(pool);
      const candidate = await upload(g);
      antivirus.verdict = { clean: false, signature: 'Synthetic.Test.Signature' };
      try {
        await scan.run({ fileVersionId: candidate.upload.versionId });
      } finally {
        antivirus.verdict = { clean: true };
      }
      const response = await http.get(`${uploadPath(g)}/${candidate.upload.fileId}`, 'expert');
      expect(profileUploadStateSchema.parse(await response.json()).upload).toMatchObject({
        scanState: 'rejected',
        rejectionReason: 'malware',
        canDownload: false,
      });
      await expect(
        diligence.override({ actor: expert }, g.profile, {
          expectedUpdatedAt: null,
          result: 'green',
          comment: null,
          reportFileId: candidate.upload.fileId,
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect((await diligence.read({ actor: expert }, g.profile)).record).toBeNull();
    });
    it('rechecks persisted actor after staging and removes bytes when authority changed', async () => {
      const g = await seedSubmissionProfile(pool),
        before = await counts(g),
        staged = storage.objects.size;
      const put = storage.put.bind(storage);
      const spy = vi.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
        await put(...args);
        await pool.query("update user_accounts set state='blocked' where id=$1", [expert.id]);
      });
      try {
        expect((await http.upload(uploadPath(g), 'expert', form())).status).toBe(403);
      } finally {
        spy.mockRestore();
        await pool.query("update user_accounts set state='active' where id=$1", [expert.id]);
      }
      expect(await counts(g)).toEqual(before);
      expect(storage.objects.size).toBe(staged);
    });
    it('rolls back file/queue registration and staging on audit/storage failure', async () => {
      const g = await seedSubmissionProfile(pool),
        before = await counts(g),
        staged = storage.objects.size;
      const accepted = await acceptUpload({
        buffer: bytes,
        originalname: 'synthetic.pdf',
        mimetype: 'application/pdf',
      } as Express.Multer.File);
      storage.failNext('put');
      await expect(uploads.upload(expert, g.profile, 'due_diligence_report', accepted, null)).rejects.toMatchObject({
        status: 503,
      });
      expect(await counts(g)).toEqual(before);
      expect(storage.objects.size).toBe(staged);
      const brokenAudit = {
        record: async () => {
          throw new Error('Synthetic audit unavailable');
        },
      };
      const failing = new DiligenceUploadService(appPool, files, brokenAudit as never);
      await expect(failing.upload(expert, g.profile, 'due_diligence_report', accepted, null)).rejects.toThrow(
        'Synthetic audit',
      );
      expect(await counts(g)).toEqual(before);
      expect(storage.objects.size).toBe(staged);
    });
    it('retains committed report bytes and scan job when the registration COMMIT acknowledgement is lost', async () => {
      const g = await seedSubmissionProfile(pool);
      const failure = new Error('Synthetic COMMIT acknowledgement lost');
      const faultyUploads = new DiligenceUploadService(loseAcknowledgement('commit', 2, failure), files, audit);
      const accepted = await acceptUpload({
        buffer: bytes,
        originalname: 'synthetic.pdf',
        mimetype: 'application/pdf',
      } as Express.Multer.File);
      const outcome = await faultyUploads.upload(expert, g.profile, 'due_diligence_report', accepted, null).then(
        () => null,
        (error: unknown) => error,
      );
      expect((outcome as Error & { cause: unknown }).cause).toBe(failure);
      expect(transactionWasRolledBack(outcome)).toBe(false);
      const versions = (
        await pool.query(
          `select v.id,v.file_object_id,v.storage_key from file_version v join file_object o on o.id=v.file_object_id
         where o.organization_id=$1 and o.purpose='due_diligence_report'`,
          [g.org],
        )
      ).rows;
      expect(versions).toHaveLength(1);
      const version = versions[0]!;
      expect(storage.objects.get(`${env.S3_BUCKET_QUARANTINE}/${version.storage_key}`)).toEqual(bytes);
      expect(
        (
          await pool.query(`select 1 from pgboss_auth_test.job where name=$1 and data->>'fileVersionId'=$2`, [
            QUEUES.fileScan,
            version.id,
          ])
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await pool.query(
            `select 1 from audit_entries where organization_id=$1 and action='due_diligence.file_uploaded' and object_id=$2`,
            [g.org, version.file_object_id],
          )
        ).rowCount,
      ).toBe(1);
      await scan.run({ fileVersionId: version.id });
      expect(
        (await uploads.metadata(expert, g.profile, 'due_diligence_report', version.file_object_id, null)).upload
          .scanState,
      ).toBe('passed');
      expect(storage.objects.get(`${env.S3_BUCKET_FILES}/${version.storage_key}`)).toEqual(bytes);
    });
    it('retains quarantine bytes when a failed registration also loses its ROLLBACK acknowledgement', async () => {
      const g = await seedSubmissionProfile(pool),
        before = await counts(g);
      const staged = new Set(storage.keys(env.S3_BUCKET_QUARANTINE));
      const failure = new Error('Synthetic ROLLBACK acknowledgement lost');
      const brokenAudit = {
        record: async () => {
          throw new Error('Synthetic callback failure');
        },
      };
      const faultyUploads = new DiligenceUploadService(
        loseAcknowledgement('rollback', 1, failure),
        files,
        brokenAudit as never,
      );
      const accepted = await acceptUpload({
        buffer: bytes,
        originalname: 'synthetic.pdf',
        mimetype: 'application/pdf',
      } as Express.Multer.File);
      const outcome = await faultyUploads.upload(expert, g.profile, 'due_diligence_report', accepted, null).then(
        () => null,
        (error: unknown) => error,
      );
      expect((outcome as Error & { cause: unknown }).cause).toBe(failure);
      expect(transactionWasRolledBack(outcome)).toBe(false);
      expect(await counts(g)).toEqual(before);
      const retained = storage.keys(env.S3_BUCKET_QUARANTINE).filter((key) => !staged.has(key));
      expect(retained).toHaveLength(1);
      expect(storage.objects.get(`${env.S3_BUCKET_QUARANTINE}/${retained[0]}`)).toEqual(bytes);
    });
    it('schedules one pending logical request for parallel SME intents, with no GET-triggered provider calls', async () => {
      const g = await seedSubmissionProfile(pool);
      const responses = await Promise.all([
        runs.request(expert, g.profile, {}, null),
        runs.request(expert, g.profile, {}, null),
      ]);
      expect(responses[0]!.lastRun?.attemptId).toBe(responses[1]!.lastRun?.attemptId);
      expect(responses[0]!.lastRun?.state).toBe('waiting');
      expect((await counts(g)).attempts).toBe(1);
      const before = await counts(g);
      await diligence.read({ actor: expert }, g.profile);
      await diligence.read({ actor: director }, g.profile);
      expect(await counts(g)).toEqual(before);
      expect((await pool.query('select used from adata_allowance')).rows).toEqual([]);
    });
    it.each(['not_configured', 'quota_exhausted'])(
      'requeues the same unsent %s logical attempt and preserves historical immutable completion',
      async (state) => {
        const g = await seedSubmissionProfile(pool);
        const first = await runs.request(expert, g.profile, {}, null);
        const id = first.lastRun!.attemptId;
        await appDb.transaction(async (raw) => {
          const tx = raw as unknown as Database;
          await tx.execute(sql`update external_check_attempt set state=${state}::external_check_state,
        completed_at='2026-11-16T00:00:00.123456Z',is_test_data=true where id=${id}`);
          await recordDiligenceSourceReceipt(tx, {
            profileId: g.profile,
            organizationId: g.org,
            attemptId: id,
            state: state as 'not_configured',
            evidence: [],
            automaticResult: null,
            schemaVersion: DILIGENCE_CATALOG_VERSION,
            schemaSha256: ADATA_DILIGENCE_SCHEMA_SHA256,
            isTestData: true,
          });
        });
        const second = await runs.request(expert, g.profile, {}, null);
        expect(second.lastRun).toMatchObject({ attemptId: id, state: 'waiting', completedAt: null, snapshotId: null });
        expect((await counts(g)).attempts).toBe(1);
        expect(
          (await pool.query('select completed_at::text from diligence_source_snapshot where attempt_id=$1', [id]))
            .rows[0].completed_at,
        ).toContain('123456');
      },
    );
    it('refuses stale persisted provider-run rights and rolls back attempt/pointer/job on enqueue failure', async () => {
      const g = await seedSubmissionProfile(pool),
        before = await counts(g);
      await pool.query("update policy_rule set effect='deny' where role='expert' and action='external_checks.run'");
      try {
        await expect(runs.request(expert, g.profile, {}, null)).rejects.toMatchObject({ status: 403 });
      } finally {
        await pool.query("update policy_rule set effect='allow' where role='expert' and action='external_checks.run'");
      }
      const failing = new DiligenceRunService(appPool, audit, {
        send: async () => {
          throw new Error('Synthetic queue failure');
        },
      } as never);
      await expect(failing.request(expert, g.profile, {}, null)).rejects.toThrow('Synthetic queue');
      expect(await counts(g)).toEqual(before);
      expect((await pool.query('select 1 from external_check where profile_id=$1', [g.profile])).rowCount).toBe(0);
    });
    it('rejects a concurrent stale SME override after an automatic replacement commits', async () => {
      const g = await seedSubmissionProfile(pool);
      const before = await diligence.override({ actor: expert }, g.profile, {
        expectedUpdatedAt: null,
        result: 'amber',
        comment: 'Reviewed earlier',
        reportFileId: null,
      });
      const requested = await runs.request(expert, g.profile, {}, null),
        attemptId = requested.lastRun!.attemptId;
      const d = DILIGENCE_CATALOG.find((c) => c.title === 'Bankrupt')!;
      const evidence = [
        {
          group: d.group,
          subjectIndex: 0,
          subjectName: 'Synthetic company',
          sourceOrder: 0,
          catalogId: d.id,
          checkName: d.title,
          kind: 'boolean' as const,
          value: true,
        },
      ];
      await appDb.transaction(async (raw) => {
        const tx = raw as unknown as Database;
        await tx.execute(
          sql`update external_check_attempt set state='received',completed_at=clock_timestamp(),is_test_data=true where id=${attemptId}`,
        );
        await recordDiligenceSourceReceipt(tx, {
          profileId: g.profile,
          organizationId: g.org,
          attemptId,
          state: 'received',
          evidence,
          automaticResult: evaluateReceivedDiligence(evidence).automaticResult,
          schemaVersion: DILIGENCE_CATALOG_VERSION,
          schemaSha256: ADATA_DILIGENCE_SCHEMA_SHA256,
          isTestData: true,
        });
      });
      let opened!: () => void, release!: () => void;
      const held = new Promise<void>((done) => {
          opened = done;
        }),
        gate = new Promise<void>((done) => {
          release = done;
        });
      const automatic = diligence.refresh(g.profile, g.org, async (phase) => {
        if (phase === 'audit') {
          opened();
          await gate;
        }
      });
      await held;
      const stale = diligence.override({ actor: expert }, g.profile, {
        expectedUpdatedAt: before.record!.updatedAt,
        result: 'green',
        comment: null,
        reportFileId: null,
      });
      release();
      expect(await automatic).toBe(true);
      await expect(stale).rejects.toMatchObject({ status: 409 });
      expect((await diligence.read({ actor: expert }, g.profile)).record?.result).toBe('red');
    });
    it('checks the full sealed after state at COMMIT, rolling back an operation with an omitted new check', async () => {
      const g = await seedSubmissionProfile(pool);
      await diligence.override({ actor: expert }, g.profile, {
        expectedUpdatedAt: null,
        result: 'green',
        comment: null,
        reportFileId: null,
      });
      const before = await storedDiligenceState(db, g.profile, g.org),
        operationId = randomUUID();
      const after = {
        record: before.record,
        checks: [
          {
            id: randomUUID(),
            profile_id: g.profile,
            organization_id: g.org,
            group_name: 'company_enterprise',
            subject_name: 'Synthetic',
            check_name: 'Omitted new check',
            adata_value: 'false',
            mark: 'clear',
            attention: false,
            position: 0,
          },
        ],
      };
      await expect(
        appDb.transaction(async (raw) => {
          const tx = raw as unknown as Database;
          const id = (
            await tx.execute<{
              id: string;
            }>(sql`insert into audit_entries(organization_id,action,object_type,object_id,diff)
        values(${g.org},'due_diligence.received','due_diligence',${g.profile},${JSON.stringify({ operationId, actor: { type: 'system' }, before, after })}::jsonb) returning id`)
          ).rows[0]!.id;
          await tx.execute(
            sql`insert into diligence_operation(id,profile_id,organization_id,audit_entry_id) values(${operationId},${g.profile},${g.org},${id})`,
          );
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
      expect(await storedDiligenceState(db, g.profile, g.org)).toEqual(before);
      expect((await pool.query('select 1 from diligence_operation where id=$1', [operationId])).rowCount).toBe(0);
    });
    it('rejects a forged temporary operation/audit that shadows real tables and would delete the current record without persistent history', async () => {
      const g = await seedSubmissionProfile(pool);
      await diligence.override({ actor: expert }, g.profile, {
        expectedUpdatedAt: null,
        result: 'green',
        comment: null,
        reportFileId: null,
      });
      const before = await storedDiligenceState(db, g.profile, g.org),
        operationId = randomUUID();
      await expect(
        appDb.transaction(async (raw) => {
          const tx = raw as unknown as Database;
          await tx.execute(
            sql`create temporary table diligence_operation (like public.diligence_operation including defaults) on commit drop`,
          );
          await tx.execute(
            sql`create temporary table audit_entries (like public.audit_entries including defaults) on commit drop`,
          );
          await tx.execute(sql`insert into pg_temp.diligence_operation(id,profile_id,organization_id,audit_entry_id,before_record_hash,after_record_hash)
          values(${operationId},${g.profile},${g.org},${randomUUID()},public.diligence_row_hash(${JSON.stringify(before.record)}::jsonb),null)`);
          await tx.execute(sql`select set_config('imbc.diligence_operation_id',${operationId},true)`);
          await tx.execute(
            sql`delete from public.due_diligence_record where profile_id=${g.profile} and organization_id=${g.org}`,
          );
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
      expect(await storedDiligenceState(db, g.profile, g.org)).toEqual(before);
      expect((await pool.query('select 1 from diligence_operation where id=$1', [operationId])).rowCount).toBe(0);
    });
  },
);
