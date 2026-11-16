import { entryDisplayName } from "@imbc/contracts";
import { useLocale, useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { useCurrentRequirements, type RequirementsKind } from "./current-requirements-data";

export function RequirementsLoading({
  pending,
  error,
  retry,
}: {
  pending: boolean;
  error: boolean;
  retry: () => void;
}) {
  const t = useTranslations("profileSubmission");
  return (
    <>
      {pending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("requirementsLoading")}
        </p>
      )}
      {error && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            {t("requirementsError")}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            {t("retry")}
          </Button>
        </div>
      )}
    </>
  );
}
export function CurrentSubmissionRequirements({ kind, ids }: { kind: RequirementsKind; ids: readonly string[] }) {
  const query = useCurrentRequirements(kind, true);
  const t = useTranslations("profileSubmission");
  const locale = useLocale() as "en" | "ru" | "kk";
  return (
    <div className="mt-2 space-y-2">
      <p className="text-sm font-medium">{t("currentRequirements")}</p>
      <RequirementsLoading pending={query.isPending} error={query.isError} retry={() => void query.refetch()} />
      {query.data && (
        <ul className="list-inside list-disc text-sm">
          {query.data.requiredTypes
            .filter((type) => ids.includes(type.id))
            .map((type) => (
              <li key={type.id}>{entryDisplayName(type.names, locale, type.code)}</li>
            ))}
        </ul>
      )}
    </div>
  );
}
