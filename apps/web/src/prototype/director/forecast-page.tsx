// Прогноз спроса для генерального директора IMBC — только просмотр (GEN-04, раздел 4: «view»), Release 2:
// версии импорта (ADM-12, ADM-14), отчёт о строках с ошибками (ADM-13), строки в колонках FC-05. Части экрана —
// из кабинета администратора с `readOnly`; выбранная версия — в адресе (`?version=`).
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ForecastLinesView, ForecastProblemsView, ForecastVersionsView } from "@/prototype/administrator/shared";
import { ProtoPage } from "@/prototype/components";
import { useDictionary } from "@/prototype/i18n";
import { accountName, publishedForecast } from "@/prototype/rules";
import { useProto } from "@/prototype/store";

import { libraryTexts } from "./library-texts";
import { useAddress } from "./paths";

export function ForecastScreen() {
  const t = useDictionary(libraryTexts);
  const state = useProto();
  const { params, set } = useAddress();
  const published = publishedForecast(state);
  const selected =
    state.forecastVersions.find((v) => v.id === params.get("version")) ??
    published ??
    [...state.forecastVersions].sort((a, b) => b.importedAt.localeCompare(a.importedAt))[0];

  return (
    <ProtoPage hideReset release2 title={t("forecastTitle")} description={t("forecastHint")}>
      <Card>
        <CardHeader>
          <CardTitle>{t("forecastTitle")}</CardTitle>
          <CardDescription>
            {published ? t("publishedNow", { file: published.fileName }) : t("nothingPublished")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForecastVersionsView
            versions={state.forecastVersions}
            publishedId={published?.id ?? null}
            readOnly
            accountName={(id) => accountName(state, id)}
            onView={(version) => set("version", version.id, published?.id ?? "")}
          />
        </CardContent>
      </Card>
      {selected && (
        <>
          <ForecastProblemsView version={selected} />
          <ForecastLinesView
            version={selected}
            lines={state.forecastLines.filter((l) => l.versionId === selected.id)}
          />
        </>
      )}
    </ProtoPage>
  );
}
