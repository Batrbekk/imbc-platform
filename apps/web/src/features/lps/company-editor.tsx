import { entryDisplayName, lpsCompanyWriteSchema, type LpsCompanyRead } from "@imbc/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFormat } from "@/i18n/format";
import { lpsApi } from "./api";
import { LpsField, LpsReferenceList } from "./controls";
import { LpsDialog, LpsError } from "./feedback";

export function LpsCompanyEditor({ initial, onClose, onSaved, onDirtyChange, onPendingChange }: {
  initial: LpsCompanyRead | null; onClose: () => void; onSaved: (value: LpsCompanyRead) => void; onDirtyChange?: (value: boolean) => void; onPendingChange?: (value: boolean) => void;
}) {
  const t = useTranslations("lps"), client = useQueryClient();
  const [name, setName] = useState(initial?.name ?? ""), [countries, setCountries] = useState(initial?.countries.map((value) => value.id) ?? []), [invalid, setInvalid] = useState(false);
  const dirty = name !== (initial?.name ?? "") || JSON.stringify(countries) !== JSON.stringify(initial?.countries.map((value) => value.id) ?? []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const save = useMutation({ mutationFn: async () => {
    const parsed = lpsCompanyWriteSchema.safeParse({ name, countryIds: countries });
    if (!parsed.success) { setInvalid(true); return null; }
    setInvalid(false); return lpsApi.saveCompany(initial?.id ?? null, parsed.data);
  }, onSuccess: async (result) => { if (!result) return; await client.invalidateQueries({ queryKey: ["lps"] }); onSaved(result); } });
  useEffect(() => { onPendingChange?.(save.isPending); }, [save.isPending, onPendingChange]);
  return <LpsDialog title={t(initial ? "editCompany" : "newCompany")} description={t("companyDescription")} dirty={dirty} pending={save.isPending} onClose={onClose}>
    <form className="min-w-0 space-y-4 [&>*]:min-w-0" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <LpsField label={t("companyNameRequired")} value={name} onChange={setName} disabled={save.isPending} error={invalid ? t("errors.validation") : undefined} />
      <LpsReferenceList kind="country" label={t("columns.countries")} ids={countries} selected={initial?.countries} onChange={setCountries} disabled={save.isPending} />
      {save.isError && <LpsError error={save.error} />}<Button type="submit" disabled={save.isPending}>{t(save.isPending ? "saving" : "save")}</Button>
    </form>
  </LpsDialog>;
}
export function LpsCompanyPicker({ value, selected, disabled, onChange, error }: {
  value: string; selected: LpsCompanyRead | null; disabled: boolean; onChange: (value: LpsCompanyRead | null) => void; error?: string;
}) {
  const t = useTranslations("lps"), locale = useLocale(), format = useFormat(), id = useId();
  const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [offset, setOffset] = useState(0);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setOffset(0); }, 250); return () => clearTimeout(timer); }, [search]);
  const result = useQuery({ queryKey: ["lps", "companies", locale, query, offset], queryFn: () => lpsApi.companies(new URLSearchParams({ q: query, locale, offset: String(offset), limit: "50" }).toString()) });
  const companies = new Map((result.data?.items ?? []).map((item) => [item.id, item]));
  if (selected) companies.set(selected.id, selected);
  const items = [{ value: null as string | null, label: t("notSelected") }, ...[...companies.values()].map((item) => ({ value: item.id, label: `${item.name} · ${item.countries.length ? item.countries.map((country) => entryDisplayName(country.names, locale as "en" | "ru" | "kk", country.code)).join(", ") : t("unknown")} · ${format.dateTime(item.updatedAt)}` }))];
  return <div className="min-w-0 space-y-2"><Field className="min-w-0"><FieldLabel htmlFor={`${id}-search`}>{t("companySearch")}</FieldLabel><Input id={`${id}-search`} maxLength={500} value={search} disabled={disabled} onChange={(event) => setSearch(event.target.value)} /></Field>
    <Field className="min-w-0" data-invalid={Boolean(error)}><FieldLabel htmlFor={id}>{t("companyRequired")}</FieldLabel><Select items={items} value={value || null} disabled={disabled || result.isPending || result.isError} onValueChange={(value) => onChange(value ? companies.get(value) ?? null : null)}>
      <SelectTrigger id={id} aria-invalid={Boolean(error)} title={items.find((item) => item.value === (value || null))?.label} className="w-full min-w-0"><SelectValue className="block min-w-0 truncate" /></SelectTrigger><SelectContent alignItemWithTrigger={false}>{items.map((item) => <SelectItem key={item.value ?? "none"} value={item.value} className="whitespace-normal wrap-anywhere">{item.label}</SelectItem>)}</SelectContent></Select>{error && <FieldError>{error}</FieldError>}</Field>
    {result.isError ? <LpsError error={result.error} retry={() => void result.refetch()} /> : <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Button type="button" size="sm" variant="outline" disabled={disabled || offset === 0 || result.isFetching} onClick={() => setOffset(Math.max(0, offset - 50))}>{t("previous")}</Button>
      <span>{t("page", { page: format.number(Math.floor(offset / 50) + 1), pages: format.number(Math.max(1, Math.ceil((result.data?.total ?? 0) / 50))) })}</span>
      <Button type="button" size="sm" variant="outline" disabled={disabled || result.isFetching || offset + 50 >= (result.data?.total ?? 0)} onClick={() => setOffset(offset + 50)}>{t("next")}</Button>
    </div>}
  </div>;
}
