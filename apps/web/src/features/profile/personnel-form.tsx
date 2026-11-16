import type { PersonnelRead, PersonnelWrite } from "@imbc/contracts";
import { useTranslations } from "use-intl";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFormat } from "@/i18n/format";
import { ProfileAttachments } from "./attachments";
import { ProfileOrgChartSample } from "./org-chart-sample";
import { fieldId, useFieldMessage } from "./form-data";
import { useProfileChange } from "./use-profile-change";
import type { SectionFieldErrors } from "./section-draft";

export function PersonnelForm({ value, source, onChange, disabled, errors }: {
  value: PersonnelWrite; source: PersonnelRead; onChange: (value: PersonnelWrite) => void;
  disabled: boolean; errors: SectionFieldErrors;
}) {
  const update = useProfileChange(value, onChange);
  const t = useTranslations("profilePersonnel"); const format = useFormat();
  const counts = [value.managersCount, value.engineersCount, value.productionWorkersCount];
  const total = counts.every((count) => count !== null) ? counts.reduce<number>((sum, count) => sum + (count ?? 0), 0) : null;
  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2">
      {(["managersCount", "engineersCount", "productionWorkersCount", "nonresidentCount"] as const).map((path) =>
        <CountField key={path} path={path} value={value[path]} label={t(path)} hint={path === "nonresidentCount" ? t("subsetHint") : undefined}
          disabled={disabled} errors={errors} onChange={(count) => update((current) => ({ ...current, [path]: count }))} />)}
      <Field><FieldLabel htmlFor={fieldId("totalHeadcount")}>{t("totalHeadcount")}</FieldLabel>
        <Textarea id={fieldId("totalHeadcount")} rows={1} readOnly value={total === null ? "—" : format.number(total)} />
        <p className="text-xs text-muted-foreground">{t("totalHint")}</p>
      </Field>
    </div>
    <ProfileOrgChartSample />
    <ProfileAttachments target={{ kind: "personnel", purpose: "organisation_chart" }} path="organisationChartIds"
      label={t("organisationCharts")} ids={value.organisationChartIds} files={source.organisationCharts}
      disabled={disabled} errors={errors} onChange={(organisationChartIds) => update((current) => ({ ...current, organisationChartIds }))} />
    <ProfileAttachments target={{ kind: "personnel", purpose: "cv" }} path="cvFileIds"
      label={t("cvs")} ids={value.cvFileIds} files={source.cvs} disabled={disabled} errors={errors}
      onChange={(cvFileIds) => update((current) => ({ ...current, cvFileIds }))} />
  </div>;
}
function CountField({ path, label, hint, value, disabled, errors, onChange }: {
  path: string; label: string; hint?: string; value: number | null; disabled: boolean;
  errors: SectionFieldErrors; onChange: (value: number | null) => void;
}) {
  const format = useFormat(); const error = useFieldMessage(errors[path]);
  return <Field data-invalid={Boolean(error)}><FieldLabel htmlFor={fieldId(path)}>{label}</FieldLabel>
    {disabled ? <Textarea id={fieldId(path)} rows={1} readOnly value={value === null ? "—" : format.number(value)} />
      : <Input id={fieldId(path)} type="number" min={0} max={2_147_483_647} step={1} inputMode="numeric"
        value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        aria-invalid={Boolean(error)} aria-describedby={error ? `${fieldId(path)}-error` : undefined} />}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    {error && <FieldError id={`${fieldId(path)}-error`}>{error}</FieldError>}
  </Field>;
}
