import { ALLOWED_FILE_TYPES, MAX_FILE_BYTES } from "@imbc/contracts";
import { sql } from "drizzle-orm";
import { ProblemException } from "../../common/problem.js";
import type { Database } from "../../database/database.module.js";
import type { SurveyStoredRecord } from "./survey-store.js";

/** Capture is profile -> record -> file object -> version, sharing locks with upload/scan/cleanup. */
export async function captureSurveyReport(
  tx: Database,
  scope: { organizationId: string },
  fileId: string | null,
  old: SurveyStoredRecord | null,
): Promise<string | null> {
  if (fileId === null) {
    if (old?.source === "expert")
      throw new ProblemException(
        400,
        "site_survey_report_required",
        "Обследованию нужен подписанный отчёт.",
      );
    return null;
  }
  const object = (
    await tx.execute(sql`select id from file_object where id=${fileId} and organization_id=${scope.organizationId}
    and purpose='site_survey_report' and data_class='c_imbc' and purge_requested_at is null for share`)
  ).rows[0];
  if (!object)
    throw new ProblemException(
      400,
      "validation_failed",
      "Отчёт не соответствует обследованию.",
    );
  // The unchanged pin is not replaced by a newer upload. A changed object captures its latest clean version only.
  const retained = old?.file_object_id === fileId ? old.file_version_id : null;
  const version = (
    await tx.execute<{
      id: string;
      scanState: string;
      byteSize: string;
      mediaType: string | null;
    }>(sql`
    select id,scan_state as "scanState",byte_size as "byteSize",detected_media_type as "mediaType" from file_version
    where file_object_id=${fileId} ${retained ? sql`and id=${retained}` : sql``}
    order by version_number desc limit 1 for share`)
  ).rows[0];
  if (
    !version ||
    version.scanState !== "passed" ||
    !version.mediaType ||
    !Object.hasOwn(ALLOWED_FILE_TYPES, version.mediaType) ||
    Number(version.byteSize) <= 0 ||
    Number(version.byteSize) > MAX_FILE_BYTES
  )
    throw new ProblemException(
      400,
      "site_survey_report_unavailable",
      "Отчёт недоступен или не прошёл проверку файла.",
    );
  return version.id;
}
