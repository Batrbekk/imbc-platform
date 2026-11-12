import { safeReturnTo } from "@imbc/contracts";
import { useSearchParams } from "react-router";
import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { AcceptButton } from "./accept-button";

/** Диалог ответственности при первом входе (AUTH-10). Без согласия остальные маршруты закрыты. */
export function ResponsibilityPage() {
  const [params] = useSearchParams();
  const t = useTranslations("responsibility");
  return (
    <Card>
      <PageTitle title={t("title")} />
      <CardHeader>
        <CardTitle className="text-xl">
          <h1>{t("title")}</h1>
        </CardTitle>
        <CardDescription className="text-base leading-relaxed text-foreground">{t("text")}</CardDescription>
      </CardHeader>
      <CardContent>
        <AcceptButton returnTo={safeReturnTo(params.get("returnTo"))} />
      </CardContent>
    </Card>
  );
}
