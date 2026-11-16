import { type DictionaryCode, type LpsEntryRead, type LpsQuery } from "@imbc/contracts";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { LpsField, LpsReferenceList, type LpsChoice } from "./controls";
export function LpsFilters({ query, rows, change, clear }: {
  query: LpsQuery; rows: readonly LpsEntryRead[]; change: (patch: Record<string, string | string[] | null>) => void; clear: () => void;
}) {
  const t = useTranslations("lps"), [q, setQ] = useState(query.q), [from, setFrom] = useState(query.lastUpdatedFrom ?? ""), [to, setTo] = useState(query.lastUpdatedTo ?? ""), [city, setCity] = useState("");
  const fields: { key: "sourceTypeIds" | "countryIds" | "commodityTypeIds" | "commodityGroupIds" | "statusIds" | "regionIds"; kind: DictionaryCode; column: string; selected: LpsChoice[]; unknown?: boolean }[] = [
    { key: "sourceTypeIds", kind: "programme", column: "sourceType", selected: rows.map((row) => row.sourceType) },
    { key: "countryIds", kind: "country", column: "countries", selected: rows.flatMap((row) => row.company.countries), unknown: true },
    { key: "commodityTypeIds", kind: "commodity_type", column: "commodityTypes", selected: rows.flatMap((row) => row.commodityTypes), unknown: true },
    { key: "commodityGroupIds", kind: "commodity_group", column: "commodityGroups", selected: rows.flatMap((row) => row.commodityGroups), unknown: true },
    { key: "statusIds", kind: "lps_status", column: "status", selected: rows.map((row) => row.status) },
    { key: "regionIds", kind: "region", column: "regions", selected: rows.flatMap((row) => row.locations.flatMap((location) => location.region ? [location.region] : [])), unknown: true },
  ];
  return <section aria-label={t("filters")} className="space-y-3 rounded-lg border p-4">
    <form className="flex flex-col items-end gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); change({ q }); }}><div className="w-full flex-1"><LpsField label={t("search")} value={q} onChange={setQ} hint={t("searchHint")} /></div><Button type="submit">{t("searchAction")}</Button><Button type="button" variant="outline" onClick={clear}>{t("clearFilters")}</Button></form>
    <details><summary className="cursor-pointer text-sm font-medium">{t("advancedFilters")}</summary><div className="mt-4 space-y-4"><p className="text-sm text-muted-foreground">{t("filterHint")}</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{fields.map((field) => <LpsReferenceList key={field.key} kind={field.kind} label={t(`columns.${field.column}`)} ids={query[field.key]} selected={field.selected} includeUnknown={field.unknown} onChange={(value) => change({ [field.key]: value })} />)}</div>
      <section aria-label={t("columns.cities")} className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">{t("columns.cities")}</h3><div className="flex flex-wrap gap-2">{query.cities.map((value) => <Button key={value} type="button" size="sm" variant="outline" onClick={() => change({ cities: query.cities.filter((city) => city !== value) })}>{t("removeCity", { city: value })}</Button>)}</div>
        <form className="flex flex-col items-end gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); if (city.trim() && !query.cities.includes(city.trim())) change({ cities: [...query.cities, city.trim()] }); setCity(""); }}><div className="w-full flex-1"><LpsField label={t("addCity")} value={city} onChange={setCity} /></div><Button type="submit" variant="outline">{t("add")}</Button></form>
      </section>
      <form className="grid items-end gap-3 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); change({ lastUpdatedFrom: from, lastUpdatedTo: to }); }}><LpsField label={t("lastUpdatedFrom")} type="date" value={from} onChange={setFrom} /><LpsField label={t("lastUpdatedTo")} type="date" value={to} onChange={setTo} /><Button type="submit" variant="outline">{t("applyDates")}</Button></form>
    </div></details>
  </section>;
}
