import { profileFileHistorySchema, type SectionKind } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ProfileFileHistory({ kind }: { kind: SectionKind }) {
  const t = useTranslations("profileAttachments"); const records = useTranslations("profileRecords"); const format = useFormat();
  const [open, setOpen] = useState(false); const [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: ["profile", "file-history", kind, offset], enabled: open,
    queryFn: async () => profileFileHistorySchema.parse(await api(`/v1/profiles/own/sections/${kind}/files/history?offset=${offset}&limit=50`)) });
  return <details className="rounded-lg border p-4" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-medium">{t("history")}</summary>
    {open && <div className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">{t("historyHint")}</p>
      {query.isPending && <p role="status">{t("historyLoading")}</p>}
      {query.isError && <div className="flex flex-wrap items-center gap-3"><p role="alert">{t("historyError")}</p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>{t("retry")}</Button></div>}
      {query.data && <>
        {!query.data.items.length && <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>}
        <ul className="space-y-3">{query.data.items.map((item) => <li key={item.id} className="space-y-2 rounded-lg border p-3">
          <p className="break-all text-sm font-medium">{item.file.originalName ?? t("unnamed")}</p>
          <p className="text-xs text-muted-foreground">{t("historyRecord", { version: format.number(item.editVersion), date: format.dateTime(item.recordedAt) })}</p>
          <Badge variant={item.file.scanState === "rejected" ? "destructive" : "secondary"}>{t(`state.${item.file.scanState ?? "unavailable"}`)}</Badge>
          {item.file.rejectionReason && <p className="text-sm text-destructive">{t(`reason.${item.file.rejectionReason}`)}</p>}
          {item.file.canDownload && item.file.versionNumber !== null && <div><a className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            href={`/api/v1/files/${item.file.fileId}/content?version=${item.file.versionNumber}`}>{t("download", { version: format.number(item.file.versionNumber) })}</a></div>}
        </li>)}</ul>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Button type="button" variant="outline" size="sm" disabled={offset === 0 || query.isFetching} onClick={() => setOffset((value) => Math.max(0, value - 50))}>{records("previous")}</Button>
          <span>{records("page", { page: format.number(Math.floor(offset / 50) + 1), pages: format.number(Math.max(1, Math.ceil(query.data.total / 50))), total: format.number(query.data.total) })}</span>
          <Button type="button" variant="outline" size="sm" disabled={offset + 50 >= query.data.total || offset + 50 > 1_000_000 || query.isFetching} onClick={() => setOffset((value) => value + 50)}>{records("next")}</Button>
        </div>
      </>}
    </div>}
  </details>;
}
