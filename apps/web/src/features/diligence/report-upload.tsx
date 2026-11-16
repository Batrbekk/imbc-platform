import { ALLOWED_FILE_TYPES, MAX_FILE_BYTES, profileUploadStateSchema, type ProfileFile } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFormat } from "@/i18n/format";
import { api, ApiError } from "@/lib/api";
import { diligencePath } from "./api";
import { DiligenceFailure } from "./feedback";

export type DiligencePurpose = "due_diligence_report" | "enhanced_due_diligence_report";
export function DiligenceReportUpload({ profileId, actorId, purpose, existingId, disabled, onChange, onBlocked }: {
  profileId: string; actorId: string; purpose: DiligencePurpose; existingId: string | null; disabled: boolean;
  onChange: (fileId: string | null) => void; onBlocked: (blocked: boolean) => void;
}) {
  const t = useTranslations("diligence"), files = useTranslations("profileAttachments"), format = useFormat();
  const [candidate, setCandidate] = useState<ProfileFile | null>(null), [uploading, setUploading] = useState(false), [failure, setFailure] = useState<unknown>(null);
  const mounted = useRef(true), input = useRef<HTMLInputElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const poll = useQuery({
    queryKey: ["diligence", actorId, profileId, "upload", purpose, candidate?.fileId],
    queryFn: async () => profileUploadStateSchema.parse(await api(`${diligencePath(profileId)}/files/${purpose}/${candidate!.fileId}`)).upload,
    enabled: !!candidate,
    initialData: candidate ?? undefined,
    staleTime: 0, gcTime: 0, refetchOnWindowFocus: false,
    refetchInterval: query => !query.state.data || query.state.data.scanState === "pending" ? 3000 : false,
  });
  const file = poll.data ?? candidate;
  const blocked = uploading || !!file && (file.scanState !== "passed" || file.versionId === null);
  useEffect(() => { onBlocked(blocked); }, [blocked, onBlocked]);
  async function upload(selected: File | undefined) {
    if (!selected || disabled || uploading) return;
    if (selected.size > MAX_FILE_BYTES) { setFailure(new ApiError(413, "file_too_large", "")); return; }
    const extension = selected.name.split(".").at(-1)?.toLowerCase();
    if (![...Object.values(ALLOWED_FILE_TYPES), "jpeg"].includes(extension ?? "")) { setFailure(new ApiError(415, "file_type_not_allowed", "")); return; }
    setUploading(true); setFailure(null);
    try {
      const body = new FormData(); body.append("file", selected);
      const { upload } = profileUploadStateSchema.parse(await api(`${diligencePath(profileId)}/files/${purpose}`, { method: "POST", body }));
      if (mounted.current) { setCandidate(upload); onChange(upload.fileId); }
    } catch (error) { if (mounted.current) setFailure(error); }
    finally { if (mounted.current) setUploading(false); if (input.current) input.current.value = ""; }
  }
  return <section className="min-w-0 space-y-3 rounded-lg border p-3" aria-label={t("report")}>
    <p className="text-xs text-muted-foreground">{t("uploadHint", { size: format.number(25) })}</p>
    {file ? <div className="min-w-0 space-y-2"><p className="break-all text-sm">{file.originalName ?? t("report")}</p><Badge variant={file.scanState === "rejected" ? "destructive" : "secondary"}>{files(`state.${file.scanState ?? "unavailable"}`)}</Badge>
      {file.rejectionReason && <p role="status" className="text-sm text-destructive">{files(`reason.${file.rejectionReason}`)}</p>}
      {file.byteSize !== null && <p className="text-xs text-muted-foreground">{files("size", { size: format.number(file.byteSize / 1024 / 1024) })}</p>}
    </div> : <p className="text-sm text-muted-foreground">{existingId ? t("reportRetained") : t("noReport")}</p>}
    <input ref={input} type="file" className="sr-only" aria-label={t("chooseReport")} accept={[...Object.values(ALLOWED_FILE_TYPES).map(extension => `.${extension}`), ".jpeg"].join(",")}
      disabled={disabled || uploading} onChange={event => void upload(event.target.files?.[0])} />
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={disabled || uploading} onClick={() => input.current?.click()}>{uploading ? t("uploading") : existingId ? t("replaceReport") : t("uploadReport")}</Button>
      {existingId && <Button type="button" variant="ghost" size="sm" disabled={disabled || uploading} onClick={() => { setCandidate(null); onChange(null); setFailure(null); }}>{t("removeReport")}</Button>}
    </div>
    {failure !== null && <DiligenceFailure error={failure} />}
    {poll.isError && <DiligenceFailure error={poll.error} retry={() => void poll.refetch()} />}
    {blocked && !uploading && <p role="status" className="text-sm text-muted-foreground">{t("fileMustPass")}</p>}
  </section>;
}
