// Прогноз спроса (Release 2): весь опубликованный прогноз, поиск и фильтры, без скачивания и печати.
// FC-01, FC-03, FC-04, FC-05, FC-06, FC-07, FC-09.
import { COMMODITY_GROUPS } from "@imbc/contracts";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";

import { useDictionary } from "../i18n";
import { publishedForecast } from "../rules";
import { useProto } from "../store";
import { ChoiceField } from "./fields";
import { NdaGate } from "./nda-gate";
import { ManufacturerPage } from "./page";
import { screenTexts } from "./screen-texts";
import { useViewedProfile } from "./view-as";

export function ForecastPage() {
  const t = useDictionary(screenTexts);
  const { profile } = useViewedProfile();
  return (
    <ManufacturerPage title={t("fcTitle")} release2 description={t("fcDescription")}>
      <NdaGate profile={profile}>
        <ForecastTable />
      </NdaGate>
    </ManufacturerPage>
  );
}

function ForecastTable() {
  const t = useDictionary(screenTexts);
  const format = useFormat();
  const state = useProto();
  const version = publishedForecast(state);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [prefix, setPrefix] = useState("");
  if (!version) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyDescription>{t("fcNone")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const lines = state.forecastLines.filter((l) => l.versionId === version.id);
  const types = [...new Set(lines.map((l) => l.commodityType))].sort();
  const q = query.trim().toLowerCase();
  const shown = lines.filter(
    (l) =>
      (!group || l.group === group) &&
      (!type || l.commodityType === type) &&
      l.tnved.startsWith(prefix.replace(/\s/g, "")) &&
      (!q || `${l.description} ${l.commodityType} ${l.tnved}`.toLowerCase().includes(q)),
  );
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertDescription>
          {t("fcPublished", { date: format.date(version.publishedAt) })} {t("fcNoDownload")}
        </AlertDescription>
      </Alert>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="fc-search" className="text-sm font-medium">
            {t("fcSearch")}
          </label>
          <Input id="fc-search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <ChoiceField
          label={t("fcGroup")}
          items={COMMODITY_GROUPS.map((g) => ({ value: g, label: t("fcGroupN", { group: g }) }))}
          value={group}
          placeholder={t("fcAll")}
          onChange={setGroup}
        />
        <ChoiceField
          label={t("fcType")}
          items={types.map((x) => ({ value: x, label: x }))}
          value={type}
          placeholder={t("fcAll")}
          onChange={setType}
        />
        <div className="flex flex-col gap-2">
          <label htmlFor="fc-prefix" className="text-sm font-medium">
            {t("fcPrefix")}
          </label>
          <Input id="fc-prefix" inputMode="numeric" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("fcShown", { shown: format.number(shown.length), total: format.number(lines.length) })}
      </p>
      {/* Строки остаются на платформе: при печати таблица не выводится (FC-06). */}
      <div className="overflow-x-auto rounded-lg border print:hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fcTnved")}</TableHead>
              <TableHead>{t("fcGroup")}</TableHead>
              <TableHead>{t("fcType")}</TableHead>
              <TableHead>{t("fcDescriptionCol")}</TableHead>
              <TableHead>{t("fcUnit")}</TableHead>
              <TableHead className="text-right">{t("fcQuantity")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {t("fcNothing")}
                </TableCell>
              </TableRow>
            ) : (
              shown.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono">{l.tnved}</TableCell>
                  <TableCell>{l.group}</TableCell>
                  <TableCell>{l.commodityType}</TableCell>
                  <TableCell className="whitespace-normal">{l.description}</TableCell>
                  <TableCell>{l.unit}</TableCell>
                  <TableCell className="text-right tabular-nums">{format.number(l.quantity)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
