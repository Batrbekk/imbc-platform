import { useEffect, useRef, useState } from "react";
import { useRouteError } from "react-router";
import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { reloadApp } from "@/lib/leave-app";
import { canReload, isChunkLoadError, LAZY_RELOAD, type ReloadOutcome, reloadOnce } from "@/lib/reload-guard";

/**
 * Ошибка любого маршрута. Чанк ленивой страницы не загрузился (вкладка старше выката) —
 * одна перезагрузка подтянет свежую сборку; иначе — сообщение на языке пользователя (LANG-02).
 */
export function RouteError() {
  const error = useRouteError();
  const t = useTranslations("routeError");
  const common = useTranslations("common");
  // Решение принимается при первом рендере; сама перезагрузка — в эффекте, один раз на экземпляр
  // (повторный запуск эффекта в StrictMode её не повторяет).
  const [reloading, setReloading] = useState(() => isChunkLoadError(error) && canReload(LAZY_RELOAD));
  const attempt = useRef<ReloadOutcome | null>(null);

  useEffect(() => {
    // Иначе исключение при вычислении модуля страницы пряталось бы за общим экраном.
    if (import.meta.env.DEV) console.error(error);
  }, [error]);

  useEffect(() => {
    if (!reloading || attempt.current) return;
    attempt.current = reloadOnce(LAZY_RELOAD);
    // Проба записи прошла, а запись флага — нет: перезагрузка не запомнилась бы, поэтому экран ошибки.
    if (attempt.current !== "reloaded") setReloading(false);
  }, [reloading]);

  if (reloading) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4" role="status">
        <PageTitle />
        <Spinner className="size-6 text-primary" />
        <p className="text-sm text-muted-foreground">{common("loading")}</p>
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
