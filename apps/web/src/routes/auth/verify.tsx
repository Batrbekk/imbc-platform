import { safeReturnTo } from "@imbc/contracts";
import { useSearchParams } from "react-router";
import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";

import { AuthScreen } from "./auth-screen";
import { VerifyForm } from "./verify-form";

/** Второй фактор: код из письма при входе с нового устройства (AUTH-03). */
export function VerifyPage() {
  const [params] = useSearchParams();
  const t = useTranslations("verify");
  return (
    <AuthScreen title={t("title")} description={t("hint")}>
      <PageTitle title={t("title")} />
      <VerifyForm returnTo={safeReturnTo(params.get("returnTo"))} />
    </AuthScreen>
  );
}
