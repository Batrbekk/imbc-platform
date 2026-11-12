import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { inspect } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AdataCallError,
  AdataClient,
  type AdataTiming,
  pollCompanyInfo,
  redactToken,
} from '../src/modules/adata/adata.client.js';
import { ADATA_FIXTURE, type AdataScenario, type AdataStub, startAdataStub } from './support/adata-stub.js';

// Токен — случайная строка теста; «/», «+» и «=» проверяют кодирование сегмента пути.
const TOKEN = `${randomBytes(18).toString('base64url')}/+=`;
const TIMING: AdataTiming = { firstPollDelayMs: 0, pollIntervalMs: 5, deadlineMs: 60, requestTimeoutMs: 50 };

let stub: AdataStub;
let client: AdataClient;
let bins = 0;
/** Новый вымышленный БИН на тест: у заглушки токен проверки и счётчик опросов — на БИН. */
const nextBin = () => `9901${String(++bins).padStart(8, '0')}`;

beforeAll(async () => {
  stub = await startAdataStub({ token: TOKEN });
  client = new AdataClient({ baseUrl: stub.baseUrl, token: TOKEN, requestTimeoutMs: TIMING.requestTimeoutMs });
});
afterAll(() => stub.close());
beforeEach(() => {
  stub.requests.length = 0;
});

// Своя пауза теста: нижняя граница шага опроса (100 мс) реальным часам теста не нужна.
const fastSleep = (ms: number) => delay(Math.min(ms, 5)).then(() => undefined);
/** Срок с запасом для ожидаемого ответа (паузы — fastSleep); тесты срока передают короткий явно. */
const GENEROUS_DEADLINE_MS = 10_000;
const poll = (pollToken: string, deadlineMs = GENEROUS_DEADLINE_MS) =>
  pollCompanyInfo(client, pollToken, { deadlineAt: Date.now() + deadlineMs, timing: TIMING, sleep: fastSleep });

async function caught(run: () => Promise<unknown>): Promise<AdataCallError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AdataCallError);
    return error as AdataCallError;
  }
  throw new Error('expected AdataCallError');
}

/**
 * Ни один вид текста ошибки не содержит токена, адреса и пути Adata (EXT-02, NFR-10). Сообщения
 * проверок называют место, но не печатают найденный текст: вывод теста тоже не должен нести токен.
 */
function expectLeakFree(error: AdataCallError, baseUrl: string) {
  const forbidden = [TOKEN, encodeURIComponent(TOKEN), '/api/company/info/', baseUrl, new URL(baseUrl).host];
  expect(Object.hasOwn(error, 'cause'), 'cause').toBe(false);
  expect(error.cause, 'cause').toBeUndefined();
  expect(
    Reflect.ownKeys(error).every((k) => ['stack', 'message', 'failure', 'httpStatus', 'name'].includes(String(k))),
    'лишнее собственное свойство',
  ).toBe(true);
  expect(error.message).toMatch(/^adata [a-z_0-9]+( \d{3})?$/);

  const texts: Array<[string, string]> = [
    ['message', error.message],
    ['stack', String(error.stack)],
    ['String', String(error)],
    ['JSON', JSON.stringify(error)],
    ['inspect', inspect(error, { depth: 5, showHidden: true })],
  ];
  for (const key of Reflect.ownKeys(error)) {
    const value: unknown = Reflect.get(error, key);
    texts.push([`${String(key)} String`, String(value)]);
    texts.push([`${String(key)} JSON`, JSON.stringify(value) ?? '']);
    texts.push([`${String(key)} inspect`, inspect(value, { depth: 5, showHidden: true })]);
  }
  for (const [place, text] of texts)
    for (const [index, needle] of forbidden.entries())
      expect(text.includes(needle), `${place} содержит запрещённую строку №${index}`).toBe(false);
}

describe('AdataClient: два шага с опросом (EXT-02, IMBC-07)', () => {
  it('ошибка клиента без URL и без cause (EXT-02, NFR-10)', async () => {
    // fetch отклоняется так, как это делает undici: cause несёт полный адрес с токеном.
    const rejecting: typeof fetch = (input) =>
      Promise.reject(new TypeError('fetch failed', { cause: new Error(`connect ECONNREFUSED ${String(input)}`) }));
    const timingOut: typeof fetch = (input) => {
      const error = new DOMException(`The operation was aborted: ${String(input)}`, 'TimeoutError');
      return Promise.reject(Object.assign(error, { cause: new Error(String(input)) }));
    };
    const throwing: typeof fetch = (input) => {
      throw new Error(`sync ${String(input)}`, { cause: input });
    };
    for (const [fake, failure] of [
      [rejecting, 'network'],
      [timingOut, 'timeout'],
      [throwing, 'network'],
    ] as const) {
      const c = new AdataClient({ baseUrl: stub.baseUrl, token: TOKEN, requestTimeoutMs: 50, fetch: fake });
      const start = await caught(() => c.startCompanyInfo(nextBin()));
      expect(start.failure).toBe(failure);
      expectLeakFree(start, stub.baseUrl);
      const check = await caught(() => c.checkCompanyInfo('0000020991'));
      expect(check.failure).toBe(failure);
      expectLeakFree(check, stub.baseUrl);
    }
    // Тело ответа, в котором fetch-подмена вернула адрес с токеном, тоже не выходит наружу.
    const echoing: typeof fetch = async (input) =>
      new Response(`<html>${String(input)}</html>`, { status: 502, headers: { 'content-type': 'text/html' } });
    const c = new AdataClient({ baseUrl: stub.baseUrl, token: TOKEN, requestTimeoutMs: 50, fetch: echoing });
    expectLeakFree(await caught(() => c.startCompanyInfo(nextBin())), stub.baseUrl);

    // Каждый сбой заглушки на обоих шагах, включая echo_url: тело 500 содержит путь с токеном.
    const scenarios: AdataScenario[] = [
      { kind: 'start_error', status: 500 },
      { kind: 'start_error', status: 400 },
      { kind: 'start_error', status: 403 },
      ...(['start', 'check'] as const).flatMap((on): AdataScenario[] => [
        { kind: 'echo_url', on },
        { kind: 'malformed', on },
        { kind: 'hang_up', on },
        { kind: 'silent', on },
      ]),
      { kind: 'check_flaky', failures: 1 },
    ];
    for (const s of scenarios) {
      const bin = nextBin();
      stub.scenario(bin, s);
      const error = await caught(async () => {
        const { pollToken } = await client.startCompanyInfo(bin);
        await client.checkCompanyInfo(pollToken);
      });
      expectLeakFree(error, stub.baseUrl);
    }
    // Неизвестный токен проверки — 400.
    expectLeakFree(await caught(() => client.checkCompanyInfo('0000000000')), stub.baseUrl);
    // Неверный токен авторизации — 401 заглушки.
    const wrong = new AdataClient({ baseUrl: stub.baseUrl, token: 'x', requestTimeoutMs: 50 });
    expectLeakFree(await caught(() => wrong.startCompanyInfo(nextBin())), stub.baseUrl);
  });

  it('переадресация не уходит ни на другой сервер, ни по относительному адресу — network (EXT-02)', async () => {
    let elsewhere = 0;
    const other = createServer((_req, res) => {
      elsewhere += 1;
      res.end('{}');
    });
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
    try {
      const otherUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}/collect`;
      for (const location of [otherUrl, '/elsewhere'])
        for (const on of ['start', 'check'] as const) {
          const bin = nextBin();
          stub.scenario(bin, { kind: 'redirect', location, on });
          stub.requests.length = 0;
          const error = await caught(async () => {
            const { pollToken } = await client.startCompanyInfo(bin);
            await client.checkCompanyInfo(pollToken);
          });
          expect([error.failure, error.httpStatus]).toEqual(['network', null]);
          expectLeakFree(error, stub.baseUrl);
          expect(stub.requests.map((r) => r.kind)).toEqual(on === 'start' ? ['start'] : ['start', 'check']);
        }
      expect(elsewhere).toBe(0);
    } finally {
      other.closeAllConnections();
      await new Promise((resolve) => other.close(resolve));
    }
  });

  it('клиент не раскрывает токен и адрес: inspect и JSON (EXT-02, NFR-10)', () => {
    const texts = [inspect(client, { showHidden: true, depth: 6 }), JSON.stringify(client)];
    for (const [index, text] of texts.entries())
      for (const [n, needle] of [
        TOKEN,
        encodeURIComponent(TOKEN),
        stub.baseUrl,
        new URL(stub.baseUrl).host,
        '/api/company/info/',
      ].entries())
        expect(text.includes(needle), `представление №${index} содержит запрещённую строку №${n}`).toBe(false);
  });

  it('под тестовым раннером адрес api.adata.kz не принимается', () => {
    for (const baseUrl of [
      'https://api.adata.kz',
      'https://adata.kz/',
      'https://x.api.ADATA.kz:443',
      // Точка в конце — тот же хост в DNS.
      'https://api.adata.kz.',
      'https://adata.kz.',
    ]) {
      let error: unknown;
      try {
        new AdataClient({ baseUrl, token: TOKEN, requestTimeoutMs: 50 });
      } catch (e) {
        error = e;
      }
      expect(error, baseUrl).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AdataCallError);
      const text = `${String(error)}\n${(error as Error).stack}\n${inspect(error, { showHidden: true })}`;
      expect(text.includes(TOKEN) || text.includes(encodeURIComponent(TOKEN)), 'ошибка содержит токен').toBe(false);
    }
    // Похожий, но чужой домен — не Adata.
    expect(() => new AdataClient({ baseUrl: 'https://notadata.kz', token: TOKEN, requestTimeoutMs: 50 })).not.toThrow();
  });

  it('тело больше 5 МБ — malformed: по content-length и по потоку', async () => {
    const MB5 = 5 * 1024 * 1024;
    let pulled = 0;
    const declared: typeof fetch = async () =>
      new Response('{"success":true,"token":"1"}', { status: 200, headers: { 'content-length': String(MB5 + 1) } });
    const streaming: typeof fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled += 1;
            controller.enqueue(new Uint8Array(256 * 1024).fill(0x20));
            if (pulled > 100) controller.close();
          },
        }),
        { status: 200 },
      );
    for (const fake of [declared, streaming]) {
      const c = new AdataClient({ baseUrl: stub.baseUrl, token: TOKEN, requestTimeoutMs: 1_000, fetch: fake });
      const start = await caught(() => c.startCompanyInfo(nextBin()));
      expect(start.failure).toBe('malformed');
      expectLeakFree(start, stub.baseUrl);
      expect((await caught(() => c.checkCompanyInfo('0000020991'))).failure).toBe('malformed');
    }
    // Чтение остановлено вскоре после 5 МБ (20 кусков по 256 КБ), а не дочитано до конца.
    expect(pulled).toBeLessThan(2 * 25);
    // Ровно 5 МБ — читается.
    const head = '{"success":true,"token":"0000020991"}';
    const exact: typeof fetch = async () => new Response(head + ' '.repeat(MB5 - head.length), { status: 200 });
    const c = new AdataClient({ baseUrl: stub.baseUrl, token: TOKEN, requestTimeoutMs: 1_000, fetch: exact });
    expect(await c.startCompanyInfo(nextBin())).toEqual({ pollToken: '0000020991' });
  });

  it('тело с BOM разбирается на Get Request и на проверке', async () => {
    const bom = (text: string) => new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(text, 'utf8')]);
    const withBom: typeof fetch = async (input) =>
      String(input).includes('/check/')
        ? new Response(bom(JSON.stringify(ADATA_FIXTURE)), { status: 200 })
        : new Response(bom('{"success":true,"token":"1"}'), { status: 200 });
    const c = new AdataClient({ baseUrl: stub.baseUrl, token: TOKEN, requestTimeoutMs: 1_000, fetch: withBom });
    expect(await c.startCompanyInfo(nextBin())).toEqual({ pollToken: '1' });
    expect(await c.checkCompanyInfo('1')).toEqual({ ready: true, data: ADATA_FIXTURE.data });
  });

  it('тело больше 5 МБ на 5xx — http_5xx: на проверке временный сбой, опрос доходит до ready', async () => {
    let checks = 0;
    const big: typeof fetch = async (input) => {
      if (!String(input).includes('/check/')) return new Response(' '.repeat(6 * 1024 * 1024), { status: 503 });
      checks += 1;
      return checks === 1
        ? new Response(' '.repeat(6 * 1024 * 1024), { status: 503 })
        : new Response(JSON.stringify(ADATA_FIXTURE), { status: 200 });
    };
    const c = new AdataClient({ baseUrl: stub.baseUrl, token: TOKEN, requestTimeoutMs: 1_000, fetch: big });
    const start = await caught(() => c.startCompanyInfo(nextBin()));
    expect([start.failure, start.httpStatus]).toEqual(['http_5xx', 503]);
    expectLeakFree(start, stub.baseUrl);
    const result = await pollCompanyInfo(c, '0000020991', {
      deadlineAt: Date.now() + GENEROUS_DEADLINE_MS,
      timing: TIMING,
      sleep: async () => {},
    });
    expect(result).toEqual({ ready: true, data: ADATA_FIXTURE.data });
    expect(checks).toBe(2);
  });

  it('429: на проверке — временный сбой, опрос идёт до срока; на Get Request — http_4xx', async () => {
    let checks = 0;
    const limited: typeof fetch = async (input) => {
      if (!String(input).includes('/check/'))
        return new Response('{"success":false,"message":"Too Many Requests"}', { status: 429 });
      checks += 1;
      return checks <= 2
        ? new Response('{"success":false,"message":"Too Many Requests"}', { status: 429 })
        : new Response(JSON.stringify(ADATA_FIXTURE), { status: 200 });
    };
    const c = new AdataClient({ baseUrl: stub.baseUrl, token: TOKEN, requestTimeoutMs: 50, fetch: limited });
    const start = await caught(() => c.startCompanyInfo(nextBin()));
    expect([start.failure, start.httpStatus]).toEqual(['http_4xx', 429]);
    const result = await pollCompanyInfo(c, '0000020991', {
      deadlineAt: Date.now() + GENEROUS_DEADLINE_MS,
      timing: TIMING,
      sleep: async () => {},
    });
    expect(result).toEqual({ ready: true, data: ADATA_FIXTURE.data });
    expect(checks).toBe(3);
    // Только 429 до срока — последний временный сбой.
    const always: typeof fetch = async () => new Response('{}', { status: 429 });
    const d = new AdataClient({ baseUrl: stub.baseUrl, token: TOKEN, requestTimeoutMs: 50, fetch: always });
    expect(
      await pollCompanyInfo(d, '0000020991', { deadlineAt: Date.now() + 30, timing: TIMING, sleep: fastSleep }),
    ).toEqual({ ready: false, failure: 'http_4xx' });
  });

  it('шаг опроса не короче 100 мс, даже при pollIntervalMs: 0', async () => {
    const failing: typeof fetch = async () => new Response('{}', { status: 500 });
    const c = new AdataClient({ baseUrl: stub.baseUrl, token: TOKEN, requestTimeoutMs: 50, fetch: failing });
    let clock = 0;
    const sleeps: number[] = [];
    const result = await pollCompanyInfo(c, '0000020991', {
      deadlineAt: 1_050,
      timing: { firstPollDelayMs: 0, pollIntervalMs: 0, deadlineMs: 1_050, requestTimeoutMs: 50 },
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    expect(result).toEqual({ ready: false, failure: 'http_5xx' });
    // Первая пауза 0, затем десять шагов по 100 мс и 50 мс до срока: двенадцать проверок, а не сотни.
    expect(sleeps).toEqual([0, ...Array<number>(10).fill(100), 50]);
  });

  it('заглушка: явное on: undefined — как по умолчанию; занятый порт — отказ startAdataStub', async () => {
    const bin = nextBin();
    stub.scenario(bin, { kind: 'malformed', on: undefined });
    const { pollToken } = await client.startCompanyInfo(bin);
    expect((await caught(() => client.checkCompanyInfo(pollToken))).failure).toBe('malformed');
    const port = Number(new URL(stub.baseUrl).port);
    await expect(startAdataStub({ token: TOKEN, port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('путь: токен закодирован, БИН — в iinBin', async () => {
    const bin = nextBin();
    const { pollToken } = await client.startCompanyInfo(bin);
    await client.checkCompanyInfo(pollToken);
    expect(stub.requests).toEqual([
      { kind: 'start', bin, authOk: true },
      { kind: 'check', bin, authOk: true },
    ]);
  });

  it('готово после трёх wait — data фикстуры, Get Request один, проверок четыре', async () => {
    const bin = nextBin();
    stub.scenario(bin, { kind: 'ready', afterPolls: 3 });
    const { pollToken } = await client.startCompanyInfo(bin);
    expect(pollToken).toMatch(/^\d{10}$/);
    const result = await poll(pollToken);
    expect(result).toEqual({ ready: true, data: ADATA_FIXTURE.data });
    expect(stub.requests.filter((r) => r.kind === 'start')).toHaveLength(1);
    expect(stub.requests.filter((r) => r.kind === 'check')).toHaveLength(4);
  });

  it('wait до срока — timeout', async () => {
    const bin = nextBin();
    stub.scenario(bin, { kind: 'wait_forever' });
    const { pollToken } = await client.startCompanyInfo(bin);
    const started = Date.now();
    expect(await poll(pollToken, TIMING.deadlineMs)).toEqual({ ready: false, failure: 'timeout' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(TIMING.deadlineMs - 5);
    expect(stub.requests.filter((r) => r.kind === 'check').length).toBeGreaterThan(1);
  });

  it('срок по часам опроса: первая пауза, шаг и последняя проверка в момент срока', async () => {
    const bin = nextBin();
    stub.scenario(bin, { kind: 'wait_forever' });
    const { pollToken } = await client.startCompanyInfo(bin);
    let clock = 1_000;
    const sleeps: number[] = [];
    const result = await pollCompanyInfo(client, pollToken, {
      deadlineAt: clock + 120_000,
      timing: { firstPollDelayMs: 5_000, pollIntervalMs: 7_000, deadlineMs: 120_000, requestTimeoutMs: 50 },
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    expect(result).toEqual({ ready: false, failure: 'timeout' });
    expect(sleeps[0]).toBe(5_000);
    expect(sleeps.slice(1, -1).every((ms) => ms === 7_000)).toBe(true);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe(120_000);
    // 5 с + 16 × 7 с = 117 с, затем 3 с до срока: 18 проверок, последняя — в момент срока.
    expect(stub.requests.filter((r) => r.kind === 'check')).toHaveLength(18);
  });

  it('срок уже истёк — timeout без проверки', async () => {
    const result = await pollCompanyInfo(client, '0000020991', { deadlineAt: Date.now() - 1, timing: TIMING });
    expect(result).toEqual({ ready: false, failure: 'timeout' });
    expect(stub.requests).toEqual([]);
  });

  it('500 на Get Request — http_5xx, без опроса', async () => {
    const bin = nextBin();
    stub.scenario(bin, { kind: 'start_error', status: 500 });
    const error = await caught(() => client.startCompanyInfo(bin));
    expect({ failure: error.failure, httpStatus: error.httpStatus, message: error.message }).toEqual({
      failure: 'http_5xx',
      httpStatus: 500,
      message: 'adata http_5xx 500',
    });
    expect(stub.requests.map((r) => r.kind)).toEqual(['start']);
  });

  it('403 modules not connected — module_off', async () => {
    const bin = nextBin();
    stub.scenario(bin, { kind: 'start_error', status: 403 });
    const error = await caught(() => client.startCompanyInfo(bin));
    expect([error.failure, error.httpStatus]).toEqual(['module_off', 403]);
  });

  it('400 — rejected', async () => {
    const bin = nextBin();
    stub.scenario(bin, { kind: 'start_error', status: 400 });
    const error = await caught(() => client.startCompanyInfo(bin));
    expect([error.failure, error.httpStatus]).toEqual(['rejected', 400]);
  });

  it('200 без token или success:false на Get Request — rejected; не JSON — malformed', async () => {
    for (const [body, failure] of [
      [{ success: true }, 'rejected'],
      [{ success: true, token: '' }, 'rejected'],
      [{ success: false, token: '0000020991' }, 'rejected'],
      ['<html></html>', 'malformed'],
    ] as const) {
      const fake: typeof fetch = async () =>
        new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
      const c = new AdataClient({ baseUrl: stub.baseUrl, token: TOKEN, requestTimeoutMs: 50, fetch: fake });
      expect((await caught(() => c.startCompanyInfo(nextBin()))).failure).toBe(failure);
    }
  });

  it('ready с data не объектом — malformed; 400 на проверке — http_4xx', async () => {
    for (const data of [null, 'x', [1]]) {
      const bin = nextBin();
      stub.scenario(bin, { kind: 'ready', afterPolls: 0, body: { success: true, message: 'ready', data } });
      const { pollToken } = await client.startCompanyInfo(bin);
      expect(await poll(pollToken)).toEqual({ ready: false, failure: 'malformed' });
    }
    stub.requests.length = 0;
    expect(await poll('0000000000')).toEqual({ ready: false, failure: 'http_4xx' });
    expect(stub.requests).toHaveLength(1);
  });

  it('HTML вместо JSON на проверке — malformed, опрос прекращён', async () => {
    const bin = nextBin();
    stub.scenario(bin, { kind: 'malformed' });
    const { pollToken } = await client.startCompanyInfo(bin);
    expect(await poll(pollToken)).toEqual({ ready: false, failure: 'malformed' });
    expect(stub.requests.filter((r) => r.kind === 'check')).toHaveLength(1);
  });

  it('два 500 на проверке, затем ready — данные (временный сбой не прерывает)', async () => {
    const bin = nextBin();
    stub.scenario(bin, { kind: 'check_flaky', failures: 2 });
    const { pollToken } = await client.startCompanyInfo(bin);
    expect(await poll(pollToken)).toEqual({ ready: true, data: ADATA_FIXTURE.data });
    expect(stub.requests.filter((r) => r.kind === 'check')).toHaveLength(3);
  });

  it('обрыв сокета — network; молчание — timeout', async () => {
    for (const [kind, failure] of [
      ['hang_up', 'network'],
      ['silent', 'timeout'],
    ] as const) {
      const startBin = nextBin();
      stub.scenario(startBin, { kind, on: 'start' });
      const error = await caught(() => client.startCompanyInfo(startBin));
      expect([error.failure, error.httpStatus]).toEqual([failure, null]);

      // На проверке это временный сбой: опрос идёт до срока и возвращает последний сбой.
      const checkBin = nextBin();
      stub.scenario(checkBin, { kind });
      const { pollToken } = await client.startCompanyInfo(checkBin);
      expect((await caught(() => client.checkCompanyInfo(pollToken))).failure).toBe(failure);
      stub.requests.length = 0;
      expect(await poll(pollToken, 200)).toEqual({ ready: false, failure });
      expect(stub.requests.length).toBeGreaterThan(1);
    }
  });

  it('redactToken: закодированный токен в нижнем регистре тоже убирается', () => {
    const lower = encodeURIComponent(TOKEN).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());
    expect(lower).not.toBe(encodeURIComponent(TOKEN));
    const redacted = redactToken({ url: `/api/company/info/${lower}?iinBin=1`, [lower]: 1 }, TOKEN);
    expect(redacted).toEqual({ url: '/api/company/info/[redacted]?iinBin=1', '[redacted]': 1 });
  });

  it('redactToken: копия без NUL и одиночных суррогатов — её принимает jsonb', () => {
    const redacted = redactToken({ a: [{ b: 'x\u0000y', c: 'z\ud800' }], ['k\u0000\udc00']: `t\u0000${TOKEN}` }, TOKEN);
    const text = JSON.stringify(redacted);
    expect(text.includes('\\u0000')).toBe(false);
    expect(/\\ud[89a-f][0-9a-f]{2}/i.test(text)).toBe(false);
    expect(redacted).toEqual({ a: [{ b: 'xy', c: 'z\ufffd' }], 'k\ufffd': 't[redacted]' });
  });

  it('redactToken убирает токен из вложенных строк', () => {
    const value = {
      url: `https://adata.invalid/api/company/info/${encodeURIComponent(TOKEN)}?iinBin=1`,
      nested: [{ text: `token=${TOKEN};` }, 42, null, true],
      [TOKEN]: 'key',
    };
    const redacted = redactToken(value, TOKEN);
    const text = JSON.stringify(redacted);
    expect(text.includes(TOKEN)).toBe(false);
    expect(text.includes(encodeURIComponent(TOKEN))).toBe(false);
    expect(redacted.url).toBe('https://adata.invalid/api/company/info/[redacted]?iinBin=1');
    expect(redacted.nested).toEqual([{ text: 'token=[redacted];' }, 42, null, true]);
    expect(Object.keys(redacted)).toEqual(['url', 'nested', '[redacted]']);
    // Исходное значение не меняется.
    expect(value.nested[0]).toEqual({ text: `token=${TOKEN};` });
  });
});
