import { readFileSync } from 'node:fs';
import {
  type Action,
  can,
  type DictionaryChoicesPage,
  type DictionaryEntriesPage,
  type DictionaryEntryResult,
  type DictionaryList,
  REFERENCE_PROBLEM_CODES,
  ROLES,
} from '@imbc/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { DictionariesController } from '../src/modules/dictionaries/dictionaries.controller.js';
import { DICTIONARY_ROUTES, DictionariesService } from '../src/modules/dictionaries/dictionaries.service.js';
import { type HttpStand, startHttp } from './support/http.js';

// Граница HTTP справочников: настоящий SessionGuard; права — из матрицы: reference.read, reference.manage (GEN-08).
const ENTRY_ID = '00000000-0000-4000-8000-000000000021';
const NAMES = { kk: 'Жылқылар', ru: 'Лошади', en: 'Horses' };

const SUMMARY = {
  code: 'tn_ved',
  closed: false,
  mandatoryApplicable: false,
  parentDictionary: null,
  active: 1,
  retired: 0,
} as const;
const ENTRY: DictionaryEntryResult = {
  entry: {
    id: ENTRY_ID,
    code: '0101210000',
    parentCode: null,
    names: NAMES,
    mandatory: null,
    customNameAllowed: false,
    sortOrder: 0,
    retiredAt: null,
  },
};
const LIST: DictionaryList = { dictionaries: [SUMMARY] };
const PAGE: DictionaryEntriesPage = { dictionary: SUMMARY, items: [ENTRY.entry], total: 1, page: 1, pageSize: 50 };
const CHOICES: DictionaryChoicesPage = {
  items: [{ id: ENTRY_ID, code: '0101210000', name: 'Жылқылар', parentCode: null }],
  total: 1,
  page: 1,
  pageSize: 50,
};

const dictionaries = {
  list: vi.fn(async () => structuredClone(LIST)),
  entries: vi.fn(async () => structuredClone(PAGE)),
  choices: vi.fn(async () => structuredClone(CHOICES)),
  create: vi.fn(async () => structuredClone(ENTRY)),
  update: vi.fn(async () => structuredClone(ENTRY)),
  setMandatory: vi.fn(async () => structuredClone(ENTRY)),
  retire: vi.fn(async () => structuredClone(ENTRY)),
  restore: vi.fn(async () => structuredClone(ENTRY)),
  remove: vi.fn(async () => undefined),
};
const services = Object.values(dictionaries);

interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  /** Путь маршрута, как его пишет в аудит SessionGuard (`req.route.path`). */
  template: string;
  action: Action;
  body?: unknown;
  /** Тело или query, которые схема отклоняет (400 validation). */
  invalid?: { path?: string; body?: unknown };
  status: number;
  /** Тело ответа; у 204 его нет. */
  response?: unknown;
  service: Mock;
  /** Аргументы сервиса: у изменяющих — после исполнителя и до IP. */
  args: unknown[];
  /** Изменяющий маршрут: сервис получает исполнителя и IP. */
  mutation: boolean;
}

const ENTRY_PATH = `/api/v1/dictionaries/tn_ved/entries/${ENTRY_ID}`;

const ROUTES: Route[] = [
  {
    method: 'GET',
    path: '/api/v1/dictionaries',
    template: DICTIONARY_ROUTES.list,
    action: 'reference.read',
    status: 200,
    response: LIST,
    service: dictionaries.list,
    args: [],
    mutation: false,
  },
  {
    method: 'GET',
    path: '/api/v1/dictionaries/tn_ved/entries?q=%200101%20&status=all&page=2&pageSize=10',
    template: DICTIONARY_ROUTES.entries,
    action: 'reference.read',
    invalid: { path: '/api/v1/dictionaries/tn_ved/entries?pageSize=5' },
    status: 200,
    response: PAGE,
    service: dictionaries.entries,
    args: ['tn_ved', { q: '0101', status: 'all', page: 2, pageSize: 10 }],
    mutation: false,
  },
  {
    method: 'POST',
    path: '/api/v1/dictionaries/tn_ved/entries',
    template: DICTIONARY_ROUTES.entries,
    action: 'reference.manage',
    body: { code: ' 0101210000 ', names: NAMES },
    invalid: { body: { code: 101210000, names: NAMES } },
    status: 201,
    response: ENTRY,
    service: dictionaries.create,
    args: ['tn_ved', { code: '0101210000', parentCode: null, names: NAMES }],
    mutation: true,
  },
  {
    method: 'PUT',
    path: ENTRY_PATH,
    template: DICTIONARY_ROUTES.entry,
    action: 'reference.manage',
    body: { names: NAMES, sortOrder: 4 },
    invalid: { body: { names: { ru: 'Лошади' }, sortOrder: 4 } },
    status: 200,
    response: ENTRY,
    service: dictionaries.update,
    args: ['tn_ved', ENTRY_ID, { names: NAMES, sortOrder: 4, parentCode: null }],
    mutation: true,
  },
  {
    method: 'PUT',
    path: `${ENTRY_PATH}/mandatory`,
    template: DICTIONARY_ROUTES.mandatory,
    action: 'reference.manage',
    body: { mandatory: true },
    invalid: { body: { mandatory: 'yes' } },
    status: 200,
    response: ENTRY,
    service: dictionaries.setMandatory,
    args: ['tn_ved', ENTRY_ID, true],
    mutation: true,
  },
  {
    method: 'POST',
    path: `${ENTRY_PATH}/retire`,
    template: DICTIONARY_ROUTES.retire,
    action: 'reference.manage',
    status: 200,
    response: ENTRY,
    service: dictionaries.retire,
    args: ['tn_ved', ENTRY_ID],
    mutation: true,
  },
  {
    method: 'POST',
    path: `${ENTRY_PATH}/restore`,
    template: DICTIONARY_ROUTES.restore,
    action: 'reference.manage',
    status: 200,
    response: ENTRY,
    service: dictionaries.restore,
    args: ['tn_ved', ENTRY_ID],
    mutation: true,
  },
  {
    method: 'DELETE',
    path: ENTRY_PATH,
    template: DICTIONARY_ROUTES.entry,
    action: 'reference.manage',
    status: 204,
    service: dictionaries.remove,
    args: ['tn_ved', ENTRY_ID],
    mutation: true,
  },
];

const allowed = (action: Action) => ROLES.filter((role) => can(role, action));
const denied = (action: Action) => ROLES.filter((role) => !can(role, action));

describe('справочники: список, значения, выбор и действия администратора (ADM-08, ADM-09, DATA-04, GEN-08)', () => {
  let http: HttpStand;

  const request = (route: Route, role?: string, body: unknown = route.body, path = route.path) =>
    route.method === 'GET' ? http.get(path, role as never) : http.send(route.method, path, role as never, body);

  beforeAll(async () => {
    http = await startHttp({
      controllers: [DictionariesController],
      providers: [{ provide: DictionariesService, useValue: dictionaries }],
    });
  });

  beforeEach(() => {
    for (const service of services) service.mockClear();
    http.audit.record.mockClear();
  });

  afterAll(async () => {
    await http?.close();
  });

  it('матрица: reference.read — администратор и директор, reference.manage — только администратор (раздел 4, «Reference lists»)', () => {
    expect(allowed('reference.read')).toEqual(['administrator', 'director']);
    expect(allowed('reference.manage')).toEqual(['administrator']);
  });

  it.each(
    ROUTES.flatMap((route) => allowed(route.action).map((role) => [route.method, route.path, role, route] as const)),
  )('%s %s: разрешённая роль — сервис вызван (%s)', async (_method, _path, role, route) => {
    const res = await request(route, role);
    expect(res.status).toBe(route.status);
    if (route.response === undefined) expect(await res.text()).toBe('');
    else expect(await res.json()).toEqual(route.response);
    expect(route.service).toHaveBeenCalledOnce();
    if (route.mutation)
      expect(route.service).toHaveBeenCalledWith(
        expect.objectContaining({ role, id: '00000000-0000-4000-8000-0000000000a2' }),
        ...route.args,
        expect.any(String),
      );
    else expect(route.service).toHaveBeenCalledWith(...route.args);
    expect(http.audit.record).not.toHaveBeenCalled();
  });

  it.each(
    ROUTES.flatMap((route) => denied(route.action).map((role) => [route.method, route.path, role, route] as const)),
  )(
    '%s %s: %s — 403, outcome denied и action в аудите, сервис не вызван (GEN-08)',
    async (_method, _path, role, route) => {
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
          // Тот же объект пишет отказ в транзакции действия (actorTransaction): DICTIONARY_ROUTES.
          objectType: 'route',
          objectId: route.template,
        }),
      );
      for (const service of services) expect(service).not.toHaveBeenCalled();
    },
  );

  it.each(ROUTES.map((route) => [route.method, route.path, route] as const))(
    '%s %s: без сеанса — 401',
    async (_method, _path, route) => {
      const res = await request(route);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ status: 401, code: 'unauthenticated' });
      for (const service of services) expect(service).not.toHaveBeenCalled();
    },
  );

  it.each(ROUTES.filter((route) => route.mutation).map((route) => [route.method, route.path, route] as const))(
    '%s %s: чужой Origin — 403 bad_origin',
    async (method, path, route) => {
      const res = await fetch(`${http.base}${path}`, {
        method,
        headers: {
          origin: 'https://evil.example',
          'content-type': 'application/json',
          cookie: 'imbc-session=administrator',
        },
        body: route.body === undefined ? undefined : JSON.stringify(route.body),
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ status: 403, code: 'bad_origin' });
      for (const service of services) expect(service).not.toHaveBeenCalled();
    },
  );

  it.each(
    ROUTES.filter((route) => route.invalid !== undefined).map((route) => [route.method, route.path, route] as const),
  )('%s %s: неверное тело или query — 400 validation, сервис не вызван', async (_method, _path, route) => {
    const res = await request(route, 'administrator', route.invalid!.body, route.invalid!.path ?? route.path);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ status: 400, code: 'validation' });
    for (const service of services) expect(service).not.toHaveBeenCalled();
  });

  it.each(ROLES)('choices: %s — 200, право матрицы не нужно (расхождение 3 плана этапа 2)', async (role) => {
    const res = await http.get('/api/v1/dictionaries/tn_ved/choices?q=0101&lang=ru', role);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(CHOICES);
    expect(dictionaries.choices).toHaveBeenCalledWith('tn_ved', { q: '0101', lang: 'ru', page: 1, pageSize: 50 });
    expect(http.audit.record).not.toHaveBeenCalled();
  });

  it('choices: без сеанса — 401; неизвестный язык — 400 validation', async () => {
    const anonymous = await http.get('/api/v1/dictionaries/tn_ved/choices');
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ status: 401, code: 'unauthenticated' });
    const bad = await http.get('/api/v1/dictionaries/tn_ved/choices?lang=de', 'manufacturer');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ status: 400, code: 'validation' });
    expect(dictionaries.choices).not.toHaveBeenCalled();
  });
});

describe('коды ошибок маршрутов справочников — контракт (REFERENCE_PROBLEM_CODES)', () => {
  // Сервис, контроллер, транзакция исполнителя и guard, через которые проходят маршруты справочников.
  const SOURCES = [
    '../src/modules/dictionaries/dictionaries.service.ts',
    '../src/modules/dictionaries/dictionaries.controller.ts',
    '../src/modules/dictionaries/usage.ts',
    '../src/common/actor-transaction.ts',
    '../src/modules/auth/guards.ts',
  ];

  it('каждый код ProblemException этих файлов есть в списке, и каждый код списка встречается', () => {
    const thrown = new Set<string>();
    for (const source of SOURCES) {
      const text = readFileSync(new URL(source, import.meta.url), 'utf8');
      for (const match of text.matchAll(/new ProblemException\(\s*\d+,\s*'([a-z_]+)'/g)) thrown.add(match[1]!);
    }
    // validation — ZodError схемы (ProblemDetailsFilter), internal — непредвиденная ошибка (500).
    const expected = new Set<string>([...thrown, 'validation', 'internal']);
    expect([...expected].sort()).toEqual([...REFERENCE_PROBLEM_CODES].sort());
  });
});
