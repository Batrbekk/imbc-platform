import type { ReviewAssignmentMetadata, ReviewExpertOptions } from "@imbc/contracts";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FieldLabel } from "@/components/ui/field";
import { ApiError } from "@/lib/api";
import { UnsavedDialog } from "@/features/profile/unsaved-dialog";
import { reviewsApi } from "./api";
import { ReviewFailure } from "./feedback";

export function ReviewAssignmentDialog({ item, experts, close, reload, saved }: {
  item: ReviewAssignmentMetadata; experts: ReviewExpertOptions; close: () => void;
  reload: () => Promise<ReviewAssignmentMetadata | null>; saved: () => void;
}) {
  const t = useTranslations("reviewWorkflow"), old = useTranslations("reviews");
  const [expertId, setExpertId] = useState<string | null>(item.assignedExpertId), [current, setCurrent] = useState(item);
  const [needsReload, setNeedsReload] = useState(false), [missing, setMissing] = useState(false), [reloading, setReloading] = useState(false), [reloadError, setReloadError] = useState<unknown>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const mutation = useMutation({ mutationFn: () => reviewsApi.assign(item.assignmentId!, { expertId: expertId!, expectedExpertId: current.assignedExpertId }), retry: false,
    onSuccess: saved, onError: error => { if (error instanceof ApiError && error.status === 409) setNeedsReload(true); } });
  const dirty = expertId !== current.assignedExpertId, busy = mutation.isPending || reloading;
  async function refresh() {
    setReloading(true); setReloadError(null);
    try { const row = await reload(); if (!row || row.unresolved) { setMissing(true); return; } setCurrent(row); setNeedsReload(false); mutation.reset(); }
    catch (error) { setReloadError(error); } finally { setReloading(false); }
  }
  const choices = [{ value: null, label: t("chooseExpert") }, ...experts.map(expert => ({ value: expert.id, label: expert.label }))];
  return <><Dialog open onOpenChange={open => { if (!open && !busy) { if (dirty) setConfirmClose(true); else close(); } }}>
    <DialogContent showCloseButton={false} className="grid-cols-[minmax(0,1fr)] max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>{item.assignedExpertId ? t("reassign") : t("assign")}</DialogTitle><DialogDescription className="whitespace-pre-wrap break-words">{item.organizationName}</DialogDescription></DialogHeader>
      <p className="whitespace-pre-wrap break-words text-sm">{t("currentAssignee", { name: current.assignedExpert ?? old("unassigned") })}</p>
      <Field className="min-w-0"><FieldLabel htmlFor="review-assign-expert">{old("assignee")}</FieldLabel>
        <Select items={choices} value={expertId} disabled={busy || missing} onValueChange={value => setExpertId(value)}><SelectTrigger id="review-assign-expert" className="w-full min-w-0"><SelectValue className="truncate" /></SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>{choices.map(expert => <SelectItem key={expert.value ?? "none"} value={expert.value}>{expert.label}</SelectItem>)}</SelectContent></Select>
      </Field>
      {mutation.isError && <ReviewFailure error={mutation.error} />}{reloadError !== null && <ReviewFailure error={reloadError} />}
      {needsReload && <div className="space-y-2"><p className="text-sm">{t("reloadPreservesIntent")}</p><Button variant="outline" disabled={busy} onClick={() => void refresh()}>{t("reload")}</Button></div>}
      {missing && <p role="status" className="text-sm text-muted-foreground">{t("assignmentMissing")}</p>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => dirty ? setConfirmClose(true) : close()}>{t("cancel")}</Button>
        <Button disabled={busy || needsReload || missing || !expertId || !experts.some(expert => expert.id === expertId) || !dirty} onClick={() => mutation.mutate()}>{mutation.isPending ? t("saving") : t("saveAssignment")}</Button></DialogFooter>
    </DialogContent>
  </Dialog><UnsavedDialog open={confirmClose} stay={() => setConfirmClose(false)} leave={close} /></>;
}
