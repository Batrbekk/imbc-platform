import { QueryCache, QueryClient } from "@tanstack/react-query";
import { ZodError } from "zod";

import { ApiError } from "./api";
import { meKey } from "./session";

/**
 * Повтор запроса: сбой сети и 5xx — до двух раз. 4xx не повторяем: это ответ сервера, а не сбой сети.
 * `503 nda_unavailable` — тоже ответ (NDA не опубликована): повтор только тратит лимит маршрута (FC-02).
 * Ответ неверной формы (ZodError разбора) повтор не исправит.
 */
export function retryQuery(count: number, error: unknown): boolean {
  if (error instanceof ZodError) return false;
  if (error instanceof ApiError && (error.status < 500 || error.code === "nda_unavailable")) return false;
  return count < 2;
}

/** Клиент запросов приложения; тесты берут его же, чтобы реакция на 401 была как в браузере. */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: retryQuery,
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        // Сеанс истёк (простой 30 минут или 12 часов): перечитываем /me,
        // и AppShell уводит на вход с возвратом на текущую страницу.
        if (error instanceof ApiError && error.status === 401 && query.queryKey[0] !== meKey[0]) {
          void client.invalidateQueries({ queryKey: meKey });
        }
      },
    }),
  });
  return client;
}
