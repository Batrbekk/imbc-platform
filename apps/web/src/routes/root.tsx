import { NuqsAdapter } from "nuqs/adapters/react-router/v8";
import { useEffect, useRef } from "react";
import { Outlet, ScrollRestoration, useLocation } from "react-router";

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
      <RouteAnnouncer />
    </NuqsAdapter>
  );
}

/**
 * Объявляет смену страницы экранному диктору: после перехода по меню фокус остаётся на ссылке,
 * и без объявления пользователь не узнает, что страница сменилась. Текст — заголовок вкладки:
 * PageTitle новой страницы ставит его в layout effect, а этот эффект (обычный) идёт после.
 * Первая отрисовка не объявляется — загруженную страницу диктор читает сам; смена только query
 * string (фильтры каталога) тоже: иначе каждый фильтр зачитывался бы заново.
 */
function RouteAnnouncer() {
  const { pathname } = useLocation();
  const region = useRef<HTMLParagraphElement>(null);
  const announced = useRef(pathname);
  useEffect(() => {
    if (announced.current === pathname || !region.current) return;
    announced.current = pathname;
    region.current.textContent = document.title;
  }, [pathname]);
  return <p id="route-announcer" ref={region} aria-live="polite" aria-atomic="true" className="sr-only" />;
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
