import { safeReturnTo } from "@imbc/contracts";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifyForm } from "./verify-form";

export default async function VerifyPage({ searchParams }: PageProps<"/auth/verify">) {
  const { returnTo } = await searchParams;
  const t = await getTranslations("verify");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          <h1>{t("title")}</h1>
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <VerifyForm returnTo={safeReturnTo(returnTo)} />
      </CardContent>
    </Card>
  );
}
