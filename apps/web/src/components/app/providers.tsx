"use client";

import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { type ReactNode, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { ApiError } from "@/lib/api";
import { meKey } from "@/lib/session";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const qc: QueryClient = new QueryClient({
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
            void qc.invalidateQueries({ queryKey: meKey });
          }
        },
      }),
    });
    return qc;
  });
  return (
    <QueryClientProvider client={client}>
      <NuqsAdapter>{children}</NuqsAdapter>
      <Toaster richColors position="top-right" />
      <ReactQueryDevtools buttonPosition="bottom-left" />
    </QueryClientProvider>
  );
}
