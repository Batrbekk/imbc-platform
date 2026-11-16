import { displayCompleteness, type SectionKind, type SectionOverview } from "@imbc/contracts";
import { type ReactNode } from "react";
import { Link } from "react-router";
import { useTranslations } from "use-intl";
import { PageTitle } from "@/components/app/page-title";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFormat } from "@/i18n/format";
import { fieldId } from "./form-data";

export function EditorHeading({ kind, section }: { kind: SectionKind; section: SectionOverview }) {
  const t = useTranslations("profileEditor");
  const profile = useTranslations("profile");
  const format = useFormat();
  return (
    <header className="flex flex-col gap-3">
      <PageTitle title={t(`sections.${kind}`)} />
      <Link to="/profile" className="text-sm text-primary hover:underline">
        {t("backToProfile")}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t(`sections.${kind}`)}</h1>
        <Badge variant="secondary">{profile(`statusValue.${section.profileStatus}`)}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("completenessLabel", { percent: format.number(displayCompleteness(section.completeness.percent)) })}
      </p>
    </header>
  );
}
export function EditorState({
  readOnly,
  profileStatus,
  hasWorkingChanges,
}: Pick<SectionOverview, "readOnly" | "profileStatus" | "hasWorkingChanges">) {
  const t = useTranslations("profileEditor");
  return readOnly ? (
    <Alert>
      <AlertDescription>{t("locked")}</AlertDescription>
    </Alert>
  ) : profileStatus === "verified" ? (
    <Alert>
      <AlertDescription>{hasWorkingChanges ? t("workingChanges") : t("verifiedHint")}</AlertDescription>
    </Alert>
  ) : null;
}
export function EditorResult({
  failure,
  saved,
  reload,
}: {
  failure: string | null;
  saved: boolean;
  reload: () => void;
}) {
  const t = useTranslations("profileEditor");
  const known = [
    "section_changed",
    "profile_locked",
    "section_unavailable",
    "request_too_large",
    "validation",
    "forbidden",
    "busy",
  ];
  return failure ? (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{t(`errors.${known.includes(failure) ? failure : "internal"}`)}</AlertDescription>
      {failure === "section_changed" && (
        <Button type="button" variant="outline" size="sm" onClick={reload}>
          {t("reloadReplace")}
        </Button>
      )}
    </Alert>
  ) : saved ? (
    <p role="status" className="text-sm text-primary">
      {t("saved")}
    </p>
  ) : null;
}
export function EditorSaveBar({
  editing,
  readOnly,
  saving,
  dirty,
  save,
  cancel,
  edit,
}: {
  editing: boolean;
  readOnly: boolean;
  saving: boolean;
  dirty: boolean;
  save: () => void;
  cancel: () => void;
  edit: () => void;
}) {
  const t = useTranslations("profileEditor");
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3 shadow-sm">
      {readOnly ? (
        <p className="text-sm text-muted-foreground">{t("locked")}</p>
      ) : editing ? (
        <>
          <Button type="button" disabled={saving || !dirty} onClick={save}>
            {t(saving ? "saving" : "save")}
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={cancel}>
            {t("cancel")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("partialSaveHint")}</p>
        </>
      ) : (
        <Button type="button" onClick={edit}>
          {t("edit")}
        </Button>
      )}
    </div>
  );
}
export function EditorMissing({
  section,
  fieldLabel,
}: {
  section: SectionOverview;
  fieldLabel: (path: string) => ReactNode;
}) {
  const t = useTranslations("profileEditor");
  return section.completeness.missing.length ? (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-medium">{t("missingTitle")}</summary>
      <ul className="mt-2 space-y-1 text-sm">
        {section.completeness.missing.map((missing) => (
          <li key={`${missing.path}-${missing.code}`}>
            <a className="text-primary underline-offset-4 hover:underline" href={`#${fieldId(missing.path)}`}>
              {fieldLabel(missing.path)}
            </a>
          </li>
        ))}
      </ul>
    </details>
  ) : null;
}
