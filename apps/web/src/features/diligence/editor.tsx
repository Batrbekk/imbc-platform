import { DILIGENCE_RESULTS, ENHANCED_DILIGENCE_STATES, diligenceEnhancedWriteSchema, diligenceOverrideWriteSchema, type DiligenceRead } from "@imbc/contracts";
import { useCallback, useState } from "react";
import { useBeforeUnload, useBlocker } from "react-router";
import { useTranslations } from "use-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { UnsavedDialog } from "@/features/profile/unsaved-dialog";
import { ApiError } from "@/lib/api";
import { readDiligence, saveEnhanced, saveOverride } from "./api";
import { DiligenceFailure } from "./feedback";
import { DiligenceReportUpload } from "./report-upload";
import { DiligenceRecord } from "./record";

export function DiligenceEditor({ initial, actorId, mode, close, saved, finalFocus }: {
  initial: DiligenceRead; actorId: string; mode: "override" | "enhanced"; close: () => void; saved: (data: DiligenceRead) => void; finalFocus: React.RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations("diligence");
  const original = initial.record;
  const [result, setResult] = useState<typeof DILIGENCE_RESULTS[number] | null>(original?.result ?? null);
  const [enhanced, setEnhanced] = useState<typeof ENHANCED_DILIGENCE_STATES[number]>(original?.enhanced ?? "not_done");
  const [comment, setComment] = useState((mode === "override" ? original?.comment : original?.enhancedComment) ?? "");
  const [fileId, setFileId] = useState((mode === "override" ? original?.reportFileId : original?.enhancedReportFileId) ?? null);
  const [token, setToken] = useState(original?.updatedAt ?? null), [failure, setFailure] = useState<unknown>(null), [pending, setPending] = useState(false), [fileBlocked, setFileBlocked] = useState(false), [confirmClose, setConfirmClose] = useState(false), [rebased, setRebased] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<DiligenceRead | null>(null);
  const [previous] = useState(() => JSON.stringify({ result, enhanced, comment, fileId }));
  const dirty = JSON.stringify({ result, enhanced, comment, fileId }) !== previous;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (dirty || pending || fileBlocked) && currentLocation.pathname !== nextLocation.pathname);
  useBeforeUnload(useCallback(event => { if (dirty || pending || fileBlocked) { event.preventDefault(); event.returnValue = ""; } }, [dirty, pending, fileBlocked]));
  const onBlocked = useCallback((blocked: boolean) => setFileBlocked(blocked), []);
  const changed = failure instanceof ApiError && failure.code === "diligence_changed";
  function requestClose() { if (pending) return; if (dirty || fileBlocked) setConfirmClose(true); else close(); }
  async function submit() {
    if (pending || fileBlocked || changed) return;
    const values = { expectedUpdatedAt: token, comment: comment === "" ? null : comment, reportFileId: fileId };
    const parsed = mode === "override" ? diligenceOverrideWriteSchema.safeParse({ ...values, result }) : diligenceEnhancedWriteSchema.safeParse({ ...values, enhanced });
    if (!parsed.success) { setFailure("validation"); return; }
    setPending(true); setFailure(null);
    try {
      const next = mode === "override" ? await saveOverride(initial.profileId, diligenceOverrideWriteSchema.parse(parsed.data)) : await saveEnhanced(initial.profileId, diligenceEnhancedWriteSchema.parse(parsed.data));
      saved(next);
    } catch (error) { setFailure(error); }
    finally { setPending(false); }
  }
  async function reload() {
    if (pending) return;
    setPending(true);
    try {
      const current = await readDiligence(initial.profileId);
      // Explicitly rebase only the concurrency token. Keep the SME's unsaved choice, comment and exact new report candidate.
      setToken(current.record?.updatedAt ?? null); setCurrentVersion(current); setFailure(null); setRebased(true);
    } catch (error) { setFailure(error); }
    finally { setPending(false); }
  }
  return <>
    <Dialog open onOpenChange={open => { if (!open) requestClose(); }}><DialogContent finalFocus={finalFocus} showCloseButton={false} className="max-h-[calc(100dvh-2rem)] min-w-0 grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>{t(mode === "override" ? "overrideTitle" : "enhancedTitle")}</DialogTitle><DialogDescription>{t(mode === "override" ? "overrideHint" : "enhancedHint")}</DialogDescription></DialogHeader>
      <form id="diligence-editor" className="min-w-0 space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <Field className="min-w-0"><FieldLabel htmlFor="diligence-choice">{t(mode === "override" ? "resultLabel" : "enhancedLabel")}</FieldLabel>
          <Select items={mode === "override" ? DILIGENCE_RESULTS.map(value => ({ value, label: t(`results.${value}`) })) : ENHANCED_DILIGENCE_STATES.map(value => ({ value, label: t(`enhancedStates.${value}`) }))}
            value={mode === "override" ? result : enhanced} disabled={pending} onValueChange={value => { if (value !== null) { if (mode === "override") setResult(value as typeof result); else setEnhanced(value as typeof enhanced); setRebased(false); } }}>
            <SelectTrigger id="diligence-choice" className="w-full min-w-0"><SelectValue placeholder={t("chooseResult")} /></SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>{(mode === "override" ? DILIGENCE_RESULTS : ENHANCED_DILIGENCE_STATES).map(value => <SelectItem key={value} value={value}>{t(`${mode === "override" ? "results" : "enhancedStates"}.${value}`)}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field className="min-w-0"><FieldLabel htmlFor="diligence-comment">{t("comment")}</FieldLabel><Textarea id="diligence-comment" className="min-w-0" rows={6} maxLength={10000} disabled={pending} value={comment} onChange={event => { setComment(event.target.value); setRebased(false); }} /></Field>
        <DiligenceReportUpload profileId={initial.profileId} actorId={actorId} purpose={mode === "override" ? "due_diligence_report" : "enhanced_due_diligence_report"} existingId={fileId} disabled={pending} onChange={setFileId} onBlocked={onBlocked} />
        {failure !== null && <DiligenceFailure error={failure} />}
        {changed && <Button type="button" variant="outline" disabled={pending} onClick={() => void reload()}>{t("reloadKeepDraft")}</Button>}
        {rebased && <Alert><AlertDescription>{t("rebased")}</AlertDescription></Alert>}
        {currentVersion && <details className="min-w-0 rounded-lg border p-3"><summary className="cursor-pointer font-medium">{t("currentResult")}</summary><div className="mt-3"><DiligenceRecord data={currentVersion} /></div></details>}
      </form>
      <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={requestClose}>{t("cancel")}</Button><Button type="submit" form="diligence-editor" disabled={pending || fileBlocked || changed}>{pending ? t("saving") : t("save")}</Button></DialogFooter>
    </DialogContent></Dialog>
    <UnsavedDialog open={confirmClose || blocker.state === "blocked"} stay={() => { setConfirmClose(false); if (blocker.state === "blocked") blocker.reset(); }} leave={() => { if (blocker.state === "blocked") blocker.proceed(); else close(); }} />
  </>;
}
