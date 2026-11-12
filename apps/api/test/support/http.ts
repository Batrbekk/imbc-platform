import 'reflect-metadata';
import { ROLES, type Role } from '@imbc/contracts';
import { Module, type Provider, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type Mock, vi } from 'vitest';
import { AuditService } from '../../src/common/audit.service.js';
import { configureHttp } from '../../src/common/http.js';
import { ProblemDetailsFilter } from '../../src/common/problem.js';
import { ENV } from '../../src/config/env.js';
import type { AuthContext } from '../../src/modules/auth/auth.types.js';
import { SessionGuard } from '../../src/modules/auth/guards.js';
import { SessionService } from '../../src/modules/auth/session.service.js';
import { ORGANIZATION_TYPE } from './organization-type.js';

const COOKIE = 'imbc-session';

export interface HttpStand {
  /** Адрес сервера, например http://127.0.0.1:54321; маршруты — под /api. */
  base: string;
  /** Заглушка AuditService.record: отказы SessionGuard пишутся сюда. */
  audit: { record: Mock };
  /** GET с cookie `imbc-session=<role>`; без роли — без сеанса. */
  get(path: string, role?: Role): Promise<Response>;
  close(): Promise<void>;
}

/**
 * Стенд прав на границе HTTP: настоящий SessionGuard (APP_GUARD), ProblemDetailsFilter и configureHttp.
 * Сеанс — заглушка SessionService.resolve: cookie `imbc-session=<role>` даёт AuthContext этой роли
 * с пройденными шлюзами входа, другое значение — нет сеанса (GEN-08, GEN-10).
 */
export async function startHttp(options: {
  controllers: Type[];
  providers?: Provider[];
  /** Организация пользователя сеанса; по умолчанию одна на все роли. */
  organizationId?: string;
}): Promise<HttpStand> {
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const organizationId = options.organizationId ?? '00000000-0000-4000-8000-0000000000aa';
  const resolve = vi.fn(async (token: string | undefined): Promise<AuthContext | null> => {
    if (!token || !(ROLES as readonly string[]).includes(token)) return null;
    const role = token as Role;
    return {
      sessionId: 's',
      mfaPassed: true,
      responsibilityAccepted: true,
      user: {
        id: 'u',
        email: `${role}@test.local`,
        fullName: null,
        role,
        organizationId,
        organizationType: ORGANIZATION_TYPE[role],
        locale: 'kk',
      },
    };
  });

  class HttpStandModule {}
  Module({
    controllers: options.controllers,
    providers: [
      ...(options.providers ?? []),
      { provide: SessionService, useValue: { resolve } },
      { provide: AuditService, useValue: audit },
      { provide: ENV, useValue: { SESSION_COOKIE_NAME: COOKIE, PUBLIC_URL: 'https://imbc.example.kz' } },
      { provide: APP_GUARD, useClass: SessionGuard },
      { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    ],
  })(HttpStandModule);

  const app = await NestFactory.create<NestExpressApplication>(HttpStandModule, { logger: false });
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();

  return {
    base,
    audit,
    get: (path, role) => fetch(`${base}${path}`, role ? { headers: { cookie: `${COOKIE}=${role}` } } : undefined),
    close: () => app.close(),
  };
}
