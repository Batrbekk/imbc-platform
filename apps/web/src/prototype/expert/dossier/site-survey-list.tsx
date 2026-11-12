// Записи site survey профиля (IMBC-01, IMBC-02, IMBC-03): даты визита, результат, подписанный отчёт, срок,
// комментарий. Только показ; действие над записью передаёт экран (`recordAction`), при `readOnly` его нет.
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { useFormat } from "@/i18n/format";
import { FileRow } from "@/prototype/components";
import type { SiteSurvey } from "@/prototype/data";
import { useDictionary } from "@/prototype/i18n";
import { accountName } from "@/prototype/rules";
import { useProto } from "@/prototype/store";

import { surveyCounts } from "./helpers";
import { FieldItem, Fields } from "./parts";
import { dossierTexts } from "./texts";

export function SiteSurveyList({
  surveys,
  readOnly = false,
  recordAction,
}: {
  surveys: SiteSurvey[];
  readOnly?: boolean;
  recordAction?: (survey: SiteSurvey) => ReactNode;
}) {
  const t = useDictionary(dossierTexts);
  const format = useFormat();
  const state = useProto();
  if (surveys.length === 0) return <p className="text-sm text-muted-foreground">{t("surveysEmpty")}</p>;
  const sorted = [...surveys].sort((a, b) => b.visitFrom.localeCompare(a.visitFrom));
  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((s) => (
        <li key={s.id} className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {s.visitFrom === s.visitTo
                ? format.date(s.visitFrom)
                : t("dateRange", { from: format.date(s.visitFrom), to: format.date(s.visitTo) })}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant={s.result ? "secondary" : "destructive"}>
                {s.result ? t("surveyYes") : t("surveyNo")}
              </Badge>
              {surveyCounts(s) ? (
                <Badge variant="default">{t("surveyCounts")}</Badge>
              ) : (
                <Badge variant="outline">{t("surveyNotCounted")}</Badge>
              )}
              {!readOnly && recordAction?.(s)}
            </span>
          </div>
          <Fields>
            <FieldItem label={t("expiresOn")}>{s.expiresOn ? format.date(s.expiresOn) : t("noExpiryDate")}</FieldItem>
            <FieldItem label={t("recordedBy")}>
              {accountName(state, s.recordedBy)}, {format.dateTime(s.recordedAt)}
            </FieldItem>
            {s.comment && <FieldItem label={t("comment")}>{s.comment}</FieldItem>}
          </Fields>
          <FileRow label={t("surveyReport")} file={s.report} />
        </li>
      ))}
    </ul>
  );
}
