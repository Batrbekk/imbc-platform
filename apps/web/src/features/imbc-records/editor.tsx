import type { ImbcRecordRead } from "@imbc/contracts";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useBeforeUnload, useBlocker } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UnsavedDialog } from "@/features/profile/unsaved-dialog";
import { ApiError } from "@/lib/api";
import { RecordsFailure } from "./feedback";
import { recordsAuthorityLost } from "./scope";
import { RecordSnapshot } from "./snapshot";
export type EditorFields<D, R> = {
  draft: D;
  baseline: R | null;
  locked: boolean;
  errors: string[];
  update: (value: Partial<D>) => void;
  blocking: (value: boolean) => void;
};
export function RecordEditor<D extends object, R extends ImbcRecordRead, W>({
  initial,
  values,
  payload,
  schema,
  save,
  reload,
  rebase,
  fields,
  scope,
  actorId,
  blocked,
  lost,
  close,
  saved,
  focus,
  title,
}: {
  initial: R | null;
  values: (row: R | null) => D;
  payload: (draft: D, row: R | null) => unknown;
  schema: z.ZodType<W>;
  save: (body: W, key: string) => Promise<R>;
  reload: () => Promise<R | null>;
  rebase?: (draft: D, next: R | null) => D;
  fields: (props: EditorFields<D, R>) => ReactNode;
  scope: { profileId: string; organizationId: string };
  actorId: string;
  blocked: boolean;
  lost: (error: unknown) => void;
  close: () => void;
  saved: (row: R) => void;
  focus: RefObject<HTMLButtonElement | null>;
  title: string;
}) {
  const t = useTranslations("imbcRecords");
  const [base, setBase] = useState(initial),
    [draft, setDraft] = useState(() => values(initial)),
    [failure, setFailure] = useState<unknown>(null),
    [pending, setPending] = useState(false),
    [needsReload, setNeedsReload] = useState(false),
    [rebased, setRebased] = useState(false),
    [errors, setErrors] = useState<string[]>([]),
    [confirmClose, setConfirmClose] = useState(false),
    [fieldBlocked, setFieldBlocked] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [latest, setLatest] = useState<R | null>(null);
  const captured = useRef<{ key: string; body: W } | null>(null),
    busy = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dirty = JSON.stringify(draft) !== JSON.stringify(values(base)),
    navigating = dirty || pending || uncertain;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      navigating &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  useBeforeUnload(
    useCallback(
      (event) => {
        if (navigating) {
          event.preventDefault();
          event.returnValue = "";
        }
      },
      [navigating],
    ),
  );
  const blocking = useCallback((value: boolean) => setFieldBlocked(value), []),
    locked = blocked || pending || uncertain;
  function update(value: Partial<D>) {
    setDraft((old) => ({ ...old, ...value }));
    setRebased(false);
    setErrors([]);
  }
  function requestClose() {
    if (busy.current) return;
    if (navigating) setConfirmClose(true);
    else close();
  }
  async function submit() {
    if (busy.current || blocked || needsReload || fieldBlocked) return;
    const parsed = schema.safeParse(captured.current?.body ?? payload(draft, base));
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")));
      setFailure("validation");
      return;
    }
    const intent = captured.current ?? { key: crypto.randomUUID(), body: parsed.data };
    captured.current = intent;
    busy.current = true;
    setPending(true);
    setFailure(null);
    try {
      const receipt = await save(intent.body, intent.key);
      if (mounted.current) saved(receipt);
    } catch (error) {
      if (!mounted.current) return;
      setFailure(error);
      if (recordsAuthorityLost(error)) {
        setNeedsReload(true);
        setUncertain(false);
        lost(error);
      } else if (error instanceof ApiError && error.code === "conflict") {
        setNeedsReload(true);
        setUncertain(false);
      } else if (error instanceof ApiError && error.status < 500) {
        captured.current = null;
        setUncertain(false);
      } else setUncertain(true);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  async function refresh() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const next = await reload();
      if (!mounted.current) return;
      setDraft((old) => (rebase ? rebase(old, next) : old));
      setBase(next);
      setLatest(next);
      captured.current = null;
      setUncertain(false);
      setNeedsReload(false);
      setFailure(null);
      setErrors([]);
      setRebased(true);
    } catch (error) {
      if (mounted.current) {
        setFailure(error);
        setNeedsReload(true);
        if (recordsAuthorityLost(error)) lost(error);
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent
          finalFocus={focus}
          showCloseButton={false}
          className="max-h-[calc(100dvh-2rem)] min-w-0 grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-3xl"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t("editorHint")}</DialogDescription>
          </DialogHeader>
          {blocked ? (
            <p role="status">{t("authorityBlocked")}</p>
          ) : (
            <form
              id="imbc-record-editor"
              className="min-w-0 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              {fields({ draft, baseline: base, locked, errors, update, blocking })}
              {latest && (
                <details className="min-w-0 rounded-lg border p-3">
                  <summary>{t("currentRecord")}</summary>
                  <div className="mt-3">
                    <RecordSnapshot row={latest} {...scope} actorId={actorId} lost={lost} />
                  </div>
                </details>
              )}
            </form>
          )}
          {failure !== null && <RecordsFailure error={failure} />}
          {uncertain && !blocked && (
            <p role="status" className="text-sm">
              {t("retryExactIntent")}
            </p>
          )}
          {(needsReload || blocked) && (
            <Button
              type="button"
              variant="outline"
              className="h-auto max-w-full whitespace-normal py-2 wrap-anywhere"
              disabled={pending}
              onClick={() => void refresh()}
            >
              {t("reloadKeepDraft")}
            </Button>
          )}
          {rebased && !blocked && (
            <p role="status" className="text-sm">
              {t("rebased")}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={requestClose}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              disabled={blocked || pending || needsReload || fieldBlocked || (!dirty && !uncertain)}
              onClick={() => void submit()}
            >
              {pending ? t("saving") : uncertain ? t("retry") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <UnsavedDialog
        open={confirmClose || blocker.state === "blocked"}
        stay={() => {
          setConfirmClose(false);
          if (blocker.state === "blocked") blocker.reset();
        }}
        leave={() => {
          if (blocker.state === "blocked") blocker.proceed();
          else close();
        }}
      />
    </>
  );
}
