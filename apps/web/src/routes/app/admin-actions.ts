import { ADMIN_PROBLEM_CODES, type AdminProblemCode } from "@imbc/contracts";
import { type QueryKey, useMutation, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import type { Messages } from "@/i18n/messages";
import { ApiError } from "@/lib/api";
import { meKey } from "@/lib/session";

/** Список организаций и аккаунтов; каждое удачное действие его перечитывает. */
export const ADMIN_ACCOUNTS_KEY = ["admin", "accounts"] as const;

type ProblemMessage = keyof Messages["adminAccounts"]["errors"];

/**
 * Сообщение для каждого кода маршрутов администратора. Тип `Record<AdminProblemCode, …>`: новый код в
 * `ADMIN_PROBLEM_CODES` без сообщения не скомпилируется, а ключ — из en.json (те же ключи в kk и ru
 * проверяет messages.test.ts). Нет сеанса или шлюза входа — одно сообщение о сеансе.
 */
export const ADMIN_PROBLEM_MESSAGES: Record<AdminProblemCode, ProblemMessage> = {
  validation: "validation",
  unauthenticated: "session",
  mfa_required: "session",
  responsibility_required: "session",
  forbidden: "forbidden",
  bad_origin: "requestError",
  not_found: "not_found",
  organization_exists: "organization_exists",
  not_operator: "not_operator",
  organization_not_invitable: "organization_not_invitable",
  role_not_allowed: "role_not_allowed",
  email_exists: "email_exists",
  not_invited: "not_invited",
  self_action: "self_action",
  role_fixed: "role_fixed",
  not_manufacturer_account: "not_manufacturer_account",
  identity_not_bound: "identity_not_bound",
  identity_unavailable: "identity_unavailable",
  busy: "busy",
  internal: "requestError",
};

const isAdminProblemCode = (code: string): code is AdminProblemCode =>
  (ADMIN_PROBLEM_CODES as readonly string[]).includes(code);

/** Код ответа, если он из списка маршрутов администратора; `http_*`, сбой сети и прочее — undefined. */
export function problemCode(error: unknown): AdminProblemCode | undefined {
  return error instanceof ApiError && isAdminProblemCode(error.code) ? error.code : undefined;
}

/** Переведённое сообщение об ошибке действия; неизвестный код — общее «не удалось обработать запрос». */
export function useProblemMessage() {
  const t = useTranslations("adminAccounts");
  return (error: unknown) => {
    const code = problemCode(error);
    return t(`errors.${code ? ADMIN_PROBLEM_MESSAGES[code] : "requestError"}`);
  };
}

export type RunOptions = { onSuccess?: () => void; onError?: (error: unknown) => void };

/** Итог последнего действия для строки состояния страницы. */
export type ActionResult = { tone: "success" | "error"; text: string };

/** Итог последнего действия с номером объявления: тот же итог дважды подряд — новое объявление. */
export type Status = ActionResult & { id: number };

/** Итог действия страницы: `announce` кладёт новый итог, `dismiss` убирает (кнопка «Скрыть»). */
export function useActionStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const announce = useCallback(
    (result: ActionResult) => setStatus((current) => ({ ...result, id: (current?.id ?? 0) + 1 })),
    [],
  );
  const dismiss = useCallback(() => setStatus(null), []);
  return { status, announce, dismiss };
}

/** Страница показывает итог действия в строке состояния (aria-live polite) над списком. */
export const AnnounceContext = createContext<(result: ActionResult) => void>(() => {});
export const useAnnounce = () => useContext(AnnounceContext);

/** Сеанс закончился или права пропали посреди действия: перечитанный /me уводит AppShell на вход. */
const SESSION_CODES = new Set<string>(["unauthenticated", "mfa_required", "responsibility_required", "forbidden"]);

/**
 * Действие администратора. Пока запрос в пути, второй вызов `run` ничего не шлёт (двойной щелчок —
 * один запрос). Успех перечитывает список и объявляет итог в строке состояния страницы; 404 и 409 тоже
 * перечитывают список: он мог устареть. `invalidate` — какие запросы перечитать (по умолчанию список
 * организаций и аккаунтов; страница справочников называет свои).
 */
export function useAdminAction<TVariables, TResult>({
  request,
  done,
  invalidate = [ADMIN_ACCOUNTS_KEY],
}: {
  request: (variables: TVariables) => Promise<TResult>;
  done: (result: TResult, variables: TVariables) => string;
  invalidate?: readonly QueryKey[];
}) {
  const client = useQueryClient();
  const announce = useAnnounce();
  const inFlight = useRef(false);
  const mutation = useMutation({
    mutationFn: request,
    onSuccess: (result, variables) => {
      for (const queryKey of invalidate) void client.invalidateQueries({ queryKey });
      announce({ tone: "success", text: done(result, variables) });
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      if (error.status === 401 || SESSION_CODES.has(error.code)) void client.invalidateQueries({ queryKey: meKey });
      if (error.status === 404 || error.status === 409)
        for (const queryKey of invalidate) void client.invalidateQueries({ queryKey });
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const run = (variables: TVariables, options?: RunOptions) => {
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(variables, {
      onSuccess: () => options?.onSuccess?.(),
      onError: (error) => options?.onError?.(error),
    });
  };
  return { ...mutation, run };
}

/** То, что форме нужно от действия. */
export interface Action<TVariables> {
  run: (variables: TVariables, options?: RunOptions) => void;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  /** Время последней отправки: растёт с каждым запросом, по нему форма находит новый ответ сервера. */
  submittedAt: number;
  reset: () => void;
}
