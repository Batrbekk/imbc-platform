import {
  contactsWriteSchema,
  mainInformationWriteSchema,
  personnelWriteSchema, documentsWriteSchema, certificatesWriteSchema, productsWriteSchema, productionWriteSchema,
  type ContactsRead,
  type MainInformationRead,
  type PersonnelRead, type DocumentsRead, type CertificatesRead, type ProductsRead, type ProductionRead,
  type SectionKind,
  type SectionRead,
} from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { useTranslations } from "use-intl";
import type { ReactNode } from "react";
import type { z } from "zod";
import { PageTitle } from "@/components/app/page-title";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactsForm } from "@/features/profile/contacts-form";
import {
  EditorHeading,
  EditorMissing,
  EditorResult,
  EditorSaveBar,
  EditorState,
} from "@/features/profile/editor-feedback";
import { LegalInformationCard, MainInformationForm } from "@/features/profile/main-form";
import { PersonnelForm } from "@/features/profile/personnel-form";
import { DocumentsForm } from "@/features/profile/documents-form";
import { ProductsForm } from "@/features/profile/products-form";
import { ProductionForm } from "@/features/profile/production-form";
import { ProfileReviewDetails } from "@/features/profile/review-details";
import { ProfileFileHistory } from "@/features/profile/file-history";
import { mergeFileObservations } from "@/features/profile/file-observations";
import { CertificatesForm } from "@/features/profile/certificates-form";
import { routeSection, useSubmissionState } from "@/features/profile/profile-data";
import { UnsavedDialog } from "@/features/profile/unsaved-dialog";
import { useSectionDraft } from "@/features/profile/section-draft";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";
import { NotFoundPage } from "@/routes/not-found";

type ImplementedRead = MainInformationRead | ContactsRead | PersonnelRead | DocumentsRead | CertificatesRead | ProductsRead | ProductionRead;

export function ProfileSectionPage() {
  const { section } = useParams();
  const kind = routeSection(section);
  useSubmissionState();
  const t = useTranslations("profileEditor");
  const available = Boolean(kind);
  const query = useQuery({
    queryKey: ["profile", "sections", kind],
    queryFn: () => api<SectionRead<ImplementedRead>>(`/v1/profiles/own/sections/${kind}`),
    enabled: available,
    refetchOnWindowFocus: false,
    refetchInterval: (state) =>
      kind === "main_information" &&
      (state.state.data?.data as MainInformationRead | undefined)?.source?.state === "waiting"
        ? 5000
        : hasPendingFiles(state.state.data?.data) ? 3000 : false,
  });
  if (!kind) return <NotFoundPage />;
  if (!available)
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <PageTitle title={t(`sections.${kind}`)} />
        <Link to="/profile">{t("backToProfile")}</Link>
        <h1 className="text-2xl font-semibold">{t(`sections.${kind}`)}</h1>
        <p>{t(kind === "production" ? "optionalSoon" : "requiredSoon")}</p>
      </div>
    );
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      {query.data ? (
        kind === "main_information" ? (
          <MainEditor key={kind} initial={query.data as SectionRead<MainInformationRead>} />
        ) : kind === "contacts" ? (
          <ContactsEditor key={kind} initial={query.data as SectionRead<ContactsRead>} />
        ) : kind === "personnel" ? <PersonnelEditor initial={query.data as SectionRead<PersonnelRead>} />
          : kind === "documents" ? <DocumentsEditor initial={query.data as SectionRead<DocumentsRead>} />
          : kind === "certificates" ? <CertificatesEditor initial={query.data as SectionRead<CertificatesRead>} />
          : kind === "products" ? <ProductsEditor initial={query.data as SectionRead<ProductsRead>} />
          : <ProductionEditor initial={query.data as SectionRead<ProductionRead>} />
      ) : (
        <>
          <PageTitle title={t(`sections.${kind}`)} />
          <Link to="/profile">{t("backToProfile")}</Link>
          <h1 className="text-2xl font-semibold">{t(`sections.${kind}`)}</h1>
          {query.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{t("loadError")}</AlertDescription>
              <Button variant="outline" onClick={() => void query.refetch()}>
                {t("retry")}
              </Button>
            </Alert>
          ) : (
            <Skeleton className="h-96" />
          )}
        </>
      )}
      {query.data && <ProfileReviewDetails kind={kind} returned={query.data.profileStatus === "returned"} />}
    </div>
  );
}
const mainEditable = (data: MainInformationRead) => data.editable;
const contactsEditable = (data: ContactsRead) => data;
const personnelEditable = (data: PersonnelRead) => data.editable;
const documentsEditable = (data: DocumentsRead) => data.editable;
const certificatesEditable = (data: CertificatesRead) => data.editable;
const productsEditable = (data: ProductsRead) => data.editable;
const productionEditable = (data: ProductionRead) => data.editable;

function hasPendingFiles(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  if ("scanState" in data && data.scanState === "pending") return true;
  return Object.values(data).some(hasPendingFiles);
}

function PersonnelEditor({ initial }: { initial: SectionRead<PersonnelRead> }) {
  return <AdditionalEditor kind="personnel" initial={initial} editable={personnelEditable} schema={personnelWriteSchema}
    form={(props) => <PersonnelForm {...props} />} />;
}
function DocumentsEditor({ initial }: { initial: SectionRead<DocumentsRead> }) {
  return <AdditionalEditor kind="documents" initial={initial} editable={documentsEditable} schema={documentsWriteSchema}
    form={(props) => <DocumentsForm {...props} />} />;
}
function CertificatesEditor({ initial }: { initial: SectionRead<CertificatesRead> }) {
  return <AdditionalEditor kind="certificates" initial={initial} editable={certificatesEditable} schema={certificatesWriteSchema}
    form={(props) => <CertificatesForm {...props} />} />;
}
function ProductsEditor({ initial }: { initial: SectionRead<ProductsRead> }) {
  return <AdditionalEditor kind="products" initial={initial} editable={productsEditable} schema={productsWriteSchema}
    form={(props) => <ProductsForm {...props} />} />;
}
function ProductionEditor({ initial }: { initial: SectionRead<ProductionRead> }) {
  return <AdditionalEditor kind="production" initial={initial} editable={productionEditable} schema={productionWriteSchema}
    form={(props) => <ProductionForm {...props} />} />;
}
function AdditionalEditor<Read, Write>({ kind, initial, editable, schema, form }: {
  kind: SectionKind; initial: SectionRead<Read>; editable: (data: Read) => Write; schema: z.ZodType<Write>;
  form: (props: { value: Write; source: Read; onChange: (value: Write) => void; disabled: boolean; errors: Record<string, string> }) => ReactNode;
}) {
  const editor = useSectionDraft(kind, initial, editable, schema);
  const label = useMissingLabel(kind);
  return <>
    <EditorHeading kind={kind} section={editor.server} /><EditorState {...editor.server} />
    <form noValidate onSubmit={(event) => { event.preventDefault(); if (!editor.disabled) void editor.save(); }}>
      {form({ value: editor.draft, source: mergeFileObservations(editor.server.data, initial.data), onChange: editor.change, disabled: editor.disabled, errors: editor.errors })}
    </form>
    <EditorMissing section={editor.server} fieldLabel={label} />
    <ProfileFileHistory kind={kind} />
    <EditorResult failure={editor.failure} saved={editor.saved} reload={() => void editor.reload()} />
    <EditorSaveBar {...editor} readOnly={initial.readOnly} save={() => void editor.save()} edit={() => editor.setEditing(true)} />
    <UnsavedDialog {...editor.navigationGuard} />
  </>;
}

function MainEditor({ initial }: { initial: SectionRead<MainInformationRead> }) {
  const editor = useSectionDraft("main_information", initial, mainEditable, mainInformationWriteSchema);
  const label = useMissingLabel("main_information");
  return (
    <>
      <EditorHeading kind="main_information" section={initial} />
      <EditorState {...initial} />
      <LegalInformationCard data={initial.data} />
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!editor.disabled) void editor.save();
        }}
      >
        <MainInformationForm
          value={editor.draft}
          source={initial.data}
          onChange={editor.change}
          disabled={editor.disabled}
          errors={editor.errors}
        />
      </form>
      <EditorMissing section={editor.server} fieldLabel={label} />
      <EditorResult failure={editor.failure} saved={editor.saved} reload={() => void editor.reload()} />
      <EditorSaveBar
        {...editor}
        readOnly={initial.readOnly}
        save={() => void editor.save()}
        edit={() => editor.setEditing(true)}
      />
      <UnsavedDialog {...editor.navigationGuard} />
    </>
  );
}
function ContactsEditor({ initial }: { initial: SectionRead<ContactsRead> }) {
  const editor = useSectionDraft("contacts", initial, contactsEditable, contactsWriteSchema);
  const label = useMissingLabel("contacts");
  return (
    <>
      <EditorHeading kind="contacts" section={initial} />
      <EditorState {...initial} />
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!editor.disabled) void editor.save();
        }}
      >
        <ContactsForm
          value={editor.draft}
          onChange={editor.change}
          disabled={editor.disabled}
          errors={editor.errors}
          onError={(path, code) => editor.setErrors((previous) => ({ ...previous, [path]: code }))}
        />
      </form>
      <EditorMissing section={editor.server} fieldLabel={label} />
      <EditorResult failure={editor.failure} saved={editor.saved} reload={() => void editor.reload()} />
      <EditorSaveBar
        {...editor}
        readOnly={initial.readOnly}
        save={() => void editor.save()}
        edit={() => editor.setEditing(true)}
      />
      <UnsavedDialog {...editor.navigationGuard} />
    </>
  );
}
function useMissingLabel(kind: SectionKind) {
  const t = useTranslations("profileEditor");
  const format = useFormat();
  const personnel = useTranslations("profilePersonnel");
  const documents = useTranslations("profileDocuments");
  const certificates = useTranslations("profileCertificates");
  const products = useTranslations("profileProducts");
  const production = useTranslations("profileProduction");
  return (path: string) => {
    const [list, index, field] = path.split(".");
    if (list === "sites" && field)
      return `${t("siteNumber", { number: format.number(Number(index) + 1) })} — ${t(field === "address" ? "productionAddress" : field === "regionId" ? "region" : "city")}`;
    if (list === "contacts" && field)
      return `${t("contactNumber", { number: format.number(Number(index) + 1) })} — ${t(field === "roleId" ? "role" : (field as "fullName" | "position" | "email" | "phone"))}`;
    if (kind === "personnel") return personnel(["managersCount", "engineersCount", "productionWorkersCount", "nonresidentCount"].includes(list) ? list : list === "cvFileIds" ? "cvs" : "organisationCharts");
    if (kind === "documents") return /^\d+$/.test(index ?? "") ? documents("requiredNumber", { number: format.number(Number(index) + 1) }) : documents("title");
    if (kind === "certificates") return /^\d+$/.test(index ?? "") ? certificates("requiredNumber", { number: format.number(Number(index) + 1) }) : certificates("title");
    if (kind === "products") return list === "products" && /^\d+$/.test(index ?? "") ? products("number", { number: format.number(Number(index) + 1) }) : products("title");
    if (kind === "production") return production("equipment");
    return t(path === "companyPhone" ? "companyPhone" : kind === "contacts" ? "contactsTitle" : "sitesTitle");
  };
}
