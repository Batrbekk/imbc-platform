import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { CatalogView } from "./catalog-view";

export async function generateMetadata() {
  const t = await getTranslations("catalog");
  return { title: t("title") };
}

export default async function CatalogPage() {
  const t = await getTranslations("catalog");
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <CatalogView />
      </Suspense>
    </div>
  );
}
