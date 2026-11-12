import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { LoggerModule } from 'nestjs-pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import { configureHttp } from '../src/common/http.js';
import { httpLoggerOptions } from '../src/common/logging.js';
import { ProblemDetailsFilter } from '../src/common/problem.js';
import { DB } from '../src/database/database.module.js';
import { QUEUE } from '../src/infra/infra.module.js';
import { IdentityProvisioningService } from '../src/modules/auth/identity-provisioning.service.js';
import { AuthRateLimitService } from '../src/modules/auth/rate-limit.service.js';
import { RegistrationController } from '../src/modules/registration/registration.controller.js';

// IP клиента — персональные данные: строка журнала запроса не несёт ни адреса прокси-заголовков, ни сокета (FC-02).
const lines: string[] = [];
const sink = { write: (chunk: string) => void lines.push(chunk) };
const ndaQuery = { from: () => ({ where: async () => [{ version: 1, body: 'NDA (тест)' }] }) };

@Module({
  // Та же настройка, что у AppModule; вывод — в поток теста, а не в stdout.
  imports: [LoggerModule.forRoot({ pinoHttp: [httpLoggerOptions({ LOG_LEVEL: 'info', NODE_ENV: 'test' }), sink] })],
  controllers: [RegistrationController],
  providers: [
    { provide: DB, useValue: { select: () => ndaQuery } },
    { provide: QUEUE, useValue: {} },
    { provide: IdentityProvisioningService, useValue: {} },
    { provide: AuditService, useValue: { record: vi.fn() } },
    { provide: AuthRateLimitService, useValue: { enforce: vi.fn() } },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
class LogHttpModule {}

describe('журнал запросов без IP клиента (FC-02, NFR-11)', () => {
  let app: NestExpressApplication;
  let base: string;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(LogHttpModule, { logger: false });
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  const proxied = {
    'x-forwarded-for': '203.0.113.7',
    'x-real-ip': '198.51.100.23',
    forwarded: 'for=192.0.2.43;proto=https',
  };

  it('x-forwarded-for, x-real-ip, forwarded и адрес сокета вырезаны из строки журнала', async () => {
    lines.length = 0;
    const terms = await fetch(`${base}/api/v1/registrations/terms`, { headers: proxied });
    expect(terms.status).toBe(200);
    const register = await fetch(`${base}/api/v1/registrations`, {
      method: 'POST',
      headers: { ...proxied, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(register.status).toBe(400);

    const entries = lines.map((line) => JSON.parse(line) as { req?: Record<string, unknown> });
    const requests = entries.filter((e) => e.req);
    expect(requests.map((e) => e.req!.url)).toEqual(['/api/v1/registrations/terms', '/api/v1/registrations']);
    for (const { req } of requests) {
      const headers = req!.headers as Record<string, unknown>;
      expect(headers['x-forwarded-for']).toBe('[Redacted]');
      expect(headers['x-real-ip']).toBe('[Redacted]');
      expect(headers.forwarded).toBe('[Redacted]');
      expect(req!.remoteAddress).toBe('[Redacted]');
      expect(req!.remotePort).toBe('[Redacted]');
    }
    // Заголовок host здесь — 127.0.0.1 стенда теста; на стенде в нём имя сайта, не адрес клиента.
    const output = lines.join('');
    for (const needle of ['203.0.113.7', '198.51.100.23', '192.0.2.43'])
      expect(output.includes(needle), needle).toBe(false);
  });
});
