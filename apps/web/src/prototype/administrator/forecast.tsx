// Прогноз спроса (Release 2): ADM-12, ADM-13, ADM-14, FC-01, FC-05, FC-10. Импорт — имитация на демо-данных.
import { useState } from "react";
import { useSearchParams } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmAction, FileRow, ProtoPage } from "@/prototype/components";
import type { FileRef, ForecastVersion, ProtoState } from "@/prototype/data";
import { localized, useDictionary } from "@/prototype/i18n";
import { accountName, publishedForecast } from "@/prototype/rules";
import { newId, nowIso, useProto } from "@/prototype/store";

import { useAdminAccountId, useGuardedUpdate } from "./actor";
import { forecastTexts } from "./forecast-texts";
import { ForecastLinesView, ForecastProblemsView, ForecastVersionsView, sharedTexts } from "./shared";

/** Образец отчёта импорта: импортированная и не опубликованная версия демо-данных (ADM-13). */
const SAMPLE_VERSION_ID = "fc-2026-11b";

/** Строки последней версии, у которой они есть: имитация содержимого импортированного файла. */
function sampleLines(state: ProtoState) {
  const withLines = [...state.forecastVersions]
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
    .find((v) => state.forecastLines.some((l) => l.versionId === v.id));
  return withLines ? state.forecastLines.filter((l) => l.versionId === withLines.id) : [];
}

export function ForecastScreen() {
  const t = useDictionary(forecastTexts);
  const shared = useDictionary(sharedTexts);
  const update = useGuardedUpdate();
  const adminId = useAdminAccountId();
  const state = useProto();
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState(false);
  const published = publishedForecast(state);
  const versions = state.forecastVersions;
  const lastImported = [...versions].sort((a, b) => b.importedAt.localeCompare(a.importedAt))[0];
  const viewed = versions.find((v) => v.id === params.get("version")) ?? published ?? lastImported ?? null;

  const importFile = (file: FileRef) => {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError(true);
      return;
    }
    setError(false);
    const sample = versions.find((v) => v.id === SAMPLE_VERSION_ID) ?? null;
    const lines = sampleLines(state);
    const problems = sample?.problems ?? [];
    const rowsTotal = sample?.rowsTotal ?? lines.length + problems.length;
    const id = newId("fc");
    update(
      {
        action: "forecast.import",
        subject: { type: "forecast", id, label: file.name },
        summary: localized(forecastTexts, "imported", {
          file: file.name,
          rows: String(rowsTotal),
          problems: String(problems.length),
        }),
      },
      (draft) => {
        draft.forecastVersions.push({
          id,
          fileName: file.name,
          importedAt: nowIso(),
          importedBy: adminId,
          publishedAt: null,
          publishedBy: null,
          rowsTotal,
          problems: structuredClone(problems),
        });
        draft.forecastLines.push(...lines.map((line, i) => ({ ...line, id: `${id}-l${i + 1}`, versionId: id })));
        return true;
      },
    );
    setParams({ version: id }, { replace: true });
  };

  const publish = (version: ForecastVersion) =>
    update(
      {
        action: "forecast.publish",
        subject: { type: "forecast", id: version.id, label: version.fileName },
        summary: localized(forecastTexts, "published", { file: version.fileName }),
      },
      (draft) => {
        const target = draft.forecastVersions.find((v) => v.id === version.id);
        if (!target || target.publishedAt) return false;
        // У версии из демо-данных без строк производители увидели бы пустую таблицу: берутся строки прежней.
        if (!draft.forecastLines.some((l) => l.versionId === version.id)) {
          draft.forecastLines.push(
            ...sampleLines(draft).map((line, i) => ({ ...line, id: `${version.id}-l${i + 1}`, versionId: version.id })),
          );
        }
        target.publishedAt = nowIso();
        target.publishedBy = adminId;
        return true;
      },
    );

  return (
    <ProtoPage title={t("title")} description={t("description")} release2>
      <Card>
        <CardHeader>
          <CardTitle>{t("importTitle")}</CardTitle>
          <CardDescription>{t("importHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <FileRow label={t("importLabel")} file={null} onSelect={importFile} />
          <p className="text-sm text-muted-foreground">{t("simulation")}</p>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{t("notXlsx")}</AlertDescription>
            </Alert>
          )}
          {lastImported && !lastImported.publishedAt && (
            <Alert>
              <AlertDescription>{t("importedNotice", { file: lastImported.fileName })}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("versions")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ForecastVersionsView
            versions={versions}
            publishedId={published?.id ?? null}
            readOnly={false}
            accountName={(id) => accountName(state, id)}
            onView={(version) => setParams({ version: version.id }, { replace: true })}
            publishAction={(version) => (
              <ConfirmAction
                size="sm"
                label={shared("fcPublish")}
                title={t("publishTitle", { file: version.fileName })}
                description={t("publishDescription")}
                confirmLabel={shared("fcPublish")}
                onConfirm={() => publish(version)}
              />
            )}
          />
        </CardContent>
      </Card>

      {viewed && (
        <>
          <ForecastProblemsView version={viewed} />
          <ForecastLinesView version={viewed} lines={state.forecastLines.filter((l) => l.versionId === viewed.id)} />
        </>
      )}
    </ProtoPage>
  );
}
