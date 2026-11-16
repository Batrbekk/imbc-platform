import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { useFormat } from "@/i18n/format";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { readHistory, recordsKey, type RecordScope, type HistoryTarget, type RecordHistory } from "./api";
import { RecordsFailure } from "./feedback";
import { recordsAuthorityLost } from "./scope";
import { RecordSnapshot } from "./snapshot";
function Entry({
  entry,
  scope,
  actorId,
  lost,
}: {
  entry: RecordHistory["items"][number];
  scope: RecordScope;
  actorId: string;
  lost: (error: unknown) => void;
}) {
  const t = useTranslations("imbcRecords"),
    f = useFormat(),
    [open, setOpen] = useState(false);
  return (
    <details className="min-w-0 rounded-lg border p-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer whitespace-pre-wrap wrap-anywhere text-sm font-medium">
        {t(`actions.${entry.action}`)} · {f.dateTime(entry.at)} · {entry.actorName ?? t("unknownAuthor")}
      </summary>
      {open && (
        <div className="mt-4 min-w-0 space-y-5">
          <section>
            <h3 className="mb-2 font-medium">{t("before")}</h3>
            {entry.before ? (
              <RecordSnapshot row={entry.before} {...scope} actorId={actorId} lost={lost} />
            ) : (
              <p>{t("noPreviousRecord")}</p>
            )}
          </section>
          <section>
            <h3 className="mb-2 font-medium">{t("after")}</h3>
            <RecordSnapshot row={entry.after} {...scope} actorId={actorId} lost={lost} />
          </section>
        </div>
      )}
    </details>
  );
}
export function RecordsHistory({
  scope,
  actorId,
  target,
  close,
  lost,
  focus,
}: {
  scope: RecordScope;
  actorId: string;
  target: HistoryTarget;
  close: () => void;
  lost: (error: unknown) => void;
  focus: React.RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations("imbcRecords"),
    [cursor, setCursor] = useState<string | undefined>();
  const history = useQuery({
    queryKey: [...recordsKey(scope.profileId, actorId), "history", target.kind, target.id, cursor],
    queryFn: async ({ signal }) => {
      try {
        return await readHistory(scope, target, cursor, signal);
      } catch (error) {
        if (recordsAuthorityLost(error)) lost(error);
        throw error;
      }
    },
    staleTime: 0,
    gcTime: 0,
  });
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent
        finalFocus={focus}
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] min-w-0 grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>{t("history")}</DialogTitle>
          <DialogDescription>{t("historyHint")}</DialogDescription>
        </DialogHeader>
        {history.isPending && <p role="status">{t("loading")}</p>}
        {history.isError && <RecordsFailure error={history.error} retry={() => void history.refetch()} />}{" "}
        {history.data && (
          <div className="min-w-0 space-y-3">
            {!history.data.items.length && <p>{t("noHistory")}</p>}
            {history.data.items.map((entry) => (
              <Entry key={entry.id} entry={entry} scope={scope} actorId={actorId} lost={lost} />
            ))}
            {history.data.nextCursor && (
              <Button
                variant="outline"
                disabled={history.isFetching}
                onClick={() => setCursor(history.data.nextCursor!)}
              >
                {t("olderHistory")}
              </Button>
            )}
            {cursor && (
              <Button variant="outline" onClick={() => setCursor(undefined)}>
                {t("latestHistory")}
              </Button>
            )}
          </div>
        )}
        <DialogFooter>
          <Button onClick={close}>{t("close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
