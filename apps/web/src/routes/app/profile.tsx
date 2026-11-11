import { Building2Icon } from "lucide-react";
import { Link } from "react-router";
import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Рабочее место производителя. Во вкладке — только название платформы: PageTitle без заголовка страницы. */
export function ProfilePage() {
  const t = useTranslations("profile");
  const nav = useTranslations("nav");
  return (
    <Card className="mx-auto max-w-3xl">
      <PageTitle />
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2Icon className="size-5 text-primary" />
          {nav("profile")}
        </CardTitle>
        <CardDescription>{t("welcome")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("accountHint")}</p>
        <Link className={buttonVariants({ variant: "outline" })} to="/account">
          {nav("account")}
        </Link>
      </CardContent>
    </Card>
  );
}
