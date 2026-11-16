import type { DiligenceRead } from "@imbc/contracts";
import { cn } from "cn";
import { DownloadIcon } from "lucide-react";
import { useTranslations } from "use-intl";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useFormat } from "@/i18n/format";
import { diligenceReportUrl } from "./api";

export function DiligenceReport({ fileId, versionNumber, label }: { fileId: string | null; versionNumber: number | null; label: string }) {
  const t = useTranslations("diligence"), format = useFormat();
  return fileId !== null && versionNumber !== null ? <a className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-auto max-w-full whitespace-normal")}
    href={diligenceReportUrl(fileId, versionNumber)}><DownloadIcon />{t("download", { label, version: format.number(versionNumber) })}</a> : null;
}
export function DiligenceRecord({ data }: { data: DiligenceRead }) {
  const t = useTranslations("diligence"), format = useFormat();
  const { record, lastRun } = data;
  return <div className="min-w-0 space-y-4">
    {lastRun && <Alert variant={["received", "waiting"].includes(lastRun.state) ? "default" : "destructive"}>
      <AlertDescription><p>{t(`runStates.${lastRun.state}`)}</p>{lastRun.isTestData && <Badge variant="outline" className="mt-2 w-fit whitespace-normal">{t("testRun")}</Badge>}<p className="mt-1 text-xs">{t("requestedAt")}: {format.dateTime(lastRun.requestedAt)}{lastRun.completedAt && ` · ${t("completedAt")}: ${format.dateTime(lastRun.completedAt)}`}</p></AlertDescription>
    </Alert>}
    {record ? <Card><CardHeader><CardTitle>{t("currentResult")}</CardTitle></CardHeader><CardContent className="min-w-0 space-y-4">
      <div className="flex flex-wrap gap-2"><Badge variant={record.result === "red" ? "destructive" : record.result === "green" ? "default" : "secondary"}>{t(`results.${record.result}`)}</Badge>
        {record.sourceIsTestData && <Badge variant="outline">{t("testData")}</Badge>}{record.overriddenAt && <Badge variant="outline">{t("manualResult")}</Badge>}</div>
      <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">{t("checkedAt")}</dt><dd>{record.checkedAt ? format.dateTime(record.checkedAt) : t("noSource")}</dd></div>
        <div><dt className="text-muted-foreground">{t("checkedOn")}</dt><dd>{format.date(record.checkedOn)}</dd></div>
        <div><dt className="text-muted-foreground">{t("automaticResult")}</dt><dd>{record.adataResult ? t(`results.${record.adataResult}`) : t("notProvided")}</dd></div>
        <div><dt className="text-muted-foreground">{t("updatedAt")}</dt><dd>{format.dateTime(record.updatedAt)}</dd></div>
        {record.overriddenAt && <div><dt className="text-muted-foreground">{t("overriddenAt")}</dt><dd>{format.dateTime(record.overriddenAt)}</dd></div>}
      </dl>
      <div><h3 className="text-sm font-medium">{t("comment")}</h3><p className="whitespace-pre-wrap wrap-anywhere text-sm">{record.comment ?? t("notProvided")}</p></div>
      <DiligenceReport fileId={record.reportFileId} versionNumber={record.reportFileVersionNumber} label={t("report")} />
      <div className="space-y-2 border-t pt-4"><h3 className="font-medium">{t("enhancedTitle")}</h3><Badge variant="outline">{t(`enhancedStates.${record.enhanced}`)}</Badge>
        <p className="whitespace-pre-wrap wrap-anywhere text-sm">{record.enhancedComment ?? t("notProvided")}</p>
        <DiligenceReport fileId={record.enhancedReportFileId} versionNumber={record.enhancedReportFileVersionNumber} label={t("enhancedReport")} />
      </div>
    </CardContent></Card> : <Card><CardContent className="py-5 text-sm text-muted-foreground">{t("noRecord")}</CardContent></Card>}
  </div>;
}
