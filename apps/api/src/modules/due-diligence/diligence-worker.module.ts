import { Module } from '@nestjs/common';
import type pg from 'pg';
import { PG_POOL } from '../../database/database.module.js';
import { DiligenceService } from './diligence.service.js';
import { DiligenceWorker } from './diligence-worker.js';
@Module({
  providers: [
    DiligenceService,
    {
      provide: DiligenceWorker,
      inject: [PG_POOL, DiligenceService],
      useFactory: (pool: pg.Pool, diligence: DiligenceService) => new DiligenceWorker(pool, diligence),
    },
  ],
  exports: [DiligenceWorker],
})
export class DiligenceWorkerModule {}
