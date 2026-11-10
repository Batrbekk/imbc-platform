import { Building2Icon } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ProfilePage() {
  const t = await getTranslations("profile");
  const nav = await getTranslations("nav");
  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2Icon className="size-5 text-primary" />
          {nav("profile")}
        </CardTitle>
        <CardDescription>{t("welcome")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("accountHint")}</p>
        <Button asChild variant="outline">
          <Link href="/account">{nav("account")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
