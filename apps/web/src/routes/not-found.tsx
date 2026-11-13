import { cn } from "cn";
import { Link } from "react-router";
import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

/** Неизвестный адрес. «/» сам уводит на стартовую страницу роли или на вход. */
export function NotFoundPage() {
  const t = useTranslations("notFound");
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
          <Link className={cn(buttonVariants())} to="/">
            {t("home")}
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}
