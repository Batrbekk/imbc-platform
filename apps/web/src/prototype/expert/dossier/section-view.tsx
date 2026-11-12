// Секция профиля так, как её ввёл производитель, с каждым файлом (REV-05, MAN-09…MAN-39). Только показ:
// кнопки решений приходят снаружи (`itemActions`) и не рисуются при `readOnly` — так же досье открывает директор.
import type { ProfileSection } from "@imbc/contracts";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { DocumentStatusBadge, FileRow } from "@/prototype/components";
import type { Certificate, ProfileDocument, ProfileSections, ProtoProfile } from "@/prototype/data";
import { useDictionary } from "@/prototype/i18n";
import { useProto } from "@/prototype/store";

import { FieldItem, Fields } from "./parts";
import { referenceLabel } from "./helpers";
import { dossierTexts } from "./texts";

/** Документ или сертификат секции: на нём решение SME (REV-06). */
export interface ReviewItemRef {
  kind: "certificate" | "document";
  id: string;
}

export function SectionView({
  profile,
  section,
  source = "current",
  readOnly = false,
  itemActions,
}: {
  profile: ProtoProfile;
  section: ProfileSection;
  /** `pending` — ожидающие изменения секции (REV-08); `current` — последние принятые значения. */
  source?: "current" | "pending";
  readOnly?: boolean;
  itemActions?: (item: ReviewItemRef) => ReactNode;
}) {
  const values: Partial<ProfileSections> = source === "pending" ? profile.pending : profile.sections;
  const actions = readOnly ? undefined : itemActions;
  switch (section) {
    case "main":
      return values.main ? <MainView value={values.main} /> : null;
    case "contacts":
      return values.contacts ? <ContactsView value={values.contacts} /> : null;
    case "personnel":
      return values.personnel ? <PersonnelView value={values.personnel} /> : null;
    case "shareholders":
      return values.shareholders ? <ShareholdersView value={values.shareholders} /> : null;
    case "products":
      return values.products ? <ProductsView value={values.products} /> : null;
    case "production":
      return values.production ? <ProductionView value={values.production} /> : null;
    case "certificates":
      return values.certificates ? <CertificatesView value={values.certificates} actions={actions} /> : null;
    case "documents":
      return values.documents ? <DocumentsView value={values.documents} actions={actions} /> : null;
  }
}

function useTexts() {
  return { t: useDictionary(dossierTexts), format: useFormat() };
}

function MainView({ value }: { value: ProfileSections["main"] }) {
  const { t, format } = useTexts();
  const state = useProto();
  return (
    <div className="flex flex-col gap-3">
      <Fields>
        <FieldItem label={t("legalName")}>{value.legalName}</FieldItem>
        <FieldItem label={t("legalForm")}>{referenceLabel(state, "legal_forms", value.legalForm)}</FieldItem>
        <FieldItem label={t("director")}>{value.director}</FieldItem>
        <FieldItem label={t("registeredOn")}>{format.date(value.registeredOn)}</FieldItem>
        <FieldItem label={t("oked")}>{value.okedCodes.join(", ")}</FieldItem>
        <FieldItem label={t("region")}>{referenceLabel(state, "regions", value.region)}</FieldItem>
        <FieldItem label={t("city")}>{value.city}</FieldItem>
        <FieldItem label={t("website")}>{value.website ?? t("notProvided")}</FieldItem>
        <FieldItem label={t("legalAddress")}>{value.legalAddress}</FieldItem>
        <FieldItem label={t("productionAddress")}>{value.productionAddress}</FieldItem>
        <FieldItem label={t("companyPhone")}>{value.companyPhone}</FieldItem>
        <FieldItem label={t("contactEmail")}>{value.contactEmail}</FieldItem>
        <FieldItem label={t("unifiedRegister")}>
          {value.unifiedRegister.registered
            ? t("registeredSince", { date: format.date(value.unifiedRegister.firstIncludedOn) })
            : t("no")}
        </FieldItem>
      </Fields>
      {value.unifiedRegister.extract && <FileRow label={t("registerExtract")} file={value.unifiedRegister.extract} />}
    </div>
  );
}

function ContactsView({ value }: { value: ProfileSections["contacts"] }) {
  const { t } = useTexts();
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("contactName")}</TableHead>
            <TableHead>{t("contactRole")}</TableHead>
            <TableHead>{t("email")}</TableHead>
            <TableHead>{t("phone")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {value.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <div className="font-medium">{c.fullName}</div>
                <div className="text-xs text-muted-foreground">{c.position}</div>
                {c.focalPoint && <Badge variant="secondary">{t("focalPoint")}</Badge>}
              </TableCell>
              <TableCell>{t(`contactRole.${c.role}`)}</TableCell>
              <TableCell>{c.email}</TableCell>
              <TableCell>{c.phone}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PersonnelView({ value }: { value: ProfileSections["personnel"] }) {
  const { t, format } = useTexts();
  const n = (v: number | null) => (v === null ? t("notProvided") : format.number(v));
  return (
    <div className="flex flex-col gap-3">
      <Fields>
        <FieldItem label={t("managers")}>{n(value.managers)}</FieldItem>
        <FieldItem label={t("office")}>{n(value.office)}</FieldItem>
        <FieldItem label={t("productionStaff")}>{n(value.production)}</FieldItem>
        <FieldItem label={t("foreignManagers")}>{n(value.foreignManagers)}</FieldItem>
      </Fields>
      <FileRow label={t("orgChart")} file={value.orgChart} />
      {value.cvs.map((cv) => (
        <FileRow key={cv.name} label={t("cv")} file={cv} />
      ))}
    </div>
  );
}

function ShareholdersView({ value }: { value: ProfileSections["shareholders"] }) {
  const { t, format } = useTexts();
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("shareholder")}</TableHead>
            <TableHead>{t("share")}</TableHead>
            <TableHead>{t("country")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {value.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.name}</TableCell>
              <TableCell>{t("percent", { value: format.number(s.sharePct) })}</TableCell>
              <TableCell>{s.country}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ProductsView({ value }: { value: ProfileSections["products"] }) {
  const { t, format } = useTexts();
  return (
    <ul className="flex flex-col gap-3">
      {value.map((p) => (
        <li key={p.id} className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{p.nameRu}</span>
            <span className="text-sm text-muted-foreground">{p.nameEn}</span>
            <Badge variant="outline">{t(`source.${p.source}`)}</Badge>
          </div>
          <Fields>
            <FieldItem label={t("group")}>{p.group}</FieldItem>
            <FieldItem label={t("commodityType")}>{p.commodityType}</FieldItem>
            <FieldItem label={t("tnved")}>
              <span className="font-mono">{p.tnved}</span>
            </FieldItem>
            <FieldItem label={t("kpved")}>{p.kpved ?? t("notProvided")}</FieldItem>
            <FieldItem label={t("capacity")}>
              {p.capacity.kind === "registry"
                ? p.capacity.text
                : t("capacityPerYear", { value: format.number(p.capacity.value), unit: t(`unit.${p.capacity.unit}`) })}
            </FieldItem>
            <FieldItem label={t("icv")}>
              {p.icvPct === null ? t("notProvided") : t("percent", { value: format.number(p.icvPct) })}
            </FieldItem>
            {p.localization && (
              <FieldItem label={t("localization")}>
                {t("ofTotal", { done: format.number(p.localization.done), total: format.number(p.localization.total) })}
              </FieldItem>
            )}
            {p.registry && (
              <FieldItem label={t("registryEntry")}>
                {p.registry.entryNumber} · {format.date(p.registry.inclusionDate)} · {p.registry.enstru}
              </FieldItem>
            )}
            {p.note && <FieldItem label={t("note")}>{p.note}</FieldItem>}
          </Fields>
          <FileRow label={t("productCertificate")} file={p.certificate} />
        </li>
      ))}
    </ul>
  );
}

function ProductionView({ value }: { value: ProfileSections["production"] }) {
  const { t, format } = useTexts();
  const empty =
    value.areaM2 === null && value.processes.length === 0 && value.equipment.length === 0 && value.photos.length === 0;
  if (empty) return <p className="text-sm text-muted-foreground">{t("productionEmpty")}</p>;
  const n = (v: number | null) => (v === null ? t("notProvided") : format.number(v));
  return (
    <div className="flex flex-col gap-3">
      <Fields>
        <FieldItem label={t("area")}>
          {value.areaM2 === null ? t("notProvided") : t("squareMetres", { value: n(value.areaM2) })}
        </FieldItem>
        <FieldItem label={t("processes")}>{value.processes.join(", ") || t("notProvided")}</FieldItem>
        <FieldItem label={t("workshops")}>{n(value.workshops)}</FieldItem>
        <FieldItem label={t("utilisation")}>
          {value.utilisationPct === null
            ? t("notProvided")
            : t("percent", { value: format.number(value.utilisationPct) })}
        </FieldItem>
      </Fields>
      {value.equipment.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("equipment")}</TableHead>
                <TableHead>{t("equipmentType")}</TableHead>
                <TableHead>{t("quantity")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {value.equipment.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.name}</TableCell>
                  <TableCell>{e.type}</TableCell>
                  <TableCell>{format.number(e.quantity)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {value.photos.map((photo) => (
        <FileRow key={photo.name} label={t("photo")} file={photo} />
      ))}
    </div>
  );
}

function CertificatesView({ value, actions }: { value: Certificate[]; actions?: (item: ReviewItemRef) => ReactNode }) {
  const { t, format } = useTexts();
  return (
    <ul className="flex flex-col gap-3">
      {value.map((c) => (
        <li key={c.id} className="flex flex-col gap-2">
          <FileRow
            label={`${c.type} · ${c.mandatory ? t("mandatory") : t("others")}`}
            file={c.file}
            status={
              <>
                <DocumentStatusBadge status={c.status} />
                {actions?.({ kind: "certificate", id: c.id })}
              </>
            }
          />
          <p className="px-1 text-xs text-muted-foreground">
            {t("certificateLine", {
              number: c.number,
              issuer: c.issuer,
              issued: format.date(c.issuedOn),
              expires: c.expiresOn ? format.date(c.expiresOn) : t("noExpiry"),
            })}
          </p>
        </li>
      ))}
    </ul>
  );
}

function DocumentsView({ value, actions }: { value: ProfileDocument[]; actions?: (item: ReviewItemRef) => ReactNode }) {
  const { t } = useTexts();
  return (
    <ul className="flex flex-col gap-3">
      {value.map((d) => (
        <li key={d.id} className="flex flex-col gap-1">
          <FileRow
            label={t(`docType.${d.type}`)}
            file={d.file}
            status={
              <>
                <DocumentStatusBadge status={d.status} />
                {actions?.({ kind: "document", id: d.id })}
              </>
            }
          />
          {d.noLicenceRequired && <p className="px-1 text-xs text-muted-foreground">{t("noLicenceRequired")}</p>}
        </li>
      ))}
    </ul>
  );
}
