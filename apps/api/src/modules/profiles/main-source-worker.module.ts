import { Module } from '@nestjs/common';
import type pg from 'pg';
import { AuditService } from '../../common/audit.service.js';
import { PG_POOL } from '../../database/database.module.js';
import { MainInformationHandler } from './main-information.handler.js';
import { ContactsHandler } from './contacts.handler.js';
import { PersonnelHandler } from './personnel.handler.js';
import { ProductsHandler } from './products.handler.js';
import { ProductionHandler } from './production.handler.js';
import { CertificatesHandler } from './certificates.handler.js';
import { DocumentsHandler } from './documents.handler.js';
import { defineSectionHandler } from './section-handler.js';
import { MainSourceRefreshService } from './main-source-refresh.service.js';
import { MainSourceWorker } from './main-source-worker.js';

/** Only the worker process imports this module. Source preparation in the API starts no loop. */
@Module({
  providers: [
    {
      provide: MainSourceRefreshService,
      inject: [PG_POOL, AuditService],
      useFactory: (pool: pg.Pool, audit: AuditService) =>
        new MainSourceRefreshService(pool, audit, [
          defineSectionHandler(new MainInformationHandler()),
          defineSectionHandler(new ContactsHandler()),
          defineSectionHandler(new PersonnelHandler()),
          defineSectionHandler(new ProductsHandler()),
          defineSectionHandler(new ProductionHandler()),
          defineSectionHandler(new CertificatesHandler()),
          defineSectionHandler(new DocumentsHandler()),
        ]),
    },
    {
      provide: MainSourceWorker,
      inject: [PG_POOL, MainSourceRefreshService],
      useFactory: (pool: pg.Pool, profiles: MainSourceRefreshService) => new MainSourceWorker(pool, profiles),
    },
  ],
  exports: [MainSourceWorker, MainSourceRefreshService],
})
export class MainSourceWorkerModule {}
