import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './common/audit.service.js';
import { PolicyModule } from './common/policy.js';
import { httpLoggerOptions } from './common/logging.js';
import { ProblemDetailsFilter } from './common/problem.js';
import { ConfigModule } from './config/config.module.js';
import { ENV, type Env } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { InfraModule } from './infra/infra.module.js';
import { MailService } from './mail/mail.service.js';
import { AccountLifecycleService } from './modules/admin/account-lifecycle.service.js';
import { AccountsController } from './modules/admin/accounts.controller.js';
import { AccountsService } from './modules/admin/accounts.service.js';
import { InvitationsService } from './modules/admin/invitations.service.js';
import { OrganizationsController } from './modules/admin/organizations.controller.js';
import { OrganizationsService } from './modules/admin/organizations.service.js';
import { AdataScheduler } from './modules/adata/adata.scheduler.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { SessionGuard } from './modules/auth/guards.js';
import { IdentityProvisioningService } from './modules/auth/identity-provisioning.service.js';
import { KeycloakAdminService } from './modules/auth/keycloak-admin.service.js';
import { OidcService } from './modules/auth/oidc.service.js';
import { SessionService } from './modules/auth/session.service.js';
import { AuthRateLimitService } from './modules/auth/rate-limit.service.js';
import { CatalogController } from './modules/catalog/catalog.controller.js';
import { CatalogService } from './modules/catalog/catalog.service.js';
import { DictionariesController } from './modules/dictionaries/dictionaries.controller.js';
import { DictionariesService } from './modules/dictionaries/dictionaries.service.js';
import { FilesController } from './modules/files/files.controller.js';
import { FilesService } from './modules/files/files.service.js';
import { OrgChartSampleController } from './modules/files/org-chart-sample.controller.js';
import { OrgChartSampleService } from './modules/files/org-chart-sample.service.js';
import { UPLOAD_SLOTS, UploadSlots } from './modules/files/upload-slots.js';
import { HealthController } from './modules/health/health.controller.js';
import { ProfilesController } from './modules/profiles/profiles.controller.js';
import { ProfilesService } from './modules/profiles/profiles.service.js';
import { ProfileSectionsController } from './modules/profiles/profile-sections.controller.js';
import { ProfileSectionsService } from './modules/profiles/profile-sections.service.js';
import { ProfileSubmitController } from './modules/profiles/profile-submit.controller.js';
import { ProfileSubmitService } from './modules/profiles/profile-submit.service.js';
import { ProfileUnlockController } from './modules/profiles/profile-unlock.controller.js';
import { ProfileUnlockService } from './modules/profiles/profile-unlock.service.js';
import { ProfileSubmissionStateController } from './modules/profiles/profile-submission-state.controller.js';
import { ProfileSubmissionStateService } from './modules/profiles/profile-submission-state.service.js';
import { ProfileReviewDetailsController } from './modules/profiles/profile-review-details.controller.js';
import { ProfileReviewDetailsService } from './modules/profiles/profile-review-details.service.js';
import { MainInformationHandler } from './modules/profiles/main-information.handler.js';
import { ContactsHandler } from './modules/profiles/contacts.handler.js';
import { PersonnelHandler } from './modules/profiles/personnel.handler.js';
import { DocumentsHandler } from './modules/profiles/documents.handler.js';
import { CertificatesHandler } from './modules/profiles/certificates.handler.js';
import { ProductsHandler } from './modules/profiles/products.handler.js';
import { ProductionHandler } from './modules/profiles/production.handler.js';
import { ProfileUploadController, ProfileUploadGuard } from './modules/profiles/profile-upload.controller.js';
import { ProfileUploadService } from './modules/profiles/profile-upload.service.js';
import { defineSectionHandler, PROFILE_SECTION_HANDLERS } from './modules/profiles/section-handler.js';
import { ManufacturerOnboardingService } from './modules/registration/onboarding.service.js';
import { RegistrationController } from './modules/registration/registration.controller.js';
import { CurrentNdaController } from './modules/registration/current-nda.controller.js';
import { CurrentNdaService } from './modules/registration/current-nda.service.js';
import { ReviewsController } from './modules/reviews/reviews.controller.js';
import { ReviewsService } from './modules/reviews/reviews.service.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ pinoHttp: httpLoggerOptions(env) }),
    }),
    DatabaseModule,
    PolicyModule,
    InfraModule,
    AuditModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    RegistrationController,
    CurrentNdaController,
    CatalogController,
    ProfilesController,
    ProfileSectionsController,
    ProfileSubmitController,
    ProfileUnlockController,
    ProfileSubmissionStateController,
    ProfileReviewDetailsController,
    ProfileUploadController,
    ReviewsController,
    AccountsController,
    OrganizationsController,
    DictionariesController,
    FilesController,
    OrgChartSampleController,
  ],
  providers: [
    OidcService,
    SessionService,
    AuthRateLimitService,
    KeycloakAdminService,
    ProfilesService,
    ProfileSectionsService,
    ProfileSubmitService,
    ProfileUnlockService,
    ProfileSubmissionStateService,
    ProfileReviewDetailsService,
    ProfileUploadService,
    ProfileUploadGuard,
    MainInformationHandler,
    ContactsHandler,
    PersonnelHandler,
    DocumentsHandler,
    CertificatesHandler,
    ProductsHandler,
    ProductionHandler,
    {
      provide: PROFILE_SECTION_HANDLERS,
      inject: [
        MainInformationHandler,
        ContactsHandler,
        PersonnelHandler,
        DocumentsHandler,
        CertificatesHandler,
        ProductsHandler,
        ProductionHandler,
      ],
      useFactory: (
        main: MainInformationHandler,
        contacts: ContactsHandler,
        personnel: PersonnelHandler,
        documents: DocumentsHandler,
        certificates: CertificatesHandler,
        products: ProductsHandler,
        production: ProductionHandler,
      ) => [
        defineSectionHandler(main),
        defineSectionHandler(contacts),
        defineSectionHandler(personnel),
        defineSectionHandler(documents),
        defineSectionHandler(certificates),
        defineSectionHandler(products),
        defineSectionHandler(production),
      ],
    },
    CatalogService,
    ReviewsService,
    AccountsService,
    OrganizationsService,
    InvitationsService,
    AccountLifecycleService,
    DictionariesService,
    FilesService,
    OrgChartSampleService,
    {
      provide: UPLOAD_SLOTS,
      inject: [ENV],
      useFactory: (env: Env) =>
        new UploadSlots({ process: env.UPLOAD_CONCURRENCY, account: env.UPLOAD_CONCURRENCY_PER_ACCOUNT }),
    },
    MailService,
    AdataScheduler,
    IdentityProvisioningService,
    ManufacturerOnboardingService,
    CurrentNdaService,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
