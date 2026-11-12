import { Inject, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { PgBoss } from 'pg-boss';
import { AuditModule } from '../common/audit.service.js';
import { ConfigModule } from '../config/config.module.js';
import { ENV, type Env } from '../config/env.js';
import { DatabaseModule } from '../database/database.module.js';
import { redactDatabaseError } from '../database/pg-errors.js';
import { InfraModule, QUEUE } from '../infra/infra.module.js';
import { MailService } from '../mail/mail.service.js';
import { ADATA_DEFAULT_TIMING } from '../modules/adata/adata.client.js';
import { AdataScheduler } from '../modules/adata/adata.scheduler.js';
import { KeycloakAdminService } from '../modules/auth/keycloak-admin.service.js';
import { SessionService } from '../modules/auth/session.service.js';
import { ProfilesService } from '../modules/profiles/profiles.service.js';
import { ManufacturerOnboardingService } from '../modules/registration/onboarding.service.js';
import { ADATA_QUEUE_OPTIONS, PLATFORM_TZ, QUEUES, type QueueName, SCHEDULES } from '../jobs/queues.js';
import { ADATA_CLIENT_FACTORY, ADATA_TIMING, AdataPrefillJob, defaultAdataClientFactory } from './adata-prefill.job.js';
import { JobHandlers } from './handlers.service.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
        },
      }),
    }),
    DatabaseModule,
    InfraModule,
    AuditModule,
  ],
  providers: [
    JobHandlers,
    MailService,
    KeycloakAdminService,
    SessionService,
    AdataScheduler,
    ProfilesService,
    ManufacturerOnboardingService,
    AdataPrefillJob,
    { provide: ADATA_CLIENT_FACTORY, useValue: defaultAdataClientFactory },
    { provide: ADATA_TIMING, useValue: ADATA_DEFAULT_TIMING },
  ],
})
export class WorkerModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('Worker');

  constructor(
    @Inject(QUEUE) private readonly boss: PgBoss,
    private readonly handlers: JobHandlers,
    private readonly adataPrefill: AdataPrefillJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const h = this.handlers;
    const routes: Record<QueueName, (data: never) => Promise<void>> = {
      [QUEUES.scanFile]: (d) => h.scanFile(d),
      [QUEUES.sendNotification]: (d) => h.sendNotification(d),
      [QUEUES.sendPasswordEmail]: (d) => h.sendPasswordEmail(d),
      [QUEUES.cleanupIdentity]: (d) => h.cleanupIdentity(d),
      [QUEUES.certificateExpiry]: () => h.certificateExpiry(),
      [QUEUES.purgeSessions]: () => h.purgeSessions(),
      [QUEUES.purgeExportFiles]: () => h.purgeExportFiles(),
      [QUEUES.refreshCatalog]: () => h.todo(QUEUES.refreshCatalog),
      [QUEUES.buildExport]: () => h.todo(QUEUES.buildExport),
      [QUEUES.updateStatus]: () => h.todo(QUEUES.updateStatus),
      [QUEUES.accountInactivity]: () => h.todo(QUEUES.accountInactivity),
      [QUEUES.keycloakEvents]: () => h.keycloakEvents(),
      [QUEUES.activitySnapshotWeekly]: () => h.todo(QUEUES.activitySnapshotWeekly),
      [QUEUES.activitySnapshotMonthly]: () => h.todo(QUEUES.activitySnapshotMonthly),
      [QUEUES.runSubscriptions]: () => h.todo(QUEUES.runSubscriptions),
      [QUEUES.adataPrefill]: (d) => this.adataPrefill.run(d),
    };

    for (const [queue, run] of Object.entries(routes) as [QueueName, (data: never) => Promise<void>][]) {
      await this.boss.createQueue(
        queue,
        queue === QUEUES.adataPrefill
          ? ADATA_QUEUE_OPTIONS
          : {
              retryLimit: queue === QUEUES.sendPasswordEmail || queue === QUEUES.cleanupIdentity ? 10 : 5,
              retryBackoff: true,
              retryDelay: 30,
            },
      );
      await this.boss.work(queue, async (jobs) => {
        try {
          for (const job of jobs) await run(job.data as never);
        } catch (error) {
          // pg-boss сохраняет ошибку обработчика в output задания: у ошибки базы — только сводка (NFR-11).
          throw redactDatabaseError(error);
        }
      });
    }
    for (const s of SCHEDULES) {
      await this.boss.schedule(s.queue, s.cron, null, { tz: PLATFORM_TZ });
    }
    this.logger.log(`очередей: ${Object.keys(routes).length}, расписаний: ${SCHEDULES.length} (${PLATFORM_TZ})`);
  }
}
