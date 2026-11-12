import { ROLES, type Role } from "@imbc/contracts";
import { Suspense, use, useEffect } from "react";
import { Link, Navigate, type RouteObject, useLocation, useParams, useRoutes } from "react-router";
import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { reloadApp } from "@/lib/leave-app";
import { clearReloadFlag } from "@/lib/reload-guard";
import { authDestination, useMe } from "@/lib/session";

import { PROTOTYPE_RELOAD, ProtoBoundary } from "./boundary";
import { useCommonTexts } from "./labels";
import { loadCabinet } from "./registry";
import { resetProto } from "./store";

const isRole = (value: unknown): value is Role => (ROLES as readonly unknown[]).includes(value);

/**
 * Шлюз роли для `/proto/<role>/*` (GEN-08 на уровне интерфейса). Оболочка уже проверила сеанс;
 * чужой модуль по прямому адресу не открывается — переход на стартовую страницу своей роли
 * (`authDestination`), неизвестная роль или экран — «не найдено». Ошибка модуля или экрана (в том
 * числе из-за повреждённых демо-данных) остаётся внутри оболочки: сообщение и сброс демо-данных.
 */
export function PrototypeGate() {
  const { role } = useParams();
  const { pathname } = useLocation();
  const me = useMe().data;
  if (!me) return null;
  if (!isRole(role)) return <ProtoNotFound />;
  if (role !== me.user.role) return <Navigate to={authDestination(me)} replace />;
  return (
    // Новый адрес снимает сбой экрана, но не перемонтирует дерево: layout-маршруты модуля сохраняют
    // своё состояние. Чанк модуля не загрузился — одна перезагрузка, затем сообщение (boundary.tsx).
    <ProtoBoundary
      resetKey={pathname}
      fallback={(retry) => <ProtoScreenError retry={retry} />}
      chunkFallback={<ProtoChunkError />}
    >
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <CabinetRoutes role={role} />
      </Suspense>
    </ProtoBoundary>
  );
}

/** Пути модуля сравниваются с учётом регистра, как маршруты приложения (`router.tsx`). */
function caseSensitive(route: RouteObject): RouteObject {
  if (route.index) return route;
  return { ...route, caseSensitive: true, children: route.children?.map(caseSensitive) };
}

/** Маршруты модуля относительно `/proto/<role>/`; неизвестный экран — «не найдено». */
function CabinetRoutes({ role }: { role: Role }) {
  const cabinet = use(loadCabinet(role));
  // Модуль загрузился: следующий недоступный чанк снова может перезагрузить страницу один раз.
  useEffect(() => clearReloadFlag(PROTOTYPE_RELOAD), []);
  return useRoutes([...cabinet.routes.map(caseSensitive), { path: "*", element: <ProtoNotFound /> }]);
}

/**
 * Чанк кабинета не загрузился и после перезагрузки: сообщение без сброса демо-данных (данные целы,
 * сброс не помог бы) и кнопка перезагрузки вручную. Оболочка и готовые страницы на месте.
 */
function ProtoChunkError() {
  const t = useCommonTexts();
  const routeError = useTranslations("routeError");
  return (
    <Empty>
      <PageTitle title={t("chunkError")} />
      <EmptyHeader>
        <EmptyTitle>
          <h1 className="text-xl">{t("chunkError")}</h1>
        </EmptyTitle>
        <EmptyDescription>{t("chunkErrorHint")}</EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" onClick={() => reloadApp()}>
        {routeError("reload")}
      </Button>
    </Empty>
  );
}

/** Экран прототипа упал: сообщение на языке интерфейса и сброс демо-данных с новой отрисовкой. */
function ProtoScreenError({ retry }: { retry: () => void }) {
  const t = useCommonTexts();
  return (
    <Empty>
      <PageTitle title={t("screenError")} />
      <EmptyHeader>
        <EmptyTitle>
          <h1 className="text-xl">{t("screenError")}</h1>
        </EmptyTitle>
        <EmptyDescription>{t("screenErrorHint")}</EmptyDescription>
      </EmptyHeader>
      <Button
        onClick={() => {
          resetProto();
          retry();
        }}
      >
        {t("reset")}
      </Button>
    </Empty>
  );
}

/** «Не найдено» внутри оболочки: тексты и ссылка — как у страницы `*`. */
function ProtoNotFound() {
  const t = useTranslations("notFound");
  return (
    <Empty>
      <PageTitle title={t("title")} />
      <EmptyHeader>
        <EmptyTitle>
          <h1 className="text-xl">{t("title")}</h1>
        </EmptyTitle>
        <EmptyDescription>{t("description")}</EmptyDescription>
      </EmptyHeader>
      <Link className={buttonVariants()} to="/">
        {t("home")}
      </Link>
    </Empty>
  );
}
