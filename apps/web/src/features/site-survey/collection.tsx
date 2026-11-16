import type { SiteSurveyRecordView } from '@imbc/contracts';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';
import { PageTitle } from '@/components/app/page-title';
import { Button, buttonVariants } from '@/components/ui/button';
import { useMe } from '@/lib/session';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { readSurvey, readSurveys, surveyKeys } from './api';
import { SurveyEditor } from './editor';
import { SurveyFailure } from './feedback';
import { SurveyHistory } from './history';
import { SurveyPaging } from './paging';
import { surveyParams, surveyQuery, surveyReturn } from './params';
import { SurveyRecord } from './record';
import { surveyAuthorityLost } from './scope';
import { SurveySummary } from './summary';

export function SurveyPage({ profileId }: { profileId: string }) {
  const me = useMe(), t = useTranslations('siteSurvey');
  if (me.isPending) return <p role="status">{t('loading')}</p>;
  if (me.isError) return <SurveyFailure error={me.error} retry={() => void me.refetch()} />;
  if (!me.data || !['expert', 'director'].includes(me.data.user.role)) return <SurveyFailure error={new ApiError(403, 'forbidden', '')} />;
  return <SurveyCollection key={`${profileId}:${me.data.user.id}:${me.data.user.role}`} profileId={profileId} actorId={me.data.user.id} expert={me.data.user.role === 'expert'} />;
}
function SurveyCollection({ profileId, actorId, expert }: { profileId: string; actorId: string; expert: boolean }) {
  const t = useTranslations('siteSurvey'), client = useQueryClient(), [search, setSearch] = useSearchParams(), location = useLocation();
  const back = surveyReturn(location.state?.from, profileId, expert);
  const params = surveyParams(search), { offset, limit } = params.value;
  const [authority, setAuthority] = useState<unknown>(null), [opening, setOpening] = useState(false), [openingError, setOpeningError] = useState<unknown>(null);
  const [editor, setEditor] = useState<{ initial: SiteSurveyRecordView | null } | null>(null), [history, setHistory] = useState<string | null>(null), [ack, setAck] = useState<SiteSurveyRecordView | null>(null);
  const focus = useRef<HTMLButtonElement | null>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const loseAuthority = useCallback((error: unknown) => {
    if (!surveyAuthorityLost(error)) return; setAuthority(error);
    void client.invalidateQueries({ queryKey: ['site-surveys', profileId, actorId], refetchType: 'none' });
  }, [actorId, client, profileId, setAuthority]);
  const list = useQuery({ queryKey: surveyKeys.list(profileId, actorId, offset, limit), queryFn: async ({ signal }) => {
    try { return await readSurveys(profileId, surveyQuery({ offset, limit }), signal); } catch (error) { loseAuthority(error); throw error; }
  }, enabled: params.valid && authority === null, placeholderData: keepPreviousData, staleTime: 0, gcTime: 0 });
  const canEdit = expert && list.data?.canEdit === true && !list.isError && !list.isFetching && !list.isPlaceholderData && authority === null;
  const change = useCallback((nextOffset: number) => { const next = new URLSearchParams(search); next.set('offset', String(nextOffset)); next.set('limit', String(limit)); setSearch(next); }, [limit, search, setSearch]);
  useEffect(() => { if (list.data && !list.isPlaceholderData && !list.isFetching && offset > 0 && offset >= list.data.total)
    change(list.data.total ? Math.floor((list.data.total - 1) / limit) * limit : 0); }, [list.data, list.isPlaceholderData, list.isFetching, offset, limit, change]);
  async function freshAccess() {
    const fresh = await readSurveys(profileId, surveyQuery({ offset, limit }));
    if (!expert || !fresh.canEdit) throw new ApiError(403, 'forbidden', '');
    client.setQueryData(surveyKeys.list(profileId, actorId, offset, limit), fresh); return fresh;
  }
  async function reload(recordId: string) {
    try {
      const fresh = await freshAccess(), row = await readSurvey(profileId, recordId);
      if (row.organizationId !== fresh.organizationId || row.needsReconciliation) throw new ApiError(403, 'forbidden', '');
      if (mounted.current) setAuthority(null); return row;
    } catch (error) { loseAuthority(error); throw error; }
  }
  async function reloadAccess() {
    try { await freshAccess(); if (mounted.current) setAuthority(null); } catch (error) { loseAuthority(error); throw error; }
  }
  async function openEdit(row: SiteSurveyRecordView, trigger: HTMLButtonElement) {
    if (!canEdit || opening || editor || history || row.needsReconciliation) return;
    focus.current = trigger; setOpening(true); setOpeningError(null);
    try { const latest = await reload(row.id); if (mounted.current) setEditor({ initial: latest }); }
    catch (error) { if (mounted.current) setOpeningError(error); }
    finally { if (mounted.current) setOpening(false); }
  }
  return <div className="mx-auto flex max-w-5xl flex-col gap-5">
    <PageTitle title={t('title')} /><div className="flex min-w-0 flex-wrap items-start justify-between gap-3"><h1 className="wrap-anywhere text-2xl font-semibold">{t('title')}</h1>
      {expert && <Button disabled={!canEdit || opening || !!editor || !!history} onClick={event => { focus.current = event.currentTarget; setAck(null); setEditor({ initial: null }); }}>{t('newRecord')}</Button>}</div>
    <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-auto w-fit max-w-full whitespace-normal')} to={back.to}>{t(back.label)}</Link>
    {!params.valid ? <><SurveyFailure error="invalid_filters" /><Button variant="outline" onClick={() => setSearch({ offset: '0', limit: '50' })}>{t('resetFilters')}</Button></> : <>
      {list.isPending && authority === null && <p role="status">{t('loading')}</p>}
      {authority !== null && <SurveyFailure error={authority} retry={() => { if (!editor) { setAuthority(null); void list.refetch(); } }} />}
      {list.isError && authority === null && <SurveyFailure error={list.error} retry={() => void list.refetch()} />}
      {openingError !== null && authority === null && <SurveyFailure error={openingError} />}
      {ack && authority === null && <details className="min-w-0 rounded-lg border p-3"><summary className="cursor-pointer font-medium">{t('recordSaved')}</summary><div className="mt-3"><SurveyRecord record={ack} /></div></details>}
      {list.data && authority === null && <><h2 className="whitespace-pre-wrap wrap-anywhere text-lg font-medium">{list.data.organizationName}</h2><SurveySummary summary={list.data.summary} tier={list.data.tier} />
        <p className="text-sm text-muted-foreground">{t(expert && !list.data.canEdit ? 'readOnlyAccess' : 'collectionHint')}</p>
        {!list.data.items.length && !list.isFetching && <p className="text-sm text-muted-foreground">{t('noRecords')}</p>}
        <div className="min-w-0 space-y-5">{list.data.items.map(row => <section key={row.id} className="min-w-0 space-y-3">
          <SurveyRecord record={row} selected={list.data.summary.currentSurveyId === row.id} />
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={list.isFetching || !!editor || !!history || opening} onClick={event => { focus.current = event.currentTarget; setHistory(row.id); }}>{t('history')}</Button>
            {expert && !row.needsReconciliation && <Button variant="outline" disabled={!canEdit || !!editor || !!history || opening} onClick={event => void openEdit(row, event.currentTarget)}>{t('editRecord')}</Button>}
          </div></section>)}</div>
        <SurveyPaging offset={offset} limit={limit} total={list.data.total} disabled={list.isFetching || !!editor || !!history || opening} change={change} />
      </>}
    </>}
    {editor && <SurveyEditor key={editor.initial?.id ?? 'new'} profileId={profileId} actorId={actorId} initial={editor.initial} disabled={authority !== null || !expert || !list.data?.canEdit}
      close={() => setEditor(null)} saved={row => { setAck(row); setEditor(null); void client.invalidateQueries({ queryKey: ['site-surveys', profileId, actorId] }); }}
      reload={reload} reloadAccess={reloadAccess} authorityLost={loseAuthority} finalFocus={focus} />}
    {history && authority === null && <SurveyHistory profileId={profileId} recordId={history} actorId={actorId} close={() => setHistory(null)} finalFocus={focus} authorityLost={loseAuthority} />}
  </div>;
}
