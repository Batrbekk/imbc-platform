import { reviewSectionDecisionInputSchema, type ReviewWorkbench } from "@imbc/contracts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFormat } from "@/i18n/format";
import { ApiError } from "@/lib/api";
import { reviewsApi } from "./api";
import { ReviewFailure } from "./feedback";
import { reviewAuthorityLost, reviewItemTitle, reviewSubjectKey } from "./data";

type Section = ReviewWorkbench["sections"][number];
type Outcome = "verified" | "rejected";
type Draft = { outcome: Outcome | null; comment: string; items: Record<string, Outcome | null> };
function draftFrom(section: Section): Draft {
  return { outcome: section.decision?.outcome ?? null, comment: section.decision?.comment ?? "",
    items: Object.fromEntries(section.items.map(item => [reviewSubjectKey(item.subject), item.decision?.outcome ?? null])) };
}
export function ReviewDecisionEditor({ assignmentId, section, disabled, blocked, saved, reload, unverifiable, fileBlocked, authorityLost }: {
  assignmentId: string; section: Section; disabled: boolean; blocked: (kind: Section["kind"], value: boolean) => void;
  saved: () => void; reload: () => Promise<ReviewWorkbench>; unverifiable: ReadonlySet<string>; fileBlocked: boolean;
  authorityLost: (error: unknown) => void;
}) {
  const t = useTranslations("reviewWorkflow"), format = useFormat(), locale = useLocale() as "en" | "ru" | "kk";
  const [draft, setDraft] = useState(() => draftFrom(section)), [baseline, setBaseline] = useState(() => draftFrom(section)), [token, setToken] = useState(section.decision?.id ?? null);
  const [failure, setFailure] = useState<unknown>(null), [pending, setPending] = useState(false), [needsReload, setNeedsReload] = useState(false), [rebased, setRebased] = useState(false);
  const [remote, setRemote] = useState<Section | null>(null);
  const current = useRef(draft), mounted = useRef(true);
  useLayoutEffect(() => { current.current = draft; });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const serverChanged = !pending && (section.decision?.id ?? null) !== token;
  const stale = needsReload || serverChanged;
  useEffect(() => { blocked(section.kind, dirty || pending || stale); }, [blocked, section.kind, dirty, pending, stale]);
  if (serverChanged && !dirty) { const next = draftFrom(section); setDraft(next); setBaseline(next); setToken(section.decision?.id ?? null); }
  function update(patch: Partial<Draft>) { setDraft(current => ({ ...current, ...patch })); setRebased(false); }
  async function submit() {
    if (disabled || pending || stale || !section.reviewRequired) return;
    if (draft.outcome === "verified" && fileBlocked || section.items.some(item => draft.items[reviewSubjectKey(item.subject)] === "verified" && unverifiable.has(reviewSubjectKey(item.subject)))) {
      setFailure(new ApiError(409, "submission_file_unavailable", "")); return;
    }
    const required = section.items.filter(item => item.subject.kind === "document" || item.subject.kind === "certificate");
    if (required.some(item => !draft.items[reviewSubjectKey(item.subject)]) || draft.outcome === "verified" && required.some(item => draft.items[reviewSubjectKey(item.subject)] !== "verified")) {
      setFailure(new ApiError(409, "review_items_incomplete", "")); return;
    }
    const parsed = reviewSectionDecisionInputSchema.safeParse({ sectionRevisionId: section.revisionId, expectedDecisionId: token,
      outcome: draft.outcome, comment: draft.comment || null, items: section.items.flatMap(item => {
        const outcome = draft.items[reviewSubjectKey(item.subject)]; return outcome ? [{ subject: item.subject, outcome }] : [];
      }) });
    if (!parsed.success) { setFailure("validation"); return; }
    const sent = structuredClone(draft);
    setPending(true); setFailure(null);
    try {
      const result = await reviewsApi.decide(assignmentId, parsed.data);
      if (!mounted.current) return;
      const decision = result.decisions.find(value => value.subject.kind === "section");
      if (!decision || decision.subject.kind !== "section" || decision.subject.sectionRevisionId !== section.revisionId) throw new Error("review_response_scope");
      setToken(decision.id); setBaseline(sent); setNeedsReload(false); setRemote(null); setRebased(false);
      // A delayed acknowledgement only marks its captured draft as saved; later typing remains dirty.
      setDraft(current.current); saved();
    } catch (error) { if (mounted.current) {
      setFailure(error);
      if (reviewAuthorityLost(error)) { setNeedsReload(true); authorityLost(error); }
      else if (error instanceof ApiError && error.status === 409 && error.code !== "review_items_incomplete" && error.code !== "review_incomplete") setNeedsReload(true);
    } }
    finally { if (mounted.current) setPending(false); }
  }
  async function refresh() {
    if (pending) return; setPending(true);
    try {
      const result = await reload(); if (!mounted.current) return;
      const currentSection = result.sections.find(value => value.kind === section.kind && value.revisionId === section.revisionId);
      if (!currentSection || !currentSection.reviewRequired) throw new ApiError(409, "assignment_changed", "");
      setToken(currentSection.decision?.id ?? null); setBaseline(draftFrom(currentSection)); setRemote(currentSection); setNeedsReload(false); setFailure(null); setRebased(true);
    } catch (error) { if (mounted.current) { setFailure(error); setNeedsReload(true); if (reviewAuthorityLost(error)) authorityLost(error); } }
    finally { if (mounted.current) setPending(false); }
  }
  const choices = [{ value: null, label: t("chooseDecision") }, ...(["verified", "rejected"] as const).map(value => ({ value, label: t(`outcome.${value}`) }))];
  const id = `review-decision-${section.kind}`;
  return <section aria-label={t("sectionDecision")} className="min-w-0 space-y-4 rounded-lg border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{t("sectionDecision")}</h3>
      <div className="flex flex-wrap gap-2"><Badge variant={section.decision?.outcome === "rejected" ? "destructive" : "secondary"}>{section.reviewRequired && dirty ? t("unsaved") : section.decision ? t(`outcome.${section.decision.outcome}`) : t("decisionMissing")}</Badge>
        {!section.reviewRequired && <Badge variant="outline">{t("retained")}</Badge>}
      </div></div>
    {section.decision && <div className="space-y-1"><p className="text-xs text-muted-foreground">{t("savedDecision", { date: format.dateTime(section.decision.decidedAt) })}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{section.decision.comment}</p></div>}
    {!section.reviewRequired ? <><p className="text-sm text-muted-foreground">{t("retainedHint")}</p>
      {section.items.length > 0 && <ul className="min-w-0 space-y-3">{section.items.map(item => {
        const label = item.label;
        const fallback = label?.kind === "document" ? t("documentNumber", { number: format.number(label.positionInList + 1) }) : label?.kind === "certificate" ? t("certificateNumber", { number: format.number(label.positionInList + 1) }) : t("file");
        return <li key={reviewSubjectKey(item.subject)} className="min-w-0 space-y-2 rounded-md border p-3">
          <p className="whitespace-pre-wrap wrap-anywhere text-sm font-medium">{reviewItemTitle(label, locale, fallback)}</p>
          <Badge variant={item.decision?.outcome === "rejected" ? "destructive" : "secondary"}>{item.decision ? t(`outcome.${item.decision.outcome}`) : t("decisionMissing")}</Badge>
          {item.decision && <p className="text-xs text-muted-foreground">{format.dateTime(item.decision.decidedAt)}</p>}
        </li>;
      })}</ul>}
    </> : <form className="min-w-0 space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <Field className="min-w-0"><FieldLabel htmlFor={id}>{t("sectionOutcome")}</FieldLabel>
        <Select items={choices} value={draft.outcome} disabled={disabled || pending} onValueChange={value => update({ outcome: value as Outcome | null })}>
          <SelectTrigger id={id} className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent alignItemWithTrigger={false}>{choices.map(choice => <SelectItem key={choice.value ?? "none"} value={choice.value} disabled={choice.value === "verified" && fileBlocked}>{choice.label}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      {section.items.map(item => {
        const key = reviewSubjectKey(item.subject), label = item.label;
        const fallback = label?.kind === "document" ? t("documentNumber", { number: format.number(label.positionInList + 1) }) : label?.kind === "certificate" ? t("certificateNumber", { number: format.number(label.positionInList + 1) }) : t("file");
        return <Field key={key} className="min-w-0"><FieldLabel htmlFor={`${id}-${key}`}>{reviewItemTitle(label, locale, fallback)}</FieldLabel>
          <p className="text-xs text-muted-foreground">{t(item.subject.kind === "file" ? "optionalFileDecision" : "requiredItemDecision")}</p>
          <Select items={choices} value={draft.items[key] ?? null} disabled={disabled || pending} onValueChange={value => update({ items: { ...current.current.items, [key]: value as Outcome | null } })}>
            <SelectTrigger id={`${id}-${key}`} className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent alignItemWithTrigger={false}>{choices.map(choice => <SelectItem key={choice.value ?? "none"} value={choice.value} disabled={choice.value === "verified" && unverifiable.has(key)}>{choice.label}</SelectItem>)}</SelectContent>
          </Select>
          {item.decision && <p className="text-xs text-muted-foreground">{t(`outcome.${item.decision.outcome}`)} · {format.dateTime(item.decision.decidedAt)}</p>}
        </Field>;
      })}
      <Field className="min-w-0"><FieldLabel htmlFor={`${id}-comment`}>{t("sectionComment")}</FieldLabel>
        <Textarea id={`${id}-comment`} className="min-w-0" rows={5} maxLength={10000} value={draft.comment} disabled={disabled || pending} onChange={event => update({ comment: event.target.value })} />
        <p className="text-xs text-muted-foreground">{t("oneCommentHint")}</p>
      </Field>
      {failure !== null && <ReviewFailure error={failure} />}
      {stale && <div className="space-y-2"><p role="status" className="text-sm">{t("reloadPreservesIntent")}</p><Button type="button" variant="outline" disabled={pending} onClick={() => void refresh()}>{t("reload")}</Button></div>}
      {rebased && <p role="status" className="text-sm text-muted-foreground">{t("rebased")}</p>}
      {remote && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{t("currentSavedDecision")}</summary><p className="mt-3 whitespace-pre-wrap break-words text-sm">{remote.decision ? `${t(`outcome.${remote.decision.outcome}`)}\n${remote.decision.comment ?? ""}` : t("decisionMissing")}</p></details>}
      <Button type="submit" disabled={disabled || pending || stale || !dirty}>{pending ? t("saving") : t("saveDecision")}</Button>
    </form>}
  </section>;
}
