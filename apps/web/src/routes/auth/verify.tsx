import { safeReturnTo } from "@imbc/contracts";
import { useSearchParams } from "react-router";
import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { VerifyForm } from "./verify-form";

/** Второй фактор: код из письма при входе с нового устройства (AUTH-03). */
export function VerifyPage() {
  const [params] = useSearchParams();
  const t = useTranslations("verify");
  return (
    <Card>
      <PageTitle />
      <CardHeader>
        <CardTitle className="text-xl">
          <h1>{t("title")}</h1>
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <VerifyForm returnTo={safeReturnTo(params.get("returnTo"))} />
      </CardContent>
    </Card>
  );
}
