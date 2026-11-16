import { useParams } from "react-router";
import { z } from "zod";
import { ReviewWorkbenchPage } from "@/features/reviews/workbench";
import { ReviewFailure } from "@/features/reviews/feedback";
import { ApiError } from "@/lib/api";
export function ReviewPage() {
  const { assignmentId = "" } = useParams();
  return z.uuid().safeParse(assignmentId).success ? <ReviewWorkbenchPage key={assignmentId} assignmentId={assignmentId} /> : <ReviewFailure error={new ApiError(404, "not_found", "")} />;
}
