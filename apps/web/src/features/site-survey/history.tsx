import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState, type RefObject } from "react";
import { useTranslations } from "use-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useFormat } from "@/i18n/format";
import { readSurveyHistory, surveyKeys } from "./api";
import { SurveyFailure } from "./feedback";
import { SurveyRecord } from "./record";
import { surveyAuthorityLost } from './scope';

/** Mounted only by the authorized expert/director page; each side keeps its own captured report. */
export function SurveyHistory({ profileId, recordId, actorId, close, finalFocus, authorityLost }: {
  profileId: string; recordId: string; actorId: string; close: () => void; finalFocus: RefObject<HTMLButtonElement | null>;
  authorityLost: (error: unknown) => void;
}) {
  const t = useTranslations("siteSurvey"), format = useFormat(), [opened, setOpened] = useState<Record<string, boolean>>({});
  const history = useInfiniteQuery({ queryKey: surveyKeys.history(profileId, recordId, actorId), initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => readSurveyHistory(profileId, recordId, pageParam, signal),
    getNextPageParam: page => page.nextCursor ?? undefined, staleTime: 0, gcTime: 0 });
  const entries = history.data?.pages.flatMap(page => page.items) ?? [];
  useEffect(() => { if (history.isError && surveyAuthorityLost(history.error)) authorityLost(history.error); }, [history.isError, history.error, authorityLost]);
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent finalFocus={finalFocus} showCloseButton={false} className="max-h-[calc(100dvh-2rem)] min-w-0 grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-3xl">
    <DialogHeader><DialogTitle>{t("history")}</DialogTitle><DialogDescription>{t("historyHint")}</DialogDescription></DialogHeader>
    <div className="min-w-0 space-y-4">
      {history.isPending && <p role="status">{t("loading")}</p>}{history.isError && <SurveyFailure error={history.error} retry={() => void history.refetch()} />}
      {!history.isPending && !history.isError && !entries.length && <p className="text-sm text-muted-foreground">{t("noHistory")}</p>}
      {entries.map(entry => <details key={entry.id} className="min-w-0 rounded-lg border p-4" onToggle={event => {
        const open = event.currentTarget.open; setOpened(previous => previous[entry.id] === open ? previous : { ...previous, [entry.id]: open });
      }}><summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring"><span className="font-medium">{t(`historyActions.${entry.action.slice("site_survey.".length)}`)}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{format.dateTime(entry.at)} · {entry.actorName ?? t("unknownActor")}</span></summary>
        {opened[entry.id] && <div className="mt-4 min-w-0 space-y-5">{(["before", "after"] as const).map(side => <section key={side} className="min-w-0 space-y-3" aria-label={t(side)}>
          <Badge variant="outline">{t(side)}</Badge>{entry[side] ? <SurveyRecord record={entry[side]} /> : <p className="text-sm text-muted-foreground">{t("noRecord")}</p>}
        </section>)}</div>}
      </details>)}
      {history.hasNextPage && <Button type="button" variant="outline" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? t("loading") : t("loadMore")}</Button>}
    </div><DialogFooter><Button type="button" variant="outline" onClick={close}>{t("close")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
