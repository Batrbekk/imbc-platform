import { ownProfileSchema, type OwnProfile, type SiteSurveyRequestRead } from '@imbc/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UnsavedDialog } from '@/features/profile/unsaved-dialog';
import { useFormat } from '@/i18n/format';
import { api, ApiError } from '@/lib/api';
import { useMe } from '@/lib/session';
import { readSurveyRequests, requestSurvey, surveyKeys } from './api';
import { SurveyFailure } from './feedback';
import { surveyAuthorityLost } from './scope';
import { SurveyPaging } from './paging';

export function SurveyOwnRequestCard({ currentProfile }: { currentProfile?: OwnProfile } = {}) {
  const me = useMe();
  if (!me.data || me.data.user.role !== 'manufacturer') return null;
  return <OwnRequest key={me.data.user.id} actorId={me.data.user.id} organizationId={me.data.user.organizationId} currentProfile={currentProfile} />;
}
function OwnRequest({ actorId, organizationId, currentProfile }: { actorId: string; organizationId: string; currentProfile?: OwnProfile }) {
  const t = useTranslations('siteSurvey'), format = useFormat(), [open, setOpen] = useState(false), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [failure, setFailure] = useState<unknown>(null), [barrier, setBarrier] = useState(false), [ack, setAck] = useState<SiteSurveyRequestRead | null>(null), [intentId, setIntentId] = useState<string | null>(null), [keyConflict, setKeyConflict] = useState(false), [offset, setOffset] = useState(0);
  const busy = useRef(false), mounted = useRef(true), focus = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (pending || uncertain) && currentLocation.pathname !== nextLocation.pathname);
  const supplied = ownProfileSchema.safeParse(currentProfile);
  const profile = useQuery({ queryKey: ['profile', 'own', actorId, 'survey-request'], queryFn: async () => ownProfileSchema.parse(await api('/v1/profiles/own')), enabled: !barrier,
    initialData: supplied.success ? supplied.data : undefined, refetchOnMount: !supplied.success, staleTime: 0, gcTime: 0 });
  const profileId = profile.data?.profileId;
  const currentVerified = currentProfile === undefined || currentProfile.status === 'verified' && currentProfile.profileId === profileId;
  const requests = useQuery({ queryKey: surveyKeys.requests(actorId, `offset=${offset}&limit=50`, profileId), enabled: !!profileId && profile.data?.status === 'verified' && currentVerified && !profile.isError && !barrier,
    queryFn: async ({ signal }) => {
      const rows = await readSurveyRequests(`offset=${offset}&limit=50`, profileId!, signal);
      if (rows.items.some(row => row.organizationId !== organizationId)) throw new Error('survey_request_tenant'); return rows;
    }, staleTime: 0, gcTime: 0 });
  const allowed = profile.data?.status === 'verified' && currentVerified
    && !profile.isFetching && !profile.isError && !requests.isFetching && !requests.isError && !barrier;
  async function submit() {
    if (!allowed || !profileId || busy.current || !intentId || keyConflict) return;
    busy.current = true; setPending(true); setFailure(null);
    try {
      const result = await requestSurvey(profileId, intentId);
      if (result.organizationId !== organizationId || result.requestedBy !== actorId) throw new Error('survey_request_actor');
      if (mounted.current) { setAck(result); setUncertain(false); setIntentId(null); setOpen(false); setOffset(0); if (offset === 0) void requests.refetch(); }
    } catch (error) { if (mounted.current) { setFailure(error); if (surveyAuthorityLost(error) || error instanceof ApiError && error.code === 'site_survey_request_requires_verified') setBarrier(true);
      if (error instanceof ApiError && error.code === 'conflict') setKeyConflict(true);
      setUncertain(!(error instanceof ApiError) || error.status >= 500); } }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function reload() {
    if (busy.current) return; busy.current = true; setPending(true);
    try {
      const fresh = await profile.refetch({ throwOnError: true });
      if (fresh.data?.status !== 'verified' || fresh.data.profileId !== profileId) throw new ApiError(403, 'forbidden', '');
      const rows = await readSurveyRequests(`offset=${offset}&limit=50`, fresh.data.profileId);
      if (rows.items.some(row => row.organizationId !== organizationId)) throw new Error('survey_request_tenant');
      if (mounted.current) { setBarrier(false); setFailure(null); } return true;
    } catch (error) { if (mounted.current) { setFailure(error); setBarrier(true); } return false; }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function resetIntent() {
    const authorized = await reload();
    if (authorized && mounted.current && !busy.current) { setIntentId(crypto.randomUUID()); setKeyConflict(false); setUncertain(false); }
  }
  return <><Card className="min-w-0"><CardHeader><CardTitle>{t('requestTitle')}</CardTitle></CardHeader><CardContent className="min-w-0 space-y-4">
    <p className="text-sm text-muted-foreground">{t('requestHint')}</p>
    {profile.isPending && <p role="status">{t('loading')}</p>}
    {requests.isPending && profile.data?.status === 'verified' && !barrier && <p role="status">{t('loading')}</p>}
    {profile.isError && <SurveyFailure error={profile.error} retry={() => void profile.refetch()} />}
    {profile.data && (profile.data.status !== 'verified' || !currentVerified) && <p className="text-sm">{t('requestVerifiedOnly')}</p>}
    {requests.isError && !barrier && <SurveyFailure error={requests.error} retry={() => void requests.refetch()} />}
    {failure !== null && !open && <SurveyFailure error={failure} context="operation" />}
    {uncertain && <p role="status" className="text-sm">{t('requestRetryHint')}</p>}
    {ack && profile.data?.status === 'verified' && currentVerified && !barrier && <p role="status" className="text-sm">{t('requestSaved', { date: format.dateTime(ack.requestedAt) })}</p>}
    {requests.data && profile.data?.status === 'verified' && currentVerified && !profile.isError && !barrier && <><ul className="space-y-2 text-sm">{requests.data.items.map(row => <li key={row.id}>{t('requestedAt')}: {format.dateTime(row.requestedAt)}</li>)}</ul>
      {!requests.data.items.length && <p className="text-sm text-muted-foreground">{t('noRequests')}</p>}
      <SurveyPaging offset={offset} limit={50} total={requests.data.total} disabled={pending || requests.isFetching || open} change={setOffset} /></>}
    <div className="flex flex-wrap gap-2"><Button disabled={!allowed || pending} onClick={event => { if (!intentId) setIntentId(crypto.randomUUID()); focus.current = event.currentTarget; setOpen(true); }}>{t(intentId ? 'resumeRequest' : ack ? 'anotherRequest' : 'requestSurvey')}</Button>
      {barrier && <Button variant="outline" disabled={pending} onClick={() => void reload()}>{t('reloadAccess')}</Button>}</div>
  </CardContent></Card>
    {open && <Dialog open onOpenChange={next => { if (!next && !busy.current) setOpen(false); }}><DialogContent finalFocus={focus} showCloseButton={false} className="min-w-0 grid-cols-[minmax(0,1fr)]">
      <DialogHeader><DialogTitle>{t('confirmRequest')}</DialogTitle><DialogDescription>{t('requestHint')}</DialogDescription></DialogHeader>
      {failure !== null && <SurveyFailure error={failure} context="operation" />}{uncertain && <p role="status">{t('requestRetryHint')}</p>}
      <DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>{t('close')}</Button>
        {barrier ? <Button disabled={pending} onClick={() => void reload()}>{t('reloadAccess')}</Button> : keyConflict ? <Button disabled={pending} onClick={() => void resetIntent()}>{t('startNewRequest')}</Button> : <Button disabled={!allowed || pending} onClick={() => void submit()}>{t(pending ? 'sendingRequest' : uncertain ? 'retryRequest' : 'sendRequest')}</Button>}
      </DialogFooter>
    </DialogContent></Dialog>}
    <UnsavedDialog open={blocker.state === 'blocked'} stay={() => { if (blocker.state === 'blocked') blocker.reset(); }} leave={() => { if (blocker.state === 'blocked') blocker.proceed(); }} />
  </>;
}
