import { DEFAULT_LOCALE, type Locale } from "@imbc/contracts";
import { render } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";

import { Providers } from "@/components/app/providers";
import type { Messages } from "@/i18n/messages";
import { createQueryClient } from "@/lib/query-client";
import { routes as appRoutes } from "@/router";

import en from "../../messages/en.json";
import kk from "../../messages/kk.json";
import ru from "../../messages/ru.json";

const MESSAGES: Record<Locale, Messages> = { en, kk, ru };

// ScrollRestoration корня прокручивает окно, а jsdom вместо прокрутки пишет «Not implemented».
window.scrollTo = () => {};

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
  document.documentElement.lang = locale;
  const user = userEvent.setup();
  render(
    <Providers initialLocale={locale} initialMessages={MESSAGES[locale]} queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { router, user };
}
