// Формы секций «Основная информация», «Контакты», «Персонал», «Акционеры».
// MAN-09, MAN-10, MAN-11, MAN-12, MAN-13, MAN-14, MAN-15, MAN-17, MAN-18, MAN-19, MAN-20, MAN-21, MAN-22.
import { CONTACT_ROLES, type ContactRole } from "@imbc/contracts";
import { use, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useFormat } from "@/i18n/format";

import { FileRow } from "../components";
import type { Contact, Shareholder } from "../data";
import { useDictionary } from "../i18n";
import { newId, useProto } from "../store";
import {
  AddButton,
  CheckField,
  ChoiceField,
  FieldGrid,
  FileSlot,
  NumberField,
  RowCard,
  SaveBar,
  TextField,
} from "./fields";
import { LockedContext } from "./locked";
import type { FormProps } from "./model";
import { EMAIL_RE, isPhone, useReference, withCurrent } from "./reference";
import { texts } from "./texts";

export function MainForm({ profile, initial, onSave }: FormProps<"main">) {
  const t = useDictionary(texts);
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [okedQuery, setOkedQuery] = useState("");
  const legalForms = useReference("legal_forms").map((i) => ({ ...i, label: `${i.label} (${i.value})` }));
  const regions = useReference("regions");
  const oked = useReference("oked", true);
  const login = useProto(
    (s) => s.accounts.find((a) => a.organizationId === profile.organizationId && a.role === "manufacturer")?.email,
  );
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => setV((prev) => ({ ...prev, [key]: value }));
  const register = v.unifiedRegister;
  const shownOked = oked.filter((o) => o.label.toLowerCase().includes(okedQuery.trim().toLowerCase()));

  const save = () => {
    const e: string[] = [];
    if (v.companyPhone && !isPhone(v.companyPhone)) e.push(t("errPhone", { value: v.companyPhone }));
    if (v.contactEmail && !EMAIL_RE.test(v.contactEmail)) e.push(t("errEmail", { value: v.contactEmail }));
    if (v.website && !/^https?:\/\/\S+\.\S+/.test(v.website)) e.push(t("errWebsite"));
    setErrors(e);
    if (e.length === 0) onSave(v);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("prefillHint")}</p>
      <FieldGrid>
        <TextField label={t("field.legalName")} required value={v.legalName} onChange={(x) => set("legalName", x)} />
        <ChoiceField
          label={t("field.legalForm")}
          required
          items={legalForms}
          value={v.legalForm}
          onChange={(x) => x && set("legalForm", x as typeof v.legalForm)}
        />
        <TextField label={t("field.bin")} value={profile.bin} readOnly description={t("binHint")} />
        <TextField
          label={t("field.website")}
          type="url"
          value={v.website ?? ""}
          onChange={(x) => set("website", x || null)}
        />
        <TextField label={t("field.director")} required value={v.director} onChange={(x) => set("director", x)} />
        <TextField
          label={t("field.registeredOn")}
          required
          type="date"
          value={v.registeredOn}
          onChange={(x) => set("registeredOn", x)}
        />
      </FieldGrid>

      <RowCard title={t("field.okedCodes")}>
        <Input
          aria-label={t("okedSearch")}
          placeholder={t("okedSearch")}
          value={okedQuery}
          onChange={(e) => setOkedQuery(e.target.value)}
        />
        <div className="flex flex-col gap-2">
          {shownOked.map((o) => (
            <CheckField
              key={o.value}
              label={o.label}
              checked={v.okedCodes.includes(o.value)}
              onChange={(c) =>
                set("okedCodes", c ? [...v.okedCodes, o.value] : v.okedCodes.filter((code) => code !== o.value))
              }
            />
          ))}
        </div>
      </RowCard>

      <FieldGrid>
        <ChoiceField
          label={t("field.region")}
          required
          items={withCurrent(regions, v.region)}
          value={v.region}
          onChange={(x) => x && set("region", x)}
        />
        <TextField label={t("field.city")} required value={v.city} onChange={(x) => set("city", x)} />
        <TextField
          label={t("field.legalAddress")}
          required
          value={v.legalAddress}
          onChange={(x) => set("legalAddress", x)}
        />
        <TextField
          label={t("field.productionAddress")}
          required
          value={v.productionAddress}
          onChange={(x) => set("productionAddress", x)}
        />
        <TextField
          label={t("field.companyPhone")}
          required
          type="tel"
          value={v.companyPhone}
          onChange={(x) => set("companyPhone", x)}
        />
        <TextField
          label={t("field.contactEmail")}
          type="email"
          value={v.contactEmail}
          onChange={(x) => set("contactEmail", x)}
        />
        <TextField label={t("field.login")} value={login ?? ""} readOnly description={t("loginHint")} />
      </FieldGrid>

      <RowCard title={t("unifiedRegister")}>
        <CheckField
          label={t("field.registered")}
          checked={register.registered}
          onChange={(c) => set("unifiedRegister", { ...register, registered: c })}
        />
        <FieldGrid>
          <TextField
            label={t("field.firstIncludedOn")}
            type="date"
            value={register.firstIncludedOn ?? ""}
            onChange={(x) => set("unifiedRegister", { ...register, firstIncludedOn: x || null })}
          />
        </FieldGrid>
        <FileSlot
          label={t("field.extract")}
          file={register.extract}
          profileId={profile.id}
          slot="extract"
          onSelect={(f) => set("unifiedRegister", { ...register, extract: f })}
        />
      </RowCard>
      <SaveBar onSave={save} errors={errors} />
    </div>
  );
}

const emptyContact = (): Contact => ({
  id: newId("contact"),
  fullName: "",
  position: "",
  email: "",
  phone: "",
  role: "commercial",
  focalPoint: false,
});

/** Контакты: не меньше трёх, ровно один focal point, без повторов почты и телефона (MAN-13…MAN-15). */
export function ContactsForm({ initial, onSave }: FormProps<"contacts">) {
  const t = useDictionary(texts);
  const locked = use(LockedContext);
  const [rows, setRows] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const roleItems = CONTACT_ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }));
  const focal = rows.find((r) => r.focalPoint)?.id ?? null;
  const patch = (id: string, change: Partial<Contact>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...change } : r)));

  const save = () => {
    const e: string[] = [];
    rows.forEach((r, i) => {
      const n = String(i + 1);
      if (r.email && !EMAIL_RE.test(r.email)) e.push(t("errContactEmail", { n }));
      if (r.phone && !isPhone(r.phone)) e.push(t("errContactPhone", { n }));
      const other = rows.slice(0, i);
      if (r.email && other.some((o) => o.email.trim().toLowerCase() === r.email.trim().toLowerCase()))
        e.push(t("errDuplicateEmail", { n }));
      if (r.phone && other.some((o) => o.phone.replace(/\D/g, "") === r.phone.replace(/\D/g, "")))
        e.push(t("errDuplicatePhone", { n }));
    });
    setErrors(e);
    if (e.length === 0) onSave(rows);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("contactsHint")}</p>
      <RadioGroup
        disabled={locked}
        aria-label={t("focalPoint")}
        value={focal}
        onValueChange={(id) =>
          typeof id === "string" && setRows((prev) => prev.map((r) => ({ ...r, focalPoint: r.id === id })))
        }
      >
        {rows.map((r, i) => (
          <RowCard
            key={r.id}
            title={t("contactN", { n: String(i + 1) })}
            onRemove={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}
          >
            <FieldGrid>
              <TextField
                label={t("field.fullName")}
                required
                value={r.fullName}
                onChange={(x) => patch(r.id, { fullName: x })}
              />
              <TextField
                label={t("field.position")}
                required
                value={r.position}
                onChange={(x) => patch(r.id, { position: x })}
              />
              <TextField
                label={t("field.email")}
                required
                type="email"
                value={r.email}
                onChange={(x) => patch(r.id, { email: x })}
              />
              <TextField
                label={t("field.phone")}
                required
                type="tel"
                value={r.phone}
                onChange={(x) => patch(r.id, { phone: x })}
              />
              <ChoiceField
                label={t("field.role")}
                required
                items={roleItems}
                value={r.role}
                onChange={(x) => x && patch(r.id, { role: x as ContactRole })}
              />
              <Label className="flex items-center gap-2 self-end font-normal">
                <RadioGroupItem value={r.id} disabled={locked} aria-label={t("focalPointOf", { n: String(i + 1) })} />
                {t("focalPoint")}
              </Label>
            </FieldGrid>
          </RowCard>
        ))}
      </RadioGroup>
      <AddButton label={t("addContact")} onClick={() => setRows((prev) => [...prev, emptyContact()])} />
      <SaveBar onSave={save} errors={errors} />
    </div>
  );
}

/** Персонал: три категории, иностранцы на руководящих должностях, оргструктура, CV (MAN-17…MAN-20). */
export function PersonnelForm({ profile, initial, onSave }: FormProps<"personnel">) {
  const t = useDictionary(texts);
  const format = useFormat();
  const sample = useProto((s) => s.orgChartSample);
  const [v, setV] = useState(initial);
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => setV((prev) => ({ ...prev, [key]: value }));
  const total = (v.managers ?? 0) + (v.office ?? 0) + (v.production ?? 0);
  return (
    <div className="flex flex-col gap-4">
      <FieldGrid>
        <NumberField label={t("field.managers")} required value={v.managers} onChange={(x) => set("managers", x)} />
        <NumberField label={t("field.office")} required value={v.office} onChange={(x) => set("office", x)} />
        <NumberField
          label={t("field.production")}
          required
          value={v.production}
          onChange={(x) => set("production", x)}
        />
        <NumberField
          label={t("field.foreignManagers")}
          required
          value={v.foreignManagers}
          onChange={(x) => set("foreignManagers", x)}
        />
      </FieldGrid>
      <p className="text-sm">{t("headcountTotal", { total: format.number(total) })}</p>
      <FileSlot
        label={t("field.orgChart")}
        file={v.orgChart}
        profileId={profile.id}
        slot="orgChart"
        onSelect={(f) => set("orgChart", f)}
      />
      <FileRow label={t("orgChartSample")} file={sample} />
      <RowCard title={t("cvs")}>
        {v.cvs.length === 0 && <p className="text-sm text-muted-foreground">{t("noCvs")}</p>}
        {v.cvs.map((cv, i) => (
          <FileRow key={`${cv.name}-${cv.uploadedAt}`} label={t("cvN", { n: String(i + 1) })} file={cv} />
        ))}
        <FileSlot
          label={t("addCv")}
          file={null}
          profileId={profile.id}
          slot={null}
          onSelect={(f) => set("cvs", [...v.cvs, f])}
        />
      </RowCard>
      <SaveBar onSave={() => onSave(v)} errors={[]} />
    </div>
  );
}

/** Акционеры: не меньше одного; итог долей и предупреждение, если не 100 % (MAN-21, MAN-22). */
/** Строка формы: доля пока может быть пустой; в хранилище уходит только число (MAN-21). */
type ShareholderRow = Omit<Shareholder, "sharePct"> & { sharePct: number | null };

export function ShareholdersForm({ initial, onSave }: FormProps<"shareholders">) {
  const t = useDictionary(texts);
  const format = useFormat();
  const [rows, setRows] = useState<ShareholderRow[]>(() =>
    initial.map((r) => ({ ...r, sharePct: Number.isFinite(r.sharePct) ? r.sharePct : null })),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const total = rows.reduce((sum, r) => sum + (r.sharePct ?? 0), 0);
  const patch = (id: string, change: Partial<ShareholderRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...change } : r)));

  const save = () => {
    const e = rows.flatMap((r, i) => (r.sharePct === null ? [t("errShare", { n: String(i + 1) })] : []));
    setErrors(e);
    if (e.length === 0) onSave(rows.map((r) => ({ ...r, sharePct: r.sharePct ?? 0 })));
  };

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t("noShareholders")}</p>}
      {rows.map((r, i) => (
        <RowCard
          key={r.id}
          title={t("shareholderN", { n: String(i + 1) })}
          onRemove={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}
        >
          <FieldGrid>
            <TextField
              label={t("field.shareholderName")}
              required
              value={r.name}
              onChange={(x) => patch(r.id, { name: x })}
            />
            <NumberField
              label={t("field.sharePct")}
              required
              max={100}
              value={r.sharePct}
              error={errors.length > 0 && r.sharePct === null ? t("errShare", { n: String(i + 1) }) : null}
              onChange={(x) => patch(r.id, { sharePct: x })}
            />
            <TextField
              label={t("field.country")}
              required
              value={r.country}
              onChange={(x) => patch(r.id, { country: x })}
            />
          </FieldGrid>
        </RowCard>
      ))}
      <AddButton
        label={t("addShareholder")}
        onClick={() => setRows((prev) => [...prev, { id: newId("sh"), name: "", sharePct: null, country: "" }])}
      />
      <p className="text-sm font-medium">{t("sharesTotal", { total: format.number(total) })}</p>
      {rows.length > 0 && total !== 100 && (
        <Alert>
          <AlertDescription>{t("sharesWarning", { total: format.number(total) })}</AlertDescription>
        </Alert>
      )}
      <SaveBar onSave={save} errors={errors} />
    </div>
  );
}
