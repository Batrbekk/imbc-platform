import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './common/audit.service.js';
import { ProblemDetailsFilter } from './common/problem.js';
import { ConfigModule } from './config/config.module.js';
import { ENV, type Env } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { InfraModule } from './infra/infra.module.js';
import { MailService } from './mail/mail.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { SessionGuard } from './modules/auth/guards.js';
import { KeycloakAdminService } from './modules/auth/keycloak-admin.service.js';
import { OidcService } from './modules/auth/oidc.service.js';
import { SessionService } from './modules/auth/session.service.js';
import { CatalogController } from './modules/catalog/catalog.controller.js';
import { CatalogService } from './modules/catalog/catalog.service.js';
import { HealthController } from './modules/health/health.controller.js';
import { ProfilesService } from './modules/profiles/profiles.service.js';
import { RegistrationController } from './modules/registration/registration.controller.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          // Секреты и персональные данные не попадают в логи (NFR-32).
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
          transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
        },
      }),
    }),
    DatabaseModule,
    InfraModule,
    AuditModule,
  ],
  controllers: [HealthController, AuthController, RegistrationController, CatalogController],
  providers: [
    OidcService,
    SessionService,
    KeycloakAdminService,
    ProfilesService,
    CatalogService,
    MailService,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
