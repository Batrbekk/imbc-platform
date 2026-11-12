/**
 * Клиент Adata «Полная информация» (EXT-02, IMBC-07): Get Request и опрос Check Request.
 * Токен авторизации стоит в пути URL, поэтому ни URL, ни объект Response, ни тело ответа и ни
 * одна исходная ошибка fetch не выходят из модуля: наружу — только AdataCallError с видом сбоя
 * и HTTP-статусом (EXT-02, NFR-10). Без БД и без логгера.
 */
import { setTimeout as delay } from 'node:timers/promises';

export const ADATA_BASE_URL = 'https://api.adata.kz';

export const ADATA_FAILURES = [
  'network',
  'timeout',
  'http_4xx',
  'http_5xx',
  'module_off',
  'rejected',
  'malformed',
  'interrupted',
] as const;
export type AdataFailure = (typeof ADATA_FAILURES)[number];

/** Временные сбои: опрос продолжается до срока. */
const TRANSIENT: ReadonlySet<AdataFailure> = new Set(['network', 'timeout', 'http_5xx']);

/** Ошибка без URL, тела ответа и cause: message = `adata ${failure}` (+ HTTP-статус). */
export class AdataCallError extends Error {
  static {
    this.prototype.name = 'AdataCallError';
  }

  constructor(
    readonly failure: AdataFailure,
    readonly httpStatus: number | null,
  ) {
    super(httpStatus === null ? `adata ${failure}` : `adata ${failure} ${httpStatus}`);
  }
}

export interface AdataTiming {
  firstPollDelayMs: number;
  pollIntervalMs: number;
  deadlineMs: number;
  requestTimeoutMs: number;
}

/** Заметки: опрос раз в 5–10 с, ответ до 90 с. Срок — 120 с от Get Request (90 + запас). */
export const ADATA_DEFAULT_TIMING: AdataTiming = {
  firstPollDelayMs: 5_000,
  pollIntervalMs: 5_000,
  deadlineMs: 120_000,
  requestTimeoutMs: 15_000,
};

type Reply = { status: number; body: unknown };
const NOT_JSON = Symbol('not json');

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const messageOf = (body: unknown) => (isObject(body) && typeof body.message === 'string' ? body.message : null);

/** Имя исходной ошибки читается без её текста: в тексте и cause может быть URL. */
function isTimeout(error: unknown): boolean {
  try {
    const name = (error as { name?: unknown } | null)?.name;
    return name === 'TimeoutError' || name === 'AbortError';
  } catch {
    return false;
  }
}

export class AdataClient {
  readonly #base: URL;
  readonly #token: string;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(opts: { baseUrl: string; token: string; requestTimeoutMs: number; fetch?: typeof fetch }) {
    // Адрес проверяется без токена: ошибка разбора URL с токеном в пути несла бы его в `input`.
    this.#base = new URL(opts.baseUrl);
    this.#token = opts.token;
    this.#requestTimeoutMs = opts.requestTimeoutMs;
    this.#fetch = opts.fetch ?? fetch;
  }

  /** Get Request `GET /api/company/info/{token}?iinBin=` — единственный вызов, расходующий квоту. */
  async startCompanyInfo(bin: string): Promise<{ pollToken: string }> {
    const { status, body } = await this.#get('/api/company/info/', { iinBin: bin });
    if (status >= 500) throw new AdataCallError('http_5xx', status);
    if (status === 403 && messageOf(body) === 'modules not connected') throw new AdataCallError('module_off', status);
    if (status >= 400) throw new AdataCallError('rejected', status);
    if (status < 200 || status >= 300 || body === NOT_JSON) throw new AdataCallError('malformed', status);
    if (!isObject(body) || body.success === false || typeof body.token !== 'string' || body.token.trim() === '')
      throw new AdataCallError('rejected', status);
    return { pollToken: body.token.trim() };
  }

  /** Один Check Request `GET /api/company/info/check/{token}?token=`. */
  async checkCompanyInfo(
    pollToken: string,
  ): Promise<{ ready: false } | { ready: true; data: Record<string, unknown> }> {
    const { status, body } = await this.#get('/api/company/info/check/', { token: pollToken });
    if (status >= 500) throw new AdataCallError('http_5xx', status);
    if (status === 403 && messageOf(body) === 'modules not connected') throw new AdataCallError('module_off', status);
    if (status >= 400) throw new AdataCallError('http_4xx', status);
    if (status < 200 || status >= 300 || body === NOT_JSON || !isObject(body))
      throw new AdataCallError('malformed', status);
    // success: true не означает готовность — смотреть message (заметки).
    if (body.message === 'wait') return { ready: false };
    if (body.message === 'ready' && isObject(body.data)) return { ready: true, data: body.data };
    if (body.success === false) throw new AdataCallError('rejected', status);
    throw new AdataCallError('malformed', status);
  }

  /**
   * Один GET. Любой отказ fetch или чтения тела становится AdataCallError без cause; Response
   * остаётся внутри. Тело ошибочного ответа читается только до поля message и не хранится.
   */
  async #get(prefix: string, query: Record<string, string>): Promise<Reply> {
    let status: number;
    let text: string;
    try {
      const url = new URL(`${prefix}${encodeURIComponent(this.#token)}`, this.#base);
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      const res = await this.#fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        // Переадресация понесла бы путь с токеном на другой адрес.
        redirect: 'error',
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
      status = res.status;
      text = await res.text();
    } catch (error) {
      throw new AdataCallError(isTimeout(error) ? 'timeout' : 'network', null);
    }
    try {
      return { status, body: JSON.parse(text) as unknown };
    } catch {
      return { status, body: NOT_JSON };
    }
  }
}

/** Опрос до deadlineAt; временные сбои (network, timeout, http_5xx) не прерывают опрос до срока. */
export async function pollCompanyInfo(
  client: AdataClient,
  pollToken: string,
  o: { deadlineAt: number; timing: AdataTiming; now?: () => number; sleep?: (ms: number) => Promise<void> },
): Promise<{ ready: true; data: Record<string, unknown> } | { ready: false; failure: AdataFailure }> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => delay(ms).then(() => undefined));
  const left = () => o.deadlineAt - now();
  // Срок истёк: последний ответ был wait (или ответа не было) → timeout, иначе — последний временный сбой.
  let last: AdataFailure = 'timeout';

  if (left() <= 0) return { ready: false, failure: last };
  await sleep(Math.min(o.timing.firstPollDelayMs, left()));
  for (;;) {
    try {
      const reply = await client.checkCompanyInfo(pollToken);
      if (reply.ready) return reply;
      last = 'timeout';
    } catch (error) {
      if (!(error instanceof AdataCallError)) return { ready: false, failure: 'malformed' };
      if (!TRANSIENT.has(error.failure)) return { ready: false, failure: error.failure };
      last = error.failure;
    }
    // Последняя проверка — в момент срока; ожидание не выходит за срок.
    const remaining = left();
    if (remaining <= 0) return { ready: false, failure: last };
    await sleep(Math.min(o.timing.pollIntervalMs, remaining));
  }
}

/** JSON-копия value, где токен и encodeURIComponent(token) заменены на '[redacted]'. */
export function redactToken<T>(value: T, token: string): T {
  const needles = [...new Set([encodeURIComponent(token), token])].filter(Boolean).sort((a, b) => b.length - a.length);
  const scrub = (s: string) => needles.reduce((acc, n) => acc.split(n).join('[redacted]'), s);
  const text = JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'string') return scrub(v);
    // Ключи объектов тоже: токен мог оказаться ключом.
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [scrub(k), x]));
    return v;
  });
  return (text === undefined ? undefined : JSON.parse(text)) as T;
}
