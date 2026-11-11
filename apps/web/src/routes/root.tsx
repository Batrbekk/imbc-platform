import { NuqsAdapter } from "nuqs/adapters/react-router/v8";
import { useEffect } from "react";
import { Outlet, ScrollRestoration } from "react-router";

import { PageTitle } from "@/components/app/page-title";
import { SessionStatus } from "@/components/auth/session-status";
import { clearReloadFlag, LAZY_RELOAD } from "@/lib/reload-guard";

/** Корень маршрутов: фильтры каталога в адресе через nuqs (OPR-05) и восстановление прокрутки. */
export function Root() {
  // Ветка маршрутов отрисовалась без ошибки (иначе вместо Root стоял бы RouteError): все её
  // чанки загрузились, и следующий выкат снова может один раз перезагрузить вкладку.
  useEffect(() => {
    clearReloadFlag(LAZY_RELOAD);
  }, []);
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
