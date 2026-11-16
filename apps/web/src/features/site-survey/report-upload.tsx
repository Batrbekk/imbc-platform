import { ALLOWED_FILE_TYPES, MAX_FILE_BYTES, profileUploadSchema, profileUploadStateSchema, type ProfileFile } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { useFormat } from "@/i18n/format";
import { api, ApiError } from "@/lib/api";
import { surveyPath } from "./api";
import { SurveyFailure } from "./feedback";
import { SurveyReport } from "./report";
import { surveyAuthorityLost } from './scope';

/** Only new candidates are polled; a retained historical pin never follows a global latest upload. */
export function SurveyReportUpload({ profileId, actorId, value, retained, required, allowRemove, disabled, onChange, onBlocked, onWorking, authorityLost }: {
  profileId: string; actorId: string; value: string | null; retained: ProfileFile | null; required: boolean;
  allowRemove: boolean; disabled: boolean;
  onChange: (id: string | null) => void; onBlocked: (blocked: boolean) => void;
  onWorking: (working: boolean) => void; authorityLost: (error: unknown) => void;
}) {
  const t = useTranslations("siteSurvey"), format = useFormat();
  const [candidate, setCandidate] = useState<ProfileFile | null>(null), [uploading, setUploading] = useState(false), [failure, setFailure] = useState<unknown>(null);
  const mounted = useRef(true), input = useRef<HTMLInputElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const selectedCandidate = candidate?.fileId === value;
  const poll = useQuery({ queryKey: ["site-surveys", profileId, actorId, "upload", candidate?.fileId],
    queryFn: async ({ signal }) => {
      const upload = profileUploadStateSchema.parse(await api(`${surveyPath(profileId)}/files/${candidate!.fileId}/state`, { signal })).upload;
      if (upload.fileId !== candidate!.fileId) throw new Error('survey_upload_scope'); return upload;
    },
    enabled: !!candidate && selectedCandidate && !disabled, initialData: candidate ?? undefined,
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false,
    refetchInterval: query => query.state.status !== 'error' && (!query.state.data || query.state.data.scanState === "pending") ? 3000 : false });
  const file = selectedCandidate ? poll.data ?? candidate : retained?.fileId === value ? retained : null;
  const clean = !!file && file.scanState === "passed" && file.versionId !== null && file.versionNumber !== null;
  const blocked = uploading || required && value === null || value !== null && !clean || selectedCandidate && poll.isError;
  useEffect(() => { onBlocked(blocked); }, [blocked, onBlocked]);
  useEffect(() => { onWorking(uploading); }, [uploading, onWorking]);
  useEffect(() => { if (poll.isError && surveyAuthorityLost(poll.error)) authorityLost(poll.error); }, [poll.isError, poll.error, authorityLost]);
  async function upload(selected: File | undefined) {
    if (!selected || disabled || uploading) return;
    if (selected.size > MAX_FILE_BYTES) { setFailure(new ApiError(413, "file_too_large", "")); return; }
    const extension = selected.name.split(".").at(-1)?.toLowerCase();
    if (![...Object.values(ALLOWED_FILE_TYPES), "jpeg"].includes(extension ?? "")) { setFailure(new ApiError(415, "file_type_not_allowed", "")); return; }
    setUploading(true); setFailure(null);
    try {
      const body = new FormData(); body.append("file", selected);
      const response = profileUploadSchema.parse(await api(`${surveyPath(profileId)}/files`, { method: "POST", body }));
      if (mounted.current) { setCandidate(response.upload); onChange(response.upload.fileId); }
    } catch (error) { if (mounted.current) { setFailure(error); if (surveyAuthorityLost(error)) authorityLost(error); } }
    finally { if (mounted.current) setUploading(false); if (input.current) input.current.value = ""; }
  }
  return <section className="min-w-0 space-y-3" aria-label={t("uploadReport")}>
    <SurveyReport file={file} label={t("report")} />
    <p className="text-xs text-muted-foreground">{t("uploadHint", { size: format.number(25) })}</p>
    <input ref={input} type="file" className="sr-only" aria-label={t("chooseReport")} disabled={disabled || uploading}
      accept={[...Object.values(ALLOWED_FILE_TYPES).map(extension => `.${extension}`), ".jpeg"].join(",")} onChange={event => void upload(event.target.files?.[0])} />
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={disabled || uploading} onClick={() => input.current?.click()}>{uploading ? t("uploading") : value ? t("replaceReport") : t("uploadReport")}</Button>
      {candidate && retained && <Button type="button" variant="outline" size="sm" disabled={disabled || uploading} onClick={() => { setCandidate(null); setFailure(null); onChange(retained.fileId); }}>{t("keepSavedReport")}</Button>}
      {allowRemove && value && <Button type="button" variant="ghost" size="sm" disabled={disabled || uploading} onClick={() => { setCandidate(null); setFailure(null); onChange(null); }}>{t("removeReport")}</Button>}
    </div>
    {required && value === null && <p role="status" className="text-sm text-muted-foreground">{t("reportRequired")}</p>}
    {value !== null && !clean && !uploading && <p role="status" className="text-sm text-muted-foreground">{t("fileMustPass")}</p>}
    {failure !== null && <SurveyFailure error={failure} />}{selectedCandidate && poll.isError && <SurveyFailure error={poll.error} retry={() => void poll.refetch()} />}
  </section>;
}
