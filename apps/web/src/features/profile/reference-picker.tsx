import { entryDisplayName, type DictionaryCode, type DictionaryChoicesPage, type ProductReference } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";
import { fieldId } from "./form-data";
import { ProfileChoiceField, ProfileGroupError } from "./form-fields";
import type { SectionFieldErrors } from "./section-draft";

/** Classification lists are searched and paginated on the server, including leading-zero codes. */
export function ProfileReferencePicker({ kind, path, label, value, selected, onChange, disabled, errors, allowedCodes }: {
  kind: DictionaryCode; path: string; label: string; value: string | null; selected: readonly ProductReference[];
  onChange: (id: string | null, reference?: ProductReference) => void; disabled: boolean; errors: SectionFieldErrors; allowedCodes?: readonly string[];
}) {
  const t = useTranslations("profileRecords"); const locale = useLocale() as "en" | "ru" | "kk"; const format = useFormat();
  const [search, setSearch] = useState(""); const [query, setQuery] = useState(""); const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<ProductReference[]>([]);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const result = useQuery({
    queryKey: ["profile", "reference-picker", kind, locale, query, page], enabled: !disabled,
    queryFn: () => api<DictionaryChoicesPage>(`/v1/dictionaries/${kind}/choices?${new URLSearchParams({ lang: locale, q: query, page: String(page), pageSize: "100" })}`),
  });
  const name = (item: ProductReference) => {
    const group = (item as ProductReference & { group?: ProductReference | null }).group;
    return `${item.code} — ${entryDisplayName(item.names, locale, item.code)}${group ? ` (${group.code} — ${entryDisplayName(group.names, locale, group.code)})` : ""}`;
  };
  const choices = (result.data?.items ?? []).filter((item) => !allowedCodes || allowedCodes.includes(item.code))
    .map((item) => ({ value: item.id, label: `${item.code} — ${item.name}${item.parentCode ? ` (${item.parentCode})` : ""}`, disabled: false }));
  const metadata = new Map([...chosen, ...selected].map((item) => [item.id, item]));
  for (const item of metadata.values()) if (!choices.some((choice) => choice.value === item.id))
    choices.push({ value: item.id, label: name(item), disabled: item.retired || Boolean(allowedCodes && !allowedCodes.includes(item.code)) });
  const pages = Math.max(1, Math.ceil((result.data?.total ?? 0) / 100));
  if (disabled) return <Field><FieldLabel htmlFor={fieldId(path)}>{label}</FieldLabel>
    <Textarea id={fieldId(path)} readOnly rows={1} value={value && metadata.has(value) ? name(metadata.get(value)!) : value ? t("referenceUnknown") : "—"} />
    <ProfileGroupError path={path} errors={errors} />
  </Field>;
  return <div className="space-y-2">
    <Field><FieldLabel htmlFor={`${fieldId(path)}-search`}>{t("searchReference", { label })}</FieldLabel>
      <Input id={`${fieldId(path)}-search`} value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} />
    </Field>
    <ProfileChoiceField path={path} label={label} value={value} choices={choices} errors={errors}
      disabled={result.isPending || result.isError} onChange={(id) => {
        const item = result.data?.items.find((item) => item.id === id);
        const reference: ProductReference | undefined = item ? { id: item.id, code: item.code, retired: false,
          names: { en: null, ru: null, kk: null, [locale]: item.name } } : id ? metadata.get(id) : undefined;
        if (reference) setChosen((previous) => [...previous.filter((item) => item.id !== reference.id), reference]);
        onChange(id, reference);
      }} />
    {result.isError ? <div className="flex flex-wrap items-center gap-2"><p role="alert" className="text-sm text-destructive">{t("referenceError")}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void result.refetch()}>{t("retry")}</Button></div>
      : <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Button type="button" variant="outline" size="sm" disabled={result.isFetching || page === 1} onClick={() => setPage((value) => value - 1)}>{t("previous")}</Button>
        <span>{t("page", { page: format.number(page), pages: format.number(pages), total: format.number(result.data?.total ?? 0) })}</span>
        <Button type="button" variant="outline" size="sm" disabled={result.isFetching || page >= pages} onClick={() => setPage((value) => value + 1)}>{t("next")}</Button>
      </div>}
  </div>;
}

export function ProfileReferenceList({ kind, path, label, ids, selected, onChange, disabled, errors }: {
  kind: DictionaryCode; path: string; label: string; ids: readonly string[]; selected: readonly ProductReference[];
  onChange: (ids: string[]) => void; disabled: boolean; errors: SectionFieldErrors;
}) {
  const locale = useLocale() as "en" | "ru" | "kk"; const t = useTranslations("profileRecords");
  const [added, setAdded] = useState<ProductReference[]>([]);
  const known = new Map([...added, ...selected].map((item) => [item.id, item]));
  return <section id={fieldId(path)} aria-label={label} className="space-y-3 rounded-lg border p-3">
    <h3 className="text-sm font-medium">{label}</h3>
    <ul className="space-y-2">{ids.map((id) => { const item = known.get(id); return <li key={id} className="flex items-start justify-between gap-3 text-sm">
      <span className="break-words">{item ? `${item.code} — ${entryDisplayName(item.names, locale, item.code)}` : t("referenceUnknown")}</span>
      {!disabled && <Button type="button" variant="outline" size="sm" onClick={() => onChange(ids.filter((value) => value !== id))}>{t("remove")}</Button>}
    </li>; })}</ul>
    {!disabled && <ProfileReferencePicker kind={kind} path={`${path}.add`} label={t("addReference", { label })} value={null}
      selected={[]} errors={errors} disabled={disabled} onChange={(id, reference) => {
        if (reference) setAdded((previous) => [...previous.filter((item) => item.id !== reference.id), reference]);
        if (id && !ids.includes(id)) onChange([...ids, id]);
      }} />}
    <ProfileGroupError path={path} errors={errors} />
  </section>;
}
