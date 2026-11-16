import { ALLOWED_FILE_TYPES, profileUploadSchema, profileUploadStateSchema, type ProfileFile, type ProfileUploadTarget } from "@imbc/contracts";
import { useQueries } from "@tanstack/react-query";
import { DownloadIcon, LoaderCircleIcon, UploadIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FieldError } from "@/components/ui/field";
import { useFormat } from "@/i18n/format";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fieldId, useFieldMessage } from "./form-data";
import { ProfileRowActions } from "./form-fields";
import type { SectionFieldErrors } from "./section-draft";

/** New uploads stay in the local draft until Save; frozen attachments always use the captured section DTO. */
export function ProfileAttachments({ target, path, label, ids, files, onChange, disabled, errors, multiple = true }: {
  target: ProfileUploadTarget; path: string; label: string; ids: readonly string[]; files: readonly ProfileFile[];
  onChange: (ids: string[]) => void; disabled: boolean; errors: SectionFieldErrors; multiple?: boolean;
}) {
  const t = useTranslations("profileAttachments");
  const format = useFormat();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Record<string, ProfileFile>>({});
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const current = useRef({ ids, onChange, disabled });
  const mounted = useRef(false);
  useLayoutEffect(() => { current.current = { ids, onChange, disabled }; });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const error = useFieldMessage(errors[path]);
  const known = new Map(Object.values(uploads).map((file) => [file.fileId, file]));
  for (const file of files) known.set(file.fileId, file);
  // Saved attachments are refreshed together by the section query. Poll only unsaved uploads here.
  const savedIds = new Set(files.map((file) => file.fileId));
  const pending = !disabled ? ids.filter((id) => !savedIds.has(id) && known.get(id)?.scanState === "pending") : [];
  const status = useQueries({ queries: pending.map((id) => ({
    queryKey: ["profile", "upload", target.kind, target.purpose, id],
    queryFn: async () => profileUploadStateSchema.parse(await api(`/v1/profiles/own/sections/${target.kind}/files/${target.purpose}/${id}`)).upload,
    refetchOnWindowFocus: false,
    refetchInterval: (query: { state: { data: ProfileFile | undefined } }) => !query.state.data || query.state.data.scanState === "pending" ? 3000 : false,
  })) });
  pending.forEach((id, index) => { if (status[index]?.data) known.set(id, status[index]!.data!); });
  async function upload(selected: FileList | null) {
    if (!selected?.length || disabled || uploading) return;
    setUploading(true); setFailure(null);
    try {
      for (const file of Array.from(selected)) {
        const form = new FormData(); form.append("file", file);
        const result = profileUploadSchema.parse(await api(`/v1/profiles/own/sections/${target.kind}/files/${target.purpose}`, { method: "POST", body: form }));
        if (!mounted.current || current.current.disabled) break;
        setUploads((previous) => ({ ...previous, [result.upload.fileId]: result.upload }));
        const next = multiple ? [...current.current.ids, result.upload.fileId] : [result.upload.fileId];
        // Keep edits made during the request; an unmounted or locked row never receives the result.
        current.current.ids = next;
        current.current.onChange(next);
        if (!multiple) break;
      }
    } catch (cause) { if (mounted.current) setFailure(cause instanceof ApiError ? cause.code : "internal"); }
    finally { if (mounted.current) setUploading(false); if (input.current) input.current.value = ""; }
  }
  const failureKey = failure && ["file_too_large", "file_type_not_allowed", "file_type_mismatch", "file_structure_unsupported", "file_encrypted", "file_too_complex", "file_has_attachments", "upload_parallel_limit", "upload_busy", "storage_unavailable", "profile_locked", "validation"].includes(failure) ? failure : "internal";
  return <section id={fieldId(path)} aria-label={label} className="space-y-3 rounded-lg border p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-medium">{label}</h3>
      {!disabled && <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => input.current?.click()}>
        {uploading ? <LoaderCircleIcon className="animate-spin" /> : <UploadIcon />}
        {uploading ? t("uploading") : !multiple && ids.length ? t("replace") : t("upload")}
      </Button>}
    </div>
    <input ref={input} type="file" className="sr-only" aria-label={t("choose", { label })}
      accept={[...Object.values(ALLOWED_FILE_TYPES).map((extension) => `.${extension}`), ".jpeg"].join(",")}
      multiple={multiple} disabled={disabled || uploading} onChange={(event) => void upload(event.target.files)} />
    {!disabled && <p className="text-xs text-muted-foreground">{t("hint", { size: format.number(25) })}</p>}
    {!ids.length && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
    <ul className="space-y-3">{ids.map((id, index) => {
      const file = known.get(id); const state = file?.scanState ?? "unavailable";
      return <li key={id} className="space-y-2 rounded-md border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="break-all text-sm font-medium">{file?.originalName ?? t("unnamed")}</p>
            <p className="text-xs text-muted-foreground">{file?.byteSize != null ? t("size", { size: format.number(file.byteSize / 1024 / 1024) }) : t("sizeUnknown")} · {format.dateTime(file?.uploadedAt)}</p>
          </div>
          <Badge variant={state === "rejected" ? "destructive" : "secondary"}>{t(`state.${state}`)}</Badge>
        </div>
        {file?.rejectionReason && <p role="status" className="text-sm text-destructive">{t(`reason.${file.rejectionReason}`)}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {file?.canDownload && file.versionNumber !== null && <a className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            href={`/api/v1/files/${id}/content?version=${file.versionNumber}`}><DownloadIcon />{t("download", { version: format.number(file.versionNumber) })}</a>}
          {!disabled && <ProfileRowActions index={index} count={ids.length} disabled={uploading}
            onMove={(to) => { const next = [...ids]; next.splice(index, 1); next.splice(to, 0, id); onChange(next); }}
            onRemove={() => onChange(ids.filter((value) => value !== id))} />}
        </div>
      </li>;
    })}</ul>
    {error && <FieldError>{error}</FieldError>}
    {failure && <p role="alert" className="text-sm text-destructive">{t(`error.${failureKey}`)}</p>}
    {status.some((query) => query.isError) && <div className="flex flex-wrap items-center gap-3">
      <p role="status" className="text-sm text-destructive">{t("statusError")}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => { for (const query of status) if (query.isError) void query.refetch(); }}>{t("retry")}</Button>
    </div>}
  </section>;
}
