import { getTranslations } from "next-intl/server";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

/** Профиль производителя: восемь секций и прогресс заполнения (MAN-01…91) — следующий этап. */
export default async function ProfilePage() {
  const t = await getTranslations("nav");
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>{t("profile")}</EmptyTitle>
        <EmptyDescription>MAN-01…MAN-91</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
