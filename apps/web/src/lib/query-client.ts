import { QueryCache, QueryClient } from "@tanstack/react-query";

import { ApiError } from "./api";
import { meKey } from "./session";

/** Клиент запросов приложения; тесты берут его же, чтобы реакция на 401 была как в браузере. */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // 4xx не повторяем: это ответ сервера, а не сбой сети.
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
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
