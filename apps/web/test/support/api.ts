import { afterEach, type Mock, vi } from "vitest";

/** Ответ подменённого BFF: тело JSON со статусом (по умолчанию 200) или своя функция. */
export type ApiReply = { status?: number; body?: unknown } | ((url: URL, init?: RequestInit) => Response);

const json = (status: number, body: unknown, type = "application/json") =>
  new Response(status === 204 || body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": type },
  });

const problemResponse = (status: number, code: string) =>
  json(status, { type: "about:blank", title: code, status, code }, "application/problem+json");

/** Ошибка RFC 9457 в том виде, в каком её отдаёт BFF. */
export function problem(status: number, code: string): ApiReply {
  return () => problemResponse(status, code);
}

/**
 * Подменяет fetch. Ключ — метод и путь: "GET /api/auth/me"; сначала ищется путь с query string,
 * потом без неё. Неизвестный путь — 404 problem+json. Подмена снимается после каждого теста.
 */
export function stubApi(handlers: Record<string, ApiReply>): Mock<typeof fetch> {
  const mock = vi.fn<typeof fetch>(async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request?.url ?? String(input), window.location.origin);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const reply = handlers[`${method} ${url.pathname}${url.search}`] ?? handlers[`${method} ${url.pathname}`];
    if (reply === undefined) return problemResponse(404, "not_found");
    if (typeof reply === "function") return reply(url, init);
    return json(reply.status ?? 200, reply.body);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});
