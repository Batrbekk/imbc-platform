import { siteSurveyCreateSchema, siteSurveyUpdateSchema, type SiteSurveyCreate, type SiteSurveyRecordView } from "@imbc/contracts";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useBeforeUnload, useBlocker } from "react-router";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { UnsavedDialog } from "@/features/profile/unsaved-dialog";
import { ApiError } from "@/lib/api";
import { createSurvey, updateSurvey } from "./api";
import { SurveyFailure } from "./feedback";
import { SurveyRecord } from "./record";
import { SurveyReportUpload } from "./report-upload";

type Draft = { visitStartedOn: string; visitEndedOn: string; expiresOn: string; result: "yes" | "no" | null; comment: string; reportFileId: string | null };
const values = (record: SiteSurveyRecordView | null): Draft => ({ visitStartedOn: record?.visitStartedOn ?? "", visitEndedOn: record?.visitEndedOn ?? "", expiresOn: record?.expiresOn ?? "",
  result: record?.result ?? null, comment: record?.comment ?? "", reportFileId: record?.reportFileId ?? null });
export function SurveyEditor({ profileId, actorId, initial, disabled, close, saved, reload, reloadAccess, authorityLost, finalFocus }: {
  profileId: string; actorId: string; initial: SiteSurveyRecordView | null; disabled: boolean;
  close: () => void; saved: (record: SiteSurveyRecordView) => void; reload: (recordId: string) => Promise<SiteSurveyRecordView>;
  reloadAccess: () => Promise<void>;
  authorityLost: (error: unknown) => void; finalFocus: RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations("siteSurvey"), common = useTranslations("common");
  const [draft, setDraft] = useState(() => values(initial)), [baseline, setBaseline] = useState(() => values(initial)), [token, setToken] = useState(initial?.updatedAt ?? null);
  const [failure, setFailure] = useState<unknown>(null), [pending, setPending] = useState(false), [needsReload, setNeedsReload] = useState(false), [rebased, setRebased] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]), [fileBlocked, setFileBlocked] = useState(!initial || initial.source === "expert" && initial.reportFileId === null);
  const [confirmClose, setConfirmClose] = useState(false), [uploadBusy, setUploadBusy] = useState(false), [currentRecord, setCurrentRecord] = useState<SiteSurveyRecordView | null>(null);
  const [intentId, setIntentId] = useState(() => crypto.randomUUID()), [capturedCreate, setCapturedCreate] = useState<SiteSurveyCreate | null>(null), [createConflict, setCreateConflict] = useState(false);
  const mounted = useRef(true), busy = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline), unresolved = initial?.needsReconciliation === true;
  const navigating = dirty || pending || uploadBusy || capturedCreate !== null;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => navigating && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  useBeforeUnload(useCallback(event => { if (navigating) { event.preventDefault(); event.returnValue = ""; } }, [navigating]));
  const onBlocked = useCallback((blocked: boolean) => setFileBlocked(blocked), []);
  const locked = disabled || pending || capturedCreate !== null;
  function requestClose() { if (busy.current) return; if (navigating) setConfirmClose(true); else close(); }
  function update(patch: Partial<Draft>) { setDraft(current => ({ ...current, ...patch })); setRebased(false); setFieldErrors([]); }
  async function submit() {
    if (busy.current || disabled || needsReload || createConflict || fileBlocked || unresolved) return;
    const write = { ...draft, visitEndedOn: draft.visitEndedOn || null, expiresOn: draft.expiresOn || null, comment: draft.comment || null };
    const parsed = initial ? siteSurveyUpdateSchema.safeParse({ ...write, expectedUpdatedAt: token }) : siteSurveyCreateSchema.safeParse(capturedCreate ?? write);
    if (!parsed.success) { setFieldErrors(parsed.error.issues.flatMap(issue => issue.message === 'visit_date_order' ? ['visitStartedOn', 'visitEndedOn'] : [String(issue.path[0] ?? "")])); setFailure("validation"); return; }
    busy.current = true; setPending(true); setFailure(null);
    const sentCreate = !initial ? siteSurveyCreateSchema.parse(parsed.data) : null;
    if (sentCreate && capturedCreate === null) setCapturedCreate(sentCreate);
    try {
      const next = initial ? await updateSurvey(profileId, initial.id, siteSurveyUpdateSchema.parse(parsed.data)) : await createSurvey(profileId, sentCreate!, intentId);
      if (mounted.current) saved(next);
    } catch (error) { if (mounted.current) {
      setFailure(error);
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) { setNeedsReload(true); authorityLost(error); }
      else if (error instanceof ApiError && error.code === "conflict") { if (initial) setNeedsReload(true); else setCreateConflict(true); }
      if (!initial && error instanceof ApiError && error.status < 500 && error.code !== "conflict") setCapturedCreate(null);
    } } finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function refresh() {
    if (busy.current) return; busy.current = true; setPending(true);
    try {
      if (!initial) { await reloadAccess(); if (mounted.current) { setNeedsReload(false); setFailure(null); setRebased(true); } return; }
      const next = await reload(initial.id); if (!mounted.current) return;
      if (next.id !== initial.id || next.profileId !== profileId || next.needsReconciliation) throw new ApiError(403, "forbidden", "");
      setToken(next.updatedAt); setBaseline(values(next)); setCurrentRecord(next); setNeedsReload(false); setFailure(null); setRebased(true);
    } catch (error) { if (mounted.current) { setFailure(error); setNeedsReload(true); if (error instanceof ApiError && [401, 403, 404].includes(error.status)) authorityLost(error); } }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function resetCreateIntent() {
    if (busy.current || initial || !createConflict) return; busy.current = true; setPending(true);
    try { await reloadAccess(); if (mounted.current) { setIntentId(crypto.randomUUID()); setCapturedCreate(null); setCreateConflict(false); setFailure(null); } }
    catch (error) { if (mounted.current) { setFailure(error); if (error instanceof ApiError && [401, 403, 404].includes(error.status)) authorityLost(error); } }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  const choices = [{ value: null, label: t("chooseResult") }, ...(["yes", "no"] as const).map(value => ({ value, label: common(value) }))];
  return <><Dialog open onOpenChange={open => { if (!open) requestClose(); }}><DialogContent finalFocus={finalFocus} showCloseButton={false} className="max-h-[calc(100dvh-2rem)] min-w-0 grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>{t(initial ? "editRecord" : "newRecord")}</DialogTitle><DialogDescription>{t("editorHint")}</DialogDescription></DialogHeader>
    {unresolved ? <><p className="text-sm">{t("reconciliationReadOnly")}</p><SurveyRecord record={initial!} /></> : <form id="site-survey-editor" className="min-w-0 space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{(["visitStartedOn", "visitEndedOn", "expiresOn"] as const).map(field => <Field key={field} className="min-w-0">
        <FieldLabel htmlFor={`site-survey-${field}`}>{t(field)}</FieldLabel><Input id={`site-survey-${field}`} type="date" value={draft[field]} disabled={locked} onChange={event => update({ [field]: event.target.value })} />
        {fieldErrors.includes(field) && <FieldError>{t("dateInvalid")}</FieldError>}
      </Field>)}</div><p className="text-xs text-muted-foreground">{t("expiryHint")}</p>
      <Field className="min-w-0"><FieldLabel htmlFor="site-survey-result">{t("result")}</FieldLabel><Select items={choices} value={draft.result} disabled={locked} onValueChange={value => update({ result: value as Draft["result"] })}>
        <SelectTrigger id="site-survey-result" className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent alignItemWithTrigger={false}>{choices.map(choice => <SelectItem key={choice.value ?? "none"} value={choice.value}>{choice.label}</SelectItem>)}</SelectContent>
      </Select>{fieldErrors.includes("result") && <FieldError>{t("resultRequired")}</FieldError>}</Field>
      <Field className="min-w-0"><FieldLabel htmlFor="site-survey-comment">{t("comment")}</FieldLabel><Textarea id="site-survey-comment" className="min-w-0" rows={6} maxLength={10000} value={draft.comment} disabled={locked} onChange={event => update({ comment: event.target.value })} /></Field>
      <SurveyReportUpload profileId={profileId} actorId={actorId} value={draft.reportFileId} retained={initial?.report ?? null} required={!initial || initial.source === "expert"}
        allowRemove={!initial || initial.source === "migration"} disabled={locked} onChange={id => update({ reportFileId: id })} onBlocked={onBlocked} onWorking={setUploadBusy} authorityLost={authorityLost} />
      {failure !== null && <SurveyFailure error={failure} context={initial ? 'record' : 'operation'} />}{capturedCreate && !pending && !createConflict && <p role="status" className="text-sm">{t("createRetryHint")}</p>}
      {createConflict && <Button variant="outline" type="button" disabled={pending} onClick={() => void resetCreateIntent()}>{t('startNewSave')}</Button>}
      {needsReload && <Button type="button" variant="outline" className="h-auto max-w-full whitespace-normal py-1.5 wrap-anywhere" disabled={pending} onClick={() => void refresh()}>{t("reloadKeepDraft")}</Button>}
      {needsReload && !initial && <p role="status" className="text-sm">{t("createRecoveryRequired")}</p>}
      {rebased && <p role="status" className="text-sm text-muted-foreground">{t("rebased")}</p>}
      {currentRecord && <details className="min-w-0 rounded-lg border p-3"><summary className="cursor-pointer font-medium">{t("currentRecord")}</summary><div className="mt-3 min-w-0"><SurveyRecord record={currentRecord} /></div></details>}
    </form>}
    <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={requestClose}>{t("cancel")}</Button>
      {!unresolved && <Button type="submit" form="site-survey-editor" disabled={disabled || pending || needsReload || createConflict || fileBlocked || !dirty}>{pending ? t("saving") : capturedCreate ? common("retry") : t("saveRecord")}</Button>}
    </DialogFooter>
  </DialogContent></Dialog><UnsavedDialog open={confirmClose || blocker.state === "blocked"} stay={() => { setConfirmClose(false); if (blocker.state === "blocked") blocker.reset(); }}
    leave={() => { if (blocker.state === "blocked") blocker.proceed(); else close(); }} /></>;
}
