import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DrizzleQueryError } from 'drizzle-orm';
import { Logger, LoggerModule } from 'nestjs-pino';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureHttp } from '../src/common/http.js';
import { httpLoggerOptions } from '../src/common/logging.js';
import { ProblemDetailsFilter } from '../src/common/problem.js';
import { redactDatabaseError } from '../src/database/pg-errors.js';

// Непредвиденная ошибка базы: в журнал — только SQLSTATE, ограничение, таблица, функция и классы ошибок (NFR-11).
const EMAIL = 'secret-person@invite.local';
const BIN = '980540000381';
const IP = '203.0.113.77';
const PERSONAL = [EMAIL, BIN, IP, 'Секретная Персона'];

/** Ошибка, как её отдаёт Drizzle на нарушении уникальности почты: параметры запроса и detail PostgreSQL. */
function duplicateEmailError(): DrizzleQueryError {
  const cause = new pg.DatabaseError(
    'duplicate key value violates unique constraint "user_accounts_email_uq"',
    0,
    'error',
  );
  Object.assign(cause, {
    severity: 'ERROR',
    code: '23505',
    detail: `Key (lower(email))=(${EMAIL}) already exists.`,
    table: 'user_accounts',
    constraint: 'user_accounts_email_uq',
    routine: '_bt_check_unique',
  });
  return new DrizzleQueryError(
    'insert into "user_accounts" ("email", "full_name", "registration_ip", "bin") values ($1, $2, $3, $4)',
    [EMAIL, 'Секретная Персона', IP, BIN],
    cause,
  );
}

const lines: string[] = [];
const sink = { write: (chunk: string) => void lines.push(chunk) };

@Controller('failing')
class FailingController {
  @Get('database')
  database() {
    throw duplicateEmailError();
  }

  @Get('plain')
  plain() {
    throw new Error('boom');
  }
}

@Module({
  imports: [LoggerModule.forRoot({ pinoHttp: [httpLoggerOptions({ LOG_LEVEL: 'info', NODE_ENV: 'test' }), sink] })],
  controllers: [FailingController],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
class ProblemLogModule {}

describe('журнал непредвиденной ошибки базы без персональных данных (NFR-11)', () => {
  let app: NestExpressApplication;
  let base: string;

  beforeAll(async () => {
    // Как main.ts: Logger Nest пишет через nestjs-pino с настройкой AppModule.
    app = await NestFactory.create<NestExpressApplication>(ProblemLogModule, { bufferLogs: true });
    app.useLogger(app.get(Logger));
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  const errorLines = () =>
    lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.level === 50 && entry.context === 'Problem');

  it('ошибка Drizzle с параметрами почты, БИН и IP — в журнале SQLSTATE и ограничение, без параметров, текста и detail', async () => {
    lines.length = 0;
    const res = await fetch(`${base}/api/failing/database`);
    expect(res.status).toBe(500);
    const body = await res.text();
    for (const needle of PERSONAL) expect(body, needle).not.toContain(needle);

    const [entry, ...rest] = errorLines();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      msg: 'Unexpected database error',
      sqlState: '23505',
      constraint: 'user_accounts_email_uq',
      table: 'user_accounts',
      routine: '_bt_check_unique',
      errors: ['DrizzleQueryError', 'DatabaseError'],
    });
    expect(entry!.err).toBeUndefined();
    const output = lines.join('');
    for (const needle of [...PERSONAL, 'Failed query', 'already exists'])
      expect(output.includes(needle), needle).toBe(false);
  });

  it('обычная ошибка пишется, как прежде, с текстом', async () => {
    lines.length = 0;
    expect((await fetch(`${base}/api/failing/plain`)).status).toBe(500);
    const [entry] = errorLines();
    expect((entry!.err as { message: string }).message).toBe('boom');
  });

  it('worker: ошибка базы в output задания pg-boss — только SQLSTATE и ограничение (NFR-11)', () => {
    // pg-boss сохраняет в output собственные поля ошибки (serialize-error), включая cause.
    const error = redactDatabaseError(duplicateEmailError());
    expect((error as { cause?: unknown }).cause).toBeUndefined();
    const own = Object.getOwnPropertyNames(error).map((key) => [
      key,
      (error as unknown as Record<string, unknown>)[key],
    ]);
    const stored = JSON.stringify(Object.fromEntries(own));
    for (const needle of [...PERSONAL, 'Failed query', 'already exists']) expect(stored, needle).not.toContain(needle);
    expect(stored).toContain('23505');
    expect(stored).toContain('user_accounts_email_uq');
    const plain = new Error('boom');
    expect(redactDatabaseError(plain)).toBe(plain);
  });
});
