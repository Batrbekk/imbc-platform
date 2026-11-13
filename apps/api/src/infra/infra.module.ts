import { S3Client } from '@aws-sdk/client-s3';
import { Global, Inject, Logger, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import nodemailer, { type Transporter } from 'nodemailer';
import { PgBoss } from 'pg-boss';
import { ENV, type Env } from '../config/env.js';
import { databaseErrorSummary } from '../database/pg-errors.js';
import { ADATA_QUEUE_OPTIONS, FILE_SCAN_QUEUE_OPTIONS, NOTIFY_QUEUE_OPTIONS, QUEUES } from '../jobs/queues.js';
import { OBJECT_STORAGE, S3ObjectStorage } from '../modules/files/object-storage.js';

export const VALKEY = Symbol('VALKEY');
export const S3 = Symbol('S3');
export const MAILER = Symbol('MAILER');
export const QUEUE = Symbol('QUEUE');

/**
 * Ошибка самого pg-boss (API и worker): у ошибки базы — только сводка с фиксированным текстом, без текста
 * запроса и значений строк (NFR-11); другая ошибка пишется как есть.
 */
export function logQueueError(logger: Pick<Logger, 'error'>, error: unknown): void {
  const database = databaseErrorSummary(error);
  if (database) logger.error(database, 'Queue database error');
  else logger.error(error);
}

/**
 * Инфраструктурные клиенты API.
 * Valkey — только кеш (ADR-11): потеря данных в нём ничего не ломает.
 * pg-boss — очередь в PostgreSQL (ADR-06): API только ставит задания, выполняет worker.
 */
@Global()
@Module({
  providers: [
    {
      provide: VALKEY,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Redis(env.VALKEY_URL, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: false }),
    },
    {
      provide: S3,
      inject: [ENV],
      useFactory: (env: Env) =>
        new S3Client({
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          forcePathStyle: true,
          credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
        }),
    },
    // Байты файлов — только через этот интерфейс: карантин, рабочий бакет, без presigned URL (NFR-09).
    { provide: OBJECT_STORAGE, inject: [S3], useFactory: (s3: S3Client) => new S3ObjectStorage(s3) },
    {
      provide: MAILER,
      inject: [ENV],
      // Зависший SMTP не держит транзакцию журнала письма и соединение БД дольше этих сроков (NOT-18).
      useFactory: (env: Env): Transporter =>
        nodemailer.createTransport({
          url: env.SMTP_URL,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 30_000,
        }),
    },
    {
      provide: QUEUE,
      inject: [ENV],
      useFactory: (env: Env) =>
        // API только ставит задания; обслуживание очереди и расписание — в worker.
        new PgBoss({
          connectionString: env.DATABASE_URL,
          schema: env.PGBOSS_SCHEMA,
          application_name: `imbc-${env.PROCESS_ROLE}-queue`,
          supervise: env.PROCESS_ROLE === 'worker',
          schedule: env.PROCESS_ROLE === 'worker',
        }),
    },
  ],
  exports: [VALKEY, S3, OBJECT_STORAGE, MAILER, QUEUE],
})
export class InfraModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(InfraModule.name);

  constructor(
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(QUEUE) private readonly queue: PgBoss,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue.on('error', (error) => logQueueError(this.logger, error));
    // Valkey — только кеш: недоступность пишется в лог не чаще раза в минуту и ничего не останавливает.
    let lastWarn = 0;
    this.valkey.on('error', (error: Error) => {
      if (Date.now() - lastWarn < 60_000) return;
      lastWarn = Date.now();
      this.logger.warn(`Valkey: ${error.message}`);
    });
    await this.queue.start();
    // API can enqueue a registration before the worker process has finished starting.
    for (const name of [QUEUES.sendPasswordEmail, QUEUES.cleanupIdentity]) {
      await this.queue.createQueue(name, { retryLimit: 10, retryDelay: 30, retryBackoff: true });
    }
    // Чтение Adata ставит и API (первый вход), и worker (событие пароля) — до старта обработчиков.
    await this.queue.createQueue(QUEUES.adataPrefill, ADATA_QUEUE_OPTIONS);
    // Действия администратора ставят identity-sync в своей транзакции (ADM-02, ADM-05); повторы — как у worker.
    await this.queue.createQueue(QUEUES.identitySync, { retryLimit: 5, retryDelay: 30, retryBackoff: true });
    // Загрузка ставит проверку файла в своей транзакции (DATA-07) — до старта worker.
    await this.queue.createQueue(QUEUES.fileScan, FILE_SCAN_QUEUE_OPTIONS);
    // Письма событий ставятся в транзакции события (раздел 8.2) — до старта worker.
    await this.queue.createQueue(QUEUES.notify, NOTIFY_QUEUE_OPTIONS);
    await this.valkey.connect().catch((error: unknown) => this.logger.warn(`Valkey недоступен: ${String(error)}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.stop({ graceful: true });
    this.valkey.disconnect();
  }
}
