import { randomBytes } from 'node:crypto';
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

const poll = (pollToken: string, deadlineMs = TIMING.deadlineMs) =>
  pollCompanyInfo(client, pollToken, { deadlineAt: Date.now() + deadlineMs, timing: TIMING });

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
    expect(await poll(pollToken)).toEqual({ ready: false, failure: 'timeout' });
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
