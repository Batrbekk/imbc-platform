import type { SiteSurveySummary } from "@imbc/contracts";
import { useTranslations } from "use-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useFormat } from "@/i18n/format";

/** The server selects across all records; a paged browser list cannot derive the current mark. */
export function SurveySummary({ summary, tier }: { summary: SiteSurveySummary; tier: 1 | 2 | null }) {
  const t = useTranslations("siteSurvey"), catalog = useTranslations("catalog"), format = useFormat();
  return <Card><CardContent className="min-w-0 space-y-3"><div className="flex flex-wrap gap-2">
    <Badge variant={summary.siteSurveyed ? "default" : "secondary"}>{t(summary.siteSurveyed ? "surveyed" : "notSurveyed")}</Badge>
    {tier !== null && <Badge variant="outline">{catalog(`tierValue.tier_${tier}`)}</Badge>}
  </div>{summary.siteSurveyed && <p className="text-sm">{t("selectedVisitDate", { date: format.date(summary.siteSurveyedOn) })}</p>}
    <p className="text-sm text-muted-foreground">{t("summaryHint")}</p>
  </CardContent></Card>;
}
