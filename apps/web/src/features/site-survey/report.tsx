import type { ProfileFile } from "@imbc/contracts";
import { DownloadIcon } from "lucide-react";
import { useTranslations } from "use-intl";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { useFormat } from "@/i18n/format";
import { cn } from "@/lib/utils";

/** A pure exact-evidence presenter: the caller supplies the selected or historical pin. */
export function SurveyReport({ file, label }: { file: ProfileFile | null; label: string }) {
  const t = useTranslations("profileAttachments"), format = useFormat();
  const available = file?.scanState === "passed" && file.versionId !== null
    && file.versionNumber !== null && file.canDownload;
  const state = file?.scanState ?? "unavailable";
  return <section aria-label={label} className="min-w-0 space-y-3 rounded-lg border p-3">
    <h3 className="text-sm font-medium">{label}</h3>
    {file ? <>
      <p className="whitespace-pre-wrap wrap-anywhere text-sm font-medium">{file.originalName ?? t("unnamed")}</p>
      <div className="flex flex-wrap items-center gap-2"><Badge variant={state === "rejected" ? "destructive" : "secondary"}>{t(`state.${state}`)}</Badge>
        <p className="text-xs text-muted-foreground">{file.byteSize !== null ? t("size", { size: format.number(file.byteSize / 1024 / 1024) }) : t("sizeUnknown")} · {format.dateTime(file.uploadedAt)}</p>
      </div>
      {file.rejectionReason && <p role="status" className="whitespace-pre-wrap wrap-anywhere text-sm text-destructive">{t(`reason.${file.rejectionReason}`)}</p>}
      {available && <a className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-auto max-w-full whitespace-normal")}
        href={`/api/v1/files/${encodeURIComponent(file.fileId)}/content?version=${file.versionNumber}`}><DownloadIcon />{t("download", { version: format.number(file.versionNumber!) })}</a>}
    </> : <p className="text-sm text-muted-foreground">{t("empty")}</p>}
  </section>;
}
