import type { SiteSurveyCurrentReport } from "@imbc/contracts";
import { useTranslations } from "use-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFormat } from "@/i18n/format";
import { SurveyReport } from "./report";

/** OPR-10 projection only: no Class C result, comment, source, author, history or queries. */
export function SurveyCompanyReport({ current }: { current: SiteSurveyCurrentReport | null }) {
  const t = useTranslations("siteSurvey"), format = useFormat();
  if (!current) return null;
  return <Card className="min-w-0"><CardHeader><CardTitle>{t("companyEvidence")}</CardTitle></CardHeader><CardContent className="min-w-0 space-y-4">
    <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">{t("visitStartedOn")}</dt><dd>{format.date(current.visitStartedOn)}</dd></div>
      <div><dt className="text-muted-foreground">{t("visitEndedOn")}</dt><dd>{current.visitEndedOn === null ? t("notProvided") : format.date(current.visitEndedOn)}</dd></div>
      <div><dt className="text-muted-foreground">{t("expiresOn")}</dt><dd>{current.expiresOn === null ? t("noExpiry") : format.date(current.expiresOn)}</dd></div>
    </dl><SurveyReport file={current.report} label={t("report")} />
  </CardContent></Card>;
}
