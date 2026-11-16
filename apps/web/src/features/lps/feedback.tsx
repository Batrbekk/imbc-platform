import { useEffect, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";
import { useTranslations } from "use-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api";
function lpsErrorKey(error: unknown) {
  if (!(error instanceof ApiError)) return "errors.unexpected";
  const map: Record<string, string> = { validation: "validation", forbidden: "forbidden", unauthenticated: "session", mfa_required: "session", responsibility_required: "session", bad_origin: "session", not_found: "notFound", busy: "busy", lps_reference: "reference", lps_child_scope: "childScope", lps_company_in_use: "companyInUse", lps_default_unavailable: "defaultUnavailable" };
  return `errors.${map[error.code] ?? (error.status === 409 ? "conflict" : "unexpected")}`;
}
export function LpsError({ error, retry }: { error: unknown; retry?: () => void }) {
  const t = useTranslations("lps");
  return <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-2">{t(lpsErrorKey(error))}{retry && <Button type="button" variant="outline" size="sm" onClick={retry}>{t("retry")}</Button>}</AlertDescription></Alert>;
}
function Discard({ open, keep, discard }: { open: boolean; keep: () => void; discard: () => void }) {
  const t = useTranslations("lps");
  return <AlertDialog open={open} onOpenChange={(value) => { if (!value) keep(); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("discardTitle")}</AlertDialogTitle><AlertDialogDescription>{t("discardDescription")}</AlertDialogDescription></AlertDialogHeader>
    <AlertDialogFooter><Button type="button" variant="outline" onClick={keep}>{t("keepEditing")}</Button><Button type="button" variant="destructive" onClick={discard}>{t("discard")}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
export function LpsLeaveGuard({ dirty, pending = false }: { dirty: boolean; pending?: boolean }) {
  const t = useTranslations("lps"), blocker = useBlocker(dirty || pending);
  useEffect(() => { if (!dirty && !pending && blocker.state === "blocked") blocker.reset(); }, [dirty, pending, blocker]);
  if (pending) return <AlertDialog open={blocker.state === "blocked"} onOpenChange={(value) => { if (!value && blocker.state === "blocked") blocker.reset(); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("saving")}</AlertDialogTitle><AlertDialogDescription>{t("savingDescription")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><Button type="button" onClick={() => { if (blocker.state === "blocked") blocker.reset(); }}>{t("keepEditing")}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>;
  return <Discard open={blocker.state === "blocked"} keep={() => { if (blocker.state === "blocked") blocker.reset(); }} discard={() => { if (blocker.state === "blocked") blocker.proceed(); }} />;
}
export function LpsDialog({ title, description, dirty, pending, onClose, children }: {
  title: string; description: string; dirty: boolean; pending: boolean; onClose: () => void; children: ReactNode;
}) {
  const t = useTranslations("lps"), [discard, setDiscard] = useState(false);
  useEffect(() => { if (!dirty && !pending) return; const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload); }, [dirty, pending]);
  const close = () => { if (pending) return; if (dirty) setDiscard(true); else onClose(); };
  return <><Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent showCloseButton={false} className="min-w-0 grid-cols-[minmax(0,1fr)] max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-3xl [&>*]:min-w-0"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
    {children}<Button type="button" variant="outline" disabled={pending} onClick={close}>{t("close")}</Button></DialogContent></Dialog>
    <Discard open={discard} keep={() => setDiscard(false)} discard={() => { setDiscard(false); onClose(); }} /></>;
}
