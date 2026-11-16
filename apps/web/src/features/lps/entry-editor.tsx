import { lpsEntryWriteSchema, type LpsCompanyRead, type LpsEntryRead } from "@imbc/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFormat } from "@/i18n/format";
import { lpsApi } from "./api";
import { LpsCompanyEditor, LpsCompanyPicker } from "./company-editor";
import { LpsField, LpsReferenceList, LpsReferencePicker } from "./controls";
import { lpsDraftInput, lpsEntryDraft, reorderLps } from "./data";
import { LpsDialog, LpsError } from "./feedback";

export function LpsEntryEditor({ initial, onClose, onSaved, onDirtyChange, onPendingChange }: {
  initial: LpsEntryRead | null; onClose: () => void; onSaved: (entry: LpsEntryRead) => void; onDirtyChange: (value: boolean) => void; onPendingChange: (value: boolean) => void;
}) {
  const t = useTranslations("lps"), format = useFormat(), client = useQueryClient();
  const [draft, setDraft] = useState(() => lpsEntryDraft(initial)), [company, setCompany] = useState<LpsCompanyRead | null>(initial?.company ?? null);
  const [companyEditor, setCompanyEditor] = useState(false), [companyDirty, setCompanyDirty] = useState(false), [companyPending, setCompanyPending] = useState(false), [issues, setIssues] = useState<Set<string>>(new Set());
  const dirty = JSON.stringify(draft) !== JSON.stringify(lpsEntryDraft(initial));
  useEffect(() => { onDirtyChange(dirty || companyDirty); }, [dirty, companyDirty, onDirtyChange]);
  const save = useMutation({ mutationFn: async () => {
    const parsed = lpsEntryWriteSchema.safeParse(lpsDraftInput(draft));
    if (!parsed.success) { setIssues(new Set(parsed.error.issues.map((issue) => issue.path.join(".")))); return null; }
    setIssues(new Set()); return lpsApi.saveEntry(initial?.id ?? null, parsed.data);
  }, onSuccess: async (entry) => { if (!entry) return; await client.invalidateQueries({ queryKey: ["lps"] }); onSaved(entry); } });
  const error = (path: string) => issues.has(path) ? t("errors.validation") : undefined;
  const disabled = save.isPending || companyPending;
  useEffect(() => { onPendingChange(disabled); }, [disabled, onPendingChange]);
  const patch = (value: Partial<typeof draft>) => setDraft((previous) => ({ ...previous, ...value }));
  const rowActions = (index: number, size: number, move: (direction: -1 | 1) => void, remove: () => void) => <div className="flex flex-wrap gap-2">
    <Button type="button" size="sm" variant="outline" disabled={disabled || index === 0} onClick={() => move(-1)}>{t("moveUp")}</Button>
    <Button type="button" size="sm" variant="outline" disabled={disabled || index === size - 1} onClick={() => move(1)}>{t("moveDown")}</Button>
    <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={remove}>{t("remove")}</Button></div>;
  return <><LpsDialog title={t(initial ? "editEntry" : "newEntry")} description={t("entryDescription")} dirty={dirty} pending={disabled} onClose={onClose}>
    <form className="min-w-0 space-y-5 [&>*]:min-w-0" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <LpsCompanyPicker value={draft.companyId} selected={company} error={error("companyId")} disabled={disabled} onChange={(value) => { setCompany(value); patch({ companyId: value?.id ?? "" }); }} />
      <Button type="button" variant="outline" disabled={disabled} onClick={() => setCompanyEditor(true)}>{t("newCompany")}</Button>
      <div className="grid gap-4 sm:grid-cols-2"><LpsReferencePicker kind="programme" label={t("columns.sourceType")} value={draft.sourceTypeId ?? null} selected={initial ? [initial.sourceType] : []} hint={initial ? undefined : t("defaultLps")} disabled={disabled} onChange={(value) => patch({ sourceTypeId: value ?? initial?.sourceType.id })} />
        <LpsReferencePicker kind="lps_status" label={t("statusRequired")} error={error("statusId")} value={draft.statusId || null} selected={initial ? [initial.status] : []} disabled={disabled} onChange={(value) => patch({ statusId: value ?? "" })} /></div>
      <LpsField label={t("scopeRequired")} error={error("scopeDescription")} multiline value={draft.scopeDescription} disabled={disabled} onChange={(value) => patch({ scopeDescription: value })} />
      <LpsReferenceList kind="commodity_type" label={t("columns.commodityTypes")} ids={draft.commodityTypeIds} selected={initial?.commodityTypes} disabled={disabled} onChange={(value) => patch({ commodityTypeIds: value })} />
      <p className="text-sm text-muted-foreground">{t("groupsDerived")}</p>
      <div className="grid gap-4 sm:grid-cols-2"><LpsField label={t("columns.plannedLaunch")} error={error("plannedLaunch")} value={draft.plannedLaunch} hint={t("launchHint")} disabled={disabled} onChange={(value) => patch({ plannedLaunch: value })} />
        <LpsField label={t("columns.lastUpdatedOn")} error={error("lastUpdatedOn")} type="date" value={draft.lastUpdatedOn} hint={t("businessDateHint")} disabled={disabled} onChange={(value) => patch({ lastUpdatedOn: value })} />
        <LpsField label={t("columns.investmentUsd")} error={error("investmentUsd")} value={draft.investmentUsd} inputMode="decimal" hint={t("amountHint")} disabled={disabled} onChange={(value) => patch({ investmentUsd: value })} />
        <LpsField label={t("columns.newJobs")} error={error("newJobs")} value={draft.newJobs} inputMode="numeric" disabled={disabled} onChange={(value) => patch({ newJobs: value })} /></div>
      <LpsField label={t("columns.comment")} multiline value={draft.comment} disabled={disabled} onChange={(value) => patch({ comment: value })} />
      <section className="space-y-3"><h3 className="font-semibold">{t("locations")}</h3><p className="text-sm text-muted-foreground">{t("locationHint")}</p>
        {draft.locations.map((location, index) => <section key={location.key} aria-label={t("locationNumber", { number: format.number(index + 1) })} className="space-y-3 rounded-lg border p-3">
          <h4 className="font-medium">{t("locationNumber", { number: format.number(index + 1) })}</h4>
          <LpsField label={t("columns.cities")} error={error(`locations.${index}.city`) ?? error(`locations.${index}`)} value={location.city} disabled={disabled} onChange={(city) => patch({ locations: draft.locations.map((value, at) => at === index ? { ...value, city } : value) })} />
          <LpsReferencePicker kind="region" label={t("columns.regions")} value={location.regionId} selected={initial?.locations.flatMap((value) => value.region ? [value.region] : [])} disabled={disabled} onChange={(regionId) => patch({ locations: draft.locations.map((value, at) => at === index ? { ...value, regionId } : value) })} />
          {rowActions(index, draft.locations.length, (direction) => patch({ locations: reorderLps(draft.locations, index, direction) }), () => patch({ locations: draft.locations.filter((_, at) => at !== index) }))}
        </section>)}<Button type="button" variant="outline" disabled={disabled} onClick={() => patch({ locations: [...draft.locations, { key: crypto.randomUUID(), id: null, city: "", regionId: null }] })}>{t("addLocation")}</Button>
      </section>
      <section className="space-y-3"><h3 className="font-semibold">{t("contacts")}</h3><p className="text-sm text-muted-foreground">{t("contactHint")}</p>
        {draft.contacts.map((contact, index) => <section key={contact.key} aria-label={t("contactNumber", { number: format.number(index + 1) })} className="space-y-3 rounded-lg border p-3">
          <h4 className="font-medium">{t("contactNumber", { number: format.number(index + 1) })}</h4>
          {(["fullName", "roleTitle"] as const).map((field) => <LpsField key={field} label={t(field === "fullName" ? "columns.contactNames" : "columns.contactTitles")} value={contact[field]} disabled={disabled} onChange={(value) => patch({ contacts: draft.contacts.map((item, at) => at === index ? { ...item, [field]: value } : item) })} />)}
          {(["emails", "phones"] as const).map((field) => <section key={field} aria-label={t(`columns.${field}`)} className="space-y-2"><h5 className="text-sm font-medium">{t(`columns.${field}`)}</h5>
            {contact[field].map((value, at) => <div key={at} className="space-y-2 rounded border p-2"><LpsField label={t(field === "emails" ? "emailNumber" : "phoneNumber", { number: format.number(at + 1) })} value={value} error={error(`contacts.${index}.${field}.${at}`)} disabled={disabled} hint={field === "phones" ? t("phoneHint") : undefined} onChange={(value) => patch({ contacts: draft.contacts.map((item, contactIndex) => contactIndex === index ? { ...item, [field]: item[field].map((method, methodIndex) => methodIndex === at ? value : method) } : item) })} />
              {rowActions(at, contact[field].length, (direction) => patch({ contacts: draft.contacts.map((item, contactIndex) => contactIndex === index ? { ...item, [field]: reorderLps(item[field], at, direction) } : item) }), () => patch({ contacts: draft.contacts.map((item, contactIndex) => contactIndex === index ? { ...item, [field]: item[field].filter((_, methodIndex) => methodIndex !== at) } : item) }))}</div>)}
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => patch({ contacts: draft.contacts.map((item, at) => at === index ? { ...item, [field]: [...item[field], ""] } : item) })}>{t(field === "emails" ? "addEmail" : "addPhone")}</Button>
          </section>)}
          {rowActions(index, draft.contacts.length, (direction) => patch({ contacts: reorderLps(draft.contacts, index, direction) }), () => patch({ contacts: draft.contacts.filter((_, at) => at !== index) }))}
        </section>)}<Button type="button" variant="outline" disabled={disabled} onClick={() => patch({ contacts: [...draft.contacts, { key: crypto.randomUUID(), id: null, fullName: "", roleTitle: "", emails: [], phones: [] }] })}>{t("addContact")}</Button>
      </section>
      {issues.size > 0 && <Alert variant="destructive"><AlertDescription>{t("errors.validation")}</AlertDescription></Alert>}{save.isError && <LpsError error={save.error} />}
      <Button type="submit" disabled={disabled}>{t(disabled ? "saving" : "save")}</Button>
    </form>
  </LpsDialog>{companyEditor && <LpsCompanyEditor initial={null} onDirtyChange={setCompanyDirty} onPendingChange={setCompanyPending} onClose={() => { setCompanyEditor(false); setCompanyDirty(false); setCompanyPending(false); }} onSaved={(value) => { setCompany(value); patch({ companyId: value.id }); setCompanyEditor(false); setCompanyDirty(false); setCompanyPending(false); }} />}</>;
}
