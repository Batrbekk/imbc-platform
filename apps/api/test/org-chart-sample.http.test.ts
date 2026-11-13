import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import {
  type Action,
  can,
  type OrgChartSampleCurrent,
  type OrgChartSampleState,
  type OrgChartSampleUpload,
  ROLES,
  type Role,
} from '@imbc/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ProblemException } from '../src/common/problem.js';
import { OrgChartSampleController } from '../src/modules/files/org-chart-sample.controller.js';
import { orgChartSampleAccess } from '../src/modules/files/org-chart-sample.rules.js';
import { ORG_CHART_SAMPLE_ROUTES, OrgChartSampleService } from '../src/modules/files/org-chart-sample.service.js';
import { headerLines, type HttpStand, startHttp } from './support/http.js';

// Граница HTTP образца оргструктуры: настоящий SessionGuard, перехватчик загрузки и проверка файла; права — из
// матрицы: просмотр reference.read, загрузка reference.manage; текущий образец — без действия матрицы, доступ
// решает сервис по orgChartSampleAccess (ADM-11, MAN-19, GEN-08, NFR-09). Сервис — заглушка.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/files/${name}`, import.meta.url));
const SESSION_USER = '00000000-0000-4000-8000-0000000000a2';
const SAMPLE_NAME = 'Құрылым үлгісі.pdf';

const FILE = {
  fileId: '00000000-0000-4000-8000-000000000051',
  originalName: SAMPLE_NAME,
  byteSize: 1024,
  mediaType: 'application/pdf',
  scanState: 'passed',
  uploadedAt: '2026-11-13T05:00:00.000Z',
} as const;
const STATE: OrgChartSampleState = { current: FILE, latest: { ...FILE, scanState: 'pending' } };
const UPLOAD: OrgChartSampleUpload = { upload: { ...FILE, scanState: 'pending' } };
const CURRENT: OrgChartSampleCurrent = {
  current: { originalName: SAMPLE_NAME, byteSize: 1024, mediaType: 'application/pdf', uploadedAt: FILE.uploadedAt },
};
const description = () => ({
  originalName: SAMPLE_NAME,
  mediaType: 'application/pdf',
  byteSize: fixture('sample.pdf').length,
  versionNumber: 1,
});

const samples = {
  state: vi.fn(async () => structuredClone(STATE)),
  upload: vi.fn(async () => structuredClone(UPLOAD)),
  current: vi.fn(async () => structuredClone(CURRENT)),
  openCurrent: vi.fn(async () => ({ ...description(), stream: Readable.from([fixture('sample.pdf')]) })),
  describeCurrent: vi.fn(async () => description()),
};
const services = Object.values(samples);

const sampleForm = (name = SAMPLE_NAME, bytes = fixture('sample.pdf')) => {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), name);
  return form;
};

interface Route {
  method: 'GET' | 'POST';
  action: Action;
  status: number;
  response: unknown;
  service: Mock;
}

const ROUTES: Route[] = [
  { method: 'GET', action: 'reference.read', status: 200, response: STATE, service: samples.state },
  { method: 'POST', action: 'reference.manage', status: 202, response: UPLOAD, service: samples.upload },
];

const allowed = (action: Action) => ROLES.filter((role) => can(role, action));
const denied = (action: Action) => ROLES.filter((role) => !can(role, action));
const onlyCalled = (service: Mock) => {
  for (const other of services) if (other !== service) expect(other).not.toHaveBeenCalled();
  expect(service).toHaveBeenCalledOnce();
};

describe('образец оргструктуры: просмотр и загрузка (ADM-11, GEN-08, NFR-09)', () => {
  vi.setConfig({ testTimeout: 30000 });
  let http: HttpStand;

  const request = (route: Route, role?: Role) =>
    route.method === 'GET'
      ? http.get(ORG_CHART_SAMPLE_ROUTES.sample, role)
      : http.upload(ORG_CHART_SAMPLE_ROUTES.sample, role, sampleForm());

  beforeAll(async () => {
    http = await startHttp({
      controllers: [OrgChartSampleController],
      providers: [{ provide: OrgChartSampleService, useValue: samples }],
    });
  });

  beforeEach(() => {
    for (const service of services) service.mockClear();
    http.audit.record.mockClear();
  });

  afterAll(async () => {
    await http?.close();
  });

  it('маршруты — /api/v1/org-chart-sample, …/current, …/current/content; просмотр — администратор и директор, загрузка — только администратор (раздел 4)', () => {
    expect(ORG_CHART_SAMPLE_ROUTES).toEqual({
      sample: '/api/v1/org-chart-sample',
      current: '/api/v1/org-chart-sample/current',
      currentContent: '/api/v1/org-chart-sample/current/content',
    });
    expect(allowed('reference.read')).toEqual(['administrator', 'director']);
    expect(allowed('reference.manage')).toEqual(['administrator']);
  });

  it('orgChartSampleAccess: администратор и директор — any, производитель — current, SME, оператор и наблюдатель — null (MAN-19, расхождение 2 плана этапа 2)', () => {
    expect(Object.fromEntries(ROLES.map((role) => [role, orgChartSampleAccess(role)]))).toEqual({
      manufacturer: 'current',
      expert: null,
      administrator: 'any',
      director: 'any',
      operator: null,
      observer: null,
    });
  });

  it.each(ROUTES.flatMap((route) => allowed(route.action).map((role) => [route.method, role, route] as const)))(
    '%s: разрешённая роль — сервис вызван (%s)',
    async (_method, role, route) => {
      const res = await request(route, role);
      expect(res.status).toBe(route.status);
      expect(await res.json()).toEqual(route.response);
      onlyCalled(route.service);
      if (route.method === 'POST')
        expect(samples.upload).toHaveBeenCalledWith(
          expect.objectContaining({ role, id: SESSION_USER }),
          expect.objectContaining({
            originalName: SAMPLE_NAME,
            mediaType: 'application/pdf',
            bytes: fixture('sample.pdf'),
          }),
          expect.any(String),
        );
      else expect(samples.state).toHaveBeenCalledWith();
      expect(http.audit.record).not.toHaveBeenCalled();
    },
  );

  it.each(ROUTES.flatMap((route) => denied(route.action).map((role) => [route.method, role, route] as const)))(
    '%s: %s — 403, outcome denied и action в аудите, сервис не вызван (GEN-08)',
    async (_method, role, route) => {
      const res = await request(route, role);
      expect(res.status).toBe(403);
      expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
      expect(await res.json()).toMatchObject({ status: 403, code: 'forbidden' });
      expect(http.audit.record).toHaveBeenCalledOnce();
      expect(http.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'denied',
          action: route.action,
          userId: expect.any(String),
          // Тот же объект пишет отказ в транзакции загрузки (actorTransaction): ORG_CHART_SAMPLE_ROUTES.
          objectType: 'route',
          objectId: ORG_CHART_SAMPLE_ROUTES.sample,
        }),
      );
      for (const service of services) expect(service).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['GET', ORG_CHART_SAMPLE_ROUTES.sample],
    ['POST', ORG_CHART_SAMPLE_ROUTES.sample],
    ['GET', ORG_CHART_SAMPLE_ROUTES.current],
    ['GET', ORG_CHART_SAMPLE_ROUTES.currentContent],
    ['HEAD', ORG_CHART_SAMPLE_ROUTES.currentContent],
  ] as const)('%s %s: без сеанса — 401', async (method, path) => {
    const res =
      method === 'POST'
        ? await http.upload(path, undefined, sampleForm())
        : await fetch(`${http.base}${path}`, { method });
    expect(res.status).toBe(401);
    if (method !== 'HEAD') expect(await res.json()).toMatchObject({ status: 401, code: 'unauthenticated' });
    for (const service of services) expect(service).not.toHaveBeenCalled();
  });

  it('POST с чужого Origin — 403 bad_origin, сервис не вызван', async () => {
    const res = await fetch(`${http.base}${ORG_CHART_SAMPLE_ROUTES.sample}`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', cookie: 'imbc-session=administrator' },
      body: sampleForm(),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ status: 403, code: 'bad_origin' });
    for (const service of services) expect(service).not.toHaveBeenCalled();
  });

  it('POST без файла — 400 file_missing; подделанный тип — 415; сервис не вызван (DATA-06)', async () => {
    const noFile = new FormData();
    noFile.append('note', 'без файла');
    const missing = await http.upload(ORG_CHART_SAMPLE_ROUTES.sample, 'administrator', noFile);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ status: 400, code: 'file_missing' });

    const png = await http.upload(
      ORG_CHART_SAMPLE_ROUTES.sample,
      'administrator',
      sampleForm('Құрылым.pdf', fixture('sample.png')),
    );
    expect(png.status).toBe(415);
    expect(await png.json()).toMatchObject({ status: 415, code: 'file_type_mismatch' });

    const exe = await http.upload(
      ORG_CHART_SAMPLE_ROUTES.sample,
      'administrator',
      sampleForm('Құрылым.pdf', fixture('program.exe')),
    );
    expect(exe.status).toBe(415);
    expect(await exe.json()).toMatchObject({ status: 415, code: 'file_type_not_allowed' });
    for (const service of services) expect(service).not.toHaveBeenCalled();
  });

  it.each(ROLES)(
    'GET current: %s — без действия матрицы доходит до сервиса (доступ решает orgChartSampleAccess)',
    async (role) => {
      const res = await http.get(ORG_CHART_SAMPLE_ROUTES.current, role);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(CURRENT);
      onlyCalled(samples.current);
      expect(samples.current).toHaveBeenCalledWith(
        expect.objectContaining({ role, id: SESSION_USER }),
        expect.any(String),
      );
      expect(http.audit.record).not.toHaveBeenCalled();
    },
  );

  it.each(ROLES)(
    'GET current/content: %s — байты из openCurrent с заголовками скачивания (attachment, nosniff, no-store)',
    async (role) => {
      const res = await http.get(ORG_CHART_SAMPLE_ROUTES.currentContent, role);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(res.headers.get('content-length')).toBe(String(fixture('sample.pdf').length));
      expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
      expect(decodeURIComponent(res.headers.get('content-disposition')!.split("UTF-8''")[1]!)).toBe(SAMPLE_NAME);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(Buffer.from(await res.arrayBuffer())).toEqual(fixture('sample.pdf'));
      onlyCalled(samples.openCurrent);
      expect(samples.openCurrent).toHaveBeenCalledWith(
        expect.objectContaining({ user: expect.objectContaining({ role, id: SESSION_USER }) }),
        expect.any(String),
      );
    },
  );

  it('HEAD current/content — describeCurrent (без чтения объекта и без «скачано»), те же заголовки, без тела', async () => {
    const get = await http.get(ORG_CHART_SAMPLE_ROUTES.currentContent, 'manufacturer');
    await get.arrayBuffer();
    samples.openCurrent.mockClear();
    const head = await fetch(`${http.base}${ORG_CHART_SAMPLE_ROUTES.currentContent}`, {
      method: 'HEAD',
      headers: { cookie: 'imbc-session=manufacturer' },
    });
    expect(head.status).toBe(200);
    for (const header of ['content-type', 'content-length', 'content-disposition', 'cache-control'])
      expect(head.headers.get(header), header).toBe(get.headers.get(header));
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    onlyCalled(samples.describeCurrent);
  });

  it('current/content: отказ сервиса уходит как problem+json — текущего нет 404 not_found, роль без доступа 403', async () => {
    samples.openCurrent.mockRejectedValueOnce(new ProblemException(404, 'not_found', 'Не найдено'));
    const missing = await http.get(ORG_CHART_SAMPLE_ROUTES.currentContent, 'manufacturer');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(await missing.json()).toMatchObject({ status: 404, code: 'not_found' });

    samples.current.mockRejectedValueOnce(new ProblemException(403, 'forbidden', 'Нет прав'));
    const forbidden = await http.get(ORG_CHART_SAMPLE_ROUTES.current, 'operator');
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('X-Content-Type-Options приходит одной строкой: скачивание GET и HEAD, отказ 403 и 401 problem+json (заголовок ставит только приложение)', async () => {
    const url = `${http.base}${ORG_CHART_SAMPLE_ROUTES.currentContent}`;
    const cookie = 'imbc-session=manufacturer';
    expect(await headerLines(url, 'x-content-type-options', { cookie })).toBe(1);
    expect(await headerLines(url, 'x-content-type-options', { cookie, method: 'HEAD' })).toBe(1);
    samples.openCurrent.mockRejectedValueOnce(new ProblemException(403, 'forbidden', 'Нет прав'));
    expect(await headerLines(url, 'x-content-type-options', { cookie })).toBe(1);
    expect(await headerLines(url, 'x-content-type-options')).toBe(1);
  });
});
