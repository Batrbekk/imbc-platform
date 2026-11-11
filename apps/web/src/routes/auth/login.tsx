import { DEFAULT_LOCALE } from "@imbc/contracts";
import { ArrowRightIcon, CircleCheckIcon, LockKeyholeIcon } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { useLocale, useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { SessionStatus } from "@/components/auth/session-status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { isLocale } from "@/i18n/locale";
import { loginUrl, passwordResetUrl } from "@/lib/api";
import { leaveApp } from "@/lib/leave-app";
import { resolveLoginState } from "@/lib/login-state";

/** Вход идёт через BFF: /api/auth/login → Keycloak → /api/auth/callback (ADR-04). */
export function LoginPage() {
  const [params] = useSearchParams();
  const t = useTranslations("login");
  const common = useTranslations("common");
  const current = useLocale();
  const locale = isLocale(current) ? current : DEFAULT_LOCALE;
  const state = useMemo(() => resolveLoginState(params, locale), [params, locale]);
  const redirectUrl = state.kind === "redirect" ? state.url : undefined;

  // Без ошибки и без выхода страница сразу уходит в BFF; адрес /login не остаётся в истории.
  useEffect(() => {
    if (redirectUrl) leaveApp(redirectUrl, { replace: true });
  }, [redirectUrl]);

  if (state.kind === "redirect") {
    return (
      <>
        <PageTitle title={t("title")} />
        <SessionStatus />
      </>
    );
  }

  const signedOut = state.kind === "signedOut";
  const known = state.kind === "error" ? state.error : undefined;
  return (
    <Card className="border-border/70 shadow-lg shadow-primary/5">
      <PageTitle title={t("title")} />
      <CardHeader className="gap-3">
        <div className="mb-1 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {signedOut ? <CircleCheckIcon className="size-5" /> : <LockKeyholeIcon className="size-5" />}
        </div>
        <CardTitle className="text-2xl">
          <h1>{t(signedOut ? "signedOutTitle" : "title")}</h1>
        </CardTitle>
        <CardDescription>{t(signedOut ? "signedOutDescription" : "subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {known && (
          <Alert variant="destructive">
            <AlertDescription>{t(`errors.${known}`)}</AlertDescription>
          </Alert>
        )}
        <a
          className={buttonVariants({ size: "lg", className: "w-full" })}
          href={loginUrl(state.target, locale, "login")}
        >
          {t(signedOut ? "signInAgain" : known === "no_account" ? "useAnotherEmail" : "button")}
          <ArrowRightIcon className="size-4" />
        </a>
        <div className="text-center">
          <a
            href={passwordResetUrl(state.target, locale)}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("forgotPassword")}
          </a>
        </div>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">{t("securityHint")}</p>
      </CardContent>
      <CardFooter className="flex-wrap justify-center gap-x-1 gap-y-2 border-t pt-6 text-sm text-muted-foreground">
        {t("noAccount")}
        <Link to="/register" className="font-medium text-primary hover:underline">
          {common("register")}
        </Link>
      </CardFooter>
    </Card>
  );
}
