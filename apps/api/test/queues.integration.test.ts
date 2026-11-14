import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import type pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/config/env.js';
import { InfraModule } from '../src/infra/infra.module.js';
import { QUEUES, RETIRED_QUEUES, retireQueues } from '../src/jobs/queues.js';
import { openTestPool } from './support/database.js';

// Очереди этапа 1 `scan-file` и `send-notification` остались в pg-boss без обработчиков: этап 2 заменил их на
// `file-scan` и `notify`. Contract этапа 2 (NFR-06) убирает их при старте worker, но только пустые: задание
// created, retry или active — очередь остаётся, предупреждение называет её и число заданий.
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('retireQueues: очереди прежней версии scan-file и send-notification (NFR-06)', () => {
  vi.setConfig({ testTimeout: 30000 });
  const SCHEMA = 'pgboss_auth_test';
  let pool: pg.Pool;
  let boss: PgBoss;

  beforeAll(async () => {
    pool = openTestPool();
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    boss = new PgBoss({ connectionString: databaseUrl, schema: SCHEMA, supervise: false, schedule: false });
    boss.on('error', () => undefined);
    await boss.start();
  }, 60000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await boss?.stop();
    await pool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool?.end();
  });

  const queueNames = async () =>
    (await pool.query<{ name: string }>(`select name from ${SCHEMA}.queue order by name`)).rows.map((r) => r.name);
  const jobStates = async (name: string) =>
    (await pool.query<{ state: string }>(`select state from ${SCHEMA}.job where name = $1`, [name])).rows.map(
      (r) => r.state,
    );

  it('RETIRED_QUEUES — две очереди этапа 1; среди очередей этой версии их нет', () => {
    expect(RETIRED_QUEUES).toEqual(['scan-file', 'send-notification']);
    for (const name of RETIRED_QUEUES) expect(Object.values(QUEUES) as string[]).not.toContain(name);
  });

  it('retireQueues: пустые scan-file и send-notification удаляются, повтор — ничего; очередь с заданием created — остаётся в kept', async () => {
    const log = vi.spyOn(Logger.prototype, 'log');
    const warn = vi.spyOn(Logger.prototype, 'warn');
    // Очереди этой версии рядом: их retireQueues не трогает.
    await boss.createQueue(QUEUES.fileScan);
    await boss.createQueue(QUEUES.notify);
    for (const name of RETIRED_QUEUES)
      await boss.createQueue(name, { retryLimit: 5, retryDelay: 30, retryBackoff: true });

    // Завершённое задание очередь не держит: оно уходит вместе с ней.
    await boss.send('send-notification', { code: 'NOT-03' });
    const [done] = await boss.fetch('send-notification');
    await boss.complete('send-notification', done!.id);
    expect(await jobStates('send-notification')).toEqual(['completed']);

    expect(await retireQueues(boss)).toEqual({ deleted: ['scan-file', 'send-notification'], kept: [] });
    expect(await queueNames()).toEqual([QUEUES.fileScan, QUEUES.notify].sort());
    expect(await jobStates('send-notification')).toEqual([]);
    expect(log).toHaveBeenCalledWith('retired queues: scan-file, send-notification');
    expect(warn).not.toHaveBeenCalled();

    // Повтор (каждый следующий старт worker): очередей нет — ничего не удаляется и не пишется.
    log.mockClear();
    expect(await retireQueues(boss)).toEqual({ deleted: [], kept: [] });
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();

    // Задание created: очередь остаётся, предупреждение — имя очереди и число заданий.
    await boss.createQueue('scan-file', { retryLimit: 1, retryDelay: 0, retryBackoff: false });
    await boss.send('scan-file', { fileId: 'f-1' });
    expect(await jobStates('scan-file')).toEqual(['created']);
    expect(await retireQueues(boss)).toEqual({ deleted: [], kept: ['scan-file'] });
    expect(warn).toHaveBeenCalledWith('retired queue kept: scan-file has 1 jobs in created, retry or active');
    expect(await queueNames()).toContain('scan-file');
    expect(await jobStates('scan-file')).toEqual(['created']);
  });

  it('задание active и retry очередь тоже держат; когда задание завершено — очередь удаляется', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    await boss.createQueue('scan-file', { retryLimit: 1, retryDelay: 0, retryBackoff: false });
    await boss.deleteAllJobs('scan-file');
    await boss.send('scan-file', { fileId: 'f-2' });

    const [first] = await boss.fetch('scan-file');
    expect(await jobStates('scan-file')).toEqual(['active']);
    expect(await retireQueues(boss)).toEqual({ deleted: [], kept: ['scan-file'] });

    await boss.fail('scan-file', first!.id, { message: 'сбой' });
    expect(await jobStates('scan-file')).toEqual(['retry']);
    expect(await retireQueues(boss)).toEqual({ deleted: [], kept: ['scan-file'] });
    expect(warn).toHaveBeenLastCalledWith('retired queue kept: scan-file has 1 jobs in created, retry or active');

    const [second] = await boss.fetch('scan-file');
    await boss.complete('scan-file', second!.id);
    expect(await jobStates('scan-file')).toEqual(['completed']);
    expect(await retireQueues(boss)).toEqual({ deleted: ['scan-file'], kept: [] });
    expect(await queueNames()).not.toContain('scan-file');
  });

  it('очередь удалил другой процесс после подсчёта заданий: deleteQueue не вызывается, в deleted и в журнале её нет', async () => {
    const log = vi.spyOn(Logger.prototype, 'log');
    for (const name of RETIRED_QUEUES) await boss.createQueue(name);
    // Второй worker того же стенда удаляет send-notification, пока первый считает её задания.
    const other = new PgBoss({ connectionString: databaseUrl, schema: SCHEMA, supervise: false, schedule: false });
    other.on('error', () => undefined);
    await other.start();
    try {
      const findJobs = boss.findJobs.bind(boss);
      vi.spyOn(boss, 'findJobs').mockImplementation(async (name, options) => {
        const jobs = await findJobs(name, options);
        if (name === 'send-notification') await other.deleteQueue(name);
        return jobs;
      });
      const deleteQueue = vi.spyOn(boss, 'deleteQueue');
      expect(await retireQueues(boss)).toEqual({ deleted: ['scan-file'], kept: [] });
      expect(deleteQueue.mock.calls).toEqual([['scan-file']]);
      expect(log).toHaveBeenCalledWith('retired queues: scan-file');
      expect(await queueNames()).not.toContain('send-notification');
    } finally {
      await other.stop();
    }
  });
});

// Подключение уборки в InfraModule: только процесс worker и до создания очередей; сбой уборки — строка журнала,
// старт идёт дальше. Без базы: pg-boss и Valkey — заглушки.
describe('InfraModule: уборка очередей прежней версии при старте', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const valkey = () => ({ on: vi.fn(), connect: vi.fn(async () => undefined), disconnect: vi.fn() });
  const queue = (getQueue: () => Promise<unknown> = async () => null) => ({
    on: vi.fn(),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    createQueue: vi.fn(async () => undefined),
    getQueue: vi.fn(getQueue),
    findJobs: vi.fn(async () => []),
    deleteQueue: vi.fn(async () => undefined),
  });
  const start = async (role: 'api' | 'worker', boss: ReturnType<typeof queue>, cache = valkey()) => {
    const module = new InfraModule(cache as never, boss as never, { PROCESS_ROLE: role } as Env);
    await module.onModuleInit();
    return cache;
  };

  it('api: очереди этапа 1 не проверяются и не удаляются; очереди API создаются', async () => {
    const boss = queue();
    await start('api', boss);
    expect(boss.getQueue).not.toHaveBeenCalled();
    expect(boss.deleteQueue).not.toHaveBeenCalled();
    expect(boss.createQueue).toHaveBeenCalledWith(QUEUES.notify, expect.anything());
  });

  it('worker: очереди этапа 1 проверяются после start и до первого createQueue', async () => {
    const boss = queue();
    await start('worker', boss);
    expect(boss.getQueue.mock.calls).toEqual(RETIRED_QUEUES.map((name) => [name]));
    const [firstCreate] = boss.createQueue.mock.invocationCallOrder;
    expect(boss.start.mock.invocationCallOrder[0]).toBeLessThan(boss.getQueue.mock.invocationCallOrder[0]!);
    expect(Math.max(...boss.getQueue.mock.invocationCallOrder)).toBeLessThan(firstCreate!);
  });

  it('worker: сбой уборки пишется в журнал и старт не останавливает — очереди созданы, Valkey подключается', async () => {
    const error = vi.spyOn(Logger.prototype, 'error');
    const failure = new Error('сбой уборки очередей');
    const boss = queue(async () => {
      throw failure;
    });
    const cache = await start('worker', boss);
    expect(error).toHaveBeenCalledWith(failure);
    expect(boss.createQueue).toHaveBeenCalledWith(QUEUES.notify, expect.anything());
    expect(boss.createQueue).toHaveBeenCalledWith(QUEUES.fileScan, expect.anything());
    expect(cache.connect).toHaveBeenCalled();
  });
});
