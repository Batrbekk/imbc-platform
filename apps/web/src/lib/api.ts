import { SECTION_KINDS } from "@imbc/contracts";
import { z } from "zod";

/**
 * Клиент BFF. Браузер ходит только на свой origin (/api), сеанс — в HttpOnly cookie,
 * токены IdP в браузер не попадают (архитектура §9, ADR-04).
 */
const missingSchema = z.object({ kind: z.enum(SECTION_KINDS), path: z.string(), code: z.string() });
const requirementSchema = z.object({ kind: z.enum(["certificates", "documents"]), requiredTypeIds: z.array(z.uuid()) });
type SubmissionMissing = z.infer<typeof missingSchema>;
type SubmissionRequirement = z.infer<typeof requirementSchema>;
function parseIssues<T>(value: unknown, schema: z.ZodType<T>): T[] {
  return Array.isArray(value)
    ? value.flatMap((item: unknown) => {
        const result = schema.safeParse(item);
        return result.success ? [result.data] : [];
      })
    : [];
}
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    title: string,
    readonly detail?: string,
    readonly retryAfter?: number,
    readonly fieldErrors: readonly { path: string; code: string }[] = [],
    readonly submissionMissing: readonly SubmissionMissing[] = [],
    readonly submissionRequirements: readonly SubmissionRequirement[] = [],
  ) {
    super(title);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...rest,
    // Ответ зависит от сеанса: браузер не берёт его из своего кеша, даже если заголовок
    // Cache-Control: no-store потерялся по дороге (NFR-11).
    cache: "no-store",
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
      Array.isArray(body?.errors)
        ? body.errors.flatMap((item: unknown) => {
            if (typeof item !== "object" || item === null) return [];
            const issue = item as Record<string, unknown>;
            return typeof issue.path === "string" && typeof (issue.code ?? issue.message) === "string"
              ? [{ path: issue.path, code: String(issue.code ?? issue.message) }]
              : [];
          })
        : [],
      parseIssues(body?.missing, missingSchema),
      parseIssues(body?.requirements, requirementSchema),
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
