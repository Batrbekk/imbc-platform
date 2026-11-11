import { createBrowserRouter, type DataRouter, type RouteObject } from "react-router";

import { AuthLayout } from "@/routes/auth/layout";
import { LoginPage } from "@/routes/auth/login";
import { RegisterPage } from "@/routes/auth/register";
import { ResponsibilityPage } from "@/routes/auth/responsibility";
import { VerifyPage } from "@/routes/auth/verify";
import { HomePage } from "@/routes/home";
import { NotFoundPage } from "@/routes/not-found";
import { Root } from "@/routes/root";

/** Маршруты приложения. Страницы — дети корня; «*» остаётся последним. */
export const routes: RouteObject[] = [
  {
    element: <Root />,
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
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function createAppRouter(): DataRouter {
  return createBrowserRouter(routes);
}
