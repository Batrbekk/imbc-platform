import { useTranslations } from "use-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";

const problems: Record<string, string> = {
  forbidden: "forbidden", not_found: "notFound", assignment_changed: "changed", review_incomplete: "incomplete",
  review_expert_unavailable: "expertUnavailable", section_decision_changed: "changed", review_decision_changed: "changed",
  review_section_changed: "changed", review_items_incomplete: "itemsIncomplete", review_subject_not_found: "subjectInvalid",
  review_section_not_required: "sectionNotRequired", review_not_opened: "notOpened", submission_file_unavailable: "fileUnavailable",
  submission_graph_invalid: "graphInvalid", busy: "busy",
  validation: "validation", file_pending: "filePending", file_rejected: "fileRejected", file_invalid: "fileInvalid",
};
export function ReviewFailure({ error, retry }: { error: unknown; retry?: () => void }) {
  const t = useTranslations("reviewWorkflow"), common = useTranslations("common");
  const key = error instanceof ApiError ? problems[error.code] ?? "internal" : error === "validation" ? "validation" : "internal";
  return <Alert variant="destructive"><AlertDescription>{t(`errors.${key}`)}</AlertDescription>
    {retry && <Button type="button" size="sm" className="mt-2" variant="outline" onClick={retry}>{common("retry")}</Button>}
  </Alert>;
}
