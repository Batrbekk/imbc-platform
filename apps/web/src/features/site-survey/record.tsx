import type { SiteSurveyRecordView } from "@imbc/contracts";
import { useTranslations } from "use-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFormat } from "@/i18n/format";
import { SurveyReport } from "./report";

/** Full Class C record supplied by the guarded record/history API, never the company projection. */
export function SurveyRecord({ record, selected = false }: { record: SiteSurveyRecordView; selected?: boolean }) {
  const t = useTranslations("siteSurvey"), common = useTranslations("common"), format = useFormat();
  return <Card className="min-w-0"><CardHeader><CardTitle>{t("visitOn", { date: format.date(record.visitStartedOn) })}</CardTitle>
    <div className="flex flex-wrap gap-2"><Badge variant="secondary">{t("result")}: {common(record.result === "yes" ? "yes" : "no")}</Badge>
      {selected && <Badge variant="outline">{t("selectedCurrentReport")}</Badge>}{record.needsReconciliation && <Badge variant="outline" className="whitespace-normal">{t("needsReconciliation")}</Badge>}
    </div></CardHeader><CardContent className="min-w-0 space-y-4">
    <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">{t("visitStartedOn")}</dt><dd>{record.visitStartedOn === null ? t("unknownVisitDate") : format.date(record.visitStartedOn)}</dd></div>
      <div><dt className="text-muted-foreground">{t("visitEndedOn")}</dt><dd>{record.visitEndedOn === null ? t("notProvided") : format.date(record.visitEndedOn)}</dd></div>
      <div><dt className="text-muted-foreground">{t("expiresOn")}</dt><dd>{record.expiresOn === null ? t("noExpiry") : format.date(record.expiresOn)}</dd></div>
      <div><dt className="text-muted-foreground">{t("source")}</dt><dd>{t(`sources.${record.source}`)}</dd></div>
      <div><dt className="text-muted-foreground">{t("recordedBy")}</dt><dd className="whitespace-pre-wrap wrap-anywhere">{record.recordedByName ?? t("unknownActor")}</dd></div>
      <div><dt className="text-muted-foreground">{t("recordedAt")}</dt><dd>{format.dateTime(record.recordedAt)}</dd></div>
      <div><dt className="text-muted-foreground">{t("updatedAt")}</dt><dd>{format.dateTime(record.updatedAt)}</dd></div>
    </dl>
    <div className="min-w-0"><h3 className="text-sm font-medium">{t("comment")}</h3><p className="whitespace-pre-wrap wrap-anywhere text-sm">{record.comment ?? t("notProvided")}</p></div>
    <SurveyReport file={record.report} label={t("report")} />
  </CardContent></Card>;
}
