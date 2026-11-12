import { S3Client } from '@aws-sdk/client-s3';
import { Global, Inject, Logger, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import nodemailer, { type Transporter } from 'nodemailer';
import { PgBoss } from 'pg-boss';
import { ENV, type Env } from '../config/env.js';
import { QUEUES } from '../jobs/queues.js';

export const VALKEY = Symbol('VALKEY');
export const S3 = Symbol('S3');
export const MAILER = Symbol('MAILER');
export const QUEUE = Symbol('QUEUE');

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
    {
      provide: MAILER,
      inject: [ENV],
      useFactory: (env: Env): Transporter => nodemailer.createTransport(env.SMTP_URL),
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
  exports: [VALKEY, S3, MAILER, QUEUE],
})
export class InfraModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(InfraModule.name);

  constructor(
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(QUEUE) private readonly queue: PgBoss,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue.on('error', (error) => this.logger.error(error));
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
    await this.valkey.connect().catch((error: unknown) => this.logger.warn(`Valkey недоступен: ${String(error)}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.stop({ graceful: true });
    this.valkey.disconnect();
  }
}
