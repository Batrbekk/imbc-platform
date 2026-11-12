import { connect } from 'node:net';
import { PROTOTYPE_STATE_MAX_BYTES, ROLES, type Role } from '@imbc/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { loadEnv } from '../src/config/env.js';
import { PrototypeController } from '../src/modules/prototype/prototype.controller.js';
import { PrototypeModule } from '../src/modules/prototype/prototype.module.js';
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

/**
 * PUT через сокет: заголовки и начало тела, остальное не отправляется. Ответ приходит, не дожидаясь
 * тела: ждём полный ответ (по content-length), а не всё тело запроса.
 */
function rawPut(stand: HttpStand, headers: Record<string, string>, chunks: string[]) {
  const { hostname, port } = new URL(stand.base);
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const socket = connect(Number(port), hostname, () => {
      const head = Object.entries({ host: `${hostname}:${port}`, ...headers })
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n');
      socket.write(`PUT ${PATH} HTTP/1.1\r\n${head}\r\n\r\n`);
      for (const chunk of chunks) socket.write(chunk);
    });
    let raw = '';
    socket.setEncoding('utf8');
    socket.on('data', (data: string) => {
      raw += data;
      const split = raw.indexOf('\r\n\r\n');
      if (split < 0) return;
      const head = raw.slice(0, split);
      const length = Number(/content-length: (\d+)/i.exec(head)?.[1]);
      const body = raw.slice(split + 4);
      if (Buffer.byteLength(body) < length) return;
      socket.destroy();
      resolve({
        status: Number(/^HTTP\/1\.1 (\d+)/.exec(head)?.[1]),
        body: JSON.parse(body) as Record<string, unknown>,
      });
    });
    socket.on('error', () => undefined);
    socket.on('close', () => reject(new Error(`соединение закрыто без ответа: ${raw.slice(0, 80)}`)));
    socket.setTimeout(10_000, () => socket.destroy(new Error('сервер ждёт тело')));
  });
}

/** Сколько байт тела удаётся отправить, пока сервер не закроет соединение после отказа. */
function bytesAcceptedAfterRefusal(stand: HttpStand, headers: Record<string, string>) {
  const { hostname, port } = new URL(stand.base);
  return new Promise<number>((resolve) => {
    let written = 0;
    const piece = Buffer.alloc(64 * 1024, 'x');
    const socket = connect(Number(port), hostname, () => {
      const head = Object.entries({ host: `${hostname}:${port}`, ...headers })
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n');
      socket.write(`PUT ${PATH} HTTP/1.1\r\n${head}\r\n\r\n`);
      const pump = () => {
        while (!socket.destroyed && written < 100_000_000) {
          written += piece.length;
          if (!socket.write(piece)) return void socket.once('drain', pump);
        }
      };
      pump();
    });
    socket.on('error', () => undefined);
    socket.on('close', () => resolve(written));
  });
}

const putHeaders = { 'content-type': 'application/json', origin: ORIGIN, cookie: 'imbc-session=expert' };

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

  it('content-length больше 2 МБ — 400 problem+json сразу, тело не читается', async () => {
    const res = await rawPut(
      http,
      {
        'content-type': 'application/json',
        origin: ORIGIN,
        cookie: 'imbc-session=expert',
        'content-length': '3000000',
      },
      ['{"baseVersion":0,'],
    );
    expect(res).toMatchObject({ status: 400, body: { status: 400, code: 'body_too_large', instance: PATH } });
    expect(memory.state).toBeNull();
  });

  it.each([
    ['не JSON', '{not json'],
    ['нет baseVersion', { state: { version: 1 } }],
    ['отрицательная версия', { baseVersion: -1, state: { version: 1 } }],
    ['state не объект', { baseVersion: 0, state: [1, 2] }],
    ['state без числовой версии схемы', { baseVersion: 0, state: { version: '1' } }],
    ['версия схемы 0', { baseVersion: 0, state: { version: 0 } }],
    ['версия схемы больше 1000', { baseVersion: 0, state: { version: 1001 } }],
    ['дробная версия схемы', { baseVersion: 0, state: { version: 1.5 } }],
    ['отрицательная версия схемы', { baseVersion: 0, state: { version: -1 } }],
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

  it('без cookie сеанса — 401 как у guard сразу, тело не читается', async () => {
    const res = await rawPut(
      http,
      { 'content-type': 'application/json', origin: ORIGIN, 'content-length': '3000000' },
      ['{"baseVersion":0,'],
    );
    expect(res).toMatchObject({ status: 401, body: { status: 401, code: 'unauthenticated', instance: PATH } });
    expect(memory.state).toBeNull();
  });

  it('после отказа остаток большого тела не дочитывается: соединение закрывается', async () => {
    const written = await bytesAcceptedAfterRefusal(http, {
      'content-type': 'application/json',
      origin: ORIGIN,
      cookie: 'imbc-session=expert',
      'content-length': '100000000',
    });
    // Из объявленных 100 МБ сервер принимает не больше запаса на отказ (плюс буферы сокетов).
    expect(written).toBeLessThan(20_000_000);
  });

  it('тело по частям больше 2 МБ — 400 после предела, остаток не дочитывается', async () => {
    const piece = 'x'.repeat(256 * 1024);
    const chunked = (text: string) => `${text.length.toString(16)}\r\n${text}\r\n`;
    const res = await rawPut(
      http,
      {
        'content-type': 'application/json',
        origin: ORIGIN,
        cookie: 'imbc-session=expert',
        'transfer-encoding': 'chunked',
      },
      [chunked('{"baseVersion":0,"state":{"version":1,"blob":"'), ...Array.from({ length: 9 }, () => chunked(piece))],
    );
    expect(res).toMatchObject({ status: 400, body: { code: 'body_too_large' } });
    expect(memory.state).toBeNull();
  });

  it.each(['DELETE', 'OPTIONS', 'POST'])('%s на адресе — обычный ответ на неизвестный маршрут', async (method) => {
    const res = await fetch(`${http.base}${PATH}`, {
      method,
      headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: 'imbc-session=expert' },
      body: method === 'OPTIONS' ? undefined : JSON.stringify({ baseVersion: 0, state: { version: 1 } }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'http_404', title: `Cannot ${method} ${PATH}` });
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
    // Как AppModule.register({ prototypeCabinets: false }): модуля прототипа нет, флаг в configureHttp выключен.
    http = await startHttp({ controllers: [], providers });
  });

  afterAll(async () => {
    await http?.close();
  });

  it('модуль прототипа подключается только при флаге', () => {
    expect(AppModule.register({ prototypeCabinets: false }).imports ?? []).not.toContain(PrototypeModule);
    expect(AppModule.register({ prototypeCabinets: true }).imports).toContain(PrototypeModule);
  });

  /** Тот же запрос на адрес прототипа и на неизвестный адрес: ответы совпадают, кроме адреса в теле. */
  async function compare(send: (path: string) => Promise<Response>) {
    const unknownPath = '/api/v1/prototype/nothing';
    const unknown = await send(unknownPath);
    const res = await send(PATH);
    expect(res.status).toBe(unknown.status);
    expect(res.headers.get('content-type')).toBe(unknown.headers.get('content-type'));
    const text = (await res.text()).replaceAll(PATH, '<path>');
    expect(text).toBe((await unknown.text()).replaceAll(unknownPath, '<path>'));
    return res.status;
  }

  it('адреса нет: 404 как у неизвестного адреса, и с сеансом, и без', async () => {
    for (const role of ['expert', undefined] as const) {
      expect(await compare((path) => http.get(path, role))).toBe(404);
    }
    const body = JSON.stringify({ baseVersion: 0, state: { version: 1 } });
    expect(await compare((path) => fetch(`${http.base}${path}`, { method: 'PUT', headers: putHeaders, body }))).toBe(
      404,
    );
    expect(memory.state).toBeNull();
  });

  it('неверный JSON и тело больше общего предела — как у неизвестного адреса', async () => {
    expect(
      await compare((path) => fetch(`${http.base}${path}`, { method: 'PUT', headers: putHeaders, body: '{not json' })),
    ).toBe(400);
    const big = JSON.stringify({ baseVersion: 0, state: { version: 1, blob: 'x'.repeat(500_000) } });
    expect(
      await compare((path) => fetch(`${http.base}${path}`, { method: 'PUT', headers: putHeaders, body: big })),
    ).toBe(413);
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
