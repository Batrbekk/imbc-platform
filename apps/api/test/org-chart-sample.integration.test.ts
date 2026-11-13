import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  FILE_PROBLEM_CODES,
  type FilePurpose,
  type OrgChartSampleFile,
  orgChartSampleCurrentSchema,
  orgChartSampleStateSchema,
  orgChartSampleUploadSchema,
  type Role,
} from '@imbc/contracts';
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
import { orgChartSamplePassed } from '../src/modules/files/org-chart-sample.rules.js';
import { ORG_CHART_SAMPLE_ROUTES, OrgChartSampleService } from '../src/modules/files/org-chart-sample.service.js';
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
// Сеанс производителя — отдельный стенд с организацией-производителем (не IMBC); остальные роли — организация IMBC.
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
    /** Стенд сеанса производителя другой организации (не IMBC). */
    let manufacturerHttp: HttpStand;
    let imbcId: string;
    let manufacturerOrg: string;
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
    /** Производитель — со своего стенда (организация-производитель), остальные роли — организация IMBC. */
    const standFor = (role: Role) => (role === 'manufacturer' ? manufacturerHttp : http);
    /**
     * Запрос роли: статус, тело, заголовки и код problem+json. Каждый код отказа — из FILE_PROBLEM_CODES: по этому
     * списку экран переводит ошибки маршрутов образца и файлов.
     */
    const call = async (path: string, role: Role, method: 'GET' | 'HEAD' = 'GET') => {
      const stand = standFor(role);
      const res = await fetch(`${stand.base}${path}`, { method, headers: { cookie: `imbc-session=${role}` } });
      const body = Buffer.from(await res.arrayBuffer());
      const code = res.status >= 400 && body.length ? (JSON.parse(body.toString()) as { code: string }).code : null;
      if (code !== null) expect(FILE_PROBLEM_CODES).toContain(code);
      return { status: res.status, body, code, headers: res.headers };
    };
    /** Скачивание файла по id: статус, байты и код отказа. */
    const download = async (fileId: string, role: Role) => {
      const { status, body, code } = await call(content(fileId), role);
      return { status, body, code };
    };
    /** Описание текущего образца (`GET …/current`). */
    const currentOf = async (role: Role) => {
      const res = await call(ORG_CHART_SAMPLE_ROUTES.current, role);
      return { status: res.status, code: res.code, json: res.status === 200 ? JSON.parse(res.body.toString()) : null };
    };
    /** Записи `file.read` `denied` о файле `objectId` (null — запись без объекта). */
    const readDenials = async (objectId: string | null) =>
      (
        await pool.query(
          `select user_id, organization_id, object_type, object_id, outcome, diff, host(ip) as ip from audit_entries
            where action = 'file.read' and outcome = 'denied' and object_id is not distinct from $1 order by at, id`,
          [objectId],
        )
      ).rows;

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
      const bin = String(Math.floor(Math.random() * 1e12)).padStart(12, '0');
      manufacturerOrg = (
        await pool.query<{ id: string }>(
          "insert into organizations (type, name, bin) values ('manufacturer', $1, $2) returning id",
          [`ТОО ${bin}`, bin],
        )
      ).rows[0]!.id;
      manufacturerHttp = await startHttp({
        controllers: [FilesController, OrgChartSampleController],
        providers: [
          { provide: FilesService, useValue: files },
          { provide: OrgChartSampleService, useValue: samples },
        ],
        organizationId: manufacturerOrg,
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
      await manufacturerHttp?.close();
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

    it('смена текущего образца — аудит org_chart_sample.current_changed { from, to } без исполнителя в транзакции хука; без смены текущего записи нет (AUD-01)', async () => {
      const sampleId = async (fileId: string) =>
        (await pool.query<{ id: string }>('select id from org_chart_sample where file_object_id = $1', [fileId]))
          .rows[0]!.id;
      const changes = async (fileIds: string[]) =>
        (
          await pool.query(
            `select user_id, organization_id, object_type, object_id, outcome, diff, is_account_event, ip
               from audit_entries
              where action = 'org_chart_sample.current_changed' and diff->>'to' = any($1::text[])
              order by at, id`,
            [fileIds],
          )
        ).rows;
      const change = async (from: string | null, to: string) => ({
        user_id: null,
        organization_id: null,
        object_type: 'org_chart_sample',
        object_id: await sampleId(to),
        outcome: 'ok',
        diff: { from, to },
        is_account_event: false,
        ip: null,
      });

      const first = await upload('Бірінші.pdf');
      expect(await scanAs(first.fileId)).toBe('passed');
      const second = await upload('Екінші.pdf');
      expect(await scanAs(second.fileId)).toBe('passed');
      // Более новый прошёл раньше более старого: старый текущим не становится — записи о нём нет.
      const older = await upload('Ескі.pdf');
      const newer = await upload('Жаңа.pdf');
      expect(await scanAs(newer.fileId)).toBe('passed');
      expect(await scanAs(older.fileId)).toBe('passed');
      // Отклонённый текущим не становится.
      const rejected = await upload('Вирус.pdf');
      expect(await scanAs(rejected.fileId, { clean: false, signature: 'Eicar-Test-Signature' })).toBe('rejected');
      // Повтор хука для уже текущего образца ничего не меняет и не пишет.
      await db.transaction((tx) =>
        orgChartSamplePassed(tx as unknown as Database, {
          id: randomUUID(),
          fileObjectId: newer.fileId,
          purpose: 'organisation_chart_sample',
        }),
      );

      const ids = [first, second, older, newer, rejected].map((f) => f.fileId);
      expect(await changes(ids)).toEqual([
        await change(null, first.fileId),
        await change(first.fileId, second.fileId),
        await change(second.fileId, newer.fileId),
      ]);
      // Имени файла и ключа объекта в записи нет.
      const text = JSON.stringify(await changes(ids));
      for (const part of ['Бірінші', 'Екінші', 'Жаңа', (await versionOf(newer.fileId)).storage_key])
        expect(text).not.toContain(part);
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

    it.each([
      ['более старый', 'older'],
      ['более новый', 'newer'],
    ] as const)(
      'текущего ещё нет: хук A (%s образец) в незафиксированной транзакции, хук B ждёт; итог — один текущий, более новый',
      async (_label, firstHook) => {
        const older = await upload('Ескі.pdf');
        const newer = await upload('Жаңа.pdf');
        const hookOf = async (fileId: string) => ({
          id: (await versionOf(fileId)).id,
          fileObjectId: fileId,
          purpose: 'organisation_chart_sample' as const,
        });
        const versions = { older: await hookOf(older.fileId), newer: await hookOf(newer.fileId) };
        const [a, b] = firstHook === 'older' ? [versions.older, versions.newer] : [versions.newer, versions.older];

        let second: Promise<void> | undefined;
        let secondDone = false;
        await db.transaction(async (tx) => {
          // Хук A поставил свой образец текущим и ещё не зафиксирован; хук B стартует и ждёт блокировку строк.
          await orgChartSamplePassed(tx as unknown as Database, a);
          second = db.transaction((other) => orgChartSamplePassed(other as unknown as Database, b));
          second.then(
            () => {
              secondDone = true;
            },
            () => undefined,
          );
          await new Promise((resolve) => setTimeout(resolve, 300));
          expect(secondDone).toBe(false);
        });
        // Без блокировки строк B не увидел бы незафиксированный текущий A и упал бы на уникальном индексе текущего.
        await second;
        expect(await rows()).toEqual([
          { file_object_id: older.fileId, is_current: false },
          { file_object_id: newer.fileId, is_current: true },
        ]);
      },
    );

    it('производитель другой организации скачивает текущий образец (MAN-19); прежний, на проверке и отклонённый — 403 с записью file.read denied; SME, оператор и наблюдатель — 403 с записью; администратор и директор скачивают любой', async () => {
      const previous = await upload('Алдыңғы.pdf');
      expect(await scanAs(previous.fileId)).toBe('passed');
      const rejected = await upload('Жұқпалы.pdf');
      expect(await scanAs(rejected.fileId, { clean: false, signature: 'Eicar-Test-Signature' })).toBe('rejected');
      const current = await upload('Ағымдағы.pdf');
      expect(await scanAs(current.fileId)).toBe('passed');
      const pending = await upload('Тексерілуде.pdf');

      expect(await download(current.fileId, 'manufacturer')).toMatchObject({
        status: 200,
        body: fixture('sample.pdf'),
      });
      const manufacturerDenial = (fileId: string) => ({
        user_id: SESSION_USER,
        organization_id: manufacturerOrg,
        object_type: 'file_object',
        object_id: fileId,
        outcome: 'denied',
        diff: null,
        ip: expect.stringMatching(/127\.0\.0\.1/),
      });
      // Отказ — правило образца, а не состояние скана: на проверке и отклонённый образец производителю закрыт так же,
      // как прежний, и каждый отказ записан с id файла и организацией производителя.
      for (const file of [previous, pending, rejected]) {
        expect(await download(file.fileId, 'manufacturer')).toMatchObject({ status: 403, code: 'forbidden' });
        expect(await readDenials(file.fileId)).toEqual([manufacturerDenial(file.fileId)]);
      }

      for (const role of ['expert', 'operator', 'observer'] as const)
        expect(await download(current.fileId, role), role).toMatchObject({ status: 403, code: 'forbidden' });
      expect(await readDenials(current.fileId)).toEqual(
        Array.from({ length: 3 }, () => ({
          user_id: SESSION_USER,
          organization_id: imbcId,
          object_type: 'file_object',
          object_id: current.fileId,
          outcome: 'denied',
          diff: null,
          ip: expect.stringMatching(/127\.0\.0\.1/),
        })),
      );

      for (const role of ['administrator', 'director'] as const) {
        for (const file of [previous, current])
          expect(await download(file.fileId, role), role).toMatchObject({ status: 200, body: fixture('sample.pdf') });
        expect(await download(pending.fileId, role), role).toMatchObject({ status: 409, code: 'file_pending_scan' });
        expect(await download(rejected.fileId, role), role).toMatchObject({ status: 409, code: 'file_rejected' });
      }
      // Скачивания — в аудите (AUD-01): производитель — один раз, администратор и директор — по два.
      const downloads = await audits('file.downloaded', (await versionOf(current.fileId)).id);
      expect(downloads.map((d) => d.organization_id)).toEqual([manufacturerOrg, imbcId, imbcId]);
    });

    it('текущий образец для производителя другой организации: описание без id и истории, стабильная ссылка отдаёт текущий; после замены — новый; HEAD без «скачано» (MAN-19, NFR-09)', async () => {
      const contentOf = (role: Role, method: 'GET' | 'HEAD' = 'GET') =>
        call(ORG_CHART_SAMPLE_ROUTES.currentContent, role, method);

      // Образцов нет; только загрузка на проверке; только отклонённая — текущего нет ни для кого.
      const noCurrent = async () => {
        for (const role of ['manufacturer', 'administrator', 'director'] as const) {
          expect(await currentOf(role), role).toEqual({ status: 200, code: null, json: { current: null } });
          expect(await contentOf(role), role).toMatchObject({ status: 404, code: 'not_found' });
        }
      };
      await noCurrent();
      await upload('Тексерілуде.pdf');
      await noCurrent();
      await pool.query('delete from org_chart_sample; delete from file_version; delete from file_object');
      const infected = await upload('Жұқпалы.pdf');
      expect(await scanAs(infected.fileId, { clean: false, signature: 'Eicar-Test-Signature' })).toBe('rejected');
      await noCurrent();

      const first = await upload('Құрылым үлгісі.pdf');
      expect(await scanAs(first.fileId)).toBe('passed');
      const described = await currentOf('manufacturer');
      expect(described.status).toBe(200);
      expect(described.json).toEqual({
        current: {
          originalName: 'Құрылым үлгісі.pdf',
          byteSize: fixture('sample.pdf').length,
          mediaType: 'application/pdf',
          uploadedAt: first.uploadedAt,
        },
      });
      // Только поля схемы: ни id файла, ни состояния скана, ни истории, ни загрузившего.
      expect(orgChartSampleCurrentSchema.parse(described.json)).toEqual(described.json);
      expect(Object.keys(described.json.current).sort()).toEqual([
        'byteSize',
        'mediaType',
        'originalName',
        'uploadedAt',
      ]);
      const text = JSON.stringify(described.json);
      for (const part of [first.fileId, infected.fileId, 'passed', 'scanState', SESSION_USER])
        expect(text).not.toContain(part);
      for (const role of ['administrator', 'director'] as const)
        expect((await currentOf(role)).json, role).toEqual(described.json);

      const versionId = (await versionOf(first.fileId)).id;
      const got = await contentOf('manufacturer');
      expect(got.status).toBe(200);
      expect(got.body).toEqual(fixture('sample.pdf'));
      expect(got.headers.get('content-type')).toBe('application/pdf');
      expect(got.headers.get('content-length')).toBe(String(fixture('sample.pdf').length));
      expect(got.headers.get('x-content-type-options')).toBe('nosniff');
      expect(got.headers.get('cache-control')).toBe('no-store');
      const disposition = got.headers.get('content-disposition')!;
      expect(disposition).toMatch(/^attachment; /);
      expect(decodeURIComponent(disposition.split("UTF-8''")[1]!)).toBe('Құрылым үлгісі.pdf');
      expect(await audits('file.downloaded', versionId)).toEqual([
        {
          user_id: SESSION_USER,
          organization_id: manufacturerOrg,
          object_type: 'file_version',
          outcome: 'ok',
          diff: { versionNumber: 1 },
          is_account_event: false,
          ip: expect.stringMatching(/127\.0\.0\.1/),
        },
      ]);

      // HEAD: те же заголовки, тела нет, объект не читается, «скачано» не пишется.
      const read = vi.spyOn(storage, 'get');
      const head = await contentOf('manufacturer', 'HEAD');
      expect(head.status).toBe(200);
      expect(head.body.length).toBe(0);
      for (const header of ['content-type', 'content-length', 'content-disposition', 'cache-control'])
        expect(head.headers.get(header), header).toBe(got.headers.get(header));
      expect(read).not.toHaveBeenCalled();
      expect(await audits('file.downloaded', versionId)).toHaveLength(1);
      read.mockRestore();

      // Новый образец на проверке — ссылка отдаёт прежний; прошёл — новый (PNG: другие байты и тип).
      const second = (await samples.upload(admin, await accepted('Жаңа үлгі.png', fixture('sample.png')), IP)).upload;
      expect((await contentOf('manufacturer')).body).toEqual(fixture('sample.pdf'));
      expect((await currentOf('manufacturer')).json.current.originalName).toBe('Құрылым үлгісі.pdf');
      expect(await scanAs(second.fileId)).toBe('passed');
      const replaced = await contentOf('manufacturer');
      expect(replaced.status).toBe(200);
      expect(replaced.body).toEqual(fixture('sample.png'));
      expect(replaced.headers.get('content-type')).toBe('image/png');
      expect((await currentOf('manufacturer')).json).toEqual({
        current: {
          originalName: 'Жаңа үлгі.png',
          byteSize: fixture('sample.png').length,
          mediaType: 'image/png',
          uploadedAt: second.uploadedAt,
        },
      });
    });

    it('текущий образец: SME, оператор и наблюдатель — 403 на описание и на ссылку (GET и HEAD) с записью file.read denied по маршруту, без id файла', async () => {
      const file = await upload('Құрылым.pdf');
      expect(await scanAs(file.fileId)).toBe('passed');
      const routeDenials = async () =>
        (
          await pool.query(
            `select user_id, organization_id, object_type, object_id, outcome, diff, host(ip) as ip from audit_entries
              where action = 'file.read' and outcome = 'denied' and object_type = 'route' order by at, id`,
          )
        ).rows;
      const before = (await routeDenials()).length;
      const versionId = (await versionOf(file.fileId)).id;

      for (const role of ['expert', 'operator', 'observer'] as const) {
        expect(await currentOf(role), role).toEqual({ status: 403, code: 'forbidden', json: null });
        expect(await call(ORG_CHART_SAMPLE_ROUTES.currentContent, role), role).toMatchObject({
          status: 403,
          code: 'forbidden',
        });
        expect((await call(ORG_CHART_SAMPLE_ROUTES.currentContent, role, 'HEAD')).status, role).toBe(403);
      }
      const denials = (await routeDenials()).slice(before);
      // По записи видно, какой маршрут отказал: описание текущего или его байты (GET и HEAD).
      const routes = [
        ORG_CHART_SAMPLE_ROUTES.current,
        ORG_CHART_SAMPLE_ROUTES.currentContent,
        ORG_CHART_SAMPLE_ROUTES.currentContent,
      ];
      expect(denials).toEqual(
        [...routes, ...routes, ...routes].map((route) => ({
          user_id: SESSION_USER,
          organization_id: imbcId,
          object_type: 'route',
          object_id: route,
          outcome: 'denied',
          diff: null,
          ip: expect.stringMatching(/127\.0\.0\.1/),
        })),
      );
      // Отказ — до поиска образца: записи с id файла нет, записи без объекта нет, «скачано» нет.
      expect(await readDenials(file.fileId)).toEqual([]);
      expect(await readDenials(null)).toEqual([]);
      expect(await audits('file.downloaded', versionId)).toEqual([]);
    });

    it('state и текущий образец: строка is_current с версией не passed текущей не считается (страховка от умолчания колонки)', async () => {
      const file = await upload('Құрылым.pdf');
      // Строка помечена текущей в обход хука, версия ещё на проверке.
      await pool.query('update org_chart_sample set is_current = true where file_object_id = $1', [file.fileId]);
      const state = await samples.state();
      expect(orgChartSampleStateSchema.parse(state)).toEqual({ current: null, latest: file });
      expect(await currentOf('manufacturer')).toEqual({ status: 200, code: null, json: { current: null } });
      expect(await call(ORG_CHART_SAMPLE_ROUTES.currentContent, 'manufacturer')).toMatchObject({
        status: 404,
        code: 'not_found',
      });
      // Скачивание по id остаётся закрытым проверкой скана (DATA-07).
      expect(await download(file.fileId, 'manufacturer')).toMatchObject({ status: 409, code: 'file_pending_scan' });
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
