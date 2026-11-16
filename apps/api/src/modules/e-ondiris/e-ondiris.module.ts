import { Module } from '@nestjs/common';
import type pg from 'pg';
import { AuditService } from '../../common/audit.service.js';
import { PG_POOL } from '../../database/database.module.js';
import { MainInformationHandler } from '../profiles/main-information.handler.js';
import { ContactsHandler } from '../profiles/contacts.handler.js';
import { PersonnelHandler } from '../profiles/personnel.handler.js';
import { ProductsHandler } from '../profiles/products.handler.js';
import { ProductionHandler } from '../profiles/production.handler.js';
import { CertificatesHandler } from '../profiles/certificates.handler.js';
import { DocumentsHandler } from '../profiles/documents.handler.js';
import { defineSectionHandler } from '../profiles/section-handler.js';
import { EOndirisSnapshotStore } from './ingestion.js';
import { EOndirisProfileRefreshService } from './profile-refresh.service.js';

/** No HTTP ingestion route or guessed upstream credentials. Parent wires these explicit disabled worker routes. */
@Module({
  providers: [
    {
      provide: EOndirisSnapshotStore,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool) => new EOndirisSnapshotStore(pool),
    },
    {
      provide: EOndirisProfileRefreshService,
      inject: [PG_POOL, AuditService],
      useFactory: (pool: pg.Pool, audit: AuditService) =>
        new EOndirisProfileRefreshService(pool, audit, [
          defineSectionHandler(new MainInformationHandler()),
          defineSectionHandler(new ContactsHandler()),
          defineSectionHandler(new PersonnelHandler()),
          defineSectionHandler(new ProductsHandler()),
          defineSectionHandler(new ProductionHandler()),
          defineSectionHandler(new CertificatesHandler()),
          defineSectionHandler(new DocumentsHandler()),
        ]),
    },
  ],
  exports: [EOndirisSnapshotStore, EOndirisProfileRefreshService],
})
export class EOndirisModule {}
