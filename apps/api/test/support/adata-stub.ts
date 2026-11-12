import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Заглушка Adata «Полная информация» (EXT-02, IMBC-07) на 127.0.0.1: тесты никогда не обращаются
 * к api.adata.kz и не расходуют квоту заказчика. Заглушка ничего не проксирует.
 */
export const ADATA_FIXTURE = JSON.parse(
  readFileSync(new URL('../fixtures/adata-company-info.json', import.meta.url), 'utf8'),
) as { success: true; message: 'ready'; data: Record<string, unknown> };

/** Шаг вызова, на котором срабатывает сбой; по умолчанию — Check Request. */
type Step = { on?: 'start' | 'check' };

export type AdataScenario =
  | { kind: 'ready'; afterPolls: number; body?: unknown }
  | { kind: 'wait_forever' }
  | { kind: 'start_error'; status: 500 | 400 | 403 }
  | { kind: 'check_flaky'; failures: number }
  | ({ kind: 'malformed' } & Step)
  | { kind: 'unknown_bin' }
  | ({ kind: 'hang_up' } & Step)
  | ({ kind: 'silent' } & Step)
  | ({ kind: 'echo_url' } & Step)
  /** 302 на location: абсолютный адрес другого сервера или относительный путь. */
  | ({ kind: 'redirect'; location: string } & Step);

export interface AdataStubRequest {
  kind: 'start' | 'check' | 'other';
  bin: string | null;
  /** Сегмент пути после декодирования совпал с токеном. Сам токен не записывается. */
  authOk: boolean;
}

export interface AdataStub {
  baseUrl: string;
  requests: AdataStubRequest[];
  scenario(bin: string, s: AdataScenario): void;
  close(): Promise<void>;
}

const STEP_FAULTS: ReadonlySet<AdataScenario['kind']> = new Set([
  'malformed',
  'hang_up',
  'silent',
  'echo_url',
  'redirect',
]);
const START = /^\/api\/company\/info\/([^/]+)$/;
const CHECK = /^\/api\/company\/info\/check\/([^/]+)$/;

/** port — для теста отказа listen; по умолчанию свободный порт. */
export async function startAdataStub({ token, port = 0 }: { token: string; port?: number }): Promise<AdataStub> {
  const requests: AdataStubRequest[] = [];
  const scenarios = new Map<string, AdataScenario>();
  // Токен проверки уникален на БИН; число проверок — по токену проверки.
  const pollTokens = new Map<string, string>();
  const binsByPollToken = new Map<string, string>();
  const polls = new Map<string, number>();

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  const html = (res: ServerResponse) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html><body>Bad gateway</body></html>');
  };
  const segmentIs = (raw: string) => {
    try {
      return decodeURIComponent(raw) === token;
    } catch {
      return false;
    }
  };

  /** Сбой шага; true — ответ отдан (или намеренно не отдан). */
  const fault = (s: AdataScenario | undefined, step: 'start' | 'check', req: IncomingMessage, res: ServerResponse) => {
    if (!s || !STEP_FAULTS.has(s.kind)) return false;
    // Явное on: undefined — как без on: Check Request.
    if (((s as Step).on ?? 'check') !== step) return false;
    if (s.kind === 'malformed') html(res);
    else if (s.kind === 'hang_up') req.socket.destroy();
    else if (s.kind === 'echo_url') json(res, 500, { success: false, message: req.url });
    else if (s.kind === 'redirect') {
      res.writeHead(302, { location: s.location });
      res.end();
    }
    // silent: ответа нет, сокет закрывает close().
    return true;
  };

  const server = createServer((req, res) => {
    const raw = req.url ?? '/';
    const query = new URL(raw, 'http://stub.invalid').searchParams;
    const path = raw.split('?')[0]!;
    const start = START.exec(path);
    const check = start ? null : CHECK.exec(path);

    if (start) {
      const bin = query.get('iinBin');
      const authOk = segmentIs(start[1]!);
      requests.push({ kind: 'start', bin, authOk });
      if (!authOk) return json(res, 401, { success: false, message: 'invalid token' });
      if (!bin || !/^\d{12}$/.test(bin)) return json(res, 400, { success: false, message: 'invalid iinBin' });
      const s = scenarios.get(bin);
      if (fault(s, 'start', req, res)) return;
      if (s?.kind === 'start_error') {
        if (s.status === 403) return json(res, 403, { success: false, data: null, message: 'modules not connected' });
        if (s.status === 400) return json(res, 400, { success: false, message: 'invalid iinBin' });
        return json(res, 500, { success: false, message: 'Something went wrong' });
      }
      let pollToken = pollTokens.get(bin);
      if (!pollToken) {
        pollToken = String(20991 + pollTokens.size).padStart(10, '0');
        pollTokens.set(bin, pollToken);
        binsByPollToken.set(pollToken, bin);
        polls.set(pollToken, 0);
      }
      return json(res, 200, { success: true, token: pollToken });
    }

    if (check) {
      const pollToken = query.get('token') ?? '';
      const bin = binsByPollToken.get(pollToken) ?? null;
      const authOk = segmentIs(check[1]!);
      requests.push({ kind: 'check', bin, authOk });
      if (!authOk) return json(res, 401, { success: false, message: 'invalid token' });
      if (!bin) return json(res, 400, { success: false, message: 'invalid token' });
      const s = scenarios.get(bin) ?? { kind: 'ready', afterPolls: 0 };
      const n = polls.get(pollToken)!;
      polls.set(pollToken, n + 1);
      if (fault(s, 'check', req, res)) return;
      const wait = () => json(res, 200, { success: true, message: 'wait', data: null });
      switch (s.kind) {
        case 'wait_forever':
          return wait();
        case 'ready':
          return n < s.afterPolls ? wait() : json(res, 200, s.body ?? ADATA_FIXTURE);
        case 'check_flaky':
          return n < s.failures
            ? json(res, 500, { success: false, message: 'Something went wrong' })
            : json(res, 200, ADATA_FIXTURE);
        case 'unknown_bin':
          return json(res, 200, {
            success: true,
            message: 'ready',
            data: { basic: null, kzCoContact: null, founders: null },
          });
        default:
          return json(res, 200, ADATA_FIXTURE);
      }
    }

    requests.push({ kind: 'other', bin: null, authOk: false });
    return json(res, 404, { success: false, message: 'not found' });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    scenario: (bin, s) => void scenarios.set(bin, s),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
