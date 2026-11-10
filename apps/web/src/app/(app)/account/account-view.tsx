"use client";

import { KeyRoundIcon, ShieldCheckIcon, UserRoundIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { SessionExit } from "@/components/auth/session-exit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { passwordResetUrl } from "@/lib/api";
import { useMe } from "@/lib/session";

export function AccountView() {
  const t = useTranslations("account");
  const roles = useTranslations("roles");
  const locale = useLocale();
  const { data } = useMe();
  if (!data) return null;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRoundIcon className="size-5 text-primary" />
            {t("details")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1">
              <dt className="text-sm text-muted-foreground">{t("email")}</dt>
              <dd className="break-all font-medium">{data.user.email}</dd>
            </div>
            <div className="space-y-2">
              <dt className="text-sm text-muted-foreground">{t("role")}</dt>
              <dd>
                <Badge variant="secondary">{roles(data.user.role)}</Badge>
              </dd>
            </div>
            {data.user.fullName && (
              <div className="space-y-1">
                <dt className="text-sm text-muted-foreground">{t("name")}</dt>
                <dd className="font-medium">{data.user.fullName}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-5 text-primary" />
            {t("security")}
          </CardTitle>
          <CardDescription>{t("securityHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild variant="outline">
            <a href={passwordResetUrl("/account", locale)}>
              <KeyRoundIcon className="size-4" />
              {t("resetPassword")}
            </a>
          </Button>
          <Separator />
          <SessionExit />
        </CardContent>
      </Card>
    </div>
  );
}
