import type { Dashboard } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";
import { serializeCatalog } from "@/lib/catalog-params";

/**
 * Ответ дашборда. Пока при выкате ещё отвечает API прежней версии, поля `tier` может не быть:
 * тогда плиток тира нет, а остальные показываются (дашборд — стартовая страница трёх ролей, OPR-31).
 */
type DashboardAnswer = Omit<Dashboard, "tier"> & Partial<Pick<Dashboard, "tier">>;

/**
 * Плитки счётчиков (OPR-32). Плитка со ссылкой открывает каталог с тем же фильтром (OPR-35);
 * у счётчиков актуальности фильтра в каталоге нет. Скелет загрузки — по числу плиток.
 */
const TILES: { label: string; value: (data: DashboardAnswer) => number | undefined; href?: string }[] = [
  { label: "total", value: (d) => d.total, href: "/catalog" },
  { label: "siteSurveyed", value: (d) => d.siteSurveyed, href: `/catalog${serializeCatalog({ surveyed: true })}` },
  {
    label: "unifiedRegister",
    value: (d) => d.unifiedRegister,
    href: `/catalog${serializeCatalog({ unifiedRegister: true })}`,
  },
  // Тир профиля (IMBC-19, IMBC-20, IMBC-22).
  { label: "tier1", value: (d) => d.tier?.tier_1, href: `/catalog${serializeCatalog({ tier: ["tier_1"] })}` },
  { label: "tier2", value: (d) => d.tier?.tier_2, href: `/catalog${serializeCatalog({ tier: ["tier_2"] })}` },
  { label: "active", value: (d) => d.updateStatus.active },
  { label: "outdated", value: (d) => d.updateStatus.outdated },
  { label: "unresponsive", value: (d) => d.updateStatus.unresponsive },
];

export function DashboardPage() {
  const t = useTranslations("dashboard");
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <PageTitle title={t("title")} />
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <DashboardView />
    </div>
  );
}

/** Дашборд (OPR-32): каждый счётчик ведёт в каталог с тем же фильтром (OPR-35). */
function DashboardView() {
  const t = useTranslations("dashboard");
  const common = useTranslations("common");
  const format = useFormat();
  const { data, isError, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardAnswer>("/v1/dashboard"),
  });

  // Сбой запроса — тот же блок с повтором, что в каталоге, а не вечный skeleton (OPR-08).
  if (!data && isError) {
    return (
      <div className="flex items-center justify-between rounded-lg border p-4 text-sm text-destructive">
        {common("error")}
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          {common("retry")}
        </Button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {TILES.map((tile) => (
          <Skeleton key={tile.label} className="h-28" />
        ))}
      </div>
    );
  }

  const maxRegion = Math.max(1, ...data.byRegion.map((r) => r.count));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((tile) => {
          const value = tile.value(data);
          if (value === undefined) return null;
          const card = (
            <Card className="h-full transition-colors hover:border-primary/40">
              <CardHeader>
                <CardDescription>{t(tile.label)}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">{format.number(value)}</CardTitle>
              </CardHeader>
            </Card>
          );
          return tile.href ? (
            <Link key={tile.label} to={tile.href}>
              {card}
            </Link>
          ) : (
            <div key={tile.label}>{card}</div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("byRegion")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.byRegion.map((r) => (
              <Link key={r.region} to={`/catalog${serializeCatalog({ region: [r.region] })}`} className="block">
                <div className="flex justify-between text-sm">
                  <span>{r.region}</span>
                  <span className="tabular-nums text-muted-foreground">{format.number(r.count)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${(r.count / maxRegion) * 100}%` }} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("byGroup")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-5 gap-2">
            {data.byCommodityGroup.map((g) => (
              <Link
                key={g.group}
                to={`/catalog${serializeCatalog({ group: [g.group] })}`}
                className="rounded-lg border p-3 text-center hover:border-primary/40"
              >
                <div className="text-sm text-muted-foreground">{g.group}</div>
                <div className="text-xl font-semibold tabular-nums">{format.number(g.count)}</div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("generatedAt", {
          time: format.dateTime(data.generatedAt),
        })}
      </p>
    </div>
  );
}
