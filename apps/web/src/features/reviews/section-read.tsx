import { entryDisplayName, type ProfileFile, type ProductReference, type ReviewSectionRead, type SectionKind } from "@imbc/contracts";
import { DownloadIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "use-intl";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LegalInformationCard } from "@/features/profile/main-form";
import { useFormat } from "@/i18n/format";
import { cn } from "@/lib/utils";

export type ReviewReadMap = Partial<Record<SectionKind, ReviewSectionRead>>;
function ReadFields({ fields }: { fields: readonly [string, ReactNode][] }) {
  return <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2">{fields.map(([label, value], index) => <div key={`${label}-${index}`} className="min-w-0 space-y-1">
    <dt className="text-xs text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{value === null || value === undefined || value === "" ? "—" : value}</dd>
  </div>)}</dl>;
}
function ReadCard({ title, children }: { title: string; children: ReactNode }) {
  return <Card className="min-w-0"><CardHeader><CardTitle className="whitespace-pre-wrap break-words">{title}</CardTitle></CardHeader><CardContent className="min-w-0 space-y-4">{children}</CardContent></Card>;
}

/** Pure captured metadata. No producer upload/state, dictionary, source-refresh or sample query is mounted. */
export function ReviewFiles({ label, files }: { label: string; files: readonly (ProfileFile | null)[] }) {
  const t = useTranslations("profileAttachments"), format = useFormat();
  return <section aria-label={label} className="min-w-0 space-y-3 rounded-lg border p-3"><h3 className="text-sm font-medium">{label}</h3>
    {!files.some(Boolean) && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
    <ul className="space-y-3">{files.flatMap((file, index) => file ? [<li key={`${file.fileId}-${index}`} className="min-w-0 space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 flex-1 whitespace-pre-wrap break-all text-sm font-medium">{file.originalName ?? t("unnamed")}</p>
        <Badge variant={file.scanState === "rejected" ? "destructive" : "secondary"}>{t(`state.${file.scanState ?? "unavailable"}`)}</Badge></div>
      <p className="text-xs text-muted-foreground">{file.byteSize === null ? t("sizeUnknown") : t("size", { size: format.number(file.byteSize / 1024 / 1024) })} · {format.dateTime(file.uploadedAt)}</p>
      {file.rejectionReason && <p className="whitespace-pre-wrap break-words text-sm text-destructive">{t(`reason.${file.rejectionReason}`)}</p>}
      {file.scanState === "passed" && file.canDownload && file.versionNumber !== null && <a className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        href={`/api/v1/files/${file.fileId}/content?version=${file.versionNumber}`}><DownloadIcon aria-hidden="true" />{t("download", { version: format.number(file.versionNumber) })}</a>}
    </li>] : [])}</ul>
  </section>;
}

export function ReviewSectionView({ section, graph }: { section: ReviewSectionRead; graph: ReviewReadMap }) {
  const locale = useLocale() as "en" | "ru" | "kk", format = useFormat();
  const e = useTranslations("profileEditor"), p = useTranslations("profilePersonnel"), products = useTranslations("profileProducts"), production = useTranslations("profileProduction"),
    cert = useTranslations("profileCertificates"), docs = useTranslations("profileDocuments"), records = useTranslations("profileRecords"), t = useTranslations("reviewWorkflow");
  const reference = (id: string | null, selected: readonly Pick<ProductReference, "id" | "names" | "code">[]) => {
    const item = selected.find(value => value.id === id);
    return item ? `${item.code} — ${entryDisplayName(item.names, locale, item.code)}` : id ? records("referenceUnknown") : null;
  };
  const main = graph.main_information?.kind === "main_information" ? graph.main_information.data : null;
  const certificates = graph.certificates?.kind === "certificates" ? graph.certificates.data : null;
  const productData = graph.products?.kind === "products" ? graph.products.data : null;
  const siteName = (id: string | null) => {
    if (!id) return null; const site = main?.editable.sites.find(site => site.identityId === id);
    return site ? [site.address, site.city, reference(site.regionId, main!.selectedRegions)].filter(Boolean).join(", ") || products("linkedSite") : t("relatedUnavailable");
  };
  const certificateName = (id: string) => {
    const row = certificates?.editable.certificates.find(row => row.identityId === id), stored = certificates?.certificates.find(row => row.identityId === id);
    if (!row) return t("relatedUnavailable");
    return [stored?.certificateType ? entryDisplayName(stored.certificateType.names, locale, stored.certificateType.code) : null, row.customTypeName, row.number].filter(Boolean).join(" — ") || cert("title");
  };
  const productName = (id: string) => {
    const row = productData?.lines.find(row => row.identityId === id);
    return row ? [locale === "en" ? row.nameEn ?? row.nameRu : row.nameRu ?? row.nameEn, row.tnVedCode].filter(Boolean).join(" — ") || products("title") : t("relatedUnavailable");
  };
  switch (section.kind) {
    case "main_information": {
      const data = section.data;
      return <div className="space-y-4"><LegalInformationCard data={data} />
        <ReadCard title={e("sections.main_information")}><ReadFields fields={[[e("companyPhone"), data.editable.companyPhone], [e("contactEmail"), data.editable.contactEmail], [e("website"), data.editable.website],
          [t("registerInclusion"), data.registry.registered === null ? null : t(data.registry.registered ? "yes" : "no")], [products("includedOn"), format.date(data.registry.firstInclusionOn)]]} /></ReadCard>
        {data.editable.sites.map((site, index) => <ReadCard key={site.identityId ?? index} title={e("siteNumber", { number: format.number(index + 1) })}><ReadFields fields={[[e("productionAddress"), site.address], [e("city"), site.city], [e("region"), reference(site.regionId, data.selectedRegions)]]} /></ReadCard>)}
      </div>;
    }
    case "contacts": return <div className="space-y-4">{section.data.contacts.map((row, index) => <ReadCard key={index} title={e("contactNumber", { number: format.number(index + 1) })}>
      <ReadFields fields={[[e("fullName"), row.fullName], [e("position"), row.position], [e("email"), row.email], [e("phone"), row.phone], [e("role"), reference(row.roleId, section.selectedContactRoles)], [e("focalPoint"), t(row.isFocalPoint ? "yes" : "no")]]} />
    </ReadCard>)}</div>;
    case "personnel": return <div className="space-y-4"><ReadFields fields={[[p("managersCount"), section.data.editable.managersCount === null ? null : format.number(section.data.editable.managersCount)],
      [p("engineersCount"), section.data.editable.engineersCount === null ? null : format.number(section.data.editable.engineersCount)], [p("productionWorkersCount"), section.data.editable.productionWorkersCount === null ? null : format.number(section.data.editable.productionWorkersCount)],
      [p("totalHeadcount"), section.data.totalHeadcount === null ? null : format.number(section.data.totalHeadcount)], [p("nonresidentCount"), section.data.editable.nonresidentCount === null ? null : format.number(section.data.editable.nonresidentCount)]]} />
      <ReviewFiles label={p("organisationCharts")} files={section.data.organisationCharts} /><ReviewFiles label={p("cvs")} files={section.data.cvs} /></div>;
    case "products": return <div className="space-y-4">{section.data.lines.map((row, index) => {
      const type = section.data.selectedReferences.commodityTypes.find(type => type.id === row.commodityTypeId);
      return <ReadCard key={row.identityId} title={products("number", { number: format.number(index + 1) })}>
        <Badge variant="secondary">{products(`source.${row.source}`)}</Badge>
        <ReadFields fields={[[products("nameEn"), row.nameEn], [products("nameRu"), row.nameRu], [products("type"), type ? [reference(type.id, [type]), type.group ? `${type.group.code} — ${entryDisplayName(type.group.names, locale, type.group.code)}` : null].filter(Boolean).join(" · ") : null],
          [products("tnVed"), [row.tnVedCode, reference(row.tnVedEntryId, section.data.selectedReferences.tnVed)].filter(Boolean).join(" — ")], [products("kpved"), row.kpved.map(code => [code.code, code.sourceName, reference(code.entryId, section.data.selectedReferences.kpved)].filter(Boolean).join(" — ")).join("\n")],
          [products("capacity"), row.capacityText ?? format.decimal(row.capacityQuantity)], [products("unit"), reference(row.capacityUnitId, section.data.selectedReferences.units)], [products("dvc"), format.decimal(row.inCountryValueShare)],
          [products("registration"), row.unifiedRegisterRegistrationNumber], [products("includedOn"), format.date(row.unifiedRegisterIncludedOn)], [products("registerActive"), row.unifiedRegisterActive === null ? null : t(row.unifiedRegisterActive ? "yes" : "no")],
          [products("enstru"), [row.enstruCode, row.enstruName].filter(Boolean).join(" — ")], [products("site"), siteName(row.productionSiteIdentityId)], [products("certificates"), row.certificateIdentityIds.map(certificateName).join("\n")], [products("note"), row.note]]} />
      </ReadCard>;
    })}<ReviewFiles label={products("extract")} files={[section.data.extract]} /></div>;
    case "production": return <div className="space-y-4"><p className="text-sm text-muted-foreground">{production("optionalHint")}</p>
      <ReadFields fields={[[production("areaSqm"), format.decimal(section.data.editable.areaSqm)], [production("workshopCount"), section.data.editable.workshopCount === null ? null : format.number(section.data.editable.workshopCount)],
        [production("utilisationPercent"), format.decimal(section.data.editable.utilisationPercent)], [production("processes"), section.data.editable.processEntryIds.map(id => reference(id, section.data.selectedReferences.processes)).join("\n")]]} />
      <ReviewFiles label={production("photos")} files={section.data.photos} />
      {section.data.editable.equipment.map((row, index) => <ReadCard key={index} title={production("number", { number: format.number(index + 1) })}>
        <ReadFields fields={[[production("name"), row.name], [production("type"), reference(row.typeId, section.data.selectedReferences.equipmentTypes)], [production("quantity"), row.quantity === null ? null : format.number(row.quantity)], [production("products"), row.productIdentityIds.map(productName).join("\n")]]} />
        <ReviewFiles label={production("equipmentPhoto")} files={[section.data.equipmentPhotos[index] ?? null]} />
      </ReadCard>)}
    </div>;
    case "certificates": return <div className="space-y-4"><ReadFields fields={[[t("capturedRequirements"), section.data.requiredTypes.map(type => entryDisplayName(type.names, locale, type.code)).join("\n")]]} />
      {section.data.editable.certificates.map((row, index) => { const stored = section.data.certificates.find(item => item.identityId === row.identityId); return <ReadCard key={row.identityId} title={cert("itemNumber", { number: format.number(index + 1) })}>
        <Badge variant="secondary">{row.notHeld ? records("status.not_held") : records(`status.${stored?.status ?? "missing"}`)}</Badge>
        <ReadFields fields={[[cert("groupLabel"), row.group ? cert(`group.${row.group}`) : null], [cert("type"), stored?.certificateType ? entryDisplayName(stored.certificateType.names, locale, stored.certificateType.code) : null], [cert("customName"), row.customTypeName],
          [cert("number"), row.number], [cert("issuer"), row.issuingBody], [cert("issuedOn"), format.date(row.issuedOn)], [cert("expiresOn"), format.date(row.expiresOn)], [cert("notHeld"), t(row.notHeld ? "yes" : "no")]]} />
        {!row.notHeld && <ReviewFiles label={cert("file")} files={[stored?.file ?? null]} />}
      </ReadCard>; })}
    </div>;
    case "documents": return <div className="space-y-4"><ReadFields fields={[[t("capturedRequirements"), section.data.requiredTypes.map(type => entryDisplayName(type.names, locale, type.code)).join("\n")]]} />
      {section.data.editable.documents.map((row, index) => { const stored = section.data.documents.find(item => item.identityId === row.identityId); return <ReadCard key={row.identityId} title={docs("number", { number: format.number(index + 1) })}>
        <Badge variant="secondary">{records(`status.${stored?.status ?? "missing"}`)}</Badge><ReadFields fields={[[docs("type"), stored?.documentType ? entryDisplayName(stored.documentType.names, locale, stored.documentType.code) : null], [docs("name"), row.customName]]} />
        <ReviewFiles label={docs("file")} files={[stored?.file ?? null]} />
      </ReadCard>; })}
    </div>;
  }
}
