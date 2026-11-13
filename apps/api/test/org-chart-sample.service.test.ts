import 'reflect-metadata';
import type { Role } from '@imbc/contracts';
import { Logger } from '@nestjs/common';
import type pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditEvent, AuditService } from '../src/common/audit.service.js';
import type { Database } from '../src/database/database.module.js';
import { databaseErrorSummary } from '../src/database/pg-errors.js';
import type { AuthContext, AuthUser } from '../src/modules/auth/auth.types.js';
import type { FilesService } from '../src/modules/files/files.service.js';
import { ORG_CHART_SAMPLE_ROUTES, OrgChartSampleService } from '../src/modules/files/org-chart-sample.service.js';

// Отказ роли без доступа к образцам на маршрутах текущего образца (MAN-19, GEN-08, AUD-01): запись `file.read`
// `denied` называет маршрут — как отказ SessionGuard по @Can; сбой записи не подменяет 403. База и файлы не нужны:
// отказ решается до поиска образца.
const USER_ID = '00000000-0000-4000-8000-0000000000b1';
const ORG_ID = '00000000-0000-4000-8000-0000000000b2';
const IP = '192.0.2.40';

const user = (role: Role): AuthUser => ({
  id: USER_ID,
  email: 'sme@imbc.local',
  fullName: null,
  role,
  organizationId: ORG_ID,
  organizationType: 'imbc',
  locale: 'kk',
});
const auth = (role: Role) => ({ user: user(role) }) as AuthContext;

function service(record: (event: AuditEvent) => Promise<void>) {
  return new OrgChartSampleService(
    {} as Database,
    {} as pg.Pool,
    {} as FilesService,
    { record: vi.fn(record) } as unknown as AuditService,
  );
}

const refusal = async (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (e: unknown) => ({
      status: (e as { getStatus?: () => number }).getStatus?.(),
      code: (e as { code?: string }).code,
    }),
  );

describe('OrgChartSampleService: отказ роли без доступа к образцам', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('SME, оператор, наблюдатель — 403 и запись file.read denied с маршрутом: описание — …/current, байты (GET и HEAD) — …/current/content', async () => {
    const events: AuditEvent[] = [];
    const samples = service(async (event) => {
      events.push(event);
    });
    const forbidden = { status: 403, code: 'forbidden' };
    expect(await refusal(samples.current(user('expert'), IP))).toEqual(forbidden);
    expect(await refusal(samples.openCurrent(auth('operator'), IP))).toEqual(forbidden);
    expect(await refusal(samples.describeCurrent(auth('observer'), IP))).toEqual(forbidden);
    const denial = (objectId: string) => ({
      userId: USER_ID,
      organizationId: ORG_ID,
      action: 'file.read',
      objectType: 'route',
      objectId,
      outcome: 'denied',
      ip: IP,
    });
    expect(events).toEqual([
      denial(ORG_CHART_SAMPLE_ROUTES.current),
      denial(ORG_CHART_SAMPLE_ROUTES.currentContent),
      denial(ORG_CHART_SAMPLE_ROUTES.currentContent),
    ]);
  });

  it('сбой записи отказа — по-прежнему 403; в журнале у ошибки базы — сводка без текста запроса, у прочей ошибки — она сама (как auditActorDenial)', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const database = Object.assign(new Error('insert into "audit_entries" … values ($1) sme@imbc.local'), {
      code: '57P01',
      severity: 'FATAL',
      routine: 'ProcessInterrupts',
    });
    const other = new Error('audit offline');
    const failures = [database, other];
    const samples = service(async () => {
      throw failures.shift();
    });
    expect(await refusal(samples.current(user('expert'), IP))).toEqual({ status: 403, code: 'forbidden' });
    expect(await refusal(samples.openCurrent(auth('expert'), IP))).toEqual({ status: 403, code: 'forbidden' });
    expect(error.mock.calls).toEqual([
      [databaseErrorSummary(database), 'Denied organisation chart sample read audit failed'],
      [other, 'Denied organisation chart sample read audit failed'],
    ]);
    expect(JSON.stringify(error.mock.calls[0])).not.toContain('@');
  });
});
