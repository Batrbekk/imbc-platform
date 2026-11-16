import { useParams } from "react-router";
import { z } from "zod";
import { RecordsPage } from "@/features/imbc-records/page";
import { RecordsFailure } from "@/features/imbc-records/feedback";
import { ApiError } from "@/lib/api";
export function Component() {
  const { profileId } = useParams();
  return z.uuid().safeParse(profileId).success ? (
    <RecordsPage profileId={profileId!} />
  ) : (
    <RecordsFailure error={new ApiError(404, "not_found", "")} />
  );
}
