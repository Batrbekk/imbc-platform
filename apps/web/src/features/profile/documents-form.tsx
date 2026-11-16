import { entryDisplayName, type DocumentsRead, type DocumentsWrite } from "@imbc/contracts";
import { PlusIcon } from "lucide-react";
import { useLocale, useTranslations } from "use-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFormat } from "@/i18n/format";
import { RequirementsLoading } from "./current-requirements";
import { useCurrentRequirements } from "./current-requirements-data";
import { ProfileAttachments } from "./attachments";
import { fieldId, moveRow, useProfileChoices } from "./form-data";
import { ProfileChoiceField, ProfileGroupError, ProfileRowActions, ProfileTextField } from "./form-fields";
import { useProfileChange } from "./use-profile-change";
import type { SectionFieldErrors } from "./section-draft";

export function DocumentsForm({ value, source, onChange, disabled, errors }: {
  value: DocumentsWrite; source: DocumentsRead; onChange: (value: DocumentsWrite) => void;
  disabled: boolean; errors: SectionFieldErrors;
}) {
  const update = useProfileChange(value, onChange);
  const t = useTranslations("profileDocuments"); const records = useTranslations("profileRecords");
  const locale = useLocale() as "en" | "ru" | "kk"; const format = useFormat();
  const current = useCurrentRequirements("documents", !disabled);
  const requiredTypes = disabled ? source.requiredTypes : current.data?.requiredTypes ?? [];
  const selected = [...requiredTypes, ...source.requiredTypes, ...source.documents.flatMap((item) => item.documentType ? [item.documentType] : [])];
  const types = useProfileChoices("document_type", selected);
  function change(index: number, patch: Partial<DocumentsWrite["documents"][number]>) {
    const identityId = value.documents[index]?.identityId;
    update((current) => ({ documents: current.documents.map((row) => row.identityId === identityId ? { ...row, ...patch } : row) }));
  }
  function add(documentTypeId: string | null = null) {
    update((current) => ({ documents: [...current.documents, { identityId: crypto.randomUUID(), documentTypeId, customName: null, fileId: null }] }));
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-medium">{t("title")}</h2>
      <Button type="button" variant="outline" disabled={disabled} onClick={() => add()}><PlusIcon />{t("add")}</Button>
    </div>
    <p className="text-sm text-muted-foreground">{t("hint")}</p>
    {!disabled && <RequirementsLoading pending={current.isPending} error={current.isError} retry={() => void current.refetch()} />}
    <div className="grid gap-3 sm:grid-cols-2">{requiredTypes.map((type, index) => <div key={type.id}
      id={fieldId(`requiredTypes.${index}`)} className="rounded-lg border p-3">
      <p className="text-sm font-medium">{entryDisplayName(type.names, locale, type.code)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("required")}</p>
      {!disabled && !value.documents.some((row) => row.documentTypeId === type.id) && <Button type="button" variant="outline" size="sm"
        className="mt-2" onClick={() => add(type.id)}>{t("add")}</Button>}
    </div>)}</div>
    {types.isError && <p role="alert" className="text-sm text-destructive">{records("referenceError")}</p>}
    <ProfileGroupError path="documents" errors={errors} />
    {value.documents.map((row, index) => {
      const saved = source.editable.documents.find((item) => item.identityId === row.identityId);
      const record = source.documents.find((item) => item.identityId === row.identityId);
      const custom = types.choices.find((item) => item.value === row.documentTypeId)?.customNameAllowed;
      const status = JSON.stringify(saved) !== JSON.stringify(row) ? "unsaved" : record?.status ?? "missing";
      return <Card key={row.identityId} id={fieldId(`documents.${index}`)}>
        <CardHeader><div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t("number", { number: format.number(index + 1) })}</CardTitle><Badge variant="secondary">{records(`status.${status}`)}</Badge>
          {!disabled && <ProfileRowActions index={index} count={value.documents.length} disabled={disabled}
            onMove={(to) => update((current) => ({ documents: moveRow(current.documents, current.documents.findIndex((item) => item.identityId === row.identityId), to) }))}
            onRemove={() => update((current) => ({ documents: current.documents.filter((item) => item.identityId !== row.identityId) }))} />}
        </div></CardHeader>
        <CardContent className="space-y-4">
          <ProfileGroupError path={`documents.${index}.identityId`} errors={errors} />
          <ProfileChoiceField path={`documents.${index}.documentTypeId`} label={t("type")} value={row.documentTypeId}
            disabled={disabled || types.isPending || types.isError} errors={errors} choices={types.choices}
            onChange={(documentTypeId) => change(index, { documentTypeId, customName: null })} />
          {(custom || row.customName !== null) && <ProfileTextField path={`documents.${index}.customName`} label={t("name")}
            value={row.customName} disabled={disabled} errors={errors} onChange={(customName) => change(index, { customName })} />}
          <ProfileAttachments target={{ kind: "documents", purpose: "document_file" }} path={`documents.${index}.fileId`}
            label={t("file")} ids={row.fileId ? [row.fileId] : []} files={record?.file ? [record.file] : []} multiple={false}
            disabled={disabled} errors={errors} onChange={(ids) => change(index, { fileId: ids[0] ?? null })} />
        </CardContent>
      </Card>;
    })}
  </div>;
}
