// Версии прогноза спроса и их строки для показа: ADM-13, ADM-14, FC-05. Роль не решает: `readOnly` задаёт вызывающий.
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import type { ForecastLine, ForecastVersion } from "@/prototype/data";
import { useDictionary } from "@/prototype/i18n";

import { sharedTexts } from "./texts";

/**
 * Таблица версий: файл, импорт, строки, ошибки, статус. `publishedId` — версия, которую сейчас видят
 * производители (`publishedForecast`). Без `readOnly` у неопубликованной версии — `publishAction` (кнопка экрана);
 * `onView` открывает строки версии (выбор — состояние экрана, не хранилища).
 */
export function ForecastVersionsView({
  versions,
  publishedId,
  readOnly,
  accountName,
  onView,
  publishAction,
}: {
  versions: ForecastVersion[];
  publishedId: string | null;
  readOnly: boolean;
  accountName: (accountId: string) => string;
  onView?: (version: ForecastVersion) => void;
  publishAction?: (version: ForecastVersion) => ReactNode;
}) {
  const t = useDictionary(sharedTexts);
  const format = useFormat();
  if (versions.length === 0) return <p className="text-sm text-muted-foreground">{t("fcNoVersions")}</p>;
  const sorted = [...versions].sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("fcFile")}</TableHead>
          <TableHead>{t("fcImported")}</TableHead>
          <TableHead>{t("fcRows")}</TableHead>
          <TableHead>{t("fcProblems")}</TableHead>
          <TableHead>{t("fcStatus")}</TableHead>
          <TableHead className="sr-only">{t("fcView")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((version) => (
          <TableRow key={version.id}>
            <TableCell className="break-all whitespace-normal">{version.fileName}</TableCell>
            <TableCell>
              {format.dateTime(version.importedAt)}
              <span className="block text-xs text-muted-foreground">{accountName(version.importedBy)}</span>
            </TableCell>
            <TableCell>{format.number(version.rowsTotal)}</TableCell>
            <TableCell>{format.number(version.problems.length)}</TableCell>
            <TableCell>
              {version.id === publishedId ? (
                <Badge>{t("fcPublishedNow")}</Badge>
              ) : version.publishedAt ? (
                <Badge variant="secondary">{t("fcPublishedEarlier")}</Badge>
              ) : (
                <Badge variant="outline">{t("fcNotPublished")}</Badge>
              )}
              {version.publishedAt && (
                <span className="block text-xs text-muted-foreground">{format.dateTime(version.publishedAt)}</span>
              )}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                {onView && (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`${t("fcView")}: ${version.fileName}`}
                    onClick={() => onView(version)}
                  >
                    {t("fcView")}
                  </Button>
                )}
                {!readOnly && !version.publishedAt && publishAction?.(version)}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Отчёт о строках с ошибками одной версии (ADM-13). */
export function ForecastProblemsView({ version }: { version: ForecastVersion }) {
  const t = useDictionary(sharedTexts);
  const format = useFormat();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("fcReport", { file: version.fileName })}</CardTitle>
      </CardHeader>
      <CardContent>
        {version.problems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("fcNoProblems")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {version.problems.map((problem) => (
              <li key={problem.row}>
                <span className="font-medium">{t("fcRow", { row: format.number(problem.row) })}</span> —{" "}
                {problem.message}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Строки версии в колонках FC-05: без оператора, проекта, бренда и разбивки количества. */
export function ForecastLinesView({ version, lines }: { version: ForecastVersion; lines: ForecastLine[] }) {
  const t = useDictionary(sharedTexts);
  const format = useFormat();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("fcLinesTitle", { file: version.fileName })}</CardTitle>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("fcNoLines")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("tnved")}</TableHead>
                <TableHead>{t("group")}</TableHead>
                <TableHead>{t("commodityType")}</TableHead>
                <TableHead>{t("description")}</TableHead>
                <TableHead>{t("unit")}</TableHead>
                <TableHead className="text-right">{t("quantity")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="font-mono text-xs">{line.tnved}</TableCell>
                  <TableCell>{line.group}</TableCell>
                  <TableCell>{line.commodityType}</TableCell>
                  <TableCell className="min-w-56 whitespace-normal">{line.description}</TableCell>
                  <TableCell>{line.unit}</TableCell>
                  <TableCell className="text-right">{format.number(line.quantity)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
