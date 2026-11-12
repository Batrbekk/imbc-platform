import type { ReactNode } from "react";

import { PageTitle } from "@/components/app/page-title";

import { useCommonTexts } from "../labels";
import { useSyncStatus } from "../remote";
import { resetProto } from "../store";
import { PrototypeBadge, Release2Badge } from "./badges";
import { ConfirmAction } from "./confirm-action";

/**
 * Каркас страницы прототипа: один `PageTitle`, заголовок, бейдж «Прототип» с пояснением,
 * бейдж «Release 2» по флагу, свои действия и «Сбросить демо-данные». Каждый экран модуля — в нём.
 * Пояснение и текст сброса — по режиму хранилища: этот браузер или все пользователи стенда.
 * `hideReset` убирает кнопку сброса — для кабинета, который ничего не меняет (директор, GEN-04).
 */
export function ProtoPage({
  title,
  description,
  actions,
  release2 = false,
  hideReset = false,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  release2?: boolean;
  hideReset?: boolean;
  children: ReactNode;
}) {
  const t = useCommonTexts();
  // Общий режим (`remote.ts`): изменения и сброс — для всех пользователей стенда.
  const shared = useSyncStatus().mode === "shared";
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <PageTitle title={title} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <PrototypeBadge />
            {release2 && <Release2Badge />}
          </div>
          <p className="text-sm text-muted-foreground">{t(shared ? "prototypeHintShared" : "prototypeHint")}</p>
          {description && <div className="text-sm text-muted-foreground">{description}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {!hideReset && (
            <ConfirmAction
              variant="outline"
              label={t("reset")}
              title={t("resetTitle")}
              description={t(shared ? "resetDescriptionShared" : "resetDescription")}
              confirmLabel={t("reset")}
              onConfirm={resetProto}
            />
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
