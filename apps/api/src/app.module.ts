import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './common/audit.service.js';
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
import { HealthController } from './modules/health/health.controller.js';
import { ProfilesController } from './modules/profiles/profiles.controller.js';
import { ProfilesService } from './modules/profiles/profiles.service.js';
import { PrototypeModule } from './modules/prototype/prototype.module.js';
import { ManufacturerOnboardingService } from './modules/registration/onboarding.service.js';
import { RegistrationController } from './modules/registration/registration.controller.js';
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
    InfraModule,
    AuditModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    RegistrationController,
    CatalogController,
    ProfilesController,
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
    CatalogService,
    ReviewsService,
    AccountsService,
    OrganizationsService,
    InvitationsService,
    AccountLifecycleService,
    DictionariesService,
    FilesService,
    OrgChartSampleService,
    MailService,
    AdataScheduler,
    IdentityProvisioningService,
    ManufacturerOnboardingService,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {
  /**
   * Модуль общего состояния прототипа кабинетов — только при `PROTOTYPE_CABINETS=true`: без флага
   * адрес `/api/v1/prototype/state` — обычный неизвестный маршрут (и в OpenAPI его нет).
   */
  static register(options: { prototypeCabinets: boolean }): DynamicModule {
    return { module: AppModule, imports: options.prototypeCabinets ? [PrototypeModule] : [] };
  }
}
