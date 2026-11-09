import { Inject, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { PgBoss } from 'pg-boss';
import { AuditModule } from '../common/audit.service.js';
import { ConfigModule } from '../config/config.module.js';
import { ENV, type Env } from '../config/env.js';
import { DatabaseModule } from '../database/database.module.js';
import { InfraModule, QUEUE } from '../infra/infra.module.js';
import { MailService } from '../mail/mail.service.js';
import { KeycloakAdminService } from '../modules/auth/keycloak-admin.service.js';
import { PLATFORM_TZ, QUEUES, type QueueName, SCHEDULES } from '../jobs/queues.js';
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
  providers: [JobHandlers, MailService, KeycloakAdminService],
})
export class WorkerModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('Worker');

  constructor(
    @Inject(QUEUE) private readonly boss: PgBoss,
    private readonly handlers: JobHandlers,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const h = this.handlers;
    const routes: Record<QueueName, (data: never) => Promise<void>> = {
      [QUEUES.scanFile]: (d) => h.scanFile(d),
      [QUEUES.sendNotification]: (d) => h.sendNotification(d),
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
    };

    for (const [queue, run] of Object.entries(routes) as [QueueName, (data: never) => Promise<void>][]) {
      await this.boss.createQueue(queue, { retryLimit: 5, retryBackoff: true, retryDelay: 30 });
      await this.boss.work(queue, async (jobs) => {
        for (const job of jobs) await run(job.data as never);
      });
    }
    for (const s of SCHEDULES) {
      await this.boss.schedule(s.queue, s.cron, null, { tz: PLATFORM_TZ });
    }
    this.logger.log(`очередей: ${Object.keys(routes).length}, расписаний: ${SCHEDULES.length} (${PLATFORM_TZ})`);
  }
}
