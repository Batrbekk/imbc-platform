import { entryDisplayName, type DictionaryCode, type DictionaryChoicesPage, type LpsReferenceBase } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";

export function LpsField({ label, value, onChange, disabled, multiline, type = "text", hint, error, inputMode }: {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean; multiline?: boolean;
  type?: string; hint?: string; error?: string; inputMode?: "decimal" | "numeric";
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return <Field className="min-w-0" data-invalid={Boolean(error)}><FieldLabel htmlFor={id}>{label}</FieldLabel>
    {multiline ? <Textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={describedBy} />
      : <Input id={id} type={type} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={describedBy} />}
    {hint && <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>}{error && <FieldError id={`${id}-error`}>{error}</FieldError>}
  </Field>;
}
export type LpsChoice = Pick<LpsReferenceBase, "id" | "code" | "names" | "retiredAt">;
export function LpsReferencePicker({ kind, label, value, selected = [], onChange, disabled, hint, error }: {
  kind: DictionaryCode; label: string; value: string | null; selected?: readonly LpsChoice[];
  onChange: (id: string | null, choice?: LpsChoice) => void; disabled?: boolean; hint?: string; error?: string;
}) {
  const t = useTranslations("lps"), locale = useLocale() as "en" | "ru" | "kk", format = useFormat(), id = useId();
  const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [page, setPage] = useState(1);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const result = useQuery({ queryKey: ["lps", "reference", kind, locale, query, page], enabled: !disabled,
    queryFn: () => api<DictionaryChoicesPage>(`/v1/dictionaries/${kind}/choices?${new URLSearchParams({ q: query, lang: locale, page: String(page), pageSize: "100" })}`) });
  const metadata = new Map<string, LpsChoice>(selected.map((item) => [item.id, item]));
  for (const item of result.data?.items ?? []) metadata.set(item.id, { id: item.id, code: item.code, names: { en: null, ru: null, kk: null, [locale]: item.name }, retiredAt: null });
  const name = (item: LpsChoice) => `${item.code} — ${entryDisplayName(item.names, locale, item.code)}${item.retiredAt ? ` (${t("retired")})` : ""}${kind === "programme" && item.code === "LC" ? ` (${t("legacy")})` : ""}`;
  const items: { value: string | null; label: string; disabled?: boolean }[] = [{ value: null, label: t("notSelected") }, ...[...metadata.values()].map((item) => ({ value: item.id, label: name(item), disabled: item.retiredAt !== null && item.id !== value }))];
  if (value && !metadata.has(value)) items.push({ value, label: t("selectedReference") });
  const pages = Math.max(1, Math.ceil((result.data?.total ?? 0) / 100));
  return <div className="min-w-0 space-y-2"><Field className="min-w-0"><FieldLabel htmlFor={`${id}-search`}>{t("referenceSearch", { label })}</FieldLabel>
    <Input id={`${id}-search`} value={search} maxLength={100} disabled={disabled} onChange={(event) => setSearch(event.target.value)} /></Field>
    <Field className="min-w-0" data-invalid={Boolean(error)}><FieldLabel htmlFor={id}>{label}</FieldLabel><Select items={items} value={value} disabled={disabled || result.isPending || result.isError} onValueChange={(value) => onChange(value, value ? metadata.get(value) : undefined)}>
      <SelectTrigger id={id} aria-invalid={Boolean(error)} title={items.find((item) => item.value === value)?.label} className="w-full min-w-0"><SelectValue className="block min-w-0 truncate" /></SelectTrigger><SelectContent alignItemWithTrigger={false}>{items.map((item) => <SelectItem key={item.value ?? "none"} value={item.value} disabled={item.disabled} className="whitespace-normal wrap-anywhere">{item.label}</SelectItem>)}</SelectContent>
    </Select>{hint && <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>}{error && <FieldError id={`${id}-error`}>{error}</FieldError>}</Field>
    {result.isError ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">{t("referenceError")}<Button type="button" variant="outline" size="sm" onClick={() => void result.refetch()}>{t("retry")}</Button></div>
      : <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Button type="button" size="sm" variant="outline" disabled={disabled || result.isFetching || page === 1} onClick={() => setPage(page - 1)}>{t("previous")}</Button>
        <span>{t("page", { page: format.number(page), pages: format.number(pages) })}</span><Button type="button" size="sm" variant="outline" disabled={disabled || result.isFetching || page >= pages} onClick={() => setPage(page + 1)}>{t("next")}</Button></div>}
  </div>;
}
export function LpsReferenceList({ kind, label, ids, selected = [], onChange, disabled, includeUnknown }: {
  kind: DictionaryCode; label: string; ids: readonly string[]; selected?: readonly LpsChoice[];
  onChange: (ids: string[]) => void; disabled?: boolean; includeUnknown?: boolean;
}) {
  const locale = useLocale() as "en" | "ru" | "kk", t = useTranslations("lps"), [added, setAdded] = useState<LpsChoice[]>([]);
  const known = new Map([...selected, ...added].map((item) => [item.id, item]));
  return <section aria-label={label} className="min-w-0 space-y-3 rounded-lg border p-3"><h3 className="font-medium">{label}</h3>
    <ul className="space-y-2">{ids.map((id) => <li key={id} className="flex items-start justify-between gap-2 text-sm">
      <span className="wrap-anywhere">{id === "unknown" ? t("unknown") : known.has(id) ? `${known.get(id)!.code} — ${entryDisplayName(known.get(id)!.names, locale, known.get(id)!.code)}` : t("selectedReference")}</span>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange(ids.filter((value) => value !== id))}>{t("remove")}</Button></li>)}</ul>
    <LpsReferencePicker kind={kind} label={t("addReference", { label })} value={null} disabled={disabled} onChange={(id, item) => {
      if (item) setAdded((previous) => [...previous.filter((value) => value.id !== item.id), item]);
      if (id && !ids.includes(id)) onChange([...ids, id]);
    }} />{includeUnknown && <Button type="button" variant="outline" size="sm" disabled={disabled || ids.includes("unknown")} onClick={() => onChange([...ids, "unknown"])}>{t("addUnknown")}</Button>}
  </section>;
}
