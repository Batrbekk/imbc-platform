import 'reflect-metadata';
import { Controller, Get, Module, Res } from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { LoggerModule } from 'nestjs-pino';
import type { Response } from 'express';
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

@Controller('auth')
class LogCallbackController {
  @Get('callback')
  callback() {
    return { ok: true };
  }

  @Get('redirect')
  redirect(@Res() response: Response) {
    response.redirect(
      302,
      'https://identity.fixture.local/callback?code=redirect-code-fixture&state=redirect-state-fixture',
    );
  }
}

@Module({
  // Та же настройка, что у AppModule; вывод — в поток теста, а не в stdout.
  imports: [LoggerModule.forRoot({ pinoHttp: [httpLoggerOptions({ LOG_LEVEL: 'info', NODE_ENV: 'test' }), sink] })],
  controllers: [RegistrationController, LogCallbackController],
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

  it('real callback and business requests keep routes/statuses but never emit query, Referer or credential values', async () => {
    lines.length = 0;
    const credentials = [
      'callback-code-fixture',
      'callback-state-fixture',
      'business-token-fixture',
      'arbitrary-secret-fixture',
      'referer-code-fixture',
      'referer-state-fixture',
      'header-token-fixture',
      'cookie-session-fixture',
      'header-api-key-fixture',
      'header-csrf-fixture',
    ];
    const headers = {
      referer: 'https://profile.fixture.local/api/auth/callback?code=referer-code-fixture&state=referer-state-fixture',
      authorization: 'Bearer header-token-fixture',
      cookie: 'session=cookie-session-fixture',
      'x-api-key': 'header-api-key-fixture',
      'x-csrf-token': 'header-csrf-fixture',
    };
    expect(
      (await fetch(`${base}/api/auth/callback?code=callback-code-fixture&state=callback-state-fixture`, { headers }))
        .status,
    ).toBe(200);
    expect(
      (
        await fetch(
          `${base}/api/v1/registrations/terms?access_token=business-token-fixture&unrecognized=arbitrary-secret-fixture`,
          { headers },
        )
      ).status,
    ).toBe(200);
    const requests = lines
      .map(
        (line) =>
          JSON.parse(line) as {
            req: { url: string; method: string; headers: Record<string, unknown>; query?: unknown };
            res: { statusCode: number };
          },
      )
      .filter((entry) => entry.req);
    expect(requests.map((entry) => [entry.req.method, entry.req.url, entry.res.statusCode])).toEqual([
      ['GET', '/api/auth/callback?[Redacted]', 200],
      ['GET', '/api/v1/registrations/terms?[Redacted]', 200],
    ]);
    for (const entry of requests) {
      expect(entry.req.headers.referer).toBe('[Redacted]');
      expect(entry.req.headers.authorization).toBe('[Redacted]');
      expect(entry.req.headers.cookie).toBe('[Redacted]');
      expect(entry.req.headers['x-api-key']).toBe('[Redacted]');
      expect(entry.req.headers['x-csrf-token']).toBe('[Redacted]');
      if (entry.req.query !== undefined) expect(entry.req.query).toBe('[Redacted]');
    }
    const output = lines.join('');
    for (const credential of credentials) expect(output, credential).not.toContain(credential);
  });

  it('encoded/repeated query names and redirect Location values are scrubbed before the sink', async () => {
    lines.length = 0;
    const secrets = [
      'encoded-code-fixture',
      'repeated-code-fixture',
      'fragment-fixture',
      'redirect-code-fixture',
      'redirect-state-fixture',
    ];
    expect(
      (
        await fetch(
          `${base}/api/auth/callback?c%6fde=encoded-code-fixture&code=repeated-code-fixture&next=%2Fprivate%23fragment-fixture`,
        )
      ).status,
    ).toBe(200);
    expect((await fetch(`${base}/api/auth/redirect`, { redirect: 'manual' })).status).toBe(302);
    const redirect = lines
      .map((line) => JSON.parse(line) as { res?: { statusCode: number; headers: Record<string, unknown> } })
      .find((entry) => entry.res?.statusCode === 302);
    expect(redirect?.res?.headers.location).toBe('https://identity.fixture.local/callback?[Redacted]');
    const output = lines.join('');
    for (const secret of secrets) {
      expect(output, secret).not.toContain(secret);
      expect(output, `encoded ${secret}`).not.toContain(encodeURIComponent(secret));
    }
  });
});
