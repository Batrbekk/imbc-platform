import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';
import { PageTitle } from '@/components/app/page-title';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel } from '@/components/ui/field';
import { Card, CardContent } from '@/components/ui/card';
import { useFormat } from '@/i18n/format';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/session';
import { cn } from '@/lib/utils';
import { readSurveyRequests, surveyKeys } from './api';
import { SurveyFailure } from './feedback';
import { SurveyPaging } from './paging';
import { surveyParams, surveyQuery } from './params';

export function SurveyRequestsPage() {
  const me = useMe(), t = useTranslations('siteSurvey');
  if (me.isPending) return <p role="status">{t('loading')}</p>;
  if (me.isError) return <SurveyFailure error={me.error} retry={() => void me.refetch()} />;
  if (!me.data || me.data.user.role !== 'expert') return <SurveyFailure error={new ApiError(403, 'forbidden', '')} />;
  return <RequestQueue key={me.data.user.id} actorId={me.data.user.id} />;
}
function RequestQueue({ actorId }: { actorId: string }) {
  const t = useTranslations('siteSurvey'), format = useFormat(), [search, setSearch] = useSearchParams(), location = useLocation(), parsed = surveyParams(search, true);
  const value = parsed.value as { offset: number; limit: number; name?: string; profileId?: string }, query = surveyQuery(value);
  const sourceName = value.name ?? '', [draftName, setName] = useState({ source: sourceName, value: sourceName });
  const name = draftName.source === sourceName ? draftName.value : sourceName;
  const requests = useQuery({ queryKey: surveyKeys.requests(actorId, query), queryFn: ({ signal }) => readSurveyRequests(query, undefined, signal), enabled: parsed.valid,
    placeholderData: keepPreviousData, staleTime: 0, gcTime: 0 });
  function change(offset: number) { const next = new URLSearchParams(search); next.set('offset', String(offset)); next.set('limit', String(value.limit)); setSearch(next); }
  useEffect(() => { if (requests.data && !requests.isPlaceholderData && !requests.isFetching && value.offset > 0 && value.offset >= requests.data.total) {
    const next = new URLSearchParams(search); next.set('offset', String(requests.data.total ? Math.floor((requests.data.total - 1) / value.limit) * value.limit : 0)); setSearch(next);
  } }, [requests.data, requests.isPlaceholderData, requests.isFetching, value.offset, value.limit, search, setSearch]);
  return <div className="mx-auto flex max-w-5xl flex-col gap-5"><PageTitle title={t('requestsTitle')} /><h1 className="text-2xl font-semibold">{t('requestsTitle')}</h1><p className="text-sm text-muted-foreground">{t('requestsHint')}</p>
    <form className="flex min-w-0 flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); const next = new URLSearchParams(search); next.set('offset', '0');
      if (name.trim()) next.set('name', name.trim()); else next.delete('name'); setSearch(next); }}>
      <Field className="min-w-0 flex-1"><FieldLabel htmlFor="survey-request-name">{t('manufacturerName')}</FieldLabel><Input id="survey-request-name" className="min-w-0" maxLength={200} value={name} onChange={event => setName({ source: sourceName, value: event.target.value })} /></Field><Button type="submit">{t('search')}</Button>
      <Button variant="outline" type="button" onClick={() => { setName({ source: sourceName, value: '' }); setSearch({ offset: '0', limit: String(value.limit) }); }}>{t('resetFilters')}</Button>
    </form>
    {!parsed.valid ? <SurveyFailure error="invalid_filters" /> : <>
      {requests.isPending && <p role="status">{t('loading')}</p>}{requests.isError && <SurveyFailure error={requests.error} retry={() => void requests.refetch()} />}
      {requests.data && !requests.isError && <>{!requests.data.items.length && !requests.isFetching && <p className="text-sm text-muted-foreground">{t(value.name || value.profileId ? 'noMatchingRequests' : 'noRequests')}</p>}
        <div className="min-w-0 space-y-3">{requests.data.items.map(row => <Card key={row.id} className="min-w-0"><CardContent className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1"><h2 className="whitespace-pre-wrap wrap-anywhere font-medium">{row.organizationName}</h2><p className="text-sm text-muted-foreground">{t('requestedAt')}: {format.dateTime(row.requestedAt)}</p></div>
          <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-auto max-w-full whitespace-normal')} to={`/imbc/profiles/${row.profileId}/site-surveys`} state={{ from: `${location.pathname}${location.search}` }}>{t('openSurveys')}</Link>
        </CardContent></Card>)}</div>
        <SurveyPaging offset={value.offset} limit={value.limit} total={requests.data.total} disabled={requests.isFetching} change={change} />
      </>}
    </>}
  </div>;
}
