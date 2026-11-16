import { DILIGENCE_CHECK_GROUPS, type DiligenceCheckRead } from "@imbc/contracts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFormat } from "@/i18n/format";
import { useTranslations } from "use-intl";
import { useState } from "react";

type Check = Pick<DiligenceCheckRead, "id" | "groupName" | "subjectName" | "checkName" | "adataValue" | "mark" | "attention">;
export function DiligenceCheckList({ checks, showGroup = false }: { checks: readonly Check[]; showGroup?: boolean }) {
  const t = useTranslations("diligence");
  return <ul className="space-y-3">{checks.map(check => <li key={check.id} className="min-w-0 space-y-2 rounded-lg border p-3">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1 break-words"><p className="font-medium">{check.checkName}</p><p className="text-sm text-muted-foreground">{showGroup && `${t(`groups.${check.groupName}`)} · `}{check.subjectName}</p></div>
      <Badge variant={check.mark === "finding" ? "destructive" : "outline"}>{t(`marks.${check.mark}`)}</Badge>
    </div>
    <div className="text-sm"><span className="text-muted-foreground">{t("value")}: </span>
      {/* Adata strings may be exact decimals or JSON counters. Rendering them verbatim never rounds or reclassifies them. */}
      <span className="whitespace-pre-wrap wrap-anywhere">{check.adataValue === null ? t("marks.no_answer") : check.adataValue}</span>
    </div>
  </li>)}</ul>;
}
export function DiligenceChecks({ checks }: { checks: readonly Check[] }) {
  const t = useTranslations("diligence"), format = useFormat();
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const grouped = DILIGENCE_CHECK_GROUPS.map(group => ({ group, checks: checks.filter(check => check.groupName === group) })).filter(group => group.checks.length > 0);
  const critical = checks.filter(check => check.mark === "finding"), attention = checks.filter(check => check.attention);
  return <div className="min-w-0 space-y-5">
    <Card><CardHeader><CardTitle>{t("groupSummary")}</CardTitle></CardHeader><CardContent>
      {grouped.length ? <dl className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{grouped.map(({ group, checks: rows }) => <div key={group} className="rounded-lg bg-muted/50 p-3">
        <dt className="font-medium">{t(`groups.${group}`)}</dt><dd className="mt-1 text-sm text-muted-foreground">{t("counts", { count: rows.length, total: format.number(rows.length), findings: format.number(rows.filter(check => check.mark === "finding").length) })}</dd>
      </div>)}</dl> : <p className="text-sm text-muted-foreground">{t("noChecks")}</p>}
    </CardContent></Card>
    <section aria-label={t("critical")} className="space-y-3"><h2 className="text-lg font-semibold">{t("critical")}</h2>{critical.length ? <DiligenceCheckList checks={critical} showGroup /> : <p className="text-sm text-muted-foreground">{t("noCritical")}</p>}</section>
    <section aria-label={t("attention")} className="space-y-3"><h2 className="text-lg font-semibold">{t("attention")}</h2>{attention.length ? <DiligenceCheckList checks={attention} showGroup /> : <p className="text-sm text-muted-foreground">{t("noAttention")}</p>}</section>
    <section aria-label={t("allChecks")} className="space-y-3"><h2 className="text-lg font-semibold">{t("allChecks")}</h2><p className="text-sm text-muted-foreground">{t("allChecksHint")}</p>
      {grouped.map(({ group, checks: rows }) => <details key={group} className="min-w-0 rounded-lg border p-4" onToggle={event => { const open = event.currentTarget.open; setOpened(previous => previous[group] === open ? previous : { ...previous, [group]: open }); }}>
        <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">{t(`groups.${group}`)} <span className="font-normal text-muted-foreground">({format.number(rows.length)})</span></summary>
        {opened[group] && <div className="mt-4"><DiligenceCheckList checks={rows} /></div>}
      </details>)}
    </section>
  </div>;
}
