import { safeReturnTo } from "@imbc/contracts";
import { ArrowRightIcon, CircleCheckIcon, LockKeyholeIcon } from "lucide-react";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { loginUrl, passwordResetUrl } from "@/lib/api";

const ERRORS = [
  "flow_expired",
  "oidc",
  "no_account",
  "account_inactive",
  "email_unverified",
  "session_expired",
] as const;

export async function generateMetadata() {
  const t = await getTranslations("login");
  return { title: t("title") };
}

/** Вход идёт через BFF: /api/auth/login → Keycloak → /api/auth/callback (ADR-04). */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { returnTo, error, logged_out } = await searchParams;
  const t = await getTranslations("login");
  const common = await getTranslations("common");
  const locale = await getLocale();
  const target = safeReturnTo(returnTo);
  const known = ERRORS.find((e) => e === error) ?? (typeof error === "string" && error ? "oidc" : undefined);
  const signedOut = logged_out === "1" && !known;
  if (!known && !signedOut) redirect(loginUrl(target, locale));

  return (
    <Card className="border-border/70 shadow-lg shadow-primary/5">
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
        <Button asChild className="w-full" size="lg">
          <a href={loginUrl(target, locale, "login")}>
            {t(signedOut ? "signInAgain" : known === "no_account" ? "useAnotherEmail" : "button")}
            <ArrowRightIcon className="size-4" />
          </a>
        </Button>
        <div className="text-center">
          <a
            href={passwordResetUrl(target, locale)}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("forgotPassword")}
          </a>
        </div>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">{t("securityHint")}</p>
      </CardContent>
      <CardFooter className="flex-wrap justify-center gap-x-1 gap-y-2 border-t pt-6 text-sm text-muted-foreground">
        {t("noAccount")}
        <Link href="/register" className="font-medium text-primary hover:underline">
          {common("register")}
        </Link>
      </CardFooter>
    </Card>
  );
}
