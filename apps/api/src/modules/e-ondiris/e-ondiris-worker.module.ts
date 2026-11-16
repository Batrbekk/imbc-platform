import { Module } from '@nestjs/common';
import type pg from 'pg';
import { PG_POOL } from '../../database/database.module.js';
import { EOndirisModule } from './e-ondiris.module.js';
import { EOndirisSnapshotStore } from './ingestion.js';
import { EOndirisProfileRefreshService } from './profile-refresh.service.js';
import { DisabledEOndirisFeedConnector, EOndirisWorker } from './worker.js';

/** Only imported by the worker process. API core imports no worker provider or scheduler. */
@Module({
  imports: [EOndirisModule],
  providers: [
    {
      provide: EOndirisWorker,
      inject: [PG_POOL, EOndirisSnapshotStore, EOndirisProfileRefreshService],
      useFactory: (pool: pg.Pool, store: EOndirisSnapshotStore, profiles: EOndirisProfileRefreshService) =>
        new EOndirisWorker(pool, new DisabledEOndirisFeedConnector(), store, profiles),
    },
  ],
  exports: [EOndirisWorker],
})
export class EOndirisWorkerModule {}
