import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifyForm } from "./verify-form";

export default async function VerifyPage({ searchParams }: PageProps<"/auth/verify">) {
  const { returnTo } = await searchParams;
  const t = await getTranslations("verify");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("title")}</CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <VerifyForm returnTo={typeof returnTo === "string" && returnTo.startsWith("/") ? returnTo : "/catalog"} />
      </CardContent>
    </Card>
  );
}
