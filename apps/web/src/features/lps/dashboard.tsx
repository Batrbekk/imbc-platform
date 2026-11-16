import { entryDisplayName, type LpsDashboard as DashboardData, type LpsReferenceBase } from "@imbc/contracts";
import { useLocale, useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFormat } from "@/i18n/format";
export function LpsDashboard({ data, drilldown }: { data: DashboardData; drilldown: (key: string, value: string) => void }) {
  const t = useTranslations("lps"), locale = useLocale() as "en" | "ru" | "kk", format = useFormat();
  const name = (item: LpsReferenceBase | null) => item ? entryDisplayName(item.names, locale, item.code) : t("unknown");
  const groups = [{ title: "columns.status", key: "statusIds", values: data.statuses }, { title: "columns.regions", key: "regionIds", values: data.regions }, { title: "columns.commodityGroups", key: "commodityGroupIds", values: data.commodityGroups }];
  return <div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Card><CardHeader><CardTitle>{t("totalEntries")}</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{format.number(data.totalEntries)}</CardContent></Card>
    <Card><CardHeader><CardTitle>{t("totalCompanies")}</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{format.number(data.totalCompanies)}</CardContent></Card></div>
    <p className="text-sm text-muted-foreground">{t("dashboardHint")}</p><div className="grid gap-4 lg:grid-cols-3">{groups.map((group) => <Card key={group.key}><CardHeader><CardTitle>{t(group.title)}</CardTitle></CardHeader><CardContent className="space-y-2">
      {group.values.map((bucket) => <Button key={bucket.reference?.id ?? "unknown"} type="button" variant="outline" className="h-auto min-h-10 w-full justify-between gap-3 whitespace-normal text-left" aria-label={t("drilldown", { name: name(bucket.reference), count: format.number(bucket.count) })} onClick={() => drilldown(group.key, bucket.reference?.id ?? "unknown")}>
        <span>{name(bucket.reference)}</span><span className="font-semibold">{format.number(bucket.count)}</span></Button>)}{group.values.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
    </CardContent></Card>)}</div></div>;
}
