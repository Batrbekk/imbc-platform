import { DEFAULT_LOCALE } from "@imbc/contracts";
import { cn } from "cn";
import { ArrowRightIcon } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { useLocale, useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { SessionStatus } from "@/components/auth/session-status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { isLocale } from "@/i18n/locale";
import { loginUrl, passwordResetUrl } from "@/lib/api";
import { leaveApp } from "@/lib/leave-app";
import { resolveLoginState } from "@/lib/login-state";

import { AuthScreen } from "./auth-screen";

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
    <AuthScreen
      title={t(signedOut ? "signedOutTitle" : "title")}
      description={t(signedOut ? "signedOutDescription" : "subtitle")}
      footer={
        <>
          {t("noAccount")}
          <Link to="/register" className="font-medium text-primary underline-offset-4 hover:underline">
            {common("register")}
          </Link>
        </>
      }
    >
      <PageTitle title={t("title")} />
      {known && (
        <Alert variant="destructive">
          <AlertDescription>{t(`errors.${known}`)}</AlertDescription>
        </Alert>
      )}
      <a
        className={cn(buttonVariants({ size: "lg", className: "w-full" }))}
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
    </AuthScreen>
  );
}
