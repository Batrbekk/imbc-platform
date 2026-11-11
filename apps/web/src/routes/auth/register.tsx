import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { RegisterForm } from "./register-form";

/** Самостоятельная регистрация производителя (MAN-02, AUTH-01). */
export function RegisterPage() {
  const t = useTranslations("register");
  return (
    <Card>
      <PageTitle title={t("title")} />
      <CardHeader>
        <CardTitle className="text-xl">
          <h1>{t("title")}</h1>
        </CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <RegisterForm />
      </CardContent>
    </Card>
  );
}
