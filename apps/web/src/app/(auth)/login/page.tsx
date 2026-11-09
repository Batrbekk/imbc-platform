import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { loginUrl } from "@/lib/api";

const ERRORS = ["flow_expired", "oidc", "no_account"] as const;

/** Вход идёт через BFF: /api/auth/login → Keycloak → /api/auth/callback (ADR-04). */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { returnTo, error } = await searchParams;
  const t = await getTranslations("login");
  const common = await getTranslations("common");
  const locale = await getLocale();
  const target = typeof returnTo === "string" && returnTo.startsWith("/") ? returnTo : "/catalog";
  const known = ERRORS.find((e) => e === error);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {known && (
          <Alert variant="destructive">
            <AlertDescription>{t(`errors.${known}`)}</AlertDescription>
          </Alert>
        )}
        <Button asChild className="w-full" size="lg">
          <a href={loginUrl(target, locale)}>{t("button")}</a>
        </Button>
      </CardContent>
      <CardFooter className="justify-center gap-1 text-sm text-muted-foreground">
        {t("noAccount")}
        <Link href="/register" className="font-medium text-primary hover:underline">
          {common("register")}
        </Link>
      </CardFooter>
    </Card>
  );
}
