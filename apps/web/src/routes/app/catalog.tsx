import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";

import { CatalogView } from "./catalog-view";

/** Каталог производителей; фильтры живут в адресе страницы (OPR-05). */
export function CatalogPage() {
  const t = useTranslations("catalog");
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <PageTitle title={t("title")} />
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <CatalogView />
    </div>
  );
}
