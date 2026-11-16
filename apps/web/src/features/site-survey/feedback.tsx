import { useTranslations } from "use-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";

const problems: Record<string, string> = {
  forbidden: "forbidden", not_found: "notFound", validation: "validation", conflict: "changed",
  validation_failed: 'validation', busy: 'busy', site_survey_report_required: 'reportRequired', site_survey_report_unavailable: 'fileInvalid', site_survey_request_requires_verified: 'verifiedRequired',
  file_invalid: "fileInvalid", file_pending: "filePending", file_rejected: "fileRejected",
  file_too_large: "fileTooLarge", file_type_not_allowed: "fileType", file_type_mismatch: "fileType",
  file_structure_unsupported: "fileStructure", file_encrypted: "fileEncrypted", file_too_complex: "fileComplex",
  file_has_attachments: "fileAttachments", upload_parallel_limit: "uploadBusy", upload_busy: "uploadBusy",
  storage_unavailable: "storage",
};
export function SurveyFailure({ error, retry, context = 'record' }: { error: unknown; retry?: () => void; context?: 'record' | 'operation' }) {
  const t = useTranslations("siteSurvey"), common = useTranslations("common");
  const key = error instanceof ApiError ? error.code === 'conflict' && context === 'operation' ? 'operationConflict' : problems[error.code] ?? "internal" : error === 'invalid_filters' ? 'invalidFilters' : error === "validation" ? "validation" : "internal";
  return <Alert variant="destructive"><AlertDescription>{t(`errors.${key}`)}</AlertDescription>
    {retry && <Button type="button" className="mt-2" size="sm" variant="outline" onClick={retry}>{common("retry")}</Button>}
  </Alert>;
}
