import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import {
  type Action,
  can,
  FILE_PROBLEM_CODES,
  type OrgChartSampleState,
  type OrgChartSampleUpload,
  ROLES,
  type Role,
} from '@imbc/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { OrgChartSampleController } from '../src/modules/files/org-chart-sample.controller.js';
import { ORG_CHART_SAMPLE_ROUTES, OrgChartSampleService } from '../src/modules/files/org-chart-sample.service.js';
import { type HttpStand, startHttp } from './support/http.js';

// Граница HTTP образца оргструктуры: настоящий SessionGuard, перехватчик загрузки и проверка файла; права — из
// матрицы: просмотр reference.read, загрузка reference.manage (ADM-11, GEN-08, NFR-09). Сервис — заглушка.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/files/${name}`, import.meta.url));

const FILE = {
  fileId: '00000000-0000-4000-8000-000000000051',
  originalName: 'Құрылым үлгісі.pdf',
  byteSize: 1024,
  mediaType: 'application/pdf',
  scanState: 'passed',
  uploadedAt: '2026-11-13T05:00:00.000Z',
} as const;
const STATE: OrgChartSampleState = { current: FILE, latest: { ...FILE, scanState: 'pending' } };
const UPLOAD: OrgChartSampleUpload = { upload: { ...FILE, scanState: 'pending' } };

const samples = {
  state: vi.fn(async () => structuredClone(STATE)),
  upload: vi.fn(async () => structuredClone(UPLOAD)),
};
const services = Object.values(samples);

const sampleForm = (name = 'Құрылым үлгісі.pdf', bytes = fixture('sample.pdf')) => {
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

  it('маршрут — /api/v1/org-chart-sample; просмотр — администратор и директор, загрузка — только администратор (раздел 4)', () => {
    expect(ORG_CHART_SAMPLE_ROUTES.sample).toBe('/api/v1/org-chart-sample');
    expect(allowed('reference.read')).toEqual(['administrator', 'director']);
    expect(allowed('reference.manage')).toEqual(['administrator']);
  });

  it.each(ROUTES.flatMap((route) => allowed(route.action).map((role) => [route.method, role, route] as const)))(
    '%s: разрешённая роль — сервис вызван (%s)',
    async (_method, role, route) => {
      const res = await request(route, role);
      expect(res.status).toBe(route.status);
      expect(await res.json()).toEqual(route.response);
      expect(route.service).toHaveBeenCalledOnce();
      if (route.method === 'POST')
        expect(samples.upload).toHaveBeenCalledWith(
          expect.objectContaining({ role, id: '00000000-0000-4000-8000-0000000000a2' }),
          expect.objectContaining({
            originalName: 'Құрылым үлгісі.pdf',
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

  it.each(ROUTES.map((route) => [route.method, route] as const))('%s: без сеанса — 401', async (_method, route) => {
    const res = await request(route);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ status: 401, code: 'unauthenticated' });
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
});

describe('коды ошибок образца оргструктуры — из FILE_PROBLEM_CODES', () => {
  // Ошибки маршрутов образца приходят из загрузки, FilesService, actorTransaction и SessionGuard (их коды сверяет
  // upload.http.test.ts); экран переводит их по одному списку FILE_PROBLEM_CODES.
  const SOURCES = [
    '../src/modules/files/org-chart-sample.service.ts',
    '../src/modules/files/org-chart-sample.controller.ts',
  ];
  const UPLOAD_ERRORS = [
    'file_missing',
    'file_empty',
    'validation',
    'file_too_large',
    'file_type_not_allowed',
    'file_type_mismatch',
    'busy',
    'storage_unavailable',
    'forbidden',
    'bad_origin',
    'unauthenticated',
  ];

  it('ошибки загрузки образца и коды ProblemException его сервиса и контроллера есть в FILE_PROBLEM_CODES', () => {
    for (const code of UPLOAD_ERRORS) expect(FILE_PROBLEM_CODES).toContain(code);
    for (const source of SOURCES) {
      const text = readFileSync(new URL(source, import.meta.url), 'utf8');
      for (const match of text.matchAll(/new ProblemException\(\s*\d+,\s*'([a-z_]+)'/g))
        expect(FILE_PROBLEM_CODES, source).toContain(match[1]);
    }
  });
});
