import { ROLES, type Role } from "@imbc/contracts";
import { Suspense, use } from "react";
import { Link, Navigate, useParams, useRoutes } from "react-router";
import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { authDestination, useMe } from "@/lib/session";

import { loadCabinet } from "./registry";

const isRole = (value: unknown): value is Role => (ROLES as readonly unknown[]).includes(value);

/**
 * Шлюз роли для `/proto/<role>/*` (GEN-08 на уровне интерфейса). Оболочка уже проверила сеанс;
 * чужой модуль по прямому адресу не открывается — переход на стартовую страницу своей роли
 * (`authDestination`), неизвестная роль или экран — «не найдено».
 */
export function PrototypeGate() {
  const { role } = useParams();
  const me = useMe().data;
  if (!me) return null;
  if (!isRole(role)) return <ProtoNotFound />;
  if (role !== me.user.role) return <Navigate to={authDestination(me)} replace />;
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <CabinetRoutes role={role} />
    </Suspense>
  );
}

/** Маршруты модуля относительно `/proto/<role>/`; неизвестный экран — «не найдено». */
function CabinetRoutes({ role }: { role: Role }) {
  const cabinet = use(loadCabinet(role));
  return useRoutes([...cabinet.routes, { path: "*", element: <ProtoNotFound /> }]);
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
