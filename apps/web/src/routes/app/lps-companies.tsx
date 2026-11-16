import { can, entryDisplayName, lpsCompanyQuerySchema, type LpsCompanyRead } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useLocale, useTranslations } from "use-intl";
import { PageTitle } from "@/components/app/page-title";
import { SessionStatus } from "@/components/auth/session-status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lpsApi } from "@/features/lps/api";
import { LpsCompanyEditor } from "@/features/lps/company-editor";
import { LpsField } from "@/features/lps/controls";
import { LpsDeleteDialog } from "@/features/lps/delete-dialog";
import { LpsError, LpsLeaveGuard } from "@/features/lps/feedback";
import { useFormat } from "@/i18n/format";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
export function LpsCompaniesPage() {
  const t = useTranslations("lps"), locale = useLocale() as "en" | "ru" | "kk", format = useFormat(), me = useMe(), [search, setSearch] = useSearchParams();
  const [editor, setEditor] = useState<LpsCompanyRead | null | undefined>(), [deleted, setDeleted] = useState<LpsCompanyRead | null>(null), [dirty, setDirty] = useState(false), [pending, setPending] = useState(false), [notice, setNotice] = useState("");
  const q = search.get("q") ?? "", parsed = lpsCompanyQuerySchema.safeParse({ q, offset: search.get("offset") ?? 0, locale }), offset = parsed.success ? parsed.data.offset : 0;
  const allowed = Boolean(me.data && can(me.data.user.role, "lps.read")), editable = Boolean(me.data && can(me.data.user.role, "lps.edit"));
  const result = useQuery({ queryKey: ["lps", "companies-page", me.data?.user.id, locale, q, offset], enabled: allowed && parsed.success, queryFn: () => lpsApi.companies(new URLSearchParams({ q, offset: String(offset), limit: "50", locale }).toString()) });
  const title = <PageTitle title={t("companies")} />;
  if (!me.data) return <>{title}<SessionStatus error={me.isError} retry={() => void me.refetch()} /></>;
  if (!allowed) return <>{title}<Alert variant="destructive"><AlertDescription>{t("errors.forbidden")}</AlertDescription></Alert></>;
  if (!parsed.success) return <>{title}<Alert variant="destructive"><AlertDescription>{t("invalidFilters")}</AlertDescription></Alert><Button onClick={() => setSearch({})}>{t("clearFilters")}</Button></>;
  return <div className="mx-auto flex max-w-7xl flex-col gap-4">{title}<LpsLeaveGuard dirty={dirty} pending={pending} /><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">{t("companies")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("companyDescription")}</p></div>
    <div className="flex flex-wrap gap-2"><Link to="/lps" className={cn(buttonVariants({ variant: "outline" }))}>{t("title")}</Link>{editable && <Button onClick={() => { setEditor(null); setDirty(false); }}>{t("newCompany")}</Button>}</div></div>
    <div aria-live="polite">{notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}</div>
    <CompanySearch key={q} initial={q} search={(q) => setSearch(q ? { q } : {})} />
    {result.isError ? <LpsError error={result.error} retry={() => void result.refetch()} /> : result.isPending ? <p role="status">{t("loading")}</p> : result.data && <>
      <p role="status" className="text-sm text-muted-foreground">{t("foundCompanies", { count: result.data.total, total: format.number(result.data.total) })}</p>
      {result.data.items.length ? <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>{t("columns.company")}</TableHead><TableHead>{t("columns.countries")}</TableHead><TableHead>{t("savedAt")}</TableHead>{editable && <TableHead>{t("actions")}</TableHead>}</TableRow></TableHeader><TableBody>{result.data.items.map((row) => <TableRow key={row.id}>
        <TableCell className="font-medium wrap-anywhere">{row.name}</TableCell><TableCell>{row.countries.length ? row.countries.map((item) => <div key={item.id}>{entryDisplayName(item.names, locale, item.code)}</div>) : t("unknown")}</TableCell><TableCell>{format.dateTime(row.updatedAt)}</TableCell>
        {editable && <TableCell><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setEditor(row); setDirty(false); }}>{t("edit")}</Button><Button size="sm" variant="outline" onClick={() => setDeleted(row)}>{t("delete")}</Button></div></TableCell>}
      </TableRow>)}</TableBody></Table></div> : <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">{t(q ? "noMatches" : "emptyCompanies")}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3"><span>{t("page", { page: format.number(Math.floor(offset / 50) + 1), pages: format.number(Math.max(1, Math.ceil(result.data.total / 50))) })}</span><div className="flex gap-2"><Button variant="outline" disabled={offset === 0 || result.isFetching} onClick={() => setSearch({ ...(q ? { q } : {}), offset: String(Math.max(0, offset - 50)) })}>{t("previous")}</Button><Button variant="outline" disabled={result.isFetching || offset + 50 >= result.data.total} onClick={() => setSearch({ ...(q ? { q } : {}), offset: String(offset + 50) })}>{t("next")}</Button></div></div>
    </>}
    {editor !== undefined && editable && <LpsCompanyEditor initial={editor} onDirtyChange={setDirty} onPendingChange={setPending} onClose={() => { setEditor(undefined); setDirty(false); setPending(false); }} onSaved={() => { setEditor(undefined); setDirty(false); setPending(false); setNotice(t("saved")); }} />}
    {deleted && editable && <LpsDeleteDialog kind="company" id={deleted.id} name={deleted.name} onPendingChange={setPending} onClose={() => { setDeleted(null); setPending(false); }} onDeleted={() => { setDeleted(null); setPending(false); setNotice(t("deleted")); }} />}
  </div>;
}
function CompanySearch({ initial, search }: { initial: string; search: (value: string) => void }) {
  const t = useTranslations("lps"), [value, setValue] = useState(initial);
  return <form className="flex flex-col items-end gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); search(value.trim()); }}><div className="w-full flex-1"><LpsField label={t("companySearch")} value={value} onChange={setValue} /></div><Button type="submit">{t("searchAction")}</Button><Button type="button" variant="outline" onClick={() => search("")}>{t("clearFilters")}</Button></form>;
}
