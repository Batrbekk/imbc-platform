import { PROTOTYPE_STATE_MAX_BYTES, ROLES, type Role } from '@imbc/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { PrototypeController } from '../src/modules/prototype/prototype.controller.js';
import { PrototypeService } from '../src/modules/prototype/prototype.service.js';
import { type HttpStand, startHttp } from './support/http.js';

// Граница HTTP общего состояния прототипа: любой вошедший пользователь, любая роль; флаг выключен — маршрутов нет.
const PATH = '/api/v1/prototype/state';
const ORIGIN = 'https://imbc.example.kz';

/** Заглушка сервиса: документ в памяти с той же семантикой версии, что у таблицы. */
const memory = { version: 0, state: null as object | null };
const service = {
  read: async () => ({ ...memory }),
  write: async (baseVersion: number, state: object) => {
    if (baseVersion !== memory.version) return { ok: false as const, ...memory };
    memory.version += 1;
    memory.state = state;
    return { ok: true as const, version: memory.version };
  },
};
const providers = [{ provide: PrototypeService, useValue: service }];

function put(stand: HttpStand, body: unknown, role?: Role, headers: Record<string, string> = {}) {
  return fetch(`${stand.base}${PATH}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(role ? { cookie: `imbc-session=${role}` } : {}),
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('/api/v1/prototype/state при PROTOTYPE_CABINETS=true', () => {
  let http: HttpStand;

  beforeAll(async () => {
    http = await startHttp({ controllers: [PrototypeController], providers, env: { PROTOTYPE_CABINETS: true } });
  });

  beforeEach(() => {
    memory.version = 0;
    memory.state = null;
  });

  afterAll(async () => {
    await http?.close();
  });

  it('без сеанса — 401 на чтение и запись', async () => {
    expect((await http.get(PATH)).status).toBe(401);
    const res = await put(http, { baseVersion: 0, state: { version: 1 } });
    expect(res.status).toBe(401);
    expect(memory.state).toBeNull();
  });

  it('пустой сервер — версия 0 и state null, ответ no-store', async () => {
    const res = await http.get(PATH, 'observer');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ version: 0, state: null });
  });

  it.each(ROLES)('%s читает и пишет документ', async (role) => {
    const first = await put(http, { baseVersion: 0, state: { version: 1, by: role } }, role);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(await first.json()).toEqual({ version: 1 });

    const read = await http.get(PATH, role);
    expect(await read.json()).toEqual({ version: 1, state: { version: 1, by: role } });
  });

  it('устаревшая версия — 409 problem+json с текущими версией и документом', async () => {
    await put(http, { baseVersion: 0, state: { version: 1, n: 1 } }, 'operator');
    const res = await put(http, { baseVersion: 0, state: { version: 1, n: 2 } }, 'manufacturer');
    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ code: 'version_conflict', version: 1, state: { version: 1, n: 1 } });
    expect(memory.state).toEqual({ version: 1, n: 1 });
  });

  it('документ около 1,5 МБ принимается', async () => {
    const big = { version: 1, blob: 'x'.repeat(1_500_000) };
    const res = await put(http, { baseVersion: 0, state: big }, 'expert');
    expect(res.status).toBe(200);
    expect(memory.state).toEqual(big);
  });

  it('тело больше 2 МБ — 400 problem+json, документ не изменён', async () => {
    const res = await put(
      http,
      { baseVersion: 0, state: { version: 1, blob: 'x'.repeat(PROTOTYPE_STATE_MAX_BYTES) } },
      'expert',
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ status: 400, code: 'body_too_large' });
    expect(memory.state).toBeNull();
  });

  it.each([
    ['не JSON', '{not json'],
    ['нет baseVersion', { state: { version: 1 } }],
    ['отрицательная версия', { baseVersion: -1, state: { version: 1 } }],
    ['state не объект', { baseVersion: 0, state: [1, 2] }],
    ['state без числовой версии схемы', { baseVersion: 0, state: { version: '1' } }],
    ['лишнее поле', { baseVersion: 0, state: { version: 1 }, extra: true }],
  ])('%s — 400 problem+json', async (_, body) => {
    const res = await put(http, body, 'administrator');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(memory.state).toBeNull();
  });

  it('тело не JSON по типу — 400', async () => {
    const res = await put(http, '{"baseVersion":0,"state":{"version":1}}', 'administrator', {
      'content-type': 'text/plain',
    });
    expect(res.status).toBe(400);
    expect(memory.state).toBeNull();
  });

  it('запись с чужого origin — 403 (CSRF, как у других изменяющих запросов)', async () => {
    const res = await put(http, { baseVersion: 0, state: { version: 1 } }, 'director', {
      origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
    expect(memory.state).toBeNull();
  });

  it('предел 2 МБ только у этого маршрута: у других маршрутов остаётся общий', async () => {
    const res = await fetch(`${http.base}/api/v1/prototype/other`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: 'imbc-session=expert' },
      body: JSON.stringify({ blob: 'x'.repeat(500_000) }),
    });
    expect(res.status).toBe(413);
  });
});

describe('/api/v1/prototype/state при выключенном флаге', () => {
  let http: HttpStand;

  beforeAll(async () => {
    http = await startHttp({ controllers: [PrototypeController], providers });
  });

  afterAll(async () => {
    await http?.close();
  });

  it('маршрутов нет: 404 как у неизвестного адреса, и с сеансом, и без', async () => {
    const unknown = await http.get('/api/v1/prototype/nothing', 'expert');
    expect(unknown.status).toBe(404);
    const unknownBody = (await unknown.json()) as Record<string, unknown>;

    for (const role of ['expert', undefined] as const) {
      const res = await http.get(PATH, role);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
      expect(await res.json()).toEqual({ ...unknownBody, instance: PATH, title: `Cannot GET ${PATH}` });
    }
    const write = await put(http, { baseVersion: 0, state: { version: 1 } }, 'expert');
    expect(write.status).toBe(404);
    expect(memory.state).toBeNull();
  });
});

describe('PROTOTYPE_CABINETS в окружении API', () => {
  const source: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://imbc.example',
    DATABASE_URL: 'postgresql://unused',
    S3_ENDPOINT: 'http://storage:9000',
    S3_ACCESS_KEY: 'unused',
    S3_SECRET_KEY: 'unused',
    OIDC_ISSUER: 'https://imbc.example/kc/realms/imbc',
    OIDC_CLIENT_SECRET: 'unused',
    KEYCLOAK_ADMIN_CLIENT_SECRET: 'unused',
    SESSION_SECRET: 'test-only-session-secret-with-32-characters',
  };

  it('по умолчанию выключен', () => {
    expect(loadEnv(source).PROTOTYPE_CABINETS).toBe(false);
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('%s → %s', (value, expected) => {
    expect(loadEnv({ ...source, PROTOTYPE_CABINETS: value }).PROTOTYPE_CABINETS).toBe(expected);
  });

  it('другое значение останавливает старт', () => {
    expect(() => loadEnv({ ...source, PROTOTYPE_CABINETS: 'yes' })).toThrow('Некорректная конфигурация окружения');
  });
});
