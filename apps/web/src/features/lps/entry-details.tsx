import { entryDisplayName, type LpsReferenceBase } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, type RefObject } from "react";
import { useLocale, useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useFormat } from "@/i18n/format";
import { lpsApi } from "./api";
import { LpsError } from "./feedback";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 space-y-1"><dt className="text-sm font-medium text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap wrap-anywhere">{children}</dd></div>;
}

export function LpsEntryDetails({ selected, actorId, returnFocus, onClose }: {
  selected: { id: string; rowNumber: number } | null; actorId: string; returnFocus: RefObject<HTMLElement | null>; onClose: () => void;
}) {
  const t = useTranslations("lps"), locale = useLocale() as "en" | "ru" | "kk", format = useFormat();
  // A fresh scoped read, separate from table values, so a deleted entry or lost permission never
  // displays a cached record. Closing this read-only view has no dirty or mutation state.
  const result = useQuery({ queryKey: ["lps", "entry-detail", actorId, selected?.id, locale], enabled: Boolean(selected), staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => lpsApi.entry(selected!.id, locale) });
  const row = result.data;
  const reference = (value: LpsReferenceBase) => `${value.code} — ${entryDisplayName(value.names, locale, value.code)}${value.retiredAt ? ` (${t("retired")})` : ""}`;
  const references = (values: readonly LpsReferenceBase[]) => values.length ? <ul className="space-y-1">{values.map((value) => <li key={value.id}>{reference(value)}</li>)}</ul> : t("unknown");
  return <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent finalFocus={returnFocus} showCloseButton={false} className="min-w-0 grid-cols-[minmax(0,1fr)] max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-3xl [&>*]:min-w-0">
      <DialogHeader><DialogTitle>{t("detailsTitle")}</DialogTitle><DialogDescription>{t("detailsDescription")}</DialogDescription></DialogHeader>
      {result.isError ? <LpsError error={result.error} retry={() => void result.refetch()} /> : result.isPending ? <p role="status">{t("loading")}</p> : row && <div className="min-w-0 space-y-5">
        <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Fact label={t("columns.rowNumber")}>{selected ? format.number(selected.rowNumber) : "—"}</Fact>
          <Fact label={t("columns.company")}>{row.company.name}</Fact>
          <Fact label={t("columns.sourceType")}>{reference(row.sourceType)}{row.sourceType.code === "LC" && ` (${t("legacy")})`}</Fact>
          <Fact label={t("columns.countries")}>{references(row.company.countries)}</Fact>
          <Fact label={t("columns.commodityTypes")}>{references(row.commodityTypes)}</Fact>
          <Fact label={t("columns.commodityGroups")}>{references(row.commodityGroups)}</Fact>
          <Fact label={t("columns.scopeDescription")}>{row.scopeDescription}</Fact>
          <Fact label={t("columns.status")}>{reference(row.status)}</Fact>
          <Fact label={t("columns.plannedLaunch")}>{row.plannedLaunch === "TBD" ? t("tbd") : row.plannedLaunch ?? "—"}</Fact>
          <Fact label={t("columns.comment")}>{row.comment ?? "—"}</Fact>
          <Fact label={t("columns.investmentUsd")}>{format.decimal(row.investmentUsd)}</Fact>
          <Fact label={t("columns.newJobs")}>{row.newJobs === null ? "—" : format.number(row.newJobs)}</Fact>
          <Fact label={t("columns.lastUpdatedOn")}>{format.date(row.lastUpdatedOn)}</Fact>
        </dl>
        <section className="min-w-0 space-y-3"><h3 className="font-semibold">{t("locations")}</h3>
          {row.locations.length ? row.locations.map((location, index) => <section key={location.id} aria-label={t("locationNumber", { number: format.number(index + 1) })} className="min-w-0 space-y-2 rounded-lg border p-3"><h4 className="text-sm font-medium">{t("locationNumber", { number: format.number(index + 1) })}</h4><dl className="grid min-w-0 gap-3 sm:grid-cols-2"><Fact label={t("columns.cities")}>{location.city ?? "—"}</Fact><Fact label={t("columns.regions")}>{location.region ? reference(location.region) : t("unknown")}</Fact></dl></section>) : <dl className="grid min-w-0 gap-3 sm:grid-cols-2"><Fact label={t("columns.cities")}>{t("unknown")}</Fact><Fact label={t("columns.regions")}>{t("unknown")}</Fact></dl>}
        </section>
        <section className="min-w-0 space-y-3"><h3 className="font-semibold">{t("contacts")}</h3>
          {row.contacts.length ? row.contacts.map((contact, index) => <section key={contact.id} aria-label={t("contactNumber", { number: format.number(index + 1) })} className="min-w-0 space-y-2 rounded-lg border p-3"><h4 className="text-sm font-medium">{t("contactNumber", { number: format.number(index + 1) })}</h4><dl className="grid min-w-0 gap-3 sm:grid-cols-2"><Fact label={t("columns.contactNames")}>{contact.fullName ?? "—"}</Fact><Fact label={t("columns.contactTitles")}>{contact.roleTitle ?? "—"}</Fact>{(["emails", "phones"] as const).map((field) => <Fact key={field} label={t(`columns.${field}`)}>{contact[field].length ? <ul className="space-y-1">{contact[field].map((method) => <li key={method}>{method}</li>)}</ul> : "—"}</Fact>)}</dl></section>) : <dl className="grid min-w-0 gap-3 sm:grid-cols-2">{(["contactNames", "contactTitles", "emails", "phones"] as const).map((field) => <Fact key={field} label={t(`columns.${field}`)}>—</Fact>)}</dl>}
        </section>
        <dl className="grid min-w-0 gap-4 border-t pt-4 sm:grid-cols-2"><Fact label={t("entryCreatedAt")}>{format.dateTime(row.createdAt)}</Fact><Fact label={t("entryUpdatedAt")}>{format.dateTime(row.updatedAt)}</Fact><Fact label={t("companyCreatedAt")}>{format.dateTime(row.company.createdAt)}</Fact><Fact label={t("companyUpdatedAt")}>{format.dateTime(row.company.updatedAt)}</Fact></dl>
      </div>}
      <Button type="button" variant="outline" onClick={onClose}>{t("close")}</Button>
    </DialogContent>
  </Dialog>;
}
