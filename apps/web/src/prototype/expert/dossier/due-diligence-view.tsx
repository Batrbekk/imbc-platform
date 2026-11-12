// Отчёт due diligence для IMBC (IMBC-07, IMBC-08, IMBC-10, IMBC-11, IMBC-13, IMBC-14): итог, время проверки,
// счёт по группам, critical и attention под сводкой, группы закрыты до открытия. Только показ;
// действия по строке передаёт экран (`lineAction`), при `readOnly` их нет.
import type { ReactNode } from "react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { DueDiligenceBadge, FileRow } from "@/prototype/components";
import type { DdCheckValue, DdGroup, DueDiligenceRecord } from "@/prototype/data";
import { DD_CHECKS, DD_GROUPS, ddSeverity } from "@/prototype/data/due-diligence";
import { useDictionary, useProtoLocale } from "@/prototype/i18n";
import { useCommonTexts } from "@/prototype/labels";
import { accountName } from "@/prototype/rules";
import { useProto } from "@/prototype/store";

import type { LineNote } from "../ext";
import { lineKey } from "../ext";
import { FieldItem, Fields } from "./parts";
import { dossierTexts } from "./texts";

const groupOf = (line: DdCheckValue): DdGroup => DD_CHECKS.find((c) => c.id === line.checkId)?.group ?? "enterprise";

/** Следующая плановая проверка: квартал от последней (IMBC-07). */
function nextCheck(checkedAt: string): string {
  const date = new Date(checkedAt);
  date.setMonth(date.getMonth() + 3);
  return date.toISOString();
}

export function DueDiligenceView({
  record,
  readOnly = false,
  lineNotes = {},
  lineAction,
}: {
  record: DueDiligenceRecord;
  readOnly?: boolean;
  /** Пометки SME к строкам (свои данные кабинета SME); ключ — `lineKey`. */
  lineNotes?: Record<string, LineNote>;
  lineAction?: (line: DdCheckValue) => ReactNode;
}) {
  const t = useDictionary(dossierTexts);
  const common = useCommonTexts();
  const format = useFormat();
  const locale = useProtoLocale();
  const state = useProto();
  const title = (line: DdCheckValue) => DD_CHECKS.find((c) => c.id === line.checkId)?.title[locale] ?? line.checkId;
  const value = (line: DdCheckValue) => (line.value === "yes" ? t("yes") : line.value === "no" ? t("no") : line.value);
  const critical = record.checks.filter((l) => ddSeverity(l) === "critical");
  const attention = record.checks.filter((l) => ddSeverity(l) === "attention");
  const note = (line: DdCheckValue) => lineNotes[lineKey(record.profileId, line.checkId, line.subject)];

  const flagged = (lines: DdCheckValue[], heading: string, empty: string) => (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{heading}</h3>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("ddGroup")}</TableHead>
                <TableHead>{t("ddSubject")}</TableHead>
                <TableHead>{t("ddCheck")}</TableHead>
                <TableHead>{t("ddValue")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={`${line.checkId}-${line.subject}`}>
                  <TableCell>{common(`ddGroup.${groupOf(line)}`)}</TableCell>
                  <TableCell>{line.subject}</TableCell>
                  <TableCell className="whitespace-normal">{title(line)}</TableCell>
                  <TableCell>{value(line)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("ddTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Fields>
          <FieldItem label={t("ddResult")}>
            <DueDiligenceBadge result={record.result} />
          </FieldItem>
          <FieldItem label={t("ddCheckedAt")}>{format.dateTime(record.checkedAt)}</FieldItem>
          <FieldItem label={t("ddAutoResult")}>
            <DueDiligenceBadge result={record.autoResult} />
          </FieldItem>
          <FieldItem label={t("ddSetBy")}>
            {record.resultSetBy ? accountName(state, record.resultSetBy) : t("ddSetByConnector")}
          </FieldItem>
          <FieldItem label={t("ddNextCheck")}>{format.date(nextCheck(record.checkedAt))}</FieldItem>
          {record.comment && <FieldItem label={t("comment")}>{record.comment}</FieldItem>}
        </Fields>
        {record.report && <FileRow label={t("ddReport")} file={record.report} />}

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("ddGroup")}</TableHead>
                <TableHead>{t("ddChecks")}</TableHead>
                <TableHead>{t("ddFindings")}</TableHead>
                <TableHead>{t("ddAttention")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DD_GROUPS.map((group) => {
                const lines = record.checks.filter((l) => groupOf(l) === group);
                return (
                  <TableRow key={group}>
                    <TableCell>{common(`ddGroup.${group}`)}</TableCell>
                    <TableCell>{format.number(lines.length)}</TableCell>
                    <TableCell>{format.number(lines.filter((l) => ddSeverity(l) === "critical").length)}</TableCell>
                    <TableCell>{format.number(lines.filter((l) => ddSeverity(l) === "attention").length)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {flagged(critical, t("ddCritical"), t("ddNoCritical"))}
        {flagged(attention, t("ddNeedsAttention"), t("ddNoAttention"))}

        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{t("ddAllChecks")}</h3>
          <Accordion multiple>
            {DD_GROUPS.map((group) => {
              const lines = record.checks.filter((l) => groupOf(l) === group);
              return (
                <AccordionItem key={group} value={group}>
                  <AccordionTrigger>
                    {t("ddGroupCount", { group: common(`ddGroup.${group}`), count: format.number(lines.length) })}
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="flex flex-col divide-y rounded-lg border">
                      {lines.map((line) => {
                        const n = note(line);
                        return (
                          <li
                            key={`${line.checkId}-${line.subject}`}
                            className="flex flex-wrap items-start justify-between gap-2 p-2"
                          >
                            <div className="flex min-w-0 flex-col">
                              <span>{title(line)}</span>
                              <span className="text-xs text-muted-foreground">
                                {line.subject} · {value(line)}
                                {line.checkId.endsWith("court_cases") && ` (${t("courtCounts")})`}
                              </span>
                              {n && (
                                <span className="text-xs">
                                  {t("lineNote", { text: n.text, name: accountName(state, n.by) })}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant={
                                  ddSeverity(line) === "critical"
                                    ? "destructive"
                                    : ddSeverity(line) === "attention"
                                      ? "secondary"
                                      : "outline"
                                }
                              >
                                {common(`ddMark.${line.mark}`)}
                              </Badge>
                              {!readOnly && lineAction?.(line)}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
      </CardContent>
    </Card>
  );
}

/** Enhanced due diligence (IMBC-08): сделана или нет, комментарий, отчёт. */
export function EnhancedDueDiligenceCard({ record, children }: { record: DueDiligenceRecord; children?: ReactNode }) {
  const t = useDictionary(dossierTexts);
  const format = useFormat();
  const state = useProto();
  const e = record.enhanced;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("enhancedTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Fields>
          <FieldItem label={t("enhancedDone")}>{e.done ? t("yes") : t("no")}</FieldItem>
          <FieldItem label={t("recordedBy")}>
            {e.by ? `${accountName(state, e.by)}, ${format.dateTime(e.at)}` : t("notProvided")}
          </FieldItem>
          {e.comment && <FieldItem label={t("comment")}>{e.comment}</FieldItem>}
        </Fields>
        {e.report && <FileRow label={t("enhancedReport")} file={e.report} />}
        {children}
      </CardContent>
    </Card>
  );
}
