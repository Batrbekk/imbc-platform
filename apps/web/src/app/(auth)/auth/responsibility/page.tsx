import { safeReturnTo } from "@imbc/contracts";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AcceptButton } from "./accept-button";

/** Диалог ответственности при первом входе (AUTH-10). Без согласия остальные маршруты закрыты. */
export default async function ResponsibilityPage({ searchParams }: PageProps<"/auth/responsibility">) {
  const { returnTo } = await searchParams;
  const t = await getTranslations("responsibility");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          <h1>{t("title")}</h1>
        </CardTitle>
        <CardDescription className="text-base leading-relaxed text-foreground">{t("text")}</CardDescription>
      </CardHeader>
      <CardContent>
        <AcceptButton returnTo={safeReturnTo(returnTo)} />
      </CardContent>
    </Card>
  );
}
