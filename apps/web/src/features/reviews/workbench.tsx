import { can, SECTION_KINDS, type ReviewSubmitResult, type SectionKind } from "@imbc/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useBeforeUnload, useBlocker, useLocation } from "react-router";
import { useTranslations } from "use-intl";
import { PageTitle } from "@/components/app/page-title";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UnsavedDialog } from "@/features/profile/unsaved-dialog";
import { useFormat } from "@/i18n/format";
import { ApiError } from "@/lib/api";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { reviewKeys, reviewsApi } from "./api";
import { ReviewFailure } from "./feedback";
import { ReviewDecisionEditor } from "./decision-editor";
import { ReviewSectionView, type ReviewReadMap } from "./section-read";
import { reviewAuthorityLost, reviewSectionFileBlocked, reviewUnverifiableItems } from "./data";

export function ReviewWorkbenchPage({ assignmentId }: { assignmentId: string }) {
  const t = useTranslations("reviewWorkflow"), sectionName = useTranslations("profileEditor.sections"), profile = useTranslations("profile"), format = useFormat();
  const me = useMe(), actor = me.data?.user, client = useQueryClient(), location = useLocation();
  const allowed = actor?.role === "expert" && can(actor.role, "profile.verify") !== null;
  const from: unknown = (location.state as { from?: unknown } | null)?.from;
  const back = typeof from === "string" && (from === "/reviews" || from.startsWith("/reviews?")) ? from : "/reviews";
  const key = [...reviewKeys.workbench(assignmentId), actor?.id], started = useRef(false);
  const [opened, setOpened] = useState(false), [active, setActive] = useState<SectionKind>("main_information"), [blockedKinds, setBlockedKinds] = useState<Partial<Record<SectionKind, boolean>>>({});
  const [confirm, setConfirm] = useState(false), [closed, setClosed] = useState<ReviewSubmitResult | null>(null);
  const [authorityError, setAuthorityError] = useState<unknown>(null), [reloadingAuthority, setReloadingAuthority] = useState(false);
  const authorityLost = useCallback((error: unknown) => {
    setAuthorityError(error); setConfirm(false);
    // Keep drafts mounted, but mark server metadata stale without issuing another automatic write/read.
    void client.invalidateQueries({ queryKey: [...reviewKeys.workbench(assignmentId), actor?.id], refetchType: "none" });
  }, [client, assignmentId, actor?.id]);
  const trigger = useRef<HTMLButtonElement>(null);
  const open = useMutation({ mutationFn: () => reviewsApi.open(assignmentId), retry: false, onSuccess: data => { client.setQueryData(key, data); setOpened(true); void client.invalidateQueries({ queryKey: reviewKeys.queues }); } });
  useEffect(() => { if (allowed && !started.current) { started.current = true; open.mutate(); } }, [allowed, open]);
  const workbench = useQuery({ queryKey: key, queryFn: async ({ signal }) => {
    const data = await reviewsApi.read(assignmentId, signal);
    if (data.assignment.id !== assignmentId) throw new ApiError(409, "assignment_changed", "");
    if (data.assignment.expertId !== actor?.id) throw new ApiError(403, "forbidden", "");
    return data;
  }, enabled: allowed && opened && !closed && authorityError === null,
    staleTime: 0, refetchOnWindowFocus: true });
  const exact = workbench.data, sections = useQueries({ queries: SECTION_KINDS.map(kind => ({ queryKey: [...reviewKeys.section(assignmentId, kind), actor?.id],
    enabled: allowed && opened && !closed && !workbench.isError && authorityError === null,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const response = await reviewsApi.section(assignmentId, kind, signal), expected = exact?.sections.find(value => value.kind === kind);
      if (response.kind !== kind || !expected || response.revisionId !== expected.revisionId) throw new ApiError(409, "review_section_changed", "");
      return response;
    }, refetchOnWindowFocus: false,
  })) });
  const graph: ReviewReadMap = Object.fromEntries(sections.flatMap(query => query.data ? [[query.data.kind, query.data]] : []));
  const submit = useMutation({ mutationFn: () => reviewsApi.submit(assignmentId), retry: false, onSuccess: data => { setClosed(data); setConfirm(false); void client.invalidateQueries({ queryKey: reviewKeys.queues }); },
    onError: error => { if (reviewAuthorityLost(error)) authorityLost(error); } });
  const dirty = Object.values(blockedKinds).some(Boolean), navigating = dirty || submit.isPending;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => navigating && currentLocation.pathname !== nextLocation.pathname);
  useBeforeUnload(useCallback(event => { if (navigating) { event.preventDefault(); event.returnValue = ""; } }, [navigating]));
  const blocked = useCallback((kind: SectionKind, value: boolean) => setBlockedKinds(current => current[kind] === value ? current : { ...current, [kind]: value }), []);
  const reload = async () => {
    setReloadingAuthority(true);
    try {
      const result = await workbench.refetch(); if (result.isError || !result.data) throw result.error;
      if (result.data.assignment.id !== assignmentId) throw new ApiError(409, "assignment_changed", "");
      if (result.data.assignment.expertId !== actor?.id) throw new ApiError(403, "forbidden", "");
      setAuthorityError(null); return result.data;
    } catch (error) { if (reviewAuthorityLost(error)) authorityLost(error); throw error; }
    finally { setReloadingAuthority(false); }
  };
  const changed = authorityError !== null || reloadingAuthority || workbench.isError || sections.some(query => query.error instanceof ApiError && [403, 409].includes(query.error.status));
  const unavailable = sections.some(query => query.isError || query.isPending || query.isFetching);
  const title = exact?.organizationName ? t("reviewTitle", { name: exact.organizationName }) : t("workbenchTitle");
  return <div className="mx-auto flex min-w-0 max-w-6xl flex-col gap-5">
    <PageTitle title={title} /><h1 className="whitespace-pre-wrap break-words text-2xl font-semibold tracking-tight">{title}</h1>
    <div><Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} to={back}>{t("backToQueue")}</Link></div>
    {me.isPending ? <p role="status">{t("loading")}</p> : !allowed ? <ReviewFailure error={new ApiError(403, "forbidden", "")} />
      : open.isError ? <ReviewFailure error={open.error} retry={() => open.mutate()} /> : !opened || !exact ? <p role="status">{t("opening")}</p> : closed ? <section className="space-y-3 rounded-lg border p-4" aria-label={t("resultSaved")}>
        <h2 className="font-semibold">{t("resultSaved")}</h2><p>{profile(`statusValue.${closed.profileStatus}`)}</p>
        <p className="text-sm text-muted-foreground">{format.dateTime(closed.closedAt)}</p>
        {closed.publishKinds.length > 0 && <p>{t("publishedSections", { sections: closed.publishKinds.map(kind => sectionName(kind)).join(", ") })}</p>}
        {closed.retainKinds.length > 0 && <p>{t("retainedSections", { sections: closed.retainKinds.map(kind => sectionName(kind)).join(", ") })}</p>}
      </section> : <>
        <div className="flex flex-wrap items-center gap-3"><Badge variant="secondary">{exact.hasPendingChanges ? t("pendingChanges") : profile(`statusValue.${exact.profileStatus}`)}</Badge>
          <p className="text-sm text-muted-foreground">{t("receivedDate", { date: format.dateTime(exact.assignment.receivedAt) })}</p>
        </div>
        <p className="text-sm text-muted-foreground">{t("frozenHint")}</p><p className="text-sm">{t("contactReminder")}</p>
        {workbench.isError && <ReviewFailure error={workbench.error} retry={() => void reload().catch(() => undefined)} />}
        {authorityError !== null && <section className="space-y-3" aria-label={t("reload")}>
          <ReviewFailure error={authorityError} /><p className="text-sm">{t("reloadPreservesIntent")}</p>
          <Button variant="outline" disabled={reloadingAuthority} onClick={() => void reload().catch(() => undefined)}>{t("reload")}</Button>
        </section>}
        <nav aria-label={t("sections")} className="flex flex-wrap gap-2">{exact.sections.map(section => <Button key={section.kind} variant={active === section.kind ? "default" : "outline"} aria-pressed={active === section.kind} onClick={() => setActive(section.kind)}>
          {sectionName(section.kind)} · {section.decision ? t(`outcome.${section.decision.outcome}`) : t("decisionMissing")}{!section.reviewRequired && ` · ${t("retained")}`}
        </Button>)}</nav>
        {exact.sections.map(metadata => {
          const query = sections[SECTION_KINDS.indexOf(metadata.kind)];
          return <section key={metadata.revisionId} hidden={active !== metadata.kind || workbench.isError} className="min-w-0 space-y-4" aria-label={sectionName(metadata.kind)}>
            <h2 className="text-xl font-semibold">{sectionName(metadata.kind)}</h2>
            {!workbench.isError && (query?.isError ? <ReviewFailure error={query.error} retry={() => void query.refetch()} /> : !query?.data ? <p role="status">{t("loading")}</p> : <ReviewSectionView section={query.data} graph={graph} />)}
            <ReviewDecisionEditor assignmentId={assignmentId} section={metadata} disabled={changed || unavailable || submit.isPending || workbench.isFetching}
              unverifiable={query?.data ? reviewUnverifiableItems(query.data) : new Set()} fileBlocked={query?.data ? reviewSectionFileBlocked(query.data) : true}
              blocked={blocked} saved={() => { void client.invalidateQueries({ queryKey: reviewKeys.workbench(assignmentId) }); }} reload={reload} authorityLost={authorityLost} />
          </section>;
        })}
        {submit.isError && <ReviewFailure error={submit.error} retry={() => void workbench.refetch()} />}
        {dirty && <p role="status" className="text-sm text-muted-foreground">{t("saveBeforeResult")}</p>}
        <div><Button ref={trigger} disabled={!exact.canSubmitResult || dirty || changed || unavailable || workbench.isFetching || submit.isPending} onClick={() => setConfirm(true)}>{t("submitResult")}</Button></div>
      </>}
    <Dialog open={confirm} onOpenChange={value => { if (!submit.isPending) setConfirm(value); }}><DialogContent finalFocus={trigger} showCloseButton={false} className="grid-cols-[minmax(0,1fr)] max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{t("submitResult")}</DialogTitle><DialogDescription>{t(exact?.hasPendingChanges ? "submitChangesHint" : "submitInitialHint")}</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" disabled={submit.isPending} onClick={() => setConfirm(false)}>{t("cancel")}</Button><Button disabled={submit.isPending || dirty || !exact?.canSubmitResult || changed || unavailable} onClick={() => submit.mutate()}>{submit.isPending ? t("submitting") : t("confirmResult")}</Button></DialogFooter>
    </DialogContent></Dialog>
    <UnsavedDialog open={blocker.state === "blocked"} stay={() => { if (blocker.state === "blocked") blocker.reset(); }} leave={() => { if (blocker.state === "blocked") blocker.proceed(); }} />
  </div>;
}
