import type { ComponentType } from "react";
import { createBrowserRouter, type DataRouter, type RouteObject } from "react-router";

import type { AppRouteHandle } from "@/components/app/app-shell";
import { AuthLayout } from "@/routes/auth/layout";
import { LoginPage } from "@/routes/auth/login";
import { RegisterPage } from "@/routes/auth/register";
import { ResponsibilityPage } from "@/routes/auth/responsibility";
import { VerifyPage } from "@/routes/auth/verify";
import { clearReloadFlag, LAZY_RELOAD } from "@/lib/reload-guard";
import { HomePage } from "@/routes/home";
import { NotFoundPage } from "@/routes/not-found";
import { Root, RootFallback } from "@/routes/root";
import { RouteError } from "@/routes/route-error";

/**
 * Ленивый маршрут: свой чанк на страницу (и на оболочку). Чанк загрузился — флаг перезагрузки снимается,
 * и следующий выкат снова может перезагрузить вкладку один раз (см. RouteError).
 */
function lazyPage<M>(load: () => Promise<M>, pick: (module: M) => ComponentType) {
  return async () => {
    const module = await load();
    clearReloadFlag(LAZY_RELOAD);
    return { Component: pick(module) };
  };
}

/** Маршруты приложения. Страницы — дети корня; «*» остаётся последним. */
export const routes: RouteObject[] = [
  {
    element: <Root />,
    // Ленивые страницы: до загрузки чанка первой открытой страницы роутер показывает это.
    HydrateFallback: RootFallback,
    // Внутри Providers: экран ошибки переведён; чанк старше выката — одна перезагрузка.
    ErrorBoundary: RouteError,
    children: [
      { index: true, element: <HomePage /> },
      {
        // Экраны входа на прежних адресах: на них ведут редиректы BFF (ADR-04).
        element: <AuthLayout />,
        children: [
          { path: "login", element: <LoginPage /> },
          { path: "register", element: <RegisterPage /> },
          { path: "auth/verify", element: <VerifyPage /> },
          { path: "auth/responsibility", element: <ResponsibilityPage /> },
        ],
      },
      {
        // Рабочие страницы за проверкой сеанса; оболочка (сайдбар, панель, подсказки) и каждая
        // страница — отдельные чанки, экраны входа — в основном.
        lazy: lazyPage(() => import("@/components/app/app-shell"), (m) => m.AppShell),
        children: [
          {
            path: "catalog",
            handle: { title: "catalog.title" } satisfies AppRouteHandle,
            lazy: lazyPage(() => import("@/routes/app/catalog"), (m) => m.CatalogPage),
          },
          {
            path: "dashboard",
            handle: { title: "dashboard.title" } satisfies AppRouteHandle,
            lazy: lazyPage(() => import("@/routes/app/dashboard"), (m) => m.DashboardPage),
          },
          {
            path: "account",
            handle: { title: "account.title" } satisfies AppRouteHandle,
            lazy: lazyPage(() => import("@/routes/app/account"), (m) => m.AccountPage),
          },
          {
            path: "profile",
            lazy: lazyPage(() => import("@/routes/app/profile"), (m) => m.ProfilePage),
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function createAppRouter(): DataRouter {
  return createBrowserRouter(routes);
}
