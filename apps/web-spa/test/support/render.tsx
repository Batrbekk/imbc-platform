import { DEFAULT_LOCALE, type Locale } from "@imbc/contracts";
import { render } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { createMemoryRouter, createPath, RouterProvider, type RouteObject } from "react-router";
import { afterEach } from "vitest";

import { Providers } from "@/components/app/providers";
import type { Messages } from "@/i18n/messages";
import { createQueryClient } from "@/lib/query-client";
import { routes as appRoutes } from "@/router";

import en from "../../messages/en.json";
import kk from "../../messages/kk.json";
import ru from "../../messages/ru.json";

const MESSAGES: Record<Locale, Messages> = { en, kk, ru };

const routers = new Set<ReturnType<typeof createMemoryRouter>>();
afterEach(() => {
  for (const router of routers) router.dispose();
  routers.clear();
});

/**
 * Открывает адрес в маршрутах приложения (или в своих `routes`) внутри тех же провайдеров,
 * что и main.tsx. Язык по умолчанию — kk, как у пользователя без cookie (LANG-01).
 * Повторов запросов нет, чтобы ошибки API проверялись сразу.
 */
export function renderRoute(
  entry: string,
  options: { locale?: Locale; routes?: RouteObject[] } = {},
): { router: ReturnType<typeof createMemoryRouter>; user: UserEvent } {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  const router = createMemoryRouter(options.routes ?? appRoutes, { initialEntries: [entry] });
  routers.add(router);
  // nuqs (адаптер React Router) читает и пишет адрес окна, а не роутера. В браузере они совпадают;
  // здесь окно повторяет адрес memory-роутера, чтобы фильтры каталога видели тот же адрес.
  window.history.replaceState(null, "", entry);
  router.subscribe((state) => window.history.replaceState(null, "", createPath(state.location)));
  document.documentElement.lang = locale;
  const user = userEvent.setup();
  render(
    <Providers initialLocale={locale} initialMessages={MESSAGES[locale]} queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { router, user };
}
