import { useEffect, useState } from "react";
import { useRouteError } from "react-router";
import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { SessionStatus } from "@/components/auth/session-status";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { reloadApp } from "@/lib/leave-app";
import { canReload, isChunkLoadError, LAZY_RELOAD, reloadOnce } from "@/lib/reload-guard";

/**
 * Ошибка любого маршрута. Чанк ленивой страницы не загрузился (вкладка старше выката) —
 * одна перезагрузка подтянет свежую сборку; иначе — сообщение на языке пользователя (LANG-02).
 */
export function RouteError() {
  const error = useRouteError();
  const t = useTranslations("routeError");
  // Решение принимается при первом рендере; сама перезагрузка — в эффекте. Повторный запуск
  // эффекта (StrictMode) видит выставленный флаг и второй раз не перезагружает.
  const [reloading] = useState(() => isChunkLoadError(error) && canReload(LAZY_RELOAD));
  useEffect(() => {
    if (reloading) reloadOnce(LAZY_RELOAD);
  }, [reloading]);

  if (reloading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <PageTitle />
        <SessionStatus />
      </div>
    );
  }
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <PageTitle title={t("title")} />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl">{t("title")}</h1>
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={() => reloadApp()}>{t("reload")}</Button>
        </CardFooter>
      </Card>
    </main>
  );
}
