import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";

import { AuthScreen } from "./auth-screen";
import { RegisterForm } from "./register-form";

/** Самостоятельная регистрация производителя (MAN-02, AUTH-01). */
export function RegisterPage() {
  const t = useTranslations("register");
  return (
    <AuthScreen wide title={t("title")} description={t("subtitle")}>
      <PageTitle title={t("title")} />
      <RegisterForm />
    </AuthScreen>
  );
}
