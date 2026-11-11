import { createBrowserRouter, type DataRouter, type RouteObject } from "react-router";

import { NotFoundPage } from "@/routes/not-found";
import { Root } from "@/routes/root";

/** Маршруты приложения. Страницы — дети корня; «*» остаётся последним. */
export const routes: RouteObject[] = [
  {
    element: <Root />,
    children: [{ path: "*", element: <NotFoundPage /> }],
  },
];

export function createAppRouter(): DataRouter {
  return createBrowserRouter(routes);
}
