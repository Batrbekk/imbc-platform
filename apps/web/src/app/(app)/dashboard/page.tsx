import { getTranslations } from "next-intl/server";
import { DashboardView } from "./dashboard-view";

export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <DashboardView />
    </div>
  );
}
