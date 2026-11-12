import type { OwnProfile } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { Building2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";

import { AdataReadCard } from "./profile-adata";

/**
 * Профиль своей компании, только для чтения (MAN-41, MAN-46, IMBC-22). Сервер отдаёт только профиль
 * организации сеанса (GEN-11). Заголовок страницы и вкладки — «Профиль компании».
 */
export function ProfilePage() {
  const t = useTranslations("profile");
  const nav = useTranslations("nav");
  const common = useTranslations("common");
  const result = useQuery({ queryKey: ["profile", "own"], queryFn: () => api<OwnProfile>("/v1/profiles/own") });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageTitle title={nav("profile")} />
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <Building2Icon className="size-6 text-primary" />
        {nav("profile")}
      </h1>

      {result.data ? (
        <>
          <ProfileView profile={result.data} />
          {/* Чтение Adata — свой запрос; без профиля его нет. */}
          <AdataReadCard />
        </>
      ) : result.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t("loadError")}</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void result.refetch()}>
              {common("retry")}
            </Button>
          </AlertAction>
        </Alert>
      ) : (
        <Skeleton className="h-80" />
      )}

      <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
        <p>{t("readOnlyHint")}</p>
        <p>{t("accountHint")}</p>
        <Link className={buttonVariants({ variant: "outline" })} to="/account">
          {nav("account")}
        </Link>
      </div>
    </div>
  );
}

function ProfileView({ profile }: { profile: OwnProfile }) {
  const t = useTranslations("profile");
  const catalog = useTranslations("catalog");
  const format = useFormat();

  return (
    <Card>
      <CardContent>
        <dl className="grid gap-3 text-sm">
          <Field label={t("company")}>{profile.organizationName}</Field>
          <Field label={t("bin")}>
            <span className="font-mono">{profile.bin}</span>
          </Field>
          <Field label={t("status")}>
            <span className="flex flex-wrap gap-1">
              <Badge variant={profile.status === "verified" ? "default" : "secondary"}>
                {t(`statusValue.${profile.status}`)}
              </Badge>
              {profile.hasPendingChanges && <Badge variant="outline">{t("pendingChanges")}</Badge>}
            </span>
          </Field>
          <Field label={t("completeness")}>{format.number(profile.completenessPct)}&nbsp;%</Field>
          {/* Статус актуальности и тир есть только у верифицированного профиля (раздел 5.5, IMBC-19). */}
          <Field label={t("updateStatus")}>
            {profile.updateStatus ? catalog(`status.${profile.updateStatus}`) : t("notVerifiedYet")}
          </Field>
          <Field label={t("tier")}>{profile.tier ? catalog(`tierValue.${profile.tier}`) : t("notVerifiedYet")}</Field>
          <Field label={t("registeredAt")}>{format.date(profile.registeredAt)}</Field>
          <Field label={t("verifiedAt")}>{format.date(profile.verifiedAt)}</Field>
        </dl>
      </CardContent>
    </Card>
  );
}

/** Строка «подпись — значение» карточки. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
