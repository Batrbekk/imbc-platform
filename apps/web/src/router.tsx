import type { ComponentType } from "react";
import { createBrowserRouter, type DataRouter, type RouteObject } from "react-router";

import type { AppRouteHandle } from "@/components/app/app-shell";
import { AuthLayout } from "@/routes/auth/layout";
import { LoginPage } from "@/routes/auth/login";
import { RegisterPage } from "@/routes/auth/register";
import { ResponsibilityPage } from "@/routes/auth/responsibility";
import { VerifyPage } from "@/routes/auth/verify";
import { HomePage } from "@/routes/home";
import { NotFoundPage } from "@/routes/not-found";
import { Root, RootFallback } from "@/routes/root";
import { RouteError } from "@/routes/route-error";

/**
 * Ленивый маршрут: свой чанк на страницу (и на оболочку). Флаг перезагрузки здесь не снимается:
 * оболочка и страница грузятся параллельно, и загруженная оболочка при упавшей странице
 * зациклила бы перезагрузки. Флаг снимает Root, когда вся ветка отрисовалась (см. RouteError).
 */
function lazyPage<M>(load: () => Promise<M>, pick: (module: M) => ComponentType) {
  return async () => ({ Component: pick(await load()) });
}

/**
 * Пути сравниваются с учётом регистра: по умолчанию React Router принял бы `/CATALOG` за каталог,
 * а шлюз роли сравнивает путь буквально и пропустил бы его. Теперь такой адрес — «не найдено».
 */
function caseSensitive(route: RouteObject): RouteObject {
  if (route.index) return route;
  return { ...route, caseSensitive: true, children: route.children?.map(caseSensitive) };
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
        // Экраны входа: на эти адреса ведут редиректы BFF, поэтому они не меняются (ADR-04).
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
            // Очередь проверки SME (REV-01, REV-04).
            path: "reviews",
            handle: { title: "reviews.title" } satisfies AppRouteHandle,
            lazy: lazyPage(() => import("@/routes/app/reviews"), (m) => m.ReviewsPage),
          },
          {
            path: "catalog",
            handle: { title: "catalog.title" } satisfies AppRouteHandle,
            lazy: lazyPage(() => import("@/routes/app/catalog"), (m) => m.CatalogPage),
          },
          {
            // Страница компании из каталога (OPR-06, OPR-09); заголовок вкладки — название компании.
            path: "companies/:profileId",
            handle: { title: "company.title" } satisfies AppRouteHandle,
            lazy: lazyPage(() => import("@/routes/app/company"), (m) => m.CompanyPage),
          },
          {
            path: "dashboard",
            handle: { title: "dashboard.title" } satisfies AppRouteHandle,
            lazy: lazyPage(() => import("@/routes/app/dashboard"), (m) => m.DashboardPage),
          },
          {
            // Организации и аккаунты для администратора (ADM-02, ADM-06).
            path: "admin/accounts",
            handle: { title: "adminAccounts.title" } satisfies AppRouteHandle,
            lazy: lazyPage(() => import("@/routes/app/admin-accounts"), (m) => m.AdminAccountsPage),
          },
          {
            path: "account",
            handle: { title: "account.title" } satisfies AppRouteHandle,
            lazy: lazyPage(() => import("@/routes/app/account"), (m) => m.AccountPage),
          },
          {
            path: "profile",
            handle: { title: "nav.profile" } satisfies AppRouteHandle,
            lazy: lazyPage(() => import("@/routes/app/profile"), (m) => m.ProfilePage),
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
].map(caseSensitive);

export function createAppRouter(): DataRouter {
  return createBrowserRouter(routes);
}
