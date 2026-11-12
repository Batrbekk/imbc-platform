import { type Locale, safeReturnTo } from "@imbc/contracts";

import { loginUrl } from "./api";

/** Коды, с которыми BFF возвращает на /login; у каждого — своё сообщение. */
export const LOGIN_ERRORS = [
  "flow_expired",
  "oidc",
  "no_account",
  "account_inactive",
  "email_unverified",
  "session_expired",
] as const;

export type LoginError = (typeof LOGIN_ERRORS)[number];

export type LoginState =
  | { kind: "redirect"; url: string }
  | { kind: "error"; error: LoginError; target: string }
  | { kind: "signedOut"; target: string };

/**
 * Что показывает /login. Вход идёт через BFF: /api/auth/login → Keycloak → /api/auth/callback (ADR-04),
 * поэтому без ошибки и без выхода страница сразу уводит в BFF. Незнакомый код ошибки — общий сбой
 * входа (oidc); returnTo — только локальный путь.
 */
export function resolveLoginState(params: URLSearchParams, locale: Locale): LoginState {
  const target = safeReturnTo(params.get("returnTo"));
  const error = params.get("error");
  const known = LOGIN_ERRORS.find((e) => e === error) ?? (error ? "oidc" : undefined);
  if (known) return { kind: "error", error: known, target };
  if (params.get("logged_out") === "1") return { kind: "signedOut", target };
  return { kind: "redirect", url: loginUrl(target, locale) };
}
