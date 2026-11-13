import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import { configureHttp } from '../src/common/http.js';
import { ProblemDetailsFilter } from '../src/common/problem.js';
import { ENV } from '../src/config/env.js';
import { DB } from '../src/database/database.module.js';
import { QUEUE } from '../src/infra/infra.module.js';
import { MailService } from '../src/mail/mail.service.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import type { AuthContext } from '../src/modules/auth/auth.types.js';
import { SessionGuard } from '../src/modules/auth/guards.js';
import { IdentityProvisioningService } from '../src/modules/auth/identity-provisioning.service.js';
import { KeycloakAdminService } from '../src/modules/auth/keycloak-admin.service.js';
import { OidcService } from '../src/modules/auth/oidc.service.js';
import { AuthRateLimitService } from '../src/modules/auth/rate-limit.service.js';
import { SessionService } from '../src/modules/auth/session.service.js';
import { CatalogController } from '../src/modules/catalog/catalog.controller.js';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';
import { ManufacturerOnboardingService } from '../src/modules/registration/onboarding.service.js';
import { RegistrationController } from '../src/modules/registration/registration.controller.js';
import { headerLines } from './support/http.js';

// Ответы API и BFF не кешируются браузером: после выхода «Назад» не показывает чужие данные (NFR-11).
const COOKIE = 'imbc-session';
const OPERATOR: AuthContext = {
  sessionId: 's',
  mfaPassed: true,
  responsibilityAccepted: true,
  user: {
    id: 'u',
    email: 'operator@operator.local',
    fullName: null,
    role: 'operator',
    organizationId: 'o',
    organizationType: 'operator',
    locale: 'kk',
  },
};

const resolve = vi.fn(async (token: string | undefined) => (token === 'valid' ? { ...OPERATOR } : null));

/** Текущая версия NDA: `select … from nda_version where is_current` маршрута условий регистрации. */
const ndaQuery = { from: () => ({ where: async () => [{ version: 3, body: 'NDA (тест)' }] }) };

@Module({
  controllers: [CatalogController, AuthController, RegistrationController],
  providers: [
    { provide: CatalogService, useValue: { search: async () => ({ items: [], total: 0, page: 1, pageSize: 25 }) } },
    { provide: SessionService, useValue: { resolve } },
    { provide: AuditService, useValue: { record: vi.fn() } },
    { provide: MailService, useValue: {} },
    { provide: AuthRateLimitService, useValue: { enforce: vi.fn() } },
    { provide: ManufacturerOnboardingService, useValue: {} },
    { provide: IdentityProvisioningService, useValue: {} },
    { provide: KeycloakAdminService, useValue: {} },
    { provide: DB, useValue: { select: () => ndaQuery } },
    { provide: QUEUE, useValue: {} },
    { provide: OidcService, useValue: { passwordResetUrl: () => new URL('https://id.example.test/reset') } },
    { provide: ENV, useValue: { SESSION_COOKIE_NAME: COOKIE, PUBLIC_URL: 'https://imbc.example.test' } },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
class NoStoreHttpModule {}

describe('Cache-Control: no-store на ответах API и BFF (NFR-11)', () => {
  let app: NestExpressApplication;
  let base: string;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(NoStoreHttpModule, { logger: false });
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  const withSession = { headers: { cookie: `${COOKIE}=valid` } };

  it('200 с данными сеанса — no-store, заголовки helmet на месте', async () => {
    const res = await fetch(`${base}/api/v1/catalog/search`, withSession);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('X-Content-Type-Options — одной строкой на 200, 401 и 404 problem+json: источник один — helmet приложения, edge второй не добавляет', async () => {
    const lines = (path: string, cookie?: string) =>
      headerLines(`${base}${path}`, 'x-content-type-options', { cookie });
    expect(await lines('/api/v1/catalog/search', `${COOKIE}=valid`)).toBe(1);
    expect(await lines('/api/v1/catalog/search')).toBe(1);
    expect(await lines('/api/v1/unknown', `${COOKIE}=valid`)).toBe(1);
  });

  it('401 problem+json без сеанса — no-store', async () => {
    const res = await fetch(`${base}/api/v1/catalog/search`);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('400 ошибки проверки и 404 неизвестного адреса — no-store', async () => {
    const invalid = await fetch(`${base}/api/v1/catalog/search?tier=tier_3`, withSession);
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('cache-control')).toBe('no-store');

    const missing = await fetch(`${base}/api/v1/unknown`, withSession);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
  });

  it('публичный текст условий регистрации — no-store, только номер и текст NDA (MAN-01)', async () => {
    const res = await fetch(`${base}/api/v1/registrations/terms`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ nda: { version: 3, body: 'NDA (тест)' } });
  });

  it('302 входа в BFF — no-store', async () => {
    const res = await fetch(`${base}/api/auth/password-reset?locale=ru`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://id.example.test/reset');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
