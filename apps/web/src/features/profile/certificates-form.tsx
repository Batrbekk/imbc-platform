import { CERTIFICATE_GROUPS, COMPANY_ISO_CODES, entryDisplayName, type CertificatesRead, type CertificatesWrite } from "@imbc/contracts";
import { PlusIcon } from "lucide-react";
import { useLocale, useTranslations } from "use-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { useFormat } from "@/i18n/format";
import { ProfileAttachments } from "./attachments";
import { fieldId, moveRow, useProfileChoices } from "./form-data";
import { ProfileChoiceField, ProfileGroupError, ProfileRowActions, ProfileTextField } from "./form-fields";
import { useProfileChange } from "./use-profile-change";
import type { SectionFieldErrors } from "./section-draft";

type Certificate = CertificatesWrite["certificates"][number];
export function CertificatesForm({ value, source, onChange, disabled, errors }: {
  value: CertificatesWrite; source: CertificatesRead; onChange: (value: CertificatesWrite) => void;
  disabled: boolean; errors: SectionFieldErrors;
}) {
  const update = useProfileChange(value, onChange);
  const t = useTranslations("profileCertificates"); const records = useTranslations("profileRecords");
  const locale = useLocale() as "en" | "ru" | "kk"; const format = useFormat();
  const selected = [...source.requiredTypes, ...source.certificates.flatMap((item) => item.certificateType ? [item.certificateType] : [])];
  const types = useProfileChoices("certificate_type", selected);
  const groups = CERTIFICATE_GROUPS.map((group) => ({ value: group, label: t(`group.${group}`) }));
  function change(index: number, patch: Partial<Certificate>) {
    const identityId = value.certificates[index]?.identityId;
    update((current) => ({ certificates: current.certificates.map((row) => row.identityId === identityId ? { ...row, ...patch } : row) }));
  }
  function add(certificateTypeId: string | null = null) {
    update((current) => ({ certificates: [...current.certificates, { identityId: crypto.randomUUID(), group: "company", certificateTypeId,
      customTypeName: null, notHeld: false, number: null, issuingBody: null, issuedOn: null, expiresOn: null, fileId: null }] }));
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-medium">{t("title")}</h2>
      <Button type="button" variant="outline" disabled={disabled} onClick={() => add()}><PlusIcon />{t("add")}</Button>
    </div>
    <p className="text-sm text-muted-foreground">{t("hint")}</p>
    <div className="grid gap-3 sm:grid-cols-3">{source.requiredTypes.map((type, index) => <div key={type.id}
      id={fieldId(`requiredTypes.${index}`)} className="rounded-lg border p-3">
      <p className="text-sm font-medium">{entryDisplayName(type.names, locale, type.code)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{COMPANY_ISO_CODES.some((code) => code.toLowerCase() === type.code.toLowerCase()) ? t("isoRequired") : t("required")}</p>
      {!disabled && !value.certificates.some((row) => row.group === "company" && row.certificateTypeId === type.id) && <Button type="button" variant="outline" size="sm"
        className="mt-2" onClick={() => add(type.id)}>{t("add")}</Button>}
    </div>)}</div>
    {types.isError && <p role="alert" className="text-sm text-destructive">{records("referenceError")}</p>}
    <ProfileGroupError path="certificates" errors={errors} />
    {value.certificates.map((row, index) => {
      const saved = source.editable.certificates.find((item) => item.identityId === row.identityId);
      const record = source.certificates.find((item) => item.identityId === row.identityId);
      const type = types.choices.find((item) => item.value === row.certificateTypeId);
      const allowsAbsence = row.group === "company" && type && COMPANY_ISO_CODES.some((code) => code.toLowerCase() === type.code.toLowerCase());
      const status = JSON.stringify(saved) !== JSON.stringify(row) ? "unsaved" : row.notHeld ? "not_held" : record?.status ?? "missing";
      return <Card key={row.identityId} id={fieldId(`certificates.${index}`)}>
        <CardHeader><div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t("itemNumber", { number: format.number(index + 1) })}</CardTitle><Badge variant="secondary">{records(`status.${status}`)}</Badge>
          {!disabled && <ProfileRowActions index={index} count={value.certificates.length} disabled={disabled}
            onMove={(to) => update((current) => ({ certificates: moveRow(current.certificates, current.certificates.findIndex((item) => item.identityId === row.identityId), to) }))}
            onRemove={() => update((current) => ({ certificates: current.certificates.filter((item) => item.identityId !== row.identityId) }))} />}
        </div></CardHeader>
        <CardContent className="space-y-4">
          <ProfileGroupError path={`certificates.${index}.identityId`} errors={errors} />
          <div className="grid gap-4 sm:grid-cols-2">
            <ProfileChoiceField path={`certificates.${index}.group`} label={t("groupLabel")} value={row.group} disabled={disabled}
              choices={groups} errors={errors} onChange={(group) => change(index, { group: group as Certificate["group"], notHeld: group === "company" && row.notHeld })} />
            <ProfileChoiceField path={`certificates.${index}.certificateTypeId`} label={t("type")} value={row.certificateTypeId}
              disabled={disabled || types.isPending || types.isError} errors={errors} choices={types.choices}
              onChange={(certificateTypeId) => change(index, { certificateTypeId, customTypeName: null,
                notHeld: row.notHeld && COMPANY_ISO_CODES.some((code) => code.toLowerCase() === types.choices.find((item) => item.value === certificateTypeId)?.code.toLowerCase()) })} />
          </div>
          {(type?.customNameAllowed || row.customTypeName !== null) && <ProfileTextField path={`certificates.${index}.customTypeName`}
            label={t("customName")} value={row.customTypeName} disabled={disabled} errors={errors} onChange={(customTypeName) => change(index, { customTypeName })} />}
          {allowsAbsence && <Field orientation="horizontal"><Checkbox id={fieldId(`certificates.${index}.notHeld`)} checked={row.notHeld}
            disabled={disabled} onCheckedChange={(notHeld) => change(index, notHeld ? { notHeld, number: null, issuingBody: null, issuedOn: null, expiresOn: null, fileId: null } : { notHeld })} />
            <FieldContent><FieldLabel htmlFor={fieldId(`certificates.${index}.notHeld`)}>{t("notHeld")}</FieldLabel></FieldContent>
          </Field>}
          <ProfileGroupError path={`certificates.${index}.notHeld`} errors={errors} />
          {!row.notHeld && <>
            <div className="grid gap-4 sm:grid-cols-2">
              <ProfileTextField path={`certificates.${index}.number`} label={t("number")} value={row.number} disabled={disabled} errors={errors} onChange={(number) => change(index, { number })} />
              <ProfileTextField path={`certificates.${index}.issuingBody`} label={t("issuer")} value={row.issuingBody} disabled={disabled} errors={errors} onChange={(issuingBody) => change(index, { issuingBody })} />
              <ProfileTextField path={`certificates.${index}.issuedOn`} label={t("issuedOn")} type="date" value={row.issuedOn} disabled={disabled} errors={errors} onChange={(issuedOn) => change(index, { issuedOn: issuedOn || null })} />
              <ProfileTextField path={`certificates.${index}.expiresOn`} label={t("expiresOn")} type="date" value={row.expiresOn} hint={t("expiryHint")}
                disabled={disabled} errors={errors} onChange={(expiresOn) => change(index, { expiresOn: expiresOn || null })} />
            </div>
            <ProfileAttachments target={{ kind: "certificates", purpose: "certificate_file" }} path={`certificates.${index}.fileId`}
              label={t("file")} ids={row.fileId ? [row.fileId] : []} files={record?.file ? [record.file] : []} multiple={false}
              disabled={disabled} errors={errors} onChange={(ids) => change(index, { fileId: ids[0] ?? null })} />
          </>}
        </CardContent>
      </Card>;
    })}
  </div>;
}
