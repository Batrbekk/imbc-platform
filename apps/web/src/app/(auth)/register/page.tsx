import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RegisterForm } from "./register-form";

export async function generateMetadata() {
  const t = await getTranslations("register");
  return { title: t("title") };
}

export default async function RegisterPage() {
  const t = await getTranslations("register");
  return (
    <Card>
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
