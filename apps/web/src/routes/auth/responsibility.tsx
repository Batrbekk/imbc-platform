import { safeReturnTo } from "@imbc/contracts";
import { useSearchParams } from "react-router";
import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";

import { AcceptButton } from "./accept-button";
import { AuthScreen } from "./auth-screen";

/** Диалог ответственности при первом входе (AUTH-10). Без согласия остальные маршруты закрыты. */
export function ResponsibilityPage() {
  const [params] = useSearchParams();
  const t = useTranslations("responsibility");
  return (
    <AuthScreen title={t("title")}>
      <PageTitle title={t("title")} />
      {/* Текст согласия — не пояснение к заголовку: полным цветом и по левому краю. */}
      <p className="text-base leading-relaxed">{t("text")}</p>
      <AcceptButton returnTo={safeReturnTo(params.get("returnTo"))} />
    </AuthScreen>
  );
}
