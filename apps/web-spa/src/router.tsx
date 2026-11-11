import { createBrowserRouter, type DataRouter, type RouteObject } from "react-router";

import { AppShell, type AppRouteHandle } from "@/components/app/app-shell";
import { AuthLayout } from "@/routes/auth/layout";
import { LoginPage } from "@/routes/auth/login";
import { RegisterPage } from "@/routes/auth/register";
import { ResponsibilityPage } from "@/routes/auth/responsibility";
import { VerifyPage } from "@/routes/auth/verify";
import { HomePage } from "@/routes/home";
import { NotFoundPage } from "@/routes/not-found";
import { Root, RootFallback } from "@/routes/root";

/** Маршруты приложения. Страницы — дети корня; «*» остаётся последним. */
export const routes: RouteObject[] = [
  {
    element: <Root />,
    // Ленивые страницы: до загрузки чанка первой открытой страницы роутер показывает это.
    HydrateFallback: RootFallback,
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
        // Рабочие страницы за проверкой сеанса; каждая — отдельный чанк, экраны входа — в основном.
        element: <AppShell />,
        children: [
          {
            path: "catalog",
            handle: { title: "catalog.title" } satisfies AppRouteHandle,
            lazy: async () => ({ Component: (await import("@/routes/app/catalog")).CatalogPage }),
          },
          {
            path: "dashboard",
            handle: { title: "dashboard.title" } satisfies AppRouteHandle,
            lazy: async () => ({ Component: (await import("@/routes/app/dashboard")).DashboardPage }),
          },
          {
            path: "account",
            handle: { title: "account.title" } satisfies AppRouteHandle,
            lazy: async () => ({ Component: (await import("@/routes/app/account")).AccountPage }),
          },
          {
            path: "profile",
            lazy: async () => ({ Component: (await import("@/routes/app/profile")).ProfilePage }),
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
