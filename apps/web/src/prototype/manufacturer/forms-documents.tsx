// Формы секций «Сертификаты» и «Документы». MAN-33, MAN-34, MAN-35, MAN-36, MAN-37, MAN-38, MAN-39, MAN-46.
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";

import { DocumentStatusBadge } from "../components";
import type { Certificate, ProfileDocument } from "../data";
import { useDictionary } from "../i18n";
import { newId, useProto } from "../store";
import { AddButton, CheckField, ChoiceField, FieldGrid, FileSlot, RowCard, SaveBar, TextField } from "./fields";
import { type FormProps, mandatoryTypes, sameFile, today } from "./model";
import { useReference } from "./reference";
import { texts, useDocumentLabel } from "./texts";

const OTHER = "Other";

const emptyCertificate = (type: string, mandatory: boolean): Certificate => ({
  id: newId("cert"),
  type,
  mandatory,
  number: "",
  issuer: "",
  issuedOn: "",
  expiresOn: null,
  file: null,
  status: "missing",
  comment: null,
});

export function CertificatesForm({ profile, initial, onSave }: FormProps<"certificates">) {
  const t = useDictionary(texts);
  const state = useProto();
  const mandatory = mandatoryTypes(state, "certificate_types");
  const types = useReference("certificate_types");
  const [rows, setRows] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const patch = (id: string, change: Partial<Certificate>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...change } : r)));
  const known = (type: string) => types.some((i) => i.value === type);
  const missing = mandatory.filter((type) => !rows.some((c) => c.type === type && c.file));

  const save = () => {
    const e: string[] = [];
    rows.forEach((c, i) => {
      if (c.expiresOn && c.issuedOn && c.expiresOn < c.issuedOn) e.push(t("errExpiry", { n: String(i + 1) }));
    });
    setErrors(e);
    if (e.length > 0) return;
    const now = today();
    onSave(
      rows.map((c) => {
        const before = initial.find((x) => x.id === c.id);
        const changed = !before || !sameFile(before.file, c.file) || before.expiresOn !== c.expiresOn;
        const next = { ...c, mandatory: mandatory.includes(c.type) };
        if (changed) {
          next.status = c.file ? "uploaded" : "missing";
          next.comment = null;
        }
        // Истёкший срок ставит платформа (раздел 6.3, REV-10).
        if (next.expiresOn && next.expiresOn < now && next.file) next.status = "expired";
        return next;
      }),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertDescription>
          {t("mandatoryCertsHint", { types: mandatory.join(", ") })}
          {missing.length > 0 && <> {t("mandatoryCertsMissing", { types: missing.join(", ") })}</>}
        </AlertDescription>
      </Alert>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t("noCertificates")}</p>}
      {rows.map((c, i) => (
        <RowCard
          key={c.id}
          title={
            <span className="flex flex-wrap items-center gap-2">
              {t("certificateN", { n: String(i + 1), type: c.type })}
              <DocumentStatusBadge status={c.status} />
            </span>
          }
          onRemove={() => setRows((prev) => prev.filter((x) => x.id !== c.id))}
        >
          {c.comment && (
            <Alert variant="destructive">
              <AlertDescription>{t("smeComment", { comment: c.comment })}</AlertDescription>
            </Alert>
          )}
          <FieldGrid>
            <ChoiceField
              label={t("field.certType")}
              required
              items={types}
              value={known(c.type) ? c.type : OTHER}
              onChange={(x) => x && patch(c.id, { type: x })}
            />
            {(c.type === OTHER || !known(c.type)) && (
              <TextField
                label={t("field.otherType")}
                required
                value={c.type === OTHER ? "" : c.type}
                onChange={(x) => patch(c.id, { type: x || OTHER })}
              />
            )}
            <TextField
              label={t("field.certNumber")}
              required
              value={c.number}
              onChange={(x) => patch(c.id, { number: x })}
            />
            <TextField
              label={t("field.issuer")}
              required
              value={c.issuer}
              onChange={(x) => patch(c.id, { issuer: x })}
            />
            <TextField
              label={t("field.issuedOn")}
              required
              type="date"
              value={c.issuedOn}
              onChange={(x) => patch(c.id, { issuedOn: x })}
            />
            <TextField
              label={t("field.expiresOn")}
              type="date"
              value={c.expiresOn ?? ""}
              description={t("expiresHint")}
              onChange={(x) => patch(c.id, { expiresOn: x || null })}
            />
          </FieldGrid>
          <FileSlot
            label={t("field.certFile")}
            file={c.file}
            profileId={profile.id}
            slot={`cert:${c.id}`}
            onSelect={(f) => patch(c.id, { file: f })}
          />
        </RowCard>
      ))}
      <div className="flex flex-wrap gap-2">
        {missing
          .filter((type) => !rows.some((c) => c.type === type))
          .map((type) => (
            <AddButton
              key={type}
              label={t("addCertificateOf", { type })}
              onClick={() => setRows((prev) => [...prev, emptyCertificate(type, true)])}
            />
          ))}
        <AddButton
          label={t("addCertificate")}
          onClick={() => setRows((prev) => [...prev, emptyCertificate(OTHER, false)])}
        />
      </div>
      <SaveBar onSave={save} errors={errors} />
    </div>
  );
}

export function DocumentsForm({ profile, initial, onSave }: FormProps<"documents">) {
  const t = useDictionary(texts);
  const documentLabel = useDocumentLabel();
  const state = useProto();
  const types = mandatoryTypes(state, "document_types") as ProfileDocument["type"][];
  // Каждый обязательный тип — своей строкой, даже если документа ещё нет (MAN-37…MAN-39).
  const [rows, setRows] = useState<ProfileDocument[]>(() => [
    ...initial,
    ...types
      .filter((type) => !initial.some((d) => d.type === type))
      .map((type) => ({
        id: newId("doc"),
        type,
        file: null,
        noLicenceRequired: false,
        status: "missing" as const,
        comment: null,
      })),
  ]);
  const patch = (id: string, change: Partial<ProfileDocument>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...change } : r)));

  const save = () =>
    onSave(
      rows.map((d) => {
        const before = initial.find((x) => x.id === d.id);
        const changed = !before || !sameFile(before.file, d.file) || before.noLicenceRequired !== d.noLicenceRequired;
        if (!changed) return d;
        const present = d.file !== null || (d.type === "licence" && d.noLicenceRequired);
        return { ...d, status: present ? "uploaded" : "missing", comment: null };
      }),
    );

  return (
    <div className="flex flex-col gap-4">
      {rows.map((d) => (
        <RowCard
          key={d.id}
          title={
            <span className="flex flex-wrap items-center gap-2">
              {documentLabel(d.type)}
              <DocumentStatusBadge status={d.status} />
            </span>
          }
        >
          {d.comment && (
            <Alert variant="destructive">
              <AlertDescription>{t("smeComment", { comment: d.comment })}</AlertDescription>
            </Alert>
          )}
          <FileSlot
            label={documentLabel(d.type)}
            file={d.file}
            profileId={profile.id}
            slot={`doc:${d.type}`}
            onSelect={(f) => patch(d.id, { file: f })}
          />
          {d.type === "licence" && (
            <CheckField
              label={t("noLicence")}
              description={t("noLicenceHint")}
              checked={d.noLicenceRequired}
              onChange={(c) => patch(d.id, { noLicenceRequired: c })}
            />
          )}
        </RowCard>
      ))}
      <SaveBar onSave={save} errors={[]} />
    </div>
  );
}
