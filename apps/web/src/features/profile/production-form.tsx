import { productionEditorChoicesSchema, type ProductionRead, type ProductionWrite } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useLocale, useTranslations } from "use-intl";
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

type Equipment = ProductionWrite["equipment"][number];
export function ProductionForm({ value, source, onChange, disabled, errors }: {
  value: ProductionWrite; source: ProductionRead; onChange: (value: ProductionWrite) => void; disabled: boolean; errors: SectionFieldErrors;
}) {
  const update = useProfileChange(value, onChange);
  const t = useTranslations("profileProduction"); const records = useTranslations("profileRecords"); const format = useFormat(); const locale = useLocale();
  // Equipment has no business identity. Keep a UI key across local edits and reorders, outside the write DTO.
  const [keys] = useState(() => new WeakMap<Equipment, string>());
  function key(row: Equipment) { let identity = keys.get(row); if (!identity) { identity = crypto.randomUUID(); keys.set(row, identity); } return identity; }
  function change(row: Equipment, patch: Partial<Equipment>) {
    const identity = key(row);
    update((current) => ({ ...current, equipment: current.equipment.map((item) => {
      if (keys.get(item) !== identity) return item;
      const next = { ...item, ...patch }; keys.set(next, identity); return next;
    }) }));
  }
  const candidates = useQuery({ queryKey: ["profile", "editor-choices", "production"], enabled: !disabled,
    queryFn: async () => productionEditorChoicesSchema.parse(await api("/v1/profiles/own/sections/production/choices")) });
  const products = (disabled ? source.productChoices : candidates.data ?? source.productChoices) ?? [];
  const productChoices = products.map((product, index) => ({ value: product.identityId,
    label: [locale === "en" ? product.nameEn ?? product.nameRu : product.nameRu ?? product.nameEn, product.tnVedCode].filter(Boolean).join(" — ")
      || t("productNumber", { number: format.number(index + 1) }) }));
  const photos = [...source.photos, ...source.equipmentPhotos.filter((file) => file !== null)];
  return <div className="space-y-5">
    <p className="text-sm text-muted-foreground">{t("optionalHint")}</p>
    <div className="grid gap-4 sm:grid-cols-2">
      {(["areaSqm", "workshopCount", "utilisationPercent"] as const).map((path) => <Field key={path}>
        <FieldLabel htmlFor={fieldId(path)}>{t(path)}</FieldLabel>
        {disabled ? <Textarea id={fieldId(path)} rows={1} readOnly value={path === "workshopCount" ? value[path] === null ? "—" : format.number(value[path]) : format.decimal(value[path])} />
          : <Input id={fieldId(path)} type={path === "workshopCount" ? "number" : "text"} inputMode={path === "workshopCount" ? "numeric" : "decimal"}
            min={0} max={path === "workshopCount" ? 2_147_483_647 : undefined} step={path === "workshopCount" ? 1 : undefined}
            value={value[path] ?? ""} onChange={(event) => update((current) => ({ ...current, [path]: path === "workshopCount" ? event.target.value === "" ? null : Number(event.target.value) : event.target.value }))} />}
        <ProfileGroupError path={path} errors={errors} />
      </Field>)}
    </div>
    <ProfileReferenceList kind="process" path="processEntryIds" label={t("processes")} ids={value.processEntryIds} selected={source.selectedReferences.processes}
      disabled={disabled} errors={errors} onChange={(processEntryIds) => update((current) => ({ ...current, processEntryIds }))} />
    <ProfileAttachments target={{ kind: "production", purpose: "production_photo" }} path="photoIds" label={t("photos")}
      ids={value.photoIds} files={photos} disabled={disabled} errors={errors} onChange={(photoIds) => update((current) => ({ ...current, photoIds }))} />
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-medium">{t("equipment")}</h2>
      {!disabled && <Button type="button" variant="outline" onClick={() => update((current) => ({ ...current, equipment: [...current.equipment,
        { name: null, typeId: null, quantity: null, photoId: null, productIdentityIds: [] }] }))}><PlusIcon />{t("add")}</Button>}
    </div>
    {candidates.isError && !disabled && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-destructive">{records("referenceError")}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void candidates.refetch()}>{records("retry")}</Button></div>}
    <ProfileGroupError path="equipment" errors={errors} />
    {value.equipment.map((row, index) => { const path = `equipment.${index}`; return <Card key={key(row)} id={fieldId(path)}>
      <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>{t("number", { number: format.number(index + 1) })}</CardTitle>
        {!disabled && <ProfileRowActions index={index} count={value.equipment.length} disabled={disabled}
          onMove={(to) => update((current) => ({ ...current, equipment: moveRow(current.equipment, index, to) }))}
          onRemove={() => update((current) => ({ ...current, equipment: current.equipment.filter((item) => keys.get(item) !== key(row)) }))} />}
      </div></CardHeader>
      <CardContent className="space-y-4">
        <ProfileTextField path={`${path}.name`} label={t("name")} value={row.name} disabled={disabled} errors={errors} onChange={(name) => change(row, { name })} />
        <ProfileReferencePicker kind="equipment_type" path={`${path}.typeId`} label={t("type")} value={row.typeId} selected={source.selectedReferences.equipmentTypes}
          disabled={disabled} errors={errors} onChange={(typeId) => change(row, { typeId })} />
        <Field><FieldLabel htmlFor={fieldId(`${path}.quantity`)}>{t("quantity")}</FieldLabel>
          {disabled ? <Textarea id={fieldId(`${path}.quantity`)} rows={1} readOnly value={row.quantity === null ? "—" : format.number(row.quantity)} />
            : <Input id={fieldId(`${path}.quantity`)} type="number" min={0} max={2_147_483_647} step={1} inputMode="numeric" value={row.quantity ?? ""}
              onChange={(event) => change(row, { quantity: event.target.value === "" ? null : Number(event.target.value) })} />}
          <ProfileGroupError path={`${path}.quantity`} errors={errors} />
        </Field>
        <ProfileAttachments target={{ kind: "production", purpose: "production_photo" }} path={`${path}.photoId`} label={t("equipmentPhoto")}
          ids={row.photoId ? [row.photoId] : []} files={photos} multiple={false} disabled={disabled} errors={errors} onChange={(ids) => change(row, { photoId: ids[0] ?? null })} />
        <section id={fieldId(`${path}.productIdentityIds`)} aria-label={t("products")} className="space-y-3 rounded-lg border p-3">
          <h3 className="text-sm font-medium">{t("products")}</h3>
          <ul className="space-y-2">{row.productIdentityIds.map((id, productIndex) => <li key={id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{productChoices.find((item) => item.value === id)?.label ?? t("productNumber", { number: format.number(productIndex + 1) })}</span>
            {!disabled && <Button type="button" variant="outline" size="sm" onClick={() => change(row, { productIdentityIds: row.productIdentityIds.filter((value) => value !== id) })}>{records("remove")}</Button>}
          </li>)}</ul>
          {!disabled && <ProfileChoiceField path={`${path}.productIdentityIds.add`} label={t("addProduct")} value={null}
            choices={productChoices.filter((item) => !row.productIdentityIds.includes(item.value))} errors={errors} disabled={candidates.isPending || candidates.isError}
            onChange={(id) => { if (id && !row.productIdentityIds.includes(id)) change(row, { productIdentityIds: [...row.productIdentityIds, id] }); }} />}
          <ProfileGroupError path={`${path}.productIdentityIds`} errors={errors} />
        </section>
      </CardContent>
    </Card>; })}
  </div>;
}
