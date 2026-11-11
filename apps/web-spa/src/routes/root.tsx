import { NuqsAdapter } from "nuqs/adapters/react-router/v8";
import { Outlet, ScrollRestoration } from "react-router";

/** Корень маршрутов: фильтры каталога в адресе через nuqs (OPR-05) и восстановление прокрутки. */
export function Root() {
  return (
    <NuqsAdapter>
      <Outlet />
      <ScrollRestoration />
    </NuqsAdapter>
  );
}
