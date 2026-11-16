import { can, QUEUE_STATUSES, type ReviewAssignmentMetadata, type ReviewOperationalQueueItem, type ReviewQueueFilter } from "@imbc/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { useTranslations } from "use-intl";
import { PageTitle } from "@/components/app/page-title";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { useMe } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { reviewKeys, reviewsApi } from "./api";
import { reviewParams, reviewQuery } from "./params";
import { ReviewFailure } from "./feedback";
import { ReviewAssignmentDialog } from "./assignment-dialog";

export function ReviewQueuePage({ admin = false }: { admin?: boolean }) {
  const t = useTranslations("reviewWorkflow"), profile = useTranslations("profile"), old = useTranslations("reviews");
  const format = useFormat(), me = useMe().data?.user, client = useQueryClient(), location = useLocation();
  const allowed = me?.role === (admin ? "administrator" : "expert") && can(me.role, admin ? "review.assign" : "review.take") !== null;
  const [search, setSearch] = useSearchParams(), parsed = reviewParams(search, admin), filters = parsed.value;
  const query = reviewQuery(filters, admin), urlKey = search.toString();
  const [q, setQ] = useState(filters.q ?? ""), [statuses, setStatuses] = useState(filters.status ?? []), [assignees, setAssignees] = useState(filters.assignee ?? []);
  const [from, setFrom] = useState(filters.receivedFrom ?? ""), [to, setTo] = useState(filters.receivedTo ?? ""), [invalid, setInvalid] = useState(false);
  const [selected, setSelected] = useState<ReviewAssignmentMetadata | null>(null);
  const [previousUrl, setPreviousUrl] = useState(urlKey);
  if (previousUrl !== urlKey) {
    setPreviousUrl(urlKey);
    const current = reviewParams(new URLSearchParams(urlKey), admin).value;
    setQ(current.q ?? ""); setStatuses(current.status ?? []); setAssignees(current.assignee ?? []);
    setFrom(current.receivedFrom ?? ""); setTo(current.receivedTo ?? ""); setInvalid(false);
  }
  const result = useQuery({ queryKey: [...reviewKeys.queue(admin, query), me?.id], enabled: allowed && parsed.valid,
    queryFn: ({ signal }) => admin ? reviewsApi.assignments(query, signal) : reviewsApi.queue(query, signal), placeholderData: keepPreviousData });
  const experts = useQuery({ queryKey: ["review-workflow", "experts", admin], enabled: allowed,
    queryFn: ({ signal }) => reviewsApi.experts(admin, signal) });
  const take = useMutation({ mutationFn: reviewsApi.take, retry: false, onSuccess: () => client.invalidateQueries({ queryKey: reviewKeys.queues }) });
  const title = admin ? t("assignmentTitle") : old("title");
  const change = (next: ReviewQueueFilter) => setSearch(reviewQuery(next, admin));
  function apply() {
    const next = new URLSearchParams({ q, status: statuses.join(","), assignee: assignees.join(","), receivedFrom: from, receivedTo: to,
      offset: "0", limit: String(filters.limit) });
    const checked = reviewParams(next, admin);
    if (!checked.valid) { setInvalid(true); return; }
    setInvalid(false); change(checked.value);
  }
  const count = result.data?.total ?? 0, pages = Math.max(1, Math.ceil(count / filters.limit));
  useEffect(() => {
    if (result.data && !result.isFetching && filters.offset >= count && filters.offset > 0)
      change({ ...filters, offset: count ? Math.floor((count - 1) / filters.limit) * filters.limit : 0 });
  });
  return <div className="mx-auto flex max-w-7xl flex-col gap-4">
    <PageTitle title={title} /><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
    {!allowed ? <ReviewFailure error={new ApiError(403, "forbidden", "")} /> : <>
      <Card><CardContent className="pt-4">
        <form className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={event => { event.preventDefault(); apply(); }}>
          <Field><FieldLabel htmlFor="review-name-filter">{old("manufacturer")}</FieldLabel>
            <Input id="review-name-filter" value={q} maxLength={200} onChange={event => setQ(event.target.value)} /></Field>
          <details className="min-w-0 rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{old("statusFilter")}</summary>
            <fieldset className="mt-3 space-y-3"><legend className="sr-only">{old("statusFilter")}</legend>
              {QUEUE_STATUSES.map(status => <Field key={status} orientation="horizontal"><Checkbox id={`review-status-${status}`} checked={statuses.includes(status)}
                onCheckedChange={checked => setStatuses(current => checked ? [...current, status] : current.filter(value => value !== status))} />
                <FieldLabel htmlFor={`review-status-${status}`}>{status === "pending_changes" ? old("pendingChanges") : profile(`statusValue.${status}`)}</FieldLabel></Field>)}
            </fieldset>
          </details>
          <details className="min-w-0 rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{old("assignee")}</summary>
            <fieldset className="mt-3 space-y-3"><legend className="sr-only">{old("assignee")}</legend>
              {[{ id: "unassigned", label: old("unassigned") }, ...(experts.data ?? [])].map(expert => <Field key={expert.id} orientation="horizontal">
                <Checkbox id={`review-expert-${expert.id}`} checked={assignees.includes(expert.id)} onCheckedChange={checked => setAssignees(current => checked ? [...current, expert.id] : current.filter(value => value !== expert.id))} />
                <FieldLabel className="break-words" htmlFor={`review-expert-${expert.id}`}>{expert.label}</FieldLabel></Field>)}
            </fieldset>
            {experts.isPending && <Skeleton className="mt-2 h-5 w-full" />}
            {experts.isError && <ReviewFailure error={experts.error} retry={() => void experts.refetch()} />}
          </details>
          {!admin && <div className="grid min-w-0 grid-cols-2 gap-2"><Field><FieldLabel htmlFor="review-received-from">{t("receivedFrom")}</FieldLabel>
            <Input id="review-received-from" type="date" value={from} onChange={event => setFrom(event.target.value)} /></Field>
            <Field><FieldLabel htmlFor="review-received-to">{t("receivedTo")}</FieldLabel>
              <Input id="review-received-to" type="date" value={to} onChange={event => setTo(event.target.value)} /></Field></div>}
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4"><Button type="submit">{t("applyFilters")}</Button>
            <Button type="button" variant="outline" onClick={() => { setInvalid(false); setSearch(""); }}>{t("clearFilters")}</Button>
          </div>
        </form>
        {(invalid || !parsed.valid) && <p role="alert" className="mt-3 text-sm text-destructive">{t("invalidFilters")}</p>}
      </CardContent></Card>
      {take.isError && <ReviewFailure error={take.error} retry={() => void result.refetch()} />}
      {result.isError ? <ReviewFailure error={result.error} retry={() => void result.refetch()} /> : parsed.valid && <>
        {result.data && <p role="status" className="text-sm text-muted-foreground">{old("found", { count, total: format.number(count) })}</p>}
        <div className={cn("rounded-lg border", result.isFetching && "opacity-70")} aria-busy={result.isFetching}>
          <Table><TableHeader><TableRow><TableHead>{old("manufacturer")}</TableHead><TableHead>{old("status")}</TableHead>
            <TableHead>{old("assignee")}</TableHead>{!admin && <TableHead>{t("receivedAt")}</TableHead>}</TableRow></TableHeader>
            <TableBody>{result.isPending && Array.from({ length: 4 }, (_, index) => <TableRow key={index}><TableCell colSpan={admin ? 3 : 4}><Skeleton className="h-6 w-full" /></TableCell></TableRow>)}
              {result.data?.items.map(item => <TableRow key={item.profileId}>
                <TableCell><p className="max-w-sm whitespace-pre-wrap break-words font-medium">{item.organizationName}</p>
                  {!admin && <p className="font-mono text-xs text-muted-foreground">{(item as ReviewOperationalQueueItem).bin ?? "—"}</p>}
                  {item.unresolved ? <p className="mt-2 max-w-sm whitespace-normal text-sm text-muted-foreground">{t("unresolved")}</p> : <div className="mt-2 flex flex-wrap gap-2">
                    {admin ? <Button size="sm" variant="outline" disabled={result.isFetching || take.isPending} onClick={() => setSelected(item)}>{item.assignedExpertId ? t("reassign") : t("assign")}</Button>
                      : item.assignedExpertId === null ? <Button size="sm" variant="outline" disabled={result.isFetching || take.isPending} onClick={() => item.assignmentId && take.mutate(item.assignmentId)}>{take.isPending && take.variables === item.assignmentId ? t("taking") : t("take")}</Button>
                        : item.assignedExpertId === me?.id && !result.isFetching ? <Link className={cn(buttonVariants({ size: "sm", variant: "outline" }))} to={`/reviews/assignments/${item.assignmentId}`} state={{ from: `${location.pathname}${location.search}` }}>{t("openReview")}</Link> : null}
                  </div>}
                  {!admin && !item.unresolved && <Link className={cn(buttonVariants({ size: "sm", variant: "outline" }), "mt-2")} to={`/imbc/profiles/${item.profileId}/due-diligence`} state={{ from: `${location.pathname}${location.search}` }}>{t("openDiligence")}</Link>}
                </TableCell>
                <TableCell><Badge variant="secondary">{item.status === "verified" && item.hasPendingChanges ? old("pendingChanges") : profile(`statusValue.${item.status}`)}</Badge></TableCell>
                <TableCell className="max-w-sm whitespace-pre-wrap break-words">{item.assignedExpert ?? old("unassigned")}</TableCell>
                {!admin && <TableCell>{(item as ReviewOperationalQueueItem).receivedAt ? format.date((item as ReviewOperationalQueueItem).receivedAt) : t("receivedUnknown")}</TableCell>}
              </TableRow>)}
            </TableBody>
          </Table>
          {result.data?.items.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>}
        </div>
        {result.data && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{t("page", { page: format.number(Math.floor(filters.offset / filters.limit) + 1), pages: format.number(pages) })}</p>
          <div className="flex flex-wrap items-center gap-2"><Select items={[25, 50, 100].map(value => ({ value: String(value), label: format.number(value) }))} value={String(filters.limit)} onValueChange={value => value && change({ ...filters, offset: 0, limit: Number(value) })}>
            <SelectTrigger aria-label={t("pageSize")}><SelectValue /></SelectTrigger><SelectContent alignItemWithTrigger={false}>{[25, 50, 100].map(value => <SelectItem key={value} value={String(value)}>{format.number(value)}</SelectItem>)}</SelectContent></Select>
            <Button variant="outline" disabled={result.isFetching || filters.offset === 0} onClick={() => change({ ...filters, offset: Math.max(0, filters.offset - filters.limit) })}>{t("previous")}</Button>
            <Button variant="outline" disabled={result.isFetching || filters.offset + filters.limit >= count} onClick={() => change({ ...filters, offset: filters.offset + filters.limit })}>{t("next")}</Button>
          </div></div>}
      </>}
      {selected?.assignmentId && <ReviewAssignmentDialog key={selected.assignmentId} item={selected} experts={experts.data ?? []} close={() => setSelected(null)} reload={() => reviewsApi.assignment(selected.assignmentId!)} saved={() => { setSelected(null); void client.invalidateQueries({ queryKey: reviewKeys.queues }); }} />}
    </>}
  </div>;
}
