import { LPS_SORT_COLUMNS, entryDisplayName, type LpsEntryRead, type LpsQuery, type LpsReferenceBase, type LpsSortColumn } from "@imbc/contracts";
import { useLocale, useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { lpsTableAmount } from "./data";

type Row = LpsEntryRead & { rowNumber: number };
export function LpsTable({ rows, query, sort, editable, edit, remove, details, busy }: {
  rows: readonly Row[]; query: LpsQuery; sort: (column: LpsSortColumn) => void; editable: boolean;
  edit: (row: Row) => void; remove: (row: Row) => void; details: (row: Row, trigger: HTMLElement) => void; busy: boolean;
}) {
  const t = useTranslations("lps"), locale = useLocale() as "en" | "ru" | "kk", format = useFormat();
  const name = (item: LpsReferenceBase) => entryDisplayName(item.names, locale, item.code);
  const values = (items: readonly LpsReferenceBase[]) => items.length ? items.map((item) => <div key={item.id}>{name(item)}</div>) : t("unknown");
  const cell = (row: Row, key: LpsSortColumn) => {
    switch (key) {
      case "company": return <div className="space-y-2"><span className="line-clamp-2 font-medium" title={row.company.name}>{row.company.name}</span><p className="line-clamp-2 text-xs text-muted-foreground" title={row.scopeDescription}><span className="sr-only">{t("columns.scopeDescription")}: </span>{row.scopeDescription}</p><Button type="button" size="sm" variant="outline" disabled={busy} aria-label={t("openDetails", { company: row.company.name })} onClick={(event) => details(row, event.currentTarget)}>{t("details")}</Button></div>;
      case "sourceType": return row.sourceType.code === "LC" ? t("lcLegacy") : row.sourceType.code;
      case "countries": return values(row.company.countries);
      case "commodityTypes": return values(row.commodityTypes);
      case "commodityGroups": return values(row.commodityGroups);
      case "status": return name(row.status);
      case "investmentUsd": return <span title={format.decimal(row.investmentUsd)}>{format.decimal(lpsTableAmount(row.investmentUsd))}</span>;
      case "newJobs": return row.newJobs === null ? "—" : format.number(row.newJobs);
      case "lastUpdatedOn": return format.date(row.lastUpdatedOn);
      case "cities": return row.locations.length ? row.locations.map((location) => <div key={location.id} className="mb-2 min-h-6 last:mb-0">{location.city ?? "—"}</div>) : t("unknown");
      case "regions": return row.locations.length ? row.locations.map((location) => <div key={location.id} className="mb-2 min-h-6 last:mb-0">{location.region ? name(location.region) : t("unknown")}</div>) : t("unknown");
      case "contactNames": case "contactTitles": case "emails": case "phones": return null;
      case "plannedLaunch": return row.plannedLaunch === "TBD" ? t("tbd") : row.plannedLaunch ?? "—";
      case "scopeDescription": case "comment": return row[key] ?? "—";
    }
  };
  return <div className="space-y-2"><p className="text-xs text-muted-foreground">{t("tableDescription")}</p><div role="region" aria-label={t("tableDescription")} tabIndex={0} className="max-w-full overflow-x-auto rounded-lg border [&>[data-slot=table-container]]:overflow-visible"><Table className="min-w-[2600px] text-sm"><TableHeader><TableRow>
    <TableHead scope="col">{t("columns.rowNumber")}</TableHead>{LPS_SORT_COLUMNS.map((column) => <TableHead key={column} scope="col" className={column === "company" ? "sticky left-0 z-30 bg-background shadow-sm" : undefined} aria-sort={query.sort === column ? query.direction === "asc" ? "ascending" : "descending" : "none"}>
      <Button type="button" size="sm" variant="ghost" className="h-auto whitespace-normal px-0 text-left" onClick={() => sort(column)}>{t(`columns.${column}`)}{query.sort === column && <span aria-hidden="true">{query.direction === "asc" ? " ↑" : " ↓"}</span>}</Button>
    </TableHead>)}{editable && <TableHead scope="col">{t("actions")}</TableHead>}</TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.id}>
      <TableCell className="align-top">{format.number(row.rowNumber)}</TableCell>{LPS_SORT_COLUMNS.map((column) => {
        if (["regions", "contactTitles", "emails", "phones"].includes(column)) return null;
        if (column === "cities") return <TableCell key={column} colSpan={2} className="min-w-64 align-top whitespace-pre-wrap wrap-anywhere">{row.locations.length ? row.locations.map((location, index) => <div role="group" aria-label={t("locationNumber", { number: format.number(index + 1) })} key={location.id} className="grid grid-cols-2 gap-3 border-b py-2 first:pt-0 last:border-0"><span aria-label={t("columns.cities")}>{location.city ?? "—"}</span><span aria-label={t("columns.regions")}>{location.region ? name(location.region) : t("unknown")}</span></div>) : t("unknown")}</TableCell>;
        if (column === "contactNames") return <TableCell key={column} colSpan={4} className="min-w-[512px] align-top whitespace-pre-wrap wrap-anywhere">{row.contacts.length ? row.contacts.map((contact, index) => <div role="group" aria-label={t("contactNumber", { number: format.number(index + 1) })} key={contact.id} className="grid grid-cols-4 gap-3 border-b py-2 first:pt-0 last:border-0"><span aria-label={t("columns.contactNames")}>{contact.fullName ?? "—"}</span><span aria-label={t("columns.contactTitles")}>{contact.roleTitle ?? "—"}</span>{(["emails", "phones"] as const).map((field) => <div key={field} aria-label={t(`columns.${field}`)}>{contact[field].length ? contact[field].map((method) => <div key={method}>{method}</div>) : "—"}</div>)}</div>) : "—"}</TableCell>;
        return <TableCell key={column} className={column === "company" ? "sticky left-0 z-20 max-w-44 min-w-32 bg-background align-top whitespace-pre-wrap wrap-anywhere shadow-sm" : "max-w-72 min-w-32 align-top whitespace-pre-wrap wrap-anywhere"}>{cell(row, column)}</TableCell>;
      })}
      {editable && <TableCell className="align-top"><div className="flex flex-col gap-2"><Button type="button" size="sm" variant="outline" onClick={() => edit(row)}>{t("edit")}</Button><Button type="button" size="sm" variant="outline" onClick={() => remove(row)}>{t("delete")}</Button></div></TableCell>}
    </TableRow>)}</TableBody></Table></div></div>;
}
