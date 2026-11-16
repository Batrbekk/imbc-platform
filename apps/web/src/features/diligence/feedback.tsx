import { useTranslations } from "use-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";

const problems: Record<string, string> = {
  forbidden: "forbidden", not_found: "notFound", diligence_changed: "changed", diligence_missing: "missing",
  bin_missing: "binMissing", file_invalid: "fileInvalid", file_pending: "filePending", file_rejected: "fileRejected",
  validation: "validation", file_too_large: "fileTooLarge", file_type_not_allowed: "fileType",
  file_type_mismatch: "fileType", file_structure_unsupported: "fileStructure", file_encrypted: "fileEncrypted",
  file_too_complex: "fileComplex", file_has_attachments: "fileAttachments", upload_parallel_limit: "uploadBusy",
  upload_busy: "uploadBusy", storage_unavailable: "storage", diligence_report_invalid: "fileInvalid",
};
export function DiligenceFailure({ error, retry }: { error: unknown; retry?: () => void }) {
  const t = useTranslations("diligence"), common = useTranslations("common");
  const code = error instanceof ApiError ? problems[error.code] ?? "internal" : error === "validation" ? "validation" : "internal";
  return <Alert variant="destructive"><AlertDescription>{t(`errors.${code}`)}</AlertDescription>
    {retry && <Button type="button" className="mt-2" size="sm" variant="outline" onClick={retry}>{common("retry")}</Button>}
  </Alert>;
}
