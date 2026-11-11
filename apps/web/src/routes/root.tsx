import { NuqsAdapter } from "nuqs/adapters/react-router/v8";
import { Outlet, ScrollRestoration } from "react-router";

import { PageTitle } from "@/components/app/page-title";
import { SessionStatus } from "@/components/auth/session-status";

/** Корень маршрутов: фильтры каталога в адресе через nuqs (OPR-05) и восстановление прокрутки. */
export function Root() {
  return (
    <NuqsAdapter>
      <Outlet />
      <ScrollRestoration />
    </NuqsAdapter>
  );
}

/** Пока грузится чанк страницы, открытой первой: тот же индикатор, что и при проверке сеанса. */
export function RootFallback() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <PageTitle />
      <SessionStatus />
    </div>
  );
}
