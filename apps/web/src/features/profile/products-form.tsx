import { entryDisplayName, MANUAL_CAPACITY_UNIT_CODES, productsReadSchema, type ProductsRead, type ProductsWrite, type ProfileProductWrite } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useLocale, useTranslations } from "use-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";
import { ProfileAttachments } from "./attachments";
import { fieldId, moveRow } from "./form-data";
import { ProfileChoiceField, ProfileGroupError, ProfileRowActions, ProfileTextField } from "./form-fields";
import { ProfileReferenceList, ProfileReferencePicker } from "./reference-picker";
import { useProfileChange } from "./use-profile-change";
import type { SectionFieldErrors } from "./section-draft";

export function ProductsForm({ value, source, onChange, disabled, errors }: {
  value: ProductsWrite; source: ProductsRead; onChange: (value: ProductsWrite) => void; disabled: boolean; errors: SectionFieldErrors;
}) {
  const update = useProfileChange(value, onChange);
  const t = useTranslations("profileProducts"); const records = useTranslations("profileRecords");
  const locale = useLocale() as "en" | "ru" | "kk"; const format = useFormat();
  const candidates = useQuery({ queryKey: ["profile", "editor-choices", "products"], enabled: !disabled,
    queryFn: async () => productsReadSchema.shape.relatedChoices.unwrap().parse(await api("/v1/profiles/own/sections/products/choices")) });
  const related = disabled ? source.relatedChoices : candidates.data ?? source.relatedChoices;
  function change(identityId: string, patch: Partial<ProfileProductWrite>) {
    update((current) => ({ ...current, products: current.products.map((row) => row.identityId === identityId ? { ...row, ...patch } as ProfileProductWrite : row) }));
  }
  function add() {
    update((current) => ({ ...current, products: [...current.products, { kind: "manual", identityId: crypto.randomUUID(), nameEn: null, nameRu: null,
      commodityTypeId: null, tnVedEntryId: null, kpvedEntryIds: [], capacityQuantity: null, capacityUnitId: null,
      productionSiteIdentityId: null, note: null, certificateIdentityIds: [] }] }));
  }
  const siteChoices = related?.sites.map((site, index) => ({ value: site.identityId,
    label: [site.address, site.city].filter(Boolean).join(", ") || t("siteNumber", { number: format.number(index + 1) }) })) ?? [];
  const certificateChoices = related?.productCertificates.map((certificate, index) => ({ value: certificate.identityId,
    label: [certificate.certificateType ? entryDisplayName(certificate.certificateType.names, locale, certificate.certificateType.code) : certificate.customTypeName,
      certificate.number].filter(Boolean).join(" — ") || t("certificateNumber", { number: format.number(index + 1) }) })) ?? [];
  const referenceLabel = (code: string | null | undefined, reference: ProductsRead["selectedReferences"]["tnVed"][number] | undefined) => {
    if (!reference) return code;
    const name = entryDisplayName(reference.names, locale, reference.code);
    return name === reference.code ? reference.code : `${reference.code} — ${name}`;
  };
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-medium">{t("title")}</h2>
      {!disabled && <Button type="button" variant="outline" onClick={add}><PlusIcon />{t("add")}</Button>}
    </div>
    <p className="text-sm text-muted-foreground">{t("hint")}</p>
    {candidates.isError && !disabled && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-destructive">{records("referenceError")}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void candidates.refetch()}>{records("retry")}</Button></div>}
    <ProfileGroupError path="products" errors={errors} />
    {!value.products.length && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
    {value.products.map((row, index) => {
      const stored = source.lines.find((line) => line.identityId === row.identityId);
      const path = `products.${index}`;
      const rawKpved = stored?.kpved.filter((item) => item.entryId === null) ?? [];
      return <Card key={row.identityId} id={fieldId(path)}>
        <CardHeader><div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t("number", { number: format.number(index + 1) })}</CardTitle>
          <Badge variant="secondary">{t(`source.${stored?.source ?? "manual"}`)}</Badge>
          {!disabled && row.kind === "manual" && <ProfileRowActions index={index} count={value.products.length} disabled={disabled}
            onMove={(to) => update((current) => ({ ...current, products: moveRow(current.products, index, to) }))}
            onRemove={() => update((current) => ({ ...current, products: current.products.filter((item) => item.identityId !== row.identityId) }))} />}
        </div></CardHeader>
        <CardContent className="space-y-5">
          <ProfileGroupError path={`${path}.identityId`} errors={errors} />
          {row.kind === "manual" ? <>
            <div className="grid gap-4 sm:grid-cols-2">
              <ProfileTextField path={`${path}.nameEn`} label={t("nameEn")} value={row.nameEn} disabled={disabled} errors={errors} onChange={(nameEn) => change(row.identityId, { nameEn })} />
              <ProfileTextField path={`${path}.nameRu`} label={t("nameRu")} value={row.nameRu} disabled={disabled} errors={errors} onChange={(nameRu) => change(row.identityId, { nameRu })} />
            </div>
            <ProfileReferencePicker kind="commodity_type" path={`${path}.commodityTypeId`} label={t("type")} value={row.commodityTypeId}
              selected={source.selectedReferences.commodityTypes} disabled={disabled} errors={errors} onChange={(commodityTypeId) => change(row.identityId, { commodityTypeId })} />
            <ProfileReferencePicker kind="tn_ved" path={`${path}.tnVedEntryId`} label={t("tnVed")} value={row.tnVedEntryId}
              selected={source.selectedReferences.tnVed} disabled={disabled} errors={errors} onChange={(tnVedEntryId) => change(row.identityId, { tnVedEntryId })} />
            {stored?.tnVedEntryId === null && stored.tnVedCode && <SourceValue label={t("sourceTnVed")} value={stored.tnVedCode} />}
            <ProfileReferenceList kind="kpved" path={`${path}.kpvedEntryIds`} label={t("kpved")} ids={row.kpvedEntryIds}
              selected={source.selectedReferences.kpved} disabled={disabled} errors={errors} onChange={(kpvedEntryIds) => change(row.identityId, { kpvedEntryIds })} />
            {rawKpved.length > 0 && <SourceValue label={t("sourceKpved")} value={rawKpved.map((item) => [item.code, item.sourceName].filter(Boolean).join(" — ")).join("\n")} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field><FieldLabel htmlFor={fieldId(`${path}.capacityQuantity`)}>{t("capacity")}</FieldLabel>
                {disabled ? <Textarea readOnly rows={1} id={fieldId(`${path}.capacityQuantity`)} value={format.decimal(row.capacityQuantity)} />
                  : <Input id={fieldId(`${path}.capacityQuantity`)} inputMode="decimal" value={row.capacityQuantity ?? ""} onChange={(event) => change(row.identityId, { capacityQuantity: event.target.value })} />}
                <ProfileGroupError path={`${path}.capacityQuantity`} errors={errors} />
              </Field>
              <ProfileReferencePicker kind="unit" path={`${path}.capacityUnitId`} label={t("unit")} value={row.capacityUnitId}
                selected={source.selectedReferences.units} allowedCodes={MANUAL_CAPACITY_UNIT_CODES} disabled={disabled} errors={errors} onChange={(capacityUnitId) => change(row.identityId, { capacityUnitId })} />
            </div>
          </> : <section aria-label={t("registryFacts")} className="space-y-3 rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">{t("registryHint")}</p>
            <SourceValue label={t("nameEn")} value={stored?.nameEn} /><SourceValue label={t("nameRu")} value={stored?.nameRu} />
            <SourceValue label={t("type")} value={(() => {
              const type = source.selectedReferences.commodityTypes.find((item) => item.id === stored?.commodityTypeId);
              return type ? [referenceLabel(type.code, type), type.group ? referenceLabel(type.group.code, type.group) : null].filter(Boolean).join(" · ") : null;
            })()} />
            <SourceValue label={t("tnVed")} value={referenceLabel(stored?.tnVedCode, source.selectedReferences.tnVed.find((item) => item.id === stored?.tnVedEntryId))} />
            <SourceValue label={t("kpved")} value={stored?.kpved.map((item) => referenceLabel(item.sourceName ? `${item.code} — ${item.sourceName}` : item.code,
              source.selectedReferences.kpved.find((entry) => entry.id === item.entryId))).join("\n")} />
            <SourceValue label={t("capacity")} value={stored?.capacityText ?? format.decimal(stored?.capacityQuantity)} />
            <SourceValue label={t("unit")} value={referenceLabel(null, source.selectedReferences.units.find((item) => item.id === stored?.capacityUnitId))} />
            <SourceValue label={t("registration")} value={stored?.unifiedRegisterRegistrationNumber} />
            <SourceValue label={t("includedOn")} value={format.date(stored?.unifiedRegisterIncludedOn)} />
            <SourceValue label={t("registerActive")} value={stored?.unifiedRegisterActive == null ? "—" : t(stored.unifiedRegisterActive ? "yes" : "no")} />
            <SourceValue label={t("enstru")} value={[stored?.enstruCode, stored?.enstruName].filter(Boolean).join(" — ")} />
          </section>}
          <SourceValue label={t("dvc")} value={format.decimal(stored?.inCountryValueShare ?? (row.kind === "manual" ? "0" : null))} />
          <ProfileChoiceField path={`${path}.productionSiteIdentityId`} label={t("site")} value={row.productionSiteIdentityId} errors={errors}
            choices={row.productionSiteIdentityId && !siteChoices.some((item) => item.value === row.productionSiteIdentityId) ? [...siteChoices, { value: row.productionSiteIdentityId, label: t("linkedSite"), disabled: true }] : siteChoices}
            disabled={disabled || candidates.isPending || candidates.isError} onChange={(productionSiteIdentityId) => change(row.identityId, { productionSiteIdentityId })} />
          <p className="text-xs text-muted-foreground">{t("siteHint")}</p>
          <section id={fieldId(`${path}.certificateIdentityIds`)} aria-label={t("certificates")} className="space-y-3 rounded-lg border p-3">
            <h3 className="text-sm font-medium">{t("certificates")}</h3>
            <ul className="space-y-2">{row.certificateIdentityIds.map((id, certificateIndex) => <li key={id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{certificateChoices.find((item) => item.value === id)?.label ?? t("certificateNumber", { number: format.number(certificateIndex + 1) })}</span>
              {!disabled && <Button type="button" variant="outline" size="sm" onClick={() => change(row.identityId, { certificateIdentityIds: row.certificateIdentityIds.filter((value) => value !== id) })}>{records("remove")}</Button>}
            </li>)}</ul>
            {!disabled && <ProfileChoiceField path={`${path}.certificateIdentityIds.add`} label={t("addCertificate")} value={null}
              choices={certificateChoices.filter((item) => !row.certificateIdentityIds.includes(item.value))} disabled={candidates.isPending || candidates.isError}
              errors={errors} onChange={(id) => { if (id && !row.certificateIdentityIds.includes(id)) change(row.identityId, { certificateIdentityIds: [...row.certificateIdentityIds, id] }); }} />}
            <ProfileGroupError path={`${path}.certificateIdentityIds`} errors={errors} />
          </section>
          <ProfileTextField path={`${path}.note`} label={t("note")} value={row.note} disabled={disabled} errors={errors} onChange={(note) => change(row.identityId, { note })} />
        </CardContent>
      </Card>;
    })}
    <ProfileAttachments target={{ kind: "products", purpose: "unified_register_extract" }} path="unifiedRegisterExtractId"
      label={t("extract")} ids={value.unifiedRegisterExtractId ? [value.unifiedRegisterExtractId] : []} files={source.extract ? [source.extract] : []}
      disabled={disabled} errors={errors} multiple={false} onChange={(ids) => update((current) => ({ ...current, unifiedRegisterExtractId: ids[0] ?? null }))} />
  </div>;
}
function SourceValue({ label, value }: { label: string; value: string | null | undefined }) {
  return <div className="space-y-1"><p className="text-xs text-muted-foreground">{label}</p><p className="whitespace-pre-wrap break-words text-sm">{value || "—"}</p></div>;
}
