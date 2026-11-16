import { type DiligenceHistoryEntry } from "@imbc/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useFormat } from "@/i18n/format";
import { readDiligenceHistory } from "./api";
import { DiligenceCheckList } from "./checks";
import { DiligenceFailure } from "./feedback";
import { DiligenceReport } from "./record";

type StoredState = DiligenceHistoryEntry["diff"]["before"];
function HistoryState({ state, entry }: { state: StoredState; entry: DiligenceHistoryEntry }) {
  const t = useTranslations("diligence"), format = useFormat(), record = state.record;
  if (!record) return <p className="text-sm text-muted-foreground">{t("noRecord")}</p>;
  const version = (fileId: string | null, versionId: string | null) => entry.reports.find(report => report.fileId === fileId && report.versionId === versionId)?.versionNumber ?? null;
  const source = entry.sourceSnapshots.find(snapshot => snapshot.snapshotId === record.source_snapshot_id);
  return <div className="min-w-0 space-y-4">
    {source?.isTestData && <Badge variant="outline" className="whitespace-normal">{t("testData")}</Badge>}
    <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">{t("resultLabel")}</dt><dd>{t(`results.${record.result}`)}</dd></div>
      <div><dt className="text-muted-foreground">{t("automaticResult")}</dt><dd>{record.adata_result ? t(`results.${record.adata_result}`) : t("notProvided")}</dd></div>
      <div><dt className="text-muted-foreground">{t("checkedOn")}</dt><dd>{format.date(record.checked_on)}</dd></div>
      <div><dt className="text-muted-foreground">{t("updatedAt")}</dt><dd>{format.dateTime(record.updated_at)}</dd></div>
      <div><dt className="text-muted-foreground">{t("enhancedLabel")}</dt><dd>{t(`enhancedStates.${record.enhanced}`)}</dd></div>
      <div><dt className="text-muted-foreground">{t("sourceLabel")}</dt><dd>{record.source_snapshot_id ? t("savedSource") : t("noSource")}</dd></div>
      <div><dt className="text-muted-foreground">{t("checkedAt")}</dt><dd>{source ? format.dateTime(source.checkedAt) : t("noSource")}</dd></div>
      {record.overridden_at && <div><dt className="text-muted-foreground">{t("overriddenAt")}</dt><dd>{format.dateTime(record.overridden_at)}</dd></div>}
    </dl>
    <div className="min-w-0"><h4 className="text-sm font-medium">{t("comment")}</h4><p className="whitespace-pre-wrap wrap-anywhere text-sm">{record.comment ?? t("notProvided")}</p></div>
    <DiligenceReport fileId={record.report_file_id} versionNumber={version(record.report_file_id, record.report_file_version_id)} label={t("report")} />
    <div className="min-w-0"><h4 className="text-sm font-medium">{t("enhancedComment")}</h4><p className="whitespace-pre-wrap wrap-anywhere text-sm">{record.enhanced_comment ?? t("notProvided")}</p></div>
    <DiligenceReport fileId={record.enhanced_report_file_id} versionNumber={version(record.enhanced_report_file_id, record.enhanced_report_file_version_id)} label={t("enhancedReport")} />
    <h4 className="font-medium">{t("allChecks")}</h4>
    {state.checks.length ? <DiligenceCheckList showGroup checks={state.checks.map(check => ({ id: check.id, groupName: check.group_name, subjectName: check.subject_name, checkName: check.check_name, adataValue: check.adata_value, mark: check.mark, attention: check.attention }))} /> : <p className="text-sm text-muted-foreground">{t("noChecks")}</p>}
  </div>;
}
export function DiligenceHistory({ profileId, actorId, close, finalFocus }: { profileId: string; actorId: string; close: () => void; finalFocus: React.RefObject<HTMLButtonElement | null> }) {
  const t = useTranslations("diligence"), format = useFormat();
  const history = useInfiniteQuery({
    queryKey: ["diligence", actorId, profileId, "history"], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => readDiligenceHistory(profileId, pageParam),
    getNextPageParam: page => page.length === 50 ? page.at(-1)?.id : undefined,
    staleTime: 0, gcTime: 0,
  });
  const entries = history.data?.pages.flat() ?? [];
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent finalFocus={finalFocus} showCloseButton={false} className="max-h-[calc(100dvh-2rem)] min-w-0 grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-3xl">
    <DialogHeader><DialogTitle>{t("history")}</DialogTitle><DialogDescription>{t("historyHint")}</DialogDescription></DialogHeader>
    <div className="min-w-0 space-y-4">
      {history.isPending && <p role="status">{t("loading")}</p>}
      {history.isError && <DiligenceFailure error={history.error} retry={() => void history.refetch()} />}
      {!history.isPending && !history.isError && !entries.length && <p className="text-muted-foreground">{t("noHistory")}</p>}
      {entries.map(entry => <details key={entry.id} className="min-w-0 rounded-lg border p-4" onToggle={event => { const open = event.currentTarget.open; setOpened(previous => previous[entry.id] === open ? previous : { ...previous, [entry.id]: open }); }}>
        <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring"><span className="font-medium">{t(`historyActions.${entry.action.slice("due_diligence.".length)}`)}</span><span className="mt-1 block text-xs text-muted-foreground">{format.dateTime(entry.at)} · {entry.actorId === null ? t("systemActor") : entry.actorName ?? t("unknownActor")}</span></summary>
        {opened[entry.id] && <div className="mt-4 min-w-0 space-y-5">{(["before", "after"] as const).map(side => <section key={side} aria-label={t(side)} className="min-w-0 space-y-3"><Badge variant="outline">{t(side)}</Badge><HistoryState state={entry.diff[side]} entry={entry} /></section>)}</div>}
      </details>)}
      {history.hasNextPage && <Button type="button" variant="outline" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? t("loading") : t("loadMore")}</Button>}
    </div>
    <DialogFooter><Button type="button" variant="outline" onClick={close}>{t("close")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
