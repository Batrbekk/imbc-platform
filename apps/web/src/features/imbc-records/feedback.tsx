import { useTranslations } from "use-intl";
import { ApiError } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
export function RecordsFailure({ error, retry }: { error: unknown; retry?: () => void }) {
  const t = useTranslations("imbcRecords");
  const known = {
    forbidden: "forbidden",
    bad_origin: "forbidden",
    not_found: "notFound",
    conflict: "changed",
    busy: "busy",
    reference_invalid: "reference",
    history_retained: "historyRetained",
    validation: "validation",
  } as const;
  const key =
    error instanceof ApiError
      ? (known[error.code as keyof typeof known] ?? "internal")
      : error === "validation"
        ? "validation"
        : "internal";
  return (
    <Alert variant="destructive">
      <AlertDescription>{t(`errors.${key}`)}</AlertDescription>
      {retry && (
        <Button type="button" className="mt-2" variant="outline" onClick={retry}>
          {t("retry")}
        </Button>
      )}
    </Alert>
  );
}
