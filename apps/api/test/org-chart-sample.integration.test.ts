import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type FilePurpose, type OrgChartSampleFile, orgChartSampleUploadSchema, type Role } from '@imbc/contracts';
import type { Provider } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import { ProblemException } from '../src/common/problem.js';
import type { Env } from '../src/config/env.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { FILE_SCAN_QUEUE_OPTIONS, QUEUES } from '../src/jobs/queues.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { FilesController } from '../src/modules/files/files.controller.js';
import { FilesService } from '../src/modules/files/files.service.js';
import { OrgChartSampleController } from '../src/modules/files/org-chart-sample.controller.js';
import {
  ORG_CHART_SAMPLE_ROUTES,
  OrgChartSampleService,
  orgChartSamplePassed,
} from '../src/modules/files/org-chart-sample.service.js';
import { acceptUpload } from '../src/modules/files/upload.js';
import { FileScanJob, SCAN_PASSED_HOOKS, type ScanPassedHook } from '../src/worker/file-scan.job.js';
import { WorkerModule } from '../src/worker/worker.module.js';
import { StubAntivirus } from './support/antivirus-stub.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { type HttpStand, startHttp } from './support/http.js';
import { MemoryObjectStorage } from './support/memory-storage.js';

// Образец оргструктуры на PostgreSQL 18 и pg-boss `pgboss_auth_test`: хранилище — MemoryObjectStorage, антивирус —
// StubAntivirus, без сети; `FileScanJob.run` вызывает тест. Загружает администратор (ADM-11), текущим образец
// становится только после скана (DATA-07), производитель скачивает текущий (MAN-19, расхождение 2 плана этапа 2).
const databaseUrl = process.env.TEST_DATABASE_URL;
const QUARANTINE = 'test-quarantine';
const FILES = 'test-files';
const env = { S3_BUCKET_QUARANTINE: QUARANTINE, S3_BUCKET_FILES: FILES } as Env;
/** Пользователь сеанса стенда startHttp (один на все роли); в БД — администратор IMBC. */
const SESSION_USER = '00000000-0000-4000-8000-0000000000a2';
const IP = '192.0.2.31';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const fixture = (name: string) => readFileSync(new URL(`./fixtures/files/${name}`, import.meta.url));

/** Хуки после скана, как их передаёт worker (`SCAN_PASSED_HOOKS` в WorkerModule). */
function workerScanHooks(): Partial<Record<FilePurpose, ScanPassedHook>> {
  const providers = (Reflect.getMetadata('providers', WorkerModule) ?? []) as Provider[];
  const provider = providers.find(
    (p): p is { provide: symbol; useValue: Partial<Record<FilePurpose, ScanPassedHook>> } =>
      typeof p === 'object' && 'provide' in p && p.provide === SCAN_PASSED_HOOKS && 'useValue' in p,
  );
  if (!provider) throw new Error('WorkerModule не передаёт SCAN_PASSED_HOOKS');
  return provider.useValue;
}

describe.skipIf(!databaseUrl)(
  'образец оргструктуры: загрузка, текущий после скана, скачивание (ADM-11, MAN-19)',
  () => {
    vi.setConfig({ testTimeout: 30000 });
    let pool: pg.Pool;
    let db: Database;
    let boss: PgBoss;
    let storage: MemoryObjectStorage;
    let antivirus: StubAntivirus;
    let files: FilesService;
    let samples: OrgChartSampleService;
    let scan: FileScanJob;
    let http: HttpStand;
    let imbcId: string;
    let admin: AuthUser;

    const accepted = (name: string, bytes: Buffer = fixture('sample.pdf')) =>
      acceptUpload({
        fieldname: 'file',
        originalname: name,
        encoding: '7bit',
        mimetype: 'application/pdf',
        size: bytes.length,
        buffer: bytes,
      } as Express.Multer.File);

    /** Администратор IMBC; `role`, `state` — состояние в БД (сеанс остаётся администраторским). */
    const imbcUser = async (
      role: Role = 'administrator',
      state: 'active' | 'blocked' = 'active',
    ): Promise<AuthUser> => {
      const id = randomUUID();
      await pool.query(
        'insert into user_accounts (id, organization_id, email, role, state) values ($1, $2, $3, $4, $5)',
        [id, imbcId, `${id}@imbc.local`, role, state],
      );
      return {
        id,
        email: `${id}@imbc.local`,
        fullName: null,
        role: 'administrator',
        organizationId: imbcId,
        organizationType: 'imbc',
        locale: 'kk',
      };
    };

    const upload = async (name: string, actor: AuthUser = admin) =>
      (await samples.upload(actor, await accepted(name), IP)).upload;

    const versionOf = async (fileId: string) =>
      (
        await pool.query<{ id: string; storage_key: string; scan_state: string }>(
          'select id, storage_key, scan_state from file_version where file_object_id = $1',
          [fileId],
        )
      ).rows[0]!;

    const scanAs = async (fileId: string, verdict: StubAntivirus['verdict'] = { clean: true }) => {
      antivirus.verdict = verdict;
      return scan.run({ fileVersionId: (await versionOf(fileId)).id });
    };

    /** Строки образцов по времени загрузки: id файла и признак текущего. */
    const rows = async () =>
      (
        await pool.query<{ file_object_id: string; is_current: boolean }>(
          'select file_object_id, is_current from org_chart_sample order by uploaded_at, id',
        )
      ).rows;

    const counts = async () =>
      (
        await pool.query<{ objects: number; versions: number; samples: number; jobs: number }>(
          `select (select count(*)::int from file_object) as objects, (select count(*)::int from file_version) as versions,
                (select count(*)::int from org_chart_sample) as samples,
                (select count(*)::int from pgboss_auth_test.job where name = $1) as jobs`,
          [QUEUES.fileScan],
        )
      ).rows[0]!;

    const audits = async (action: string, objectId: string) =>
      (
        await pool.query<{
          user_id: string | null;
          organization_id: string | null;
          object_type: string;
          outcome: string;
          diff: unknown;
          is_account_event: boolean;
          ip: string | null;
        }>(
          `select user_id, organization_id, object_type, outcome, diff, is_account_event, host(ip) as ip
           from audit_entries where action = $1 and object_id = $2 order by at, id`,
          [action, objectId],
        )
      ).rows;

    const problem = async (promise: Promise<unknown>) => {
      const error = await promise.then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ProblemException);
      const p = error as ProblemException;
      return { status: p.getStatus(), code: p.code };
    };

    const content = (fileId: string) => `/api/v1/files/${fileId}/content`;
    /** Статус скачивания и байты, если 200. */
    const download = async (fileId: string, role: Role) => {
      const res = await http.get(content(fileId), role);
      const body = Buffer.from(await res.arrayBuffer());
      return { status: res.status, body, code: res.status === 200 ? null : JSON.parse(body.toString()).code };
    };

    const passed = (file: OrgChartSampleFile): OrgChartSampleFile => ({ ...file, scanState: 'passed' });

    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool);
      db = drizzle(pool, { schema, casing: 'snake_case' });
      boss = new PgBoss({
        connectionString: databaseUrl,
        schema: 'pgboss_auth_test',
        supervise: false,
        schedule: false,
      });
      await boss.start();
      await boss.createQueue(QUEUES.fileScan, FILE_SCAN_QUEUE_OPTIONS);
      imbcId = (await pool.query<{ id: string }>("select id from organizations where type = 'imbc'")).rows[0]!.id;
      await pool.query(
        "insert into user_accounts (id, organization_id, email, role, state) values ($1, $2, 'admin@imbc.local', 'administrator', 'active')",
        [SESSION_USER, imbcId],
      );
      admin = {
        id: SESSION_USER,
        email: 'admin@imbc.local',
        fullName: null,
        role: 'administrator',
        organizationId: imbcId,
        organizationType: 'imbc',
        locale: 'kk',
      };
      storage = new MemoryObjectStorage();
      antivirus = new StubAntivirus();
      const audit = new AuditService(db);
      files = new FilesService(db, boss, storage, env, audit);
      samples = new OrgChartSampleService(db, pool, files, audit);
      scan = new FileScanJob(db, storage, antivirus, env, audit, boss, workerScanHooks());
      http = await startHttp({
        controllers: [FilesController, OrgChartSampleController],
        providers: [
          { provide: FilesService, useValue: files },
          { provide: OrgChartSampleService, useValue: samples },
        ],
        organizationId: imbcId,
      });
    }, 120000);

    beforeEach(async () => {
      storage.objects.clear();
      antivirus.verdict = { clean: true };
      await pool.query('delete from org_chart_sample; delete from file_version; delete from file_object');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    afterAll(async () => {
      await http?.close();
      await boss?.stop({ graceful: false });
      await pool?.end();
    });

    it('worker передаёт хук образца в SCAN_PASSED_HOOKS', () => {
      expect(workerScanHooks()).toEqual({ organisation_chart_sample: orgChartSamplePassed });
    });

    it('загрузка: file_object класса e_administration организации IMBC, строка org_chart_sample не текущая, 202 pending; аудит org_chart_sample.uploaded без имени файла (ADM-11)', async () => {
      const bytes = fixture('sample.pdf');
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), 'Құрылым үлгісі.pdf');
      const res = await http.upload(ORG_CHART_SAMPLE_ROUTES.sample, 'administrator', form);
      expect(res.status).toBe(202);
      const { upload: file } = orgChartSampleUploadSchema.parse(await res.json());
      expect(file).toEqual({
        fileId: expect.stringMatching(UUID),
        originalName: 'Құрылым үлгісі.pdf',
        byteSize: bytes.length,
        mediaType: 'application/pdf',
        scanState: 'pending',
        uploadedAt: expect.any(String),
      });

      const object = await pool.query('select organization_id, purpose, data_class from file_object where id = $1', [
        file.fileId,
      ]);
      expect(object.rows).toEqual([
        { organization_id: imbcId, purpose: 'organisation_chart_sample', data_class: 'e_administration' },
      ]);
      const sample = (
        await pool.query<{
          id: string;
          uploaded_by: string;
          is_current: boolean;
          uploaded_at: Date;
          same_time: boolean;
        }>(
          `select s.id, s.uploaded_by, s.is_current, s.uploaded_at, s.uploaded_at = v.uploaded_at as same_time
           from org_chart_sample s join file_version v on v.file_object_id = s.file_object_id
          where s.file_object_id = $1`,
          [file.fileId],
        )
      ).rows;
      expect(sample).toEqual([
        {
          id: expect.stringMatching(UUID),
          uploaded_by: SESSION_USER,
          is_current: false,
          uploaded_at: expect.any(Date),
          same_time: true,
        },
      ]);
      expect(file.uploadedAt).toBe(sample[0]!.uploaded_at.toISOString());

      // Байты — в карантине, задание скана — в очереди; рабочий бакет пуст.
      const version = await versionOf(file.fileId);
      expect(version.scan_state).toBe('pending');
      expect(storage.keys(QUARANTINE)).toEqual([version.storage_key]);
      expect(storage.keys(FILES)).toEqual([]);
      const jobs = await pool.query(
        `select 1 from pgboss_auth_test.job where name = $1 and data->>'fileVersionId' = $2`,
        [QUEUES.fileScan, version.id],
      );
      expect(jobs.rowCount).toBe(1);

      expect(await audits('org_chart_sample.uploaded', sample[0]!.id)).toEqual([
        {
          user_id: SESSION_USER,
          organization_id: imbcId,
          object_type: 'org_chart_sample',
          outcome: 'ok',
          diff: { fileObjectId: file.fileId },
          is_account_event: false,
          ip: expect.stringMatching(/127\.0\.0\.1/),
        },
      ]);
      const auditText = JSON.stringify(
        (await pool.query("select * from audit_entries where action = 'org_chart_sample.uploaded'")).rows,
      );
      for (const part of ['Құрылым', 'үлгісі', version.storage_key]) expect(auditText).not.toContain(part);

      // До скана файл не открывается никому (DATA-07), и текущим он не стал.
      expect(await samples.state()).toEqual({ current: null, latest: file });
      expect(await download(file.fileId, 'administrator')).toMatchObject({ status: 409, code: 'file_pending_scan' });

      const state = await http.get(ORG_CHART_SAMPLE_ROUTES.sample, 'director');
      expect(state.status).toBe(200);
      expect(await state.json()).toEqual({ current: null, latest: file });
    });

    it('пока новый на проверке, текущий — прежний; скан прошёл — новый текущий, прежний остаётся строкой истории; не прошёл — текущий прежний, latest — rejected (DATA-07)', async () => {
      const first = await upload('Бірінші.pdf');
      expect(await scanAs(first.fileId)).toBe('passed');
      expect(await samples.state()).toEqual({ current: passed(first), latest: null });

      const second = await upload('Екінші.pdf');
      expect(await samples.state()).toEqual({ current: passed(first), latest: second });
      expect(await download(first.fileId, 'manufacturer')).toMatchObject({ status: 200, body: fixture('sample.pdf') });
      expect(await download(second.fileId, 'manufacturer')).toMatchObject({ status: 403, code: 'forbidden' });

      expect(await scanAs(second.fileId)).toBe('passed');
      expect(await samples.state()).toEqual({ current: passed(second), latest: null });
      expect(await rows()).toEqual([
        { file_object_id: first.fileId, is_current: false },
        { file_object_id: second.fileId, is_current: true },
      ]);

      const third = await upload('Үшінші.pdf');
      expect(await scanAs(third.fileId, { clean: false, signature: 'Eicar-Test-Signature' })).toBe('rejected');
      expect(await samples.state()).toEqual({ current: passed(second), latest: { ...third, scanState: 'rejected' } });
      expect(await rows()).toEqual([
        { file_object_id: first.fileId, is_current: false },
        { file_object_id: second.fileId, is_current: true },
        { file_object_id: third.fileId, is_current: false },
      ]);
      expect(await download(third.fileId, 'administrator')).toMatchObject({ status: 409, code: 'file_rejected' });
    });

    it('два образца: новый прошёл раньше старого — текущим остаётся новый', async () => {
      const older = await upload('Ескі.pdf');
      const newer = await upload('Жаңа.pdf');
      expect(await scanAs(newer.fileId)).toBe('passed');
      expect(await samples.state()).toEqual({ current: passed(newer), latest: null });
      expect(await scanAs(older.fileId)).toBe('passed');
      expect(await samples.state()).toEqual({ current: passed(newer), latest: null });
      expect(await rows()).toEqual([
        { file_object_id: older.fileId, is_current: false },
        { file_object_id: newer.fileId, is_current: true },
      ]);

      // Сканы двух новых образцов одновременно: хуки идут по очереди под блокировкой строк, текущий — более новый.
      const third = await upload('Үшінші.pdf');
      const fourth = await upload('Төртінші.pdf');
      const [v3, v4] = [await versionOf(third.fileId), await versionOf(fourth.fileId)];
      expect(await Promise.all([scan.run({ fileVersionId: v4.id }), scan.run({ fileVersionId: v3.id })])).toEqual([
        'passed',
        'passed',
      ]);
      expect(await samples.state()).toEqual({ current: passed(fourth), latest: null });
      expect((await rows()).filter((r) => r.is_current)).toEqual([{ file_object_id: fourth.fileId, is_current: true }]);
    });

    it('хуки двух сканов: второй ждёт, пока первый (более старый образец) зафиксирует смену, и перечитывает текущий — текущим становится более новый', async () => {
      const base = await upload('Негізгі.pdf');
      expect(await scanAs(base.fileId)).toBe('passed');
      const older = await upload('Ескі.pdf');
      const newer = await upload('Жаңа.pdf');
      const hookOf = async (fileId: string) => ({
        id: (await versionOf(fileId)).id,
        fileObjectId: fileId,
        purpose: 'organisation_chart_sample' as const,
      });
      const [olderVersion, newerVersion] = [await hookOf(older.fileId), await hookOf(newer.fileId)];

      let second: Promise<void> | undefined;
      let secondDone = false;
      await db.transaction(async (tx) => {
        // Первый хук (старый образец) сменил текущий и ещё не зафиксирован.
        await orgChartSamplePassed(tx as unknown as Database, olderVersion);
        second = db.transaction((other) => orgChartSamplePassed(other as unknown as Database, newerVersion));
        second.then(
          () => {
            secondDone = true;
          },
          () => undefined,
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(secondDone).toBe(false);
      });
      await second;
      expect(await rows()).toEqual([
        { file_object_id: base.fileId, is_current: false },
        { file_object_id: older.fileId, is_current: false },
        { file_object_id: newer.fileId, is_current: true },
      ]);
    });

    it('производитель скачивает текущий образец (MAN-19); прежний образец — 403; SME, оператор и наблюдатель — 403 с записью file.read denied; администратор и директор скачивают любой', async () => {
      const previous = await upload('Алдыңғы.pdf');
      expect(await scanAs(previous.fileId)).toBe('passed');
      const current = await upload('Ағымдағы.pdf');
      expect(await scanAs(current.fileId)).toBe('passed');
      const pending = await upload('Тексерілуде.pdf');

      expect(await download(current.fileId, 'manufacturer')).toMatchObject({
        status: 200,
        body: fixture('sample.pdf'),
      });
      expect(await download(previous.fileId, 'manufacturer')).toMatchObject({ status: 403, code: 'forbidden' });
      expect(await download(pending.fileId, 'manufacturer')).toMatchObject({ status: 403, code: 'forbidden' });

      for (const role of ['expert', 'operator', 'observer'] as const)
        expect(await download(current.fileId, role), role).toMatchObject({ status: 403, code: 'forbidden' });
      const denied = await audits('file.read', current.fileId);
      expect(denied).toHaveLength(3);
      for (const entry of denied)
        expect(entry).toMatchObject({
          user_id: SESSION_USER,
          object_type: 'file_object',
          outcome: 'denied',
          diff: null,
        });
      expect(await audits('file.read', previous.fileId)).toHaveLength(1);

      for (const role of ['administrator', 'director'] as const) {
        for (const file of [previous, current])
          expect(await download(file.fileId, role), role).toMatchObject({ status: 200, body: fixture('sample.pdf') });
        expect(await download(pending.fileId, role), role).toMatchObject({ status: 409, code: 'file_pending_scan' });
      }
      // Скачивания — в аудите (AUD-01): производитель — один раз, администратор и директор — по два.
      expect(await audits('file.downloaded', (await versionOf(current.fileId)).id)).toHaveLength(3);
    });

    it('state: без образцов — current null, latest null; после прохождения — latest null', async () => {
      expect(await samples.state()).toEqual({ current: null, latest: null });
      const file = await upload('Құрылым.pdf');
      expect(await samples.state()).toEqual({ current: null, latest: file });
      expect(await scanAs(file.fileId)).toBe('passed');
      expect(await samples.state()).toEqual({ current: passed(file), latest: null });

      // Первый образец не прошёл проверку: текущего нет, последняя загрузка — rejected.
      await pool.query('delete from org_chart_sample; delete from file_version; delete from file_object');
      const infected = await upload('Құрылым.pdf');
      expect(await scanAs(infected.fileId, { clean: false, signature: 'Eicar-Test-Signature' })).toBe('rejected');
      expect(await samples.state()).toEqual({ current: null, latest: { ...infected, scanState: 'rejected' } });
    });

    it('исполнитель перестал быть администратором — 403, объект карантина удалён, строк нет', async () => {
      const demoted = await imbcUser('director');
      const blocked = await imbcUser('administrator', 'blocked');
      const before = await counts();
      const remove = vi.spyOn(storage, 'remove');

      for (const actor of [demoted, blocked]) {
        remove.mockClear();
        expect(await problem(samples.upload(actor, await accepted('Құрылым.pdf'), IP))).toEqual({
          status: 403,
          code: 'forbidden',
        });
        // Байты были в карантине и удалены после отказа.
        expect(remove).toHaveBeenCalledOnce();
        expect(remove.mock.calls[0]![0]).toBe(QUARANTINE);
        expect(storage.keys(QUARANTINE)).toEqual([]);
        expect(await audits('reference.manage', ORG_CHART_SAMPLE_ROUTES.sample)).toContainEqual({
          user_id: actor.id,
          organization_id: imbcId,
          object_type: 'route',
          outcome: 'denied',
          diff: null,
          is_account_event: false,
          ip: IP,
        });
      }
      expect(await counts()).toEqual(before);
      expect(
        (
          await pool.query(
            "select 1 from audit_entries where action = 'org_chart_sample.uploaded' and user_id = any($1)",
            [[demoted.id, blocked.id]],
          )
        ).rowCount,
      ).toBe(0);
    });
  },
);
