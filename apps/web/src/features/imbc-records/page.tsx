import type { ImbcEngagementRead, ImbcNoteRead, ImbcProductContextRead, ImbcRecordRead } from "@imbc/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { useTranslations } from "use-intl";
import { PageTitle } from "@/components/app/page-title";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useMe, meKey } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  recordsKey,
  readNotes,
  readNote,
  readEngagement,
  readContext,
  readRecordActor,
  type RecordScope,
  type HistoryTarget,
} from "./api";
import { recordsParams, recordsReturn } from "./params";
import { RecordsFailure } from "./feedback";
import { recordsAuthorityLost } from "./scope";
import { RecordSnapshot } from "./snapshot";
import { RecordsPaging } from "./paging";
import { RecordsHistory as RecordsHistoryDialog } from "./history";
import { NoteEditor, EngagementEditor, ContextEditor } from "./forms";
type EditorTarget =
  | { kind: "note"; initial: ImbcNoteRead | null }
  | { kind: "engagement"; initial: ImbcEngagementRead | null }
  | { kind: "product_context"; initial: ImbcProductContextRead | null; productIdentityId: string; productName: string };
type Editing = EditorTarget & { organizationId: string };
import { ProductsView } from "./products";
export function RecordsPage({ profileId }: { profileId: string }) {
  const t = useTranslations("imbcRecords"),
    me = useMe();
  if (me.isPending) return <p role="status">{t("loading")}</p>;
  if (me.isError && (!me.data || recordsAuthorityLost(me.error)))
    return <RecordsFailure error={me.error} retry={() => void me.refetch()} />;
  if (!me.data || !["expert", "director"].includes(me.data.user.role))
    return <RecordsFailure error={new ApiError(403, "forbidden", "")} />;
  return (
    <RecordsWorkbench
      key={`${profileId}:${me.data.user.id}:${me.data.user.role}`}
      profileId={profileId}
      actorId={me.data.user.id}
      expert={me.data.user.role === "expert"}
      sessionError={me.isError ? me.error : null}
    />
  );
}
function RecordsWorkbench({
  profileId,
  actorId,
  expert,
  sessionError,
}: {
  profileId: string;
  actorId: string;
  expert: boolean;
  sessionError: unknown;
}) {
  const t = useTranslations("imbcRecords"),
    client = useQueryClient(),
    [search, setSearch] = useSearchParams(),
    location = useLocation(),
    params = recordsParams(search),
    { view, noteOffset, productOffset, contextOffset, product } = params.value;
  const back = recordsReturn(location.state?.from, profileId, expert),
    [authority, setAuthority] = useState<unknown>(null),
    [sessionBarrier, setSessionBarrier] = useState<unknown>(null),
    [observedSessionError, setObservedSessionError] = useState<unknown>(null),
    [opening, setOpening] = useState(false),
    [failure, setFailure] = useState<unknown>(null),
    [editing, setEditing] = useState<Editing | null>(null),
    [history, setHistory] = useState<HistoryTarget | null>(null),
    [receipt, setReceipt] = useState<ImbcRecordRead | null>(null);
  const focus = useRef<HTMLButtonElement | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const lost = useCallback(
    (error: unknown) => {
      if (!recordsAuthorityLost(error)) return;
      setAuthority(error);
      setReceipt(null);
      void client.cancelQueries({ queryKey: recordsKey(profileId, actorId) });
      client.removeQueries({ queryKey: recordsKey(profileId, actorId) });
    },
    [actorId, client, profileId, setAuthority, setReceipt],
  );
  // Keep a failed probe latched across subsequent Me success; only explicit same-actor/private-scope recovery clears it.
  if (sessionError !== observedSessionError) {
    setObservedSessionError(sessionError);
    if (sessionError !== null) {
      setSessionBarrier(sessionError);
      setReceipt(null);
    }
  }
  const accessError = sessionError ?? sessionBarrier ?? authority;
  useEffect(() => {
    if (sessionError === null) return;
    void client.cancelQueries({ queryKey: recordsKey(profileId, actorId) });
    client.removeQueries({ queryKey: recordsKey(profileId, actorId) });
  }, [sessionError, profileId, actorId, client]);
  const notes = useQuery({
    queryKey: [...recordsKey(profileId, actorId), "notes", noteOffset],
    enabled: params.valid && accessError === null,
    queryFn: async ({ signal }) => {
      try {
        return await readNotes(profileId, noteOffset, 25, signal);
      } catch (error) {
        lost(error);
        throw error;
      }
    },
    staleTime: 0,
    gcTime: 0,
  });
  const scope = notes.data ? { profileId, organizationId: notes.data.organizationId } : null,
    editorScope = editing ? { profileId, organizationId: editing.organizationId } : null,
    canEdit = expert && notes.data?.canEdit === true && !notes.isFetching && !notes.isError && accessError === null,
    busy = opening || !!editing || !!history;
  function change(patch: Record<string, string>) {
    if (busy) return;
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(patch)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }
    setSearch(next, { state: location.state });
    setReceipt(null);
  }
  async function freshAccess() {
    const freshMe = await readRecordActor();
    client.setQueryData(meKey, freshMe);
    if (freshMe.user.id !== actorId || freshMe.user.role !== "expert" || freshMe.user.organizationType !== "imbc")
      throw new ApiError(403, "forbidden", "");
    const fresh = await readNotes(profileId, noteOffset, 25);
    if (
      !fresh.canEdit ||
      fresh.organizationId !== (editing?.organizationId ?? scope?.organizationId ?? fresh.organizationId)
    )
      throw new ApiError(403, "forbidden", "");
    client.setQueryData([...recordsKey(profileId, actorId), "notes", noteOffset], fresh);
    return { profileId, organizationId: fresh.organizationId };
  }
  async function retryAccess() {
    try {
      const freshMe = await readRecordActor();
      client.setQueryData(meKey, freshMe);
      if (
        freshMe.user.id !== actorId ||
        freshMe.user.role !== (expert ? "expert" : "director") ||
        freshMe.user.organizationType !== "imbc"
      )
        throw new ApiError(403, "forbidden", "");
      const fresh = await readNotes(profileId, noteOffset, 25);
      client.setQueryData([...recordsKey(profileId, actorId), "notes", noteOffset], fresh);
      if (mounted.current) {
        setAuthority(null);
        setSessionBarrier(null);
      }
    } catch (error) {
      if (mounted.current) setSessionBarrier(error);
      lost(error);
    }
  }
  async function reload(target: EditorTarget) {
    try {
      const trusted = await freshAccess(),
        row =
          target.kind === "note"
            ? target.initial
              ? await readNote(trusted, target.initial.id)
              : null
            : target.kind === "engagement"
              ? await readEngagement(trusted)
              : await readContext(trusted, target.productIdentityId);
      if (mounted.current) {
        setAuthority(null);
        setSessionBarrier(null);
      }
      return row;
    } catch (error) {
      lost(error);
      throw error;
    }
  }
  async function open(target: EditorTarget, trigger: HTMLButtonElement) {
    if (!canEdit || busy) return;
    focus.current = trigger;
    setOpening(true);
    setFailure(null);
    setReceipt(null);
    try {
      const row = await reload(target);
      if (mounted.current) setEditing({ ...target, initial: row, organizationId: scope!.organizationId } as Editing);
    } catch (error) {
      if (mounted.current) setFailure(error);
    } finally {
      if (mounted.current) setOpening(false);
    }
  }
  function showHistory(target: HistoryTarget, trigger: HTMLButtonElement) {
    if (busy) return;
    focus.current = trigger;
    setHistory(target);
  }
  function saved(row: ImbcRecordRead) {
    setEditing(null);
    setReceipt(row);
    void client.invalidateQueries({ queryKey: recordsKey(profileId, actorId) });
  }
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageTitle title={t("title")} />
      <h1 className="wrap-anywhere text-2xl font-semibold">{t("title")}</h1>
      <Link
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-auto w-fit max-w-full whitespace-normal")}
        to={back.to}
      >
        {t(back.label)}
      </Link>
      {!params.valid ? (
        <>
          <RecordsFailure error="validation" />
          <Button variant="outline" onClick={() => setSearch({ view: "notes" }, { state: location.state })}>
            {t("resetFilters")}
          </Button>
        </>
      ) : (
        <>
          {accessError !== null ? (
            <RecordsFailure error={accessError} retry={!editing ? () => void retryAccess() : undefined} />
          ) : notes.isPending ? (
            <p role="status">{t("loading")}</p>
          ) : notes.isError ? (
            <RecordsFailure error={notes.error} retry={() => void notes.refetch()} />
          ) : scope && notes.data ? (
            <>
              <h2 className="whitespace-pre-wrap wrap-anywhere text-lg font-medium">{notes.data.organizationName}</h2>
              <p className="text-sm text-muted-foreground">{t("privateHint")}</p>
              {!canEdit && <p className="text-sm">{t("readOnly")}</p>}
              {failure !== null && <RecordsFailure error={failure} />}{" "}
              {receipt && (
                <details className="min-w-0 rounded-lg border p-3">
                  <summary>{t("saveReceipt")}</summary>
                  <p className="my-3 text-sm text-muted-foreground">{t("receiptHint")}</p>
                  <RecordSnapshot row={receipt} {...scope} actorId={actorId} lost={lost} />
                </details>
              )}
              <Tabs value={view} onValueChange={(next) => change({ view: String(next) })}>
                <TabsList className="h-auto group-data-horizontal/tabs:h-auto max-w-full flex-wrap">
                  {(["notes", "engagement", "products"] as const).map((key) => (
                    <TabsTrigger key={key} value={key} disabled={busy} className="min-w-0 whitespace-normal">
                      {t(key)}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <TabsContent value="notes">
                  <div className="min-w-0 space-y-5">
                    {expert && (
                      <Button
                        disabled={!canEdit || busy}
                        onClick={(event) => void open({ kind: "note", initial: null }, event.currentTarget)}
                      >
                        {t("newNote")}
                      </Button>
                    )}
                    {!notes.data.items.length && <p>{t("noNotes")}</p>}
                    {notes.data.items.map((row) => (
                      <section key={row.id} className="min-w-0 space-y-3 rounded-lg border p-4">
                        <RecordSnapshot row={row} {...scope} actorId={actorId} lost={lost} />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            disabled={busy || notes.isFetching}
                            onClick={(event) => showHistory({ kind: "note", id: row.id }, event.currentTarget)}
                          >
                            {t("history")}
                          </Button>
                          {expert && (
                            <Button
                              variant="outline"
                              disabled={!canEdit || busy}
                              onClick={(event) => void open({ kind: "note", initial: row }, event.currentTarget)}
                            >
                              {t("editNote")}
                            </Button>
                          )}
                        </div>
                      </section>
                    ))}
                    <RecordsPaging
                      offset={noteOffset}
                      total={notes.data.total}
                      disabled={busy || notes.isFetching}
                      change={(offset) => change({ noteOffset: String(offset) })}
                    />
                  </div>
                </TabsContent>
                <TabsContent value="engagement">
                  {view === "engagement" && (
                    <EngagementView
                      scope={scope}
                      actorId={actorId}
                      expert={expert}
                      canEdit={canEdit}
                      busy={busy}
                      lost={lost}
                      edit={(row, button) => void open({ kind: "engagement", initial: row }, button)}
                      history={(button) => showHistory({ kind: "engagement" }, button)}
                    />
                  )}
                </TabsContent>
                <TabsContent value="products">
                  {view === "products" && (
                    <ProductsView
                      scope={scope}
                      actorId={actorId}
                      expert={expert}
                      canEdit={canEdit}
                      busy={busy}
                      lost={lost}
                      offset={productOffset}
                      contextOffset={contextOffset}
                      selectedId={product}
                      change={change}
                      edit={(row, id, name, button) =>
                        void open(
                          { kind: "product_context", initial: row, productIdentityId: id, productName: name },
                          button,
                        )
                      }
                      history={(id, button) => showHistory({ kind: "product_context", id }, button)}
                    />
                  )}
                </TabsContent>
              </Tabs>
            </>
          ) : null}
        </>
      )}
      {editing && editorScope && (
        <>
          {editing.kind === "note" ? (
            <NoteEditor
              scope={editorScope}
              actorId={actorId}
              initial={editing.initial}
              blocked={accessError !== null}
              lost={lost}
              close={() => setEditing(null)}
              saved={saved}
              reload={() => reload(editing) as Promise<ImbcNoteRead | null>}
              focus={focus}
            />
          ) : editing.kind === "engagement" ? (
            <EngagementEditor
              scope={editorScope}
              actorId={actorId}
              initial={editing.initial}
              blocked={accessError !== null}
              lost={lost}
              close={() => setEditing(null)}
              saved={saved}
              reload={() => reload(editing) as Promise<ImbcEngagementRead | null>}
              focus={focus}
            />
          ) : (
            <ContextEditor
              scope={editorScope}
              actorId={actorId}
              initial={editing.initial}
              productIdentityId={editing.productIdentityId}
              productName={editing.productName}
              blocked={accessError !== null}
              lost={lost}
              close={() => setEditing(null)}
              saved={saved}
              reload={() => reload(editing) as Promise<ImbcProductContextRead | null>}
              focus={focus}
            />
          )}
        </>
      )}
      {history && scope && accessError === null && (
        <RecordsHistoryDialog
          scope={scope}
          actorId={actorId}
          target={history}
          close={() => setHistory(null)}
          lost={lost}
          focus={focus}
        />
      )}
    </div>
  );
}
function EngagementView({
  scope,
  actorId,
  expert,
  canEdit,
  busy,
  lost,
  edit,
  history,
}: {
  scope: RecordScope;
  actorId: string;
  expert: boolean;
  canEdit: boolean;
  busy: boolean;
  lost: (error: unknown) => void;
  edit: (row: ImbcEngagementRead | null, button: HTMLButtonElement) => void;
  history: (button: HTMLButtonElement) => void;
}) {
  const t = useTranslations("imbcRecords"),
    record = useQuery({
      queryKey: [...recordsKey(scope.profileId, actorId), "engagement"],
      queryFn: async ({ signal }) => {
        try {
          return await readEngagement(scope, signal);
        } catch (error) {
          lost(error);
          throw error;
        }
      },
      staleTime: 0,
      gcTime: 0,
    });
  return (
    <div className="min-w-0 space-y-4">
      {record.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : record.isError ? (
        <RecordsFailure error={record.error} retry={() => void record.refetch()} />
      ) : (
        <>
          {record.data ? (
            <RecordSnapshot row={record.data} {...scope} actorId={actorId} lost={lost} />
          ) : (
            <p>{t("noEngagement")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {expert && (
              <Button
                disabled={!canEdit || busy || record.isFetching}
                onClick={(event) => edit(record.data ?? null, event.currentTarget)}
              >
                {t("editEngagement")}
              </Button>
            )}
            {record.data && (
              <Button
                variant="outline"
                disabled={busy || record.isFetching}
                onClick={(event) => history(event.currentTarget)}
              >
                {t("history")}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
