import {
  contactsWriteSchema,
  mainInformationWriteSchema,
  type ContactsRead,
  type MainInformationRead,
  type SectionKind,
  type SectionRead,
} from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { useTranslations } from "use-intl";
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
import { routeSection } from "@/features/profile/profile-data";
import { UnsavedDialog } from "@/features/profile/unsaved-dialog";
import { useSectionDraft } from "@/features/profile/section-draft";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";
import { NotFoundPage } from "@/routes/not-found";

export function ProfileSectionPage() {
  const { section } = useParams();
  const kind = routeSection(section);
  const t = useTranslations("profileEditor");
  const available = kind === "main_information" || kind === "contacts";
  const query = useQuery({
    queryKey: ["profile", "sections", kind],
    queryFn: () => api<SectionRead<MainInformationRead | ContactsRead>>(`/v1/profiles/own/sections/${kind}`),
    enabled: available,
    refetchOnWindowFocus: false,
    refetchInterval: (state) =>
      kind === "main_information" &&
      (state.state.data?.data as MainInformationRead | undefined)?.source?.state === "waiting"
        ? 5000
        : false,
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
        ) : (
          <ContactsEditor key={kind} initial={query.data as SectionRead<ContactsRead>} />
        )
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
    </div>
  );
}
const mainEditable = (data: MainInformationRead) => data.editable;
const contactsEditable = (data: ContactsRead) => data;

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
  return (path: string) => {
    const [list, index, field] = path.split(".");
    if (list === "sites" && field)
      return `${t("siteNumber", { number: format.number(Number(index) + 1) })} — ${t(field === "address" ? "productionAddress" : field === "regionId" ? "region" : "city")}`;
    if (list === "contacts" && field)
      return `${t("contactNumber", { number: format.number(Number(index) + 1) })} — ${t(field === "roleId" ? "role" : (field as "fullName" | "position" | "email" | "phone"))}`;
    return t(path === "companyPhone" ? "companyPhone" : kind === "contacts" ? "contactsTitle" : "sitesTitle");
  };
}
