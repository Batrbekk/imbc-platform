import { can, type LpsEntryRead } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useLocale, useTranslations } from "use-intl";
import { PageTitle } from "@/components/app/page-title";
import { SessionStatus } from "@/components/auth/session-status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button, buttonVariants } from "@/components/ui/button";
import { lpsApi } from "@/features/lps/api";
import { LpsDashboard } from "@/features/lps/dashboard";
import { LpsDeleteDialog } from "@/features/lps/delete-dialog";
import { LpsEntryDetails } from "@/features/lps/entry-details";
import { LpsEntryEditor } from "@/features/lps/entry-editor";
import { LpsError, LpsLeaveGuard } from "@/features/lps/feedback";
import { LpsFilters } from "@/features/lps/filters";
import { changeLpsParams, lpsRequestParams, readLpsParams } from "@/features/lps/params";
import { LpsTable } from "@/features/lps/table";
import { useFormat } from "@/i18n/format";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";

export function LpsPage() {
  const t = useTranslations("lps"), format = useFormat(), locale = useLocale(), me = useMe(), [search, setSearch] = useSearchParams();
  const [editor, setEditor] = useState<LpsEntryRead | null | undefined>(), [deleted, setDeleted] = useState<LpsEntryRead | null>(null), [dirty, setDirty] = useState(false), [pending, setPending] = useState(false), [notice, setNotice] = useState("");
  const [details, setDetails] = useState<{ id: string; rowNumber: number } | null>(null), detailsTrigger = useRef<HTMLElement | null>(null);
  const parsed = readLpsParams(search, locale), query = parsed.success ? parsed.data : null, view = search.get("view") === "dashboard" ? "dashboard" : "table";
  const allowed = Boolean(me.data && can(me.data.user.role, "lps.read")), editable = Boolean(me.data && can(me.data.user.role, "lps.edit"));
  const table = useQuery({ queryKey: ["lps", "entries", me.data?.user.id, query], enabled: allowed && Boolean(query) && view === "table", queryFn: () => lpsApi.entries(lpsRequestParams(query!)) });
  const dashboard = useQuery({ queryKey: ["lps", "dashboard", me.data?.user.id, query && lpsRequestParams(query, true)], enabled: allowed && Boolean(query) && view === "dashboard", queryFn: () => lpsApi.dashboard(lpsRequestParams(query!, true)) });
  const change = (patch: Record<string, string | string[] | null>, resetPage = true) => setSearch(changeLpsParams(search, patch, resetPage));
  const title = <PageTitle title={t("title")} />;
  if (!me.data) return <>{title}<SessionStatus error={me.isError} retry={() => void me.refetch()} /></>;
  if (!allowed) return <>{title}<Alert variant="destructive"><AlertDescription>{t("errors.forbidden")}</AlertDescription></Alert></>;
  if (!query) return <>{title}<h1 className="text-2xl font-semibold">{t("title")}</h1><Alert variant="destructive"><AlertDescription>{t("invalidFilters")}</AlertDescription></Alert><Button onClick={() => setSearch({})}>{t("clearFilters")}</Button></>;
  const result = view === "table" ? table : dashboard;
  const filtered = Boolean(query.q || query.lastUpdatedFrom || query.lastUpdatedTo || [query.sourceTypeIds, query.countryIds, query.commodityTypeIds, query.commodityGroupIds, query.statusIds, query.cities, query.regionIds].some((value) => value.length));
  return <div className="mx-auto flex max-w-7xl flex-col gap-4">{title}<LpsLeaveGuard dirty={dirty} pending={pending} />
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("description")}</p></div>
      <div className="flex flex-wrap gap-2"><Link to="/lps/companies" className={cn(buttonVariants({ variant: "outline" }))}>{t("companies")}</Link>{editable && <Button onClick={() => { setNotice(""); setDirty(false); setEditor(null); }}>{t("newEntry")}</Button>}</div>
    </div>
    <div aria-live="polite">{notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}</div>
    <div className="flex flex-wrap gap-2"><Button variant={view === "table" ? "default" : "outline"} aria-pressed={view === "table"} onClick={() => change({ view: "table" }, false)}>{t("table")}</Button><Button variant={view === "dashboard" ? "default" : "outline"} aria-pressed={view === "dashboard"} onClick={() => change({ view: "dashboard" }, false)}>{t("dashboard")}</Button></div>
    <LpsFilters key={`${query.q}|${query.lastUpdatedFrom}|${query.lastUpdatedTo}`} query={query} rows={table.data?.items ?? []} change={change} clear={() => setSearch(search.get("view") === "dashboard" ? { view: "dashboard" } : {})} />
    {result.isError ? <LpsError error={result.error} retry={() => void result.refetch()} /> : result.isPending ? <p role="status">{t("loading")}</p> : view === "dashboard" && dashboard.data ? <LpsDashboard data={dashboard.data} drilldown={(key, value) => change({ [key]: [value], view: "table" })} /> : table.data && <>
      <p role="status" className="text-sm text-muted-foreground">{t("found", { count: table.data.total, total: format.number(table.data.total) })}</p>
      {table.data.items.length ? <LpsTable rows={table.data.items} query={query} editable={editable} busy={pending || editor !== undefined || Boolean(deleted)} details={(row, trigger) => { if (pending || editor !== undefined || deleted) return; detailsTrigger.current = trigger; setDetails({ id: row.id, rowNumber: row.rowNumber }); }} edit={(row) => { setNotice(""); setDirty(false); setEditor(row); }} remove={setDeleted} sort={(column) => change({ sort: column, direction: query.sort === column && query.direction === "asc" ? "desc" : "asc" })} />
        : <div className="rounded-lg border border-dashed p-8 text-center"><h2 className="font-semibold">{t(filtered ? "noMatches" : "empty")}</h2><p className="mt-2 text-sm text-muted-foreground">{t(filtered ? "noMatchesDescription" : editable ? "emptyEditableDescription" : "emptyDescription")}</p></div>}
      <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{t("page", { page: format.number(Math.floor(query.offset / query.limit) + 1), pages: format.number(Math.max(1, Math.ceil(table.data.total / query.limit))) })}</span>
        <div className="flex flex-wrap items-center gap-2"><Field className="w-auto"><FieldLabel htmlFor="lps-page-size">{t("rowsPerPage")}</FieldLabel><Select value={query.limit} items={[...new Set([25, 50, 100, 200, query.limit])].sort((a, b) => a - b).map((value) => ({ value, label: format.number(value) }))} disabled={table.isFetching} onValueChange={(value) => { if (value !== null) change({ limit: String(value) }); }}><SelectTrigger id="lps-page-size"><SelectValue /></SelectTrigger><SelectContent alignItemWithTrigger={false}>{[...new Set([25, 50, 100, 200, query.limit])].sort((a, b) => a - b).map((value) => <SelectItem key={value} value={value}>{format.number(value)}</SelectItem>)}</SelectContent></Select></Field><Button variant="outline" disabled={table.isFetching || query.offset === 0} onClick={() => change({ offset: String(Math.max(0, query.offset - query.limit)) }, false)}>{t("previous")}</Button><Button variant="outline" disabled={table.isFetching || query.offset + query.limit >= table.data.total} onClick={() => change({ offset: String(query.offset + query.limit) }, false)}>{t("next")}</Button></div></div>
    </>}
    <LpsEntryDetails selected={details} actorId={me.data.user.id} returnFocus={detailsTrigger} onClose={() => setDetails(null)} />
    {editor !== undefined && editable && <LpsEntryEditor initial={editor} onDirtyChange={setDirty} onPendingChange={setPending} onClose={() => { setEditor(undefined); setDirty(false); setPending(false); }} onSaved={() => { setEditor(undefined); setDirty(false); setPending(false); setNotice(t("saved")); }} />}
    {deleted && editable && <LpsDeleteDialog kind="entry" id={deleted.id} name={`${deleted.company.name} — ${deleted.scopeDescription}`} onPendingChange={setPending} onClose={() => { setDeleted(null); setPending(false); }} onDeleted={() => { setDeleted(null); setPending(false); setNotice(t("deleted")); }} />}
  </div>;
}
