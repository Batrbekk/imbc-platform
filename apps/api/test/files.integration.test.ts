import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import {
  type DataClass,
  FILE_PURPOSES,
  type FilePurpose,
  MANUFACTURER_FILE_PURPOSES,
  ROLES,
  type Role,
} from '@imbc/contracts';
import { Controller, HttpCode, Logger, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Env } from '../src/config/env.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { lockWaitExceeded } from '../src/database/lock-waits.js';
import { withQueueTransaction } from '../src/database/transaction.js';
import { FILE_SCAN_QUEUE_OPTIONS, QUEUES } from '../src/jobs/queues.js';
import type { AuthContext } from '../src/modules/auth/auth.types.js';
import { Auth } from '../src/modules/auth/guards.js';
import { denyAll, FILE_READ_RULES, manufacturerFileRule } from '../src/modules/files/file-access.js';
import { FilesController } from '../src/modules/files/files.controller.js';
import { orgChartSampleReadRule } from '../src/modules/files/org-chart-sample.rules.js';
import type { Antivirus } from '../src/modules/files/antivirus.js';
import { FILE_ROUTES, FilesService } from '../src/modules/files/files.service.js';
import { type AcceptedUpload, acceptUpload, uploadInterceptor } from '../src/modules/files/upload.js';
import {
  CHECKSUM_MISMATCH_SIGNATURE,
  FileScanJob,
  OBJECT_MISSING_SIGNATURE,
  SCAN_STALE_MS,
  type ScanPassedHook,
} from '../src/worker/file-scan.job.js';
import { StubAntivirus } from './support/antivirus-stub.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { type HttpStand, startHttp } from './support/http.js';
import { MemoryObjectStorage } from './support/memory-storage.js';

// Файлы на PostgreSQL 18 и pg-boss `pgboss_auth_test`: хранилище — MemoryObjectStorage, антивирус — StubAntivirus,
// без сети. Путь файла: загрузка → карантин → скан → рабочий бакет → скачивание через API с проверкой прав
// записи-владельца и аудитом (GEN-09, DATA-05, DATA-06, DATA-07, NFR-09, ADM-06).
const databaseUrl = process.env.TEST_DATABASE_URL;
const QUARANTINE = 'test-quarantine';
const FILES = 'test-files';
const env = { S3_BUCKET_QUARANTINE: QUARANTINE, S3_BUCKET_FILES: FILES } as Env;
/** Пользователь сеанса стенда startHttp (один на все роли). */
const SESSION_USER = '00000000-0000-4000-8000-0000000000a2';
/** id строк — UUID v7 БД; ключ объекта — случайный UUID v4 (`randomUUID`), без имени файла. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RANDOM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KAZAKH_NAME = 'Құрылым "IMBC"; v1.pdf';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/files/${name}`, import.meta.url));
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/** Всё, что передано в методы Logger, текстом: ошибки — с сообщением, стеком и полями. */
const logged = (spies: { mock: { calls: unknown[][] } }[]) =>
  spies.flatMap((spy) => spy.mock.calls.map((call) => inspect(call, { depth: 10 }))).join('\n');

let pool: pg.Pool;
let db: Database;
let boss: PgBoss;
let storage: MemoryObjectStorage;
let antivirus: StubAntivirus;
let service: FilesService;
let ownerOrg: string;

/** Загрузка целиком, как её строят маршруты загрузки: multer → проверка → карантин → строки и задание. */
@Controller('test')
class UploadFlowController {
  @Post('files')
  @HttpCode(201)
  @UseInterceptors(uploadInterceptor())
  async create(@Auth() auth: AuthContext, @UploadedFile() file: Express.Multer.File | undefined) {
    const upload = await acceptUpload(file);
    return service.withStagedObject(upload, (storageKey) =>
      withQueueTransaction(pool, (tx, queueDb) =>
        service.recordNew(tx, queueDb, {
          organizationId: auth.user.organizationId,
          purpose: 'organisation_chart',
          dataClass: 'b_manufacturer',
          uploadedBy: auth.user.id,
          upload,
          storageKey,
        }),
      ),
    );
  }
}

describe.skipIf(!databaseUrl)('файлы: карантин, скан, скачивание с проверкой прав (GEN-09, DATA-05, DATA-07)', () => {
  vi.setConfig({ testTimeout: 30000 });
  let scan: FileScanJob;
  let http: HttpStand;
  let otherOrg: string;

  const accepted = (name: string, bytes: Buffer = fixture('sample.pdf'), declared = 'application/pdf') =>
    acceptUpload({
      fieldname: 'file',
      originalname: name,
      encoding: '7bit',
      mimetype: declared,
      size: bytes.length,
      buffer: bytes,
    } as Express.Multer.File);

  const createFile = async (
    opts: {
      name?: string;
      bytes?: Buffer;
      organizationId?: string | null;
      purpose?: FilePurpose;
      dataClass?: DataClass;
    } = {},
  ) => {
    const upload = await accepted(opts.name ?? 'Схема.pdf', opts.bytes);
    return service.withStagedObject(upload, (storageKey) =>
      withQueueTransaction(pool, (tx, queueDb) =>
        service.recordNew(tx, queueDb, {
          organizationId: opts.organizationId === undefined ? ownerOrg : opts.organizationId,
          purpose: opts.purpose ?? 'organisation_chart',
          dataClass: opts.dataClass ?? 'b_manufacturer',
          uploadedBy: SESSION_USER,
          upload,
          storageKey,
        }),
      ),
    );
  };

  const addVersion = (fileObjectId: string, upload: AcceptedUpload) =>
    service.withStagedObject(upload, (storageKey) =>
      withQueueTransaction(pool, (tx, queueDb) =>
        service.recordVersion(tx, queueDb, fileObjectId, { uploadedBy: SESSION_USER, upload, storageKey }),
      ),
    );

  const scanAs = async (versionId: string, verdict: StubAntivirus['verdict']) => {
    antivirus.verdict = verdict;
    return scan.run({ fileVersionId: versionId });
  };

  const version = async (id: string) =>
    (
      await pool.query<{
        file_object_id: string;
        version_number: number;
        original_name: string;
        byte_size: string;
        declared_media_type: string;
        detected_media_type: string | null;
        checksum: string;
        scan_state: string;
        scanned_at: Date | null;
        uploaded_at: Date;
        uploaded_by: string | null;
        storage_key: string;
      }>('select * from file_version where id = $1', [id])
    ).rows[0]!;

  const counts = async () =>
    (
      await pool.query<{ objects: number; versions: number; jobs: number }>(
        `select (select count(*)::int from file_object) as objects, (select count(*)::int from file_version) as versions,
                (select count(*)::int from pgboss_auth_test.job where name = $1) as jobs`,
        [QUEUES.fileScan],
      )
    ).rows[0]!;

  const jobs = async (versionId: string) =>
    (
      await pool.query<{ data: unknown; singleton_key: string | null; state: string }>(
        `select data, singleton_key, state from pgboss_auth_test.job where name = $1 and data->>'fileVersionId' = $2`,
        [QUEUES.fileScan, versionId],
      )
    ).rows;

  const audits = async (action: string, objectId: string) =>
    (
      await pool.query<{
        user_id: string | null;
        organization_id: string | null;
        object_type: string;
        outcome: string;
        diff: unknown;
        ip: string | null;
      }>(
        `select user_id, organization_id, object_type, outcome, diff, host(ip) as ip from audit_entries
          where action = $1 and object_id = $2 order by at, id`,
        [action, objectId],
      )
    ).rows;

  const content = (fileObjectId: string, query = '') => `/api/v1/files/${fileObjectId}/content${query}`;

  const manufacturerOrg = async () => {
    const bin = String(Math.floor(Math.random() * 1e12)).padStart(12, '0');
    return (
      await pool.query<{ id: string }>(
        "insert into organizations (type, name, bin) values ('manufacturer', $1, $2) returning id",
        [`ТОО ${bin}`, bin],
      )
    ).rows[0]!.id;
  };

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema, casing: 'snake_case' });
    boss = new PgBoss({ connectionString: databaseUrl, schema: 'pgboss_auth_test', supervise: false, schedule: false });
    await boss.start();
    await boss.createQueue(QUEUES.fileScan, FILE_SCAN_QUEUE_OPTIONS);
    ownerOrg = await manufacturerOrg();
    otherOrg = await manufacturerOrg();
    await pool.query(
      "insert into user_accounts (id, organization_id, email, role, state) values ($1, $2, 'owner@factory.local', 'manufacturer', 'active')",
      [SESSION_USER, ownerOrg],
    );
    storage = new MemoryObjectStorage();
    antivirus = new StubAntivirus();
    service = new FilesService(db, boss, storage, env, new AuditService(db));
    scan = new FileScanJob(db, storage, antivirus, env, new AuditService(db), boss, {});
    http = await startHttp({
      controllers: [FilesController, UploadFlowController],
      providers: [{ provide: FilesService, useValue: service }],
      organizationId: ownerOrg,
    });
  }, 120000);

  beforeEach(() => {
    storage.objects.clear();
    antivirus.verdict = { clean: true };
    antivirus.calls = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await http?.close();
    await boss?.stop({ graceful: false });
    await pool?.end();
  });

  it('recordNew: объект в карантине под UUID без имени; file_object и версия 1 pending с исходным именем, размером, типом по содержимому, sha256 и временем загрузки; задание file-scan в той же транзакции (DATA-05)', async () => {
    const bytes = fixture('sample.pdf');
    const started = Date.now();
    const result = await createFile({ name: KAZAKH_NAME, bytes });
    expect(result).toEqual({
      fileObjectId: expect.stringMatching(UUID),
      versionId: expect.stringMatching(UUID),
      versionNumber: 1,
    });

    const keys = storage.keys(QUARANTINE);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(RANDOM_UUID);
    expect(storage.objects.get(`${QUARANTINE}/${keys[0]}`)).toEqual(bytes);
    expect(storage.keys(FILES)).toEqual([]);

    const object = await pool.query('select organization_id, purpose, data_class from file_object where id = $1', [
      result.fileObjectId,
    ]);
    expect(object.rows).toEqual([
      { organization_id: ownerOrg, purpose: 'organisation_chart', data_class: 'b_manufacturer' },
    ]);
    const row = await version(result.versionId);
    expect(row).toMatchObject({
      file_object_id: result.fileObjectId,
      version_number: 1,
      original_name: KAZAKH_NAME,
      byte_size: String(bytes.length),
      declared_media_type: 'application/pdf',
      detected_media_type: 'application/pdf',
      checksum: sha256(bytes),
      scan_state: 'pending',
      scanned_at: null,
      uploaded_by: SESSION_USER,
      storage_key: keys[0],
    });
    expect(row.uploaded_at.getTime()).toBeGreaterThanOrEqual(started - 5000);
    expect(row.uploaded_at.getTime()).toBeLessThanOrEqual(Date.now() + 5000);

    // Задание несёт только id версии: ни имени, ни ключа объекта (NFR-11).
    expect(await jobs(result.versionId)).toEqual([
      { data: { fileVersionId: result.versionId }, singleton_key: result.versionId, state: 'created' },
    ]);
  });

  it('сбой транзакции после put — объект карантина удалён, строк нет', async () => {
    const before = await counts();
    const upload = await accepted('Схема.pdf');
    await expect(
      service.withStagedObject(upload, (storageKey) =>
        withQueueTransaction(pool, async (tx, queueDb) => {
          await service.recordNew(tx, queueDb, {
            organizationId: ownerOrg,
            purpose: 'cv',
            dataClass: 'b_manufacturer',
            uploadedBy: SESSION_USER,
            upload,
            storageKey,
          });
          throw new Error('сбой после записи');
        }),
      ),
    ).rejects.toThrow('сбой после записи');
    expect(storage.objects.size).toBe(0);
    expect(await counts()).toEqual(before);

    // Удаление не удалось — исходная ошибка наружу, в журнале предупреждение без ключа и имени.
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const error = vi.spyOn(Logger.prototype, 'error');
    const secret = await accepted('Секретное имя.pdf');
    let stagedKey = '';
    storage.failNext('remove');
    await expect(
      service.withStagedObject(secret, async (storageKey) => {
        stagedKey = storageKey;
        throw new Error('сбой действия');
      }),
    ).rejects.toThrow('сбой действия');
    expect(storage.keys(QUARANTINE)).toEqual([stagedKey]);
    expect(warn).toHaveBeenCalled();
    const text = logged([warn, error]);
    expect(text).not.toContain(stagedKey);
    expect(text).not.toContain('Секретное');

    // Хранилище не приняло объект — 503 storage_unavailable, действие не выполняется.
    storage.objects.clear();
    storage.failNext('put');
    const run = vi.fn();
    await expect(service.withStagedObject(secret, run)).rejects.toMatchObject({
      code: 'storage_unavailable',
      status: 503,
    });
    expect(run).not.toHaveBeenCalled();
    expect(storage.objects.size).toBe(0);
    expect(await counts()).toEqual(before);
  });

  it('recordVersion: версия 2; версия 1 остаётся и скачивается по ?version=1 (MAN-36)', async () => {
    const first = await createFile({ name: 'Схема v1.pdf', bytes: fixture('sample.pdf') });
    expect(await scanAs(first.versionId, { clean: true })).toBe('passed');

    const second = await addVersion(
      first.fileObjectId,
      await accepted('Схема v2.png', fixture('sample.png'), 'image/png'),
    );
    expect(second).toEqual({
      fileObjectId: first.fileObjectId,
      versionId: expect.stringMatching(UUID),
      versionNumber: 2,
    });
    expect(await version(second.versionId)).toMatchObject({ version_number: 2, scan_state: 'pending' });
    expect(await jobs(second.versionId)).toHaveLength(1);
    expect(await version(first.versionId)).toMatchObject({ version_number: 1, scan_state: 'passed' });

    const v1 = await http.get(content(first.fileObjectId, '?version=1'), 'manufacturer');
    expect(v1.status).toBe(200);
    expect(v1.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await v1.arrayBuffer())).toEqual(fixture('sample.pdf'));

    // Последняя версия — по умолчанию; до скана её не открыть.
    const latestPending = await http.get(content(first.fileObjectId), 'manufacturer');
    expect(latestPending.status).toBe(409);
    expect(await latestPending.json()).toMatchObject({ code: 'file_pending_scan' });
    expect(await scanAs(second.versionId, { clean: true })).toBe('passed');
    const latest = await http.get(content(first.fileObjectId), 'manufacturer');
    expect(latest.status).toBe(200);
    expect(latest.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await latest.arrayBuffer())).toEqual(fixture('sample.png'));

    const third = await addVersion(first.fileObjectId, await accepted('Схема v3.pdf'));
    expect(third.versionNumber).toBe(3);

    const missing = await http.get(content(first.fileObjectId, '?version=4'), 'manufacturer');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'not_found' });
    for (const query of [
      '?version=0',
      '?version=-1',
      '?version=1.5',
      '?version=abc',
      '?version=',
      '?version=1&version=2',
    ])
      expect((await http.get(content(first.fileObjectId, query), 'manufacturer')).status, query).toBe(400);

    // Новая версия неизвестного файла — 404, объект карантина удалён.
    storage.objects.clear();
    await expect(addVersion(randomUUID(), await accepted('Схема.pdf'))).rejects.toMatchObject({ code: 'not_found' });
    expect(storage.objects.size).toBe(0);
  });

  it('файл до прохождения скана не открывается никому: pending — 409 file_pending_scan, rejected — 409 file_rejected для производителя-владельца, SME и директора; passed — скачивается (DATA-07)', async () => {
    const readers: Role[] = ['manufacturer', 'expert', 'director'];
    const pending = await createFile();
    const rejected = await createFile();
    expect(await scanAs(rejected.versionId, { clean: false, signature: 'Eicar-Test-Signature' })).toBe('rejected');
    const passed = await createFile();
    expect(await scanAs(passed.versionId, { clean: true })).toBe('passed');

    for (const role of readers) {
      for (const query of ['', '?version=1']) {
        const p = await http.get(content(pending.fileObjectId, query), role);
        expect(p.status, `${role} pending${query}`).toBe(409);
        expect(await p.json()).toMatchObject({ status: 409, code: 'file_pending_scan' });
        const r = await http.get(content(rejected.fileObjectId, query), role);
        expect(r.status, `${role} rejected${query}`).toBe(409);
        expect(await r.json()).toMatchObject({ status: 409, code: 'file_rejected' });
      }
      const ok = await http.get(content(passed.fileObjectId), role);
      expect(ok.status, role).toBe(200);
      expect(Buffer.from(await ok.arrayBuffer())).toEqual(fixture('sample.pdf'));
    }
    // Отказ до скана не считается скачиванием.
    expect(await audits('file.downloaded', pending.versionId)).toEqual([]);
    expect(await audits('file.downloaded', rejected.versionId)).toEqual([]);
    expect(await audits('file.downloaded', passed.versionId)).toHaveLength(readers.length);
  });

  it('скан: passed — копия в рабочем бакете, карантин пуст, scanned_at; FOUND — rejected, аудит file.scan_rejected с сигнатурой, объект удалён; ошибка clamd — состояние pending, исключение; повтор после passed — skipped, StubAntivirus не вызван', async () => {
    const bytes = fixture('sample.docx');
    const clean = await createFile({ name: 'Устав.docx', bytes });
    const key = (await version(clean.versionId)).storage_key;
    expect(await scanAs(clean.versionId, { clean: true })).toBe('passed');
    expect(antivirus.calls).toBe(1);
    expect(antivirus.scanned).toEqual(bytes);
    expect(storage.keys(FILES)).toEqual([key]);
    expect(storage.objects.get(`${FILES}/${key}`)).toEqual(bytes);
    expect(storage.keys(QUARANTINE)).toEqual([]);
    const passedRow = await version(clean.versionId);
    expect(passedRow.scan_state).toBe('passed');
    expect(passedRow.scanned_at).toBeInstanceOf(Date);

    // Повтор задания (pg-boss, зачистка) ничего не меняет и антивирус не зовёт.
    expect(await scan.run({ fileVersionId: clean.versionId })).toBe('skipped');
    expect(antivirus.calls).toBe(1);
    expect(await version(clean.versionId)).toEqual(passedRow);
    expect(await scan.run({ fileVersionId: randomUUID() })).toBe('skipped');
    expect(await scan.run({ fileVersionId: 'not-a-uuid' })).toBe('skipped');

    const infected = await createFile({ name: 'Вирус.pdf' });
    const infectedKey = (await version(infected.versionId)).storage_key;
    // Копия в рабочем бакете от прежней попытки (чистый скан, сбой транзакции) тоже удаляется.
    storage.objects.set(`${FILES}/${infectedKey}`, Buffer.from('stale copy'));
    expect(await scanAs(infected.versionId, { clean: false, signature: 'Win.Test.EICAR_HDB-1' })).toBe('rejected');
    const rejectedRow = await version(infected.versionId);
    expect(rejectedRow.scan_state).toBe('rejected');
    expect(rejectedRow.scanned_at).toBeInstanceOf(Date);
    expect(storage.keys(QUARANTINE)).not.toContain(infectedKey);
    expect(storage.keys(FILES)).not.toContain(infectedKey);
    expect(await audits('file.scan_rejected', infected.versionId)).toEqual([
      {
        user_id: SESSION_USER,
        organization_id: ownerOrg,
        object_type: 'file_version',
        outcome: 'denied',
        diff: { signature: 'Win.Test.EICAR_HDB-1' },
        ip: null,
      },
    ]);
    expect(await scan.run({ fileVersionId: infected.versionId })).toBe('skipped');

    // clamd недоступен или ответил не OK/FOUND — ошибка задания (повтор pg-boss), версия остаётся pending.
    const unsure = await createFile();
    const unsureKey = (await version(unsure.versionId)).storage_key;
    await expect(
      scanAs(unsure.versionId, new Error('clamd: неожиданный ответ «INSTREAM size limit exceeded. ERROR»')),
    ).rejects.toThrow('clamd');
    expect(await version(unsure.versionId)).toMatchObject({ scan_state: 'pending', scanned_at: null });
    expect(storage.keys(QUARANTINE)).toContain(unsureKey);
    expect(storage.keys(FILES)).not.toContain(unsureKey);

    // Хранилище: чтение карантина или копия в рабочий бакет не удались — тоже pending и исключение.
    storage.failNext('get');
    await expect(scanAs(unsure.versionId, { clean: true })).rejects.toThrow();
    storage.failNext('copy');
    await expect(scanAs(unsure.versionId, { clean: true })).rejects.toThrow();
    expect(await version(unsure.versionId)).toMatchObject({ scan_state: 'pending', scanned_at: null });
    expect(storage.keys(FILES)).not.toContain(unsureKey);
    expect(await scanAs(unsure.versionId, { clean: true })).toBe('passed');
    expect(storage.keys(QUARANTINE)).not.toContain(unsureKey);
  });

  it('скан: хук назначения выполняется в транзакции перехода в passed; сбой хука — версия pending и исключение', async () => {
    const hook = vi.fn<ScanPassedHook>(async (tx, v) => {
      // Хук видит версию уже в passed — в той же транзакции.
      const [row] = await tx
        .select({ scanState: schema.fileVersion.scanState })
        .from(schema.fileVersion)
        .where(eq(schema.fileVersion.id, v.id));
      expect(row?.scanState).toBe('passed');
    });
    const withHook = new FileScanJob(db, storage, antivirus, env, new AuditService(db), boss, { cv: hook });
    const cv = await createFile({ purpose: 'cv' });
    const chart = await createFile({ purpose: 'organisation_chart' });
    expect(await withHook.run({ fileVersionId: cv.versionId })).toBe('passed');
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0]![1]).toEqual({ id: cv.versionId, fileObjectId: cv.fileObjectId, purpose: 'cv' });
    expect(await withHook.run({ fileVersionId: chart.versionId })).toBe('passed');
    expect(hook).toHaveBeenCalledTimes(1);

    const failing = new FileScanJob(db, storage, antivirus, env, new AuditService(db), boss, {
      cv: async () => {
        throw new Error('hook failed');
      },
    });
    const broken = await createFile({ purpose: 'cv' });
    await expect(failing.run({ fileVersionId: broken.versionId })).rejects.toThrow('hook failed');
    expect(await version(broken.versionId)).toMatchObject({ scan_state: 'pending', scanned_at: null });
    expect(storage.keys(QUARANTINE)).toContain((await version(broken.versionId)).storage_key);
  });

  it('зачистка: pending старше 15 минут — снова в file-scan, моложе — нет; passed и rejected — нет', async () => {
    const now = new Date();
    const at = (minutes: number, seconds = 0) => new Date(now.getTime() - minutes * 60_000 - seconds * 1000);
    const stale = await createFile();
    const young = await createFile();
    const passed = await createFile();
    const rejected = await createFile();
    expect(await scanAs(passed.versionId, { clean: true })).toBe('passed');
    expect(await scanAs(rejected.versionId, { clean: false, signature: 'Eicar-Test-Signature' })).toBe('rejected');
    for (const [v, uploadedAt] of [
      [stale, at(15, 1)],
      [young, at(14, 59)],
      [passed, at(60)],
      [rejected, at(60)],
    ] as const)
      await pool.query('update file_version set uploaded_at = $2 where id = $1', [v.versionId, uploadedAt]);
    await boss.deleteAllJobs(QUEUES.fileScan);

    expect(await scan.sweep(now)).toEqual({ requeued: 1 });
    expect(await jobs(stale.versionId)).toEqual([
      { data: { fileVersionId: stale.versionId }, singleton_key: stale.versionId, state: 'created' },
    ]);
    for (const v of [young, passed, rejected]) expect(await jobs(v.versionId)).toEqual([]);

    // Задание ещё в очереди — повторная зачистка второго не ставит.
    expect(await scan.sweep(now)).toEqual({ requeued: 0 });
    expect(await jobs(stale.versionId)).toHaveLength(1);
  });

  it('ссылка на чужой файл возвращает отказ и запись в аудит: производитель другой организации и администратор (ADM-06) — 403, аудит file.read denied с id файла; без сеанса — 401 (GEN-09)', async () => {
    const foreign = await createFile({ organizationId: otherOrg });
    const own = await createFile();
    for (const file of [foreign, own]) expect(await scanAs(file.versionId, { clean: true })).toBe('passed');

    const denied = async (fileObjectId: string, role: Role) => {
      const res = await http.get(content(fileObjectId), role);
      expect(res.status, role).toBe(403);
      expect(await res.json()).toMatchObject({ status: 403, code: 'forbidden' });
    };
    await denied(foreign.fileObjectId, 'manufacturer');
    // Администратор не читает файлы производителя и своей организации стенда (ADM-06).
    await denied(foreign.fileObjectId, 'administrator');
    await denied(own.fileObjectId, 'administrator');

    const foreignAudit = await audits('file.read', foreign.fileObjectId);
    expect(foreignAudit).toHaveLength(2);
    for (const entry of foreignAudit)
      expect(entry).toMatchObject({
        user_id: SESSION_USER,
        organization_id: ownerOrg,
        object_type: 'file_object',
        outcome: 'denied',
        diff: null,
      });
    expect(foreignAudit[0]!.ip).toMatch(/127\.0\.0\.1/);
    expect(await audits('file.read', own.fileObjectId)).toHaveLength(1);
    expect(await audits('file.downloaded', foreign.versionId)).toEqual([]);

    const anonymous = await http.get(content(foreign.fileObjectId));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ code: 'unauthenticated' });

    // Несуществующий файл и id не-UUID — 404 без аудита чтения.
    for (const id of [randomUUID(), 'not-a-uuid', `${foreign.fileObjectId}x`]) {
      const res = await http.get(content(id), 'manufacturer');
      expect(res.status, id).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'not_found' });
    }
  });

  it('права по назначению: владелец, SME и директор читают файл производителя; оператор и наблюдатель — 403; назначение без правила (site_survey_report) — 403 всем ролям', async () => {
    // Образец оргструктуры — своё правило (org-chart-sample.integration.test.ts).
    for (const purpose of FILE_PURPOSES)
      expect(FILE_READ_RULES[purpose], purpose).toBe(
        (MANUFACTURER_FILE_PURPOSES as readonly FilePurpose[]).includes(purpose)
          ? manufacturerFileRule
          : purpose === 'organisation_chart_sample'
            ? orgChartSampleReadRule
            : denyAll,
      );

    const cv = await createFile({ purpose: 'cv' });
    const survey = await createFile({ purpose: 'site_survey_report', dataClass: 'c_imbc' });
    for (const file of [cv, survey]) expect(await scanAs(file.versionId, { clean: true })).toBe('passed');

    const allowed = new Set<Role>(['manufacturer', 'expert', 'director']);
    for (const role of ROLES) {
      const res = await http.get(content(cv.fileObjectId), role);
      expect(res.status, `cv ${role}`).toBe(allowed.has(role) ? 200 : 403);
      await res.arrayBuffer();
      const s = await http.get(content(survey.fileObjectId), role);
      expect(s.status, `site_survey_report ${role}`).toBe(403);
    }
    expect(await audits('file.read', survey.fileObjectId)).toHaveLength(ROLES.length);
    expect(await audits('file.read', cv.fileObjectId)).toHaveLength(ROLES.length - allowed.size);
  });

  it("скачивание: Content-Type по содержимому, Content-Disposition attachment с filename*=UTF-8'' исходного казахского имени и ASCII-запасным filename, заголовок одной строкой; Cache-Control no-store; аудит file.downloaded без имени файла", async () => {
    // Загрузка через HTTP: путь, кавычки, «;» и перевод строки в имени части.
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(fixture('sample.pdf'))], { type: 'text/plain' }),
      `C:\\docs\\Құрылым "IMBC";\n v1.pdf`,
    );
    const created = await http.upload('/api/test/files', 'manufacturer', form);
    expect(created.status).toBe(201);
    const file = (await created.json()) as { fileObjectId: string; versionId: string; versionNumber: number };
    expect(await version(file.versionId)).toMatchObject({
      original_name: KAZAKH_NAME,
      declared_media_type: 'text/plain',
      detected_media_type: 'application/pdf',
    });
    expect(await scanAs(file.versionId, { clean: true })).toBe('passed');

    const res = await http.get(content(file.fileObjectId), 'manufacturer');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-length')).toBe(String(fixture('sample.pdf').length));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const disposition = res.headers.get('content-disposition')!;
    expect(disposition).toBe(
      `attachment; filename="_______ _IMBC_; v1.pdf"; filename*=UTF-8''%D2%9A%D2%B1%D1%80%D1%8B%D0%BB%D1%8B%D0%BC%20%22IMBC%22%3B%20v1.pdf`,
    );
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(decodeURIComponent(disposition.split("UTF-8''")[1]!)).toBe(KAZAKH_NAME);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(fixture('sample.pdf'));

    const downloaded = await audits('file.downloaded', file.versionId);
    expect(downloaded).toEqual([
      {
        user_id: SESSION_USER,
        organization_id: ownerOrg,
        object_type: 'file_version',
        outcome: 'ok',
        diff: { versionNumber: 1 },
        ip: expect.stringMatching(/127\.0\.0\.1/),
      },
    ]);
    const auditText = JSON.stringify((await pool.query("select * from audit_entries where action like 'file.%'")).rows);
    for (const part of ['Құрылым', 'IMBC', 'v1.pdf', (await version(file.versionId)).storage_key])
      expect(auditText).not.toContain(part);
  });

  it('загрузка целиком: отказ проверки (предел, пустой, подделанный тип, ZIP64 и усечённый архив) — в хранилище и БД ничего не осталось (DATA-06, DATA-07)', async () => {
    const before = await counts();
    const pdf = (size: number) => {
      const bytes = Buffer.alloc(size);
      bytes.write('%PDF-1.7\n');
      return bytes;
    };
    const cases: [Buffer, string, number, string][] = [
      [pdf(26_214_401), 'больше.pdf', 413, 'file_too_large'],
      [Buffer.alloc(0), 'пустой.pdf', 400, 'file_empty'],
      [fixture('sample.png'), 'схема.pdf', 415, 'file_type_mismatch'],
      [fixture('program.exe'), 'устав.pdf', 415, 'file_type_not_allowed'],
      [fixture('plain.zip'), 'устав.docx', 415, 'file_type_not_allowed'],
      // DOCX и XLSX, которые антивирус не проверил бы целиком (ZIP64), и усечённый архив (DATA-07).
      [fixture('zip64-local.docx'), 'устав.docx', 415, 'file_structure_unsupported'],
      [fixture('zip64-local.xlsx'), 'мощности.xlsx', 415, 'file_structure_unsupported'],
      [fixture('zip64-directory.docx'), 'устав.docx', 415, 'file_structure_unsupported'],
      [fixture('truncated.docx'), 'устав.docx', 415, 'file_structure_unsupported'],
    ];
    for (const [bytes, name, status, code] of cases) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)]), name);
      const res = await http.upload('/api/test/files', 'manufacturer', form);
      expect(res.status, name).toBe(status);
      expect(await res.json()).toMatchObject({ code });
    }
    expect(storage.objects.size).toBe(0);
    expect(await counts()).toEqual(before);
  });

  it('хранилище недоступно при скачивании — 503 storage_unavailable, в журнале нет ключа и имени', async () => {
    const file = await createFile({ name: 'Секретная схема.pdf' });
    expect(await scanAs(file.versionId, { clean: true })).toBe('passed');
    const key = (await version(file.versionId)).storage_key;
    const spies = (['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const).map((method) =>
      vi.spyOn(Logger.prototype, method),
    );

    storage.failNext('get');
    const res = await http.get(content(file.fileObjectId), 'manufacturer');
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ status: 503, code: 'storage_unavailable' });
    for (const secret of [key, 'Секретная']) {
      expect(body).not.toContain(secret);
      expect(logged(spies)).not.toContain(secret);
    }
    expect(spies[1]).toHaveBeenCalled();
    expect(await audits('file.downloaded', file.versionId)).toEqual([]);

    // Хранилище вернулось — файл скачивается.
    const retry = await http.get(content(file.fileObjectId), 'manufacturer');
    expect(retry.status).toBe(200);
    await retry.arrayBuffer();
  });

  it('HEAD: те же проверки и заголовки, что у GET, без тела, без чтения объекта и без file.downloaded; отказ — 403 и file.read denied', async () => {
    const head = (path: string, role?: Role) =>
      fetch(`${http.base}${path}`, { method: 'HEAD', headers: role ? { cookie: `imbc-session=${role}` } : {} });
    const file = await createFile({ name: KAZAKH_NAME });
    expect(await scanAs(file.versionId, { clean: true })).toBe('passed');
    const get = await http.get(content(file.fileObjectId), 'manufacturer');
    expect(get.status).toBe(200);
    await get.arrayBuffer();
    expect(await audits('file.downloaded', file.versionId)).toHaveLength(1);

    const read = vi.spyOn(storage, 'get');
    for (const query of ['', '?version=1']) {
      const res = await head(content(file.fileObjectId, query), 'manufacturer');
      expect(res.status, query).toBe(200);
      for (const header of ['content-type', 'content-length', 'content-disposition', 'cache-control'])
        expect(res.headers.get(header), header).toBe(get.headers.get(header));
      expect((await res.arrayBuffer()).byteLength).toBe(0);
    }
    expect(read).not.toHaveBeenCalled();
    expect(await audits('file.downloaded', file.versionId)).toHaveLength(1);

    // Отказ правила — как у GET: 403 и file.read denied; состояние скана и сеанс — те же коды.
    expect((await head(content(file.fileObjectId), 'operator')).status).toBe(403);
    expect(await audits('file.read', file.fileObjectId)).toMatchObject([
      { outcome: 'denied', object_type: 'file_object' },
    ]);
    const pending = await createFile();
    expect((await head(content(pending.fileObjectId), 'manufacturer')).status).toBe(409);
    expect((await head(content(file.fileObjectId))).status).toBe(401);
    expect((await head(content(randomUUID()), 'manufacturer')).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });

  it('скан: объекта нет в карантине — пока версии не больше 15 минут, ошибка задания (повтор); старше — rejected с аудитом object_missing; зачистка её больше не берёт; прочий сбой хранилища — ошибка задания при любом возрасте', async () => {
    const lost = await createFile({ name: 'Потерянный план.pdf' });
    const { storage_key: key, uploaded_at: uploadedAt } = await version(lost.versionId);
    storage.objects.delete(`${QUARANTINE}/${key}`);
    const at = (age: number) => new Date(uploadedAt.getTime() + age);
    const warn = vi.spyOn(Logger.prototype, 'warn');

    // Не старше SCAN_STALE_MS (граница включительно) — ошибка задания, версия ждёт.
    for (const age of [0, SCAN_STALE_MS - 1000, SCAN_STALE_MS]) {
      const error = await scan.run({ fileVersionId: lost.versionId }, at(age)).then(
        () => null,
        (e: unknown) => e,
      );
      expect((error as Error | null)?.message, String(age)).toBe(`file-scan ${lost.versionId}: object_missing`);
    }
    expect(await version(lost.versionId)).toMatchObject({ scan_state: 'pending', scanned_at: null });
    expect(await audits('file.scan_rejected', lost.versionId)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      { fileVersionId: lost.versionId, reason: 'object_missing', final: false },
      expect.any(String),
    );

    // Старше — окончательный отказ.
    expect(await scan.run({ fileVersionId: lost.versionId }, at(SCAN_STALE_MS + 1000))).toBe('rejected');
    expect(antivirus.calls).toBe(0);
    const row = await version(lost.versionId);
    expect(row.scan_state).toBe('rejected');
    expect(row.scanned_at).toBeInstanceOf(Date);
    expect(await audits('file.scan_rejected', lost.versionId)).toEqual([
      {
        user_id: SESSION_USER,
        organization_id: ownerOrg,
        object_type: 'file_version',
        outcome: 'denied',
        diff: { signature: OBJECT_MISSING_SIGNATURE },
        ip: null,
      },
    ]);
    expect(OBJECT_MISSING_SIGNATURE).toBe('object_missing');
    expect(warn).toHaveBeenCalledWith(
      { fileVersionId: lost.versionId, reason: 'object_missing', final: true },
      expect.any(String),
    );
    const text = logged([warn]);
    expect(text).not.toContain(key);
    expect(text).not.toContain('Потерянный');

    await boss.deleteAllJobs(QUEUES.fileScan);
    await scan.sweep(at(20 * 60_000));
    expect(await jobs(lost.versionId)).toEqual([]);
    expect(await scan.run({ fileVersionId: lost.versionId }, at(20 * 60_000))).toBe('skipped');

    // Хранилище недоступно (не «нет ключа») — ошибка задания и повтор при любом возрасте, версия остаётся pending.
    const unavailable = await createFile();
    const unavailableAt = (await version(unavailable.versionId)).uploaded_at;
    storage.failNext('get');
    await expect(
      scan.run({ fileVersionId: unavailable.versionId }, new Date(unavailableAt.getTime() + 60 * 60_000)),
    ).rejects.toThrow();
    expect(await version(unavailable.versionId)).toMatchObject({ scan_state: 'pending', scanned_at: null });
  });

  it('скан: байты карантина не совпадают с sha256 загрузки — никогда не passed: пока версии не больше 15 минут, ошибка задания; старше — rejected с аудитом checksum_mismatch, объект удалён; в журнале только id версии', async () => {
    const swapped = await createFile({ name: 'Подменённый план.pdf' });
    const { storage_key: key, uploaded_at: uploadedAt } = await version(swapped.versionId);
    const at = (age: number) => new Date(uploadedAt.getTime() + age);
    storage.objects.set(`${QUARANTINE}/${key}`, fixture('sample.png'));
    const warn = vi.spyOn(Logger.prototype, 'warn');

    for (const [verdict, age] of [
      [{ clean: true }, 0],
      [{ clean: false, signature: 'Eicar-Test-Signature' }, SCAN_STALE_MS - 1000],
      [{ clean: true }, SCAN_STALE_MS],
    ] as const) {
      antivirus.verdict = verdict;
      const error = await scan.run({ fileVersionId: swapped.versionId }, at(age)).then(
        () => null,
        (e: unknown) => e,
      );
      expect((error as Error | null)?.message, String(age)).toBe(`file-scan ${swapped.versionId}: checksum_mismatch`);
    }
    expect(antivirus.calls).toBe(3);
    expect(await version(swapped.versionId)).toMatchObject({ scan_state: 'pending', scanned_at: null });
    expect(storage.keys(FILES)).not.toContain(key);
    expect(storage.keys(QUARANTINE)).toContain(key);
    expect(await audits('file.scan_rejected', swapped.versionId)).toEqual([]);

    antivirus.verdict = { clean: true };
    expect(await scan.run({ fileVersionId: swapped.versionId }, at(SCAN_STALE_MS + 1000))).toBe('rejected');
    expect(await version(swapped.versionId)).toMatchObject({ scan_state: 'rejected' });
    expect(await audits('file.scan_rejected', swapped.versionId)).toMatchObject([
      { outcome: 'denied', object_type: 'file_version', diff: { signature: CHECKSUM_MISMATCH_SIGNATURE } },
    ]);
    expect(CHECKSUM_MISMATCH_SIGNATURE).toBe('checksum_mismatch');
    expect(storage.keys(QUARANTINE)).not.toContain(key);
    expect(storage.keys(FILES)).not.toContain(key);
    expect(warn).toHaveBeenCalledWith(
      { fileVersionId: swapped.versionId, reason: 'checksum_mismatch', final: true },
      expect.any(String),
    );
    const text = logged([warn]);
    expect(text).not.toContain(key);
    expect(text).not.toContain('Подменённый');

    // Те же байты, что приняла загрузка, — проходят.
    const restored = await createFile();
    const restoredKey = (await version(restored.versionId)).storage_key;
    storage.objects.set(`${QUARANTINE}/${restoredKey}`, fixture('sample.png'));
    await expect(scanAs(restored.versionId, { clean: true })).rejects.toThrow('checksum_mismatch');
    storage.objects.set(`${QUARANTINE}/${restoredKey}`, fixture('sample.pdf'));
    expect(await scanAs(restored.versionId, { clean: true })).toBe('passed');
  });

  it('скан: параллельный запуск с другим вердиктом решил раньше — отклонил: наша копия в рабочем бакете удаляется; пропустил: копия остаётся', async () => {
    /** Антивирус, пока «проверяет», даёт другому запуску перевести версию в `state`. */
    const racing = (versionId: string, state: 'passed' | 'rejected'): Antivirus => ({
      scan: async (body) => {
        for await (const chunk of body) void chunk;
        await pool.query('update file_version set scan_state = $2, scanned_at = now() where id = $1', [
          versionId,
          state,
        ]);
        return { clean: true };
      },
    });
    const rejected = await createFile();
    const rejectedKey = (await version(rejected.versionId)).storage_key;
    const loser = new FileScanJob(
      db,
      storage,
      racing(rejected.versionId, 'rejected'),
      env,
      new AuditService(db),
      boss,
      {},
    );
    expect(await loser.run({ fileVersionId: rejected.versionId })).toBe('skipped');
    expect(storage.keys(FILES)).not.toContain(rejectedKey);
    expect(storage.keys(QUARANTINE)).not.toContain(rejectedKey);

    const passed = await createFile();
    const passedKey = (await version(passed.versionId)).storage_key;
    const second = new FileScanJob(
      db,
      storage,
      racing(passed.versionId, 'passed'),
      env,
      new AuditService(db),
      boss,
      {},
    );
    expect(await second.run({ fileVersionId: passed.versionId })).toBe('skipped');
    expect(storage.keys(FILES)).toContain(passedKey);
    expect(storage.keys(QUARANTINE)).not.toContain(passedKey);
  });

  it('скан: транзакция перехода ждёт блокировку не дольше boundLockWaits — превышение — ошибка задания, версия pending; после снятия — passed', async () => {
    const locked = await createFile();
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select 1 from file_version where id = $1 for update', [locked.versionId]);
      const started = Date.now();
      const error = await scanAs(locked.versionId, { clean: true }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(lockWaitExceeded(error)).toBe(true);
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      await client.query('rollback');
      client.release();
    }
    expect(await version(locked.versionId)).toMatchObject({ scan_state: 'pending', scanned_at: null });
    expect(await scanAs(locked.versionId, { clean: true })).toBe('passed');
  });

  it('параллельные recordVersion одного файла: номера версий не повторяются, ни одна загрузка не теряется (file_version_number_uq)', async () => {
    const first = await createFile({ name: 'Схема v1.pdf' });
    const uploads = await Promise.all([2, 3, 4, 5].map((n) => accepted(`Схема v${n}.pdf`)));
    const results = await Promise.all(uploads.map((upload) => addVersion(first.fileObjectId, upload)));
    expect(results.map((r) => r.versionNumber).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
    const rows = (
      await pool.query<{ id: string; version_number: number; original_name: string }>(
        'select id, version_number, original_name from file_version where file_object_id = $1 order by version_number',
        [first.fileObjectId],
      )
    ).rows;
    expect(rows.map((r) => r.version_number)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(rows.map((r) => r.original_name)).size).toBe(5);
    for (const result of results) {
      expect(rows.find((r) => r.id === result.versionId)?.version_number).toBe(result.versionNumber);
      expect(await jobs(result.versionId)).toHaveLength(1);
    }
    expect(storage.keys(QUARANTINE)).toHaveLength(5);
  });

  it('маршрут скачивания — FILE_ROUTES.content', () => {
    expect(FILE_ROUTES).toEqual({ content: '/api/v1/files/:id/content' });
  });
});
