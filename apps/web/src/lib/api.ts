/**
 * Клиент BFF. Браузер ходит только на свой origin (/api), сеанс — в HttpOnly cookie,
 * токены IdP в браузер не попадают (архитектура §9, ADR-04).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    title: string,
    readonly detail?: string,
    readonly retryAfter?: number,
  ) {
    super(title);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...rest,
    headers: {
      accept: "application/json",
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    // RFC 9457: { type, title, status, detail, code }
    throw new ApiError(
      res.status,
      String(body?.code ?? "unknown"),
      String(body?.title ?? res.statusText),
      body?.detail ? String(body.detail) : undefined,
      Number(res.headers.get("retry-after")) || undefined,
    );
  }
  return body as T;
}

export function loginUrl(returnTo: string, locale?: string, prompt?: "login"): string {
  const params = new URLSearchParams({ returnTo });
  if (locale) params.set("locale", locale);
  if (prompt) params.set("prompt", prompt);
  return `/api/auth/login?${params}`;
}

export function passwordResetUrl(returnTo = "/", locale?: string): string {
  const params = new URLSearchParams({ returnTo });
  if (locale) params.set("locale", locale);
  return `/api/auth/password-reset?${params}`;
}
