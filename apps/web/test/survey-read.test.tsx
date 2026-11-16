import { ROLES, type SiteSurveyCurrentReport } from '@imbc/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Link } from 'react-router';
import { SurveyPage } from '@/features/site-survey/collection';
import { SurveyCompanyReport } from '@/features/site-survey/company-report';
import { SurveyRequestsPage } from '@/features/site-survey/requests';
import { SurveyReport } from '@/features/site-survey/report';
import { CompanyPage } from '@/routes/app/company';
import { renderRoute } from './support/render';
import { REVIEW_QUEUE, stubReview } from './support/review-workflow';
import en from '../messages/en.json';
import { file, list, messages, mount, NEW_TIME, PATH, PROFILE, record, RECORD, request, stubSurvey, TIME, URL, uuid } from './support/survey';

const company = { profileId: PROFILE, bin: '000100000001', nameEn: 'Demo public company', nameRu: 'Demo public company', region: 'Demo region', commodityGroups: [], tnvedCodes: [], mainTnved: null, headcountTotal: null,
  certificates: [], siteSurveyed: false, tier: 'tier_1', unifiedRegister: false, worksWithCount: 0, updateStatus: 'active', pendingChanges: false, verifiedAt: NEW_TIME, companyPhone: null, companyEmail: null };

describe('Site Survey exact read projections', () => {
  it.each(['en', 'ru', 'kk'] as const)('the %s SME queue opens surveys for a non-catalogued unresolved profile independently of its review assignment', async locale => {
    const item = { ...REVIEW_QUEUE.items[0]!, profileId: PROFILE, organizationName: 'Survey hidden queue company', assignmentId: null, assignedExpertId: null, assignedExpert: null, receivedAt: null, unresolved: true };
    const api = stubReview('expert', { 'GET /api/v1/reviews/queue': { body: { items: [item], total: 1, offset: 0, limit: 25 } },
      [`GET ${PATH}`]: { body: list({ profileStatus: 'submitted' }) } });
    const origin = '/reviews?q=Survey&status=submitted&assignee=unassigned&offset=0&limit=25';
    const { user, router } = renderRoute(origin, { locale }); await screen.findByText(item.organizationName);
    const link = screen.getByRole('link', { name: messages[locale].openSurveys }); expect(link.getAttribute('href')).toBe(URL);
    await user.click(link); await screen.findByText('Demo original survey comment'); expect(router.state.location.pathname).toBe(URL);
    expect(api.mock.calls.some(([url]) => String(url).includes('/catalog/companies/') || String(url).includes('/due-diligence'))).toBe(false);
    expect(api.mock.calls.some(([url]) => String(url).startsWith(PATH))).toBe(true);
    const back = screen.getByRole('link', { name: messages[locale].backToQueue }); expect(back.getAttribute('href')).toBe(origin);
    await user.click(back); await screen.findByText(item.organizationName);
    expect(router.state.location.pathname + router.state.location.search).toBe(origin);
  });
  it.each(['en', 'ru', 'kk'] as const)('the %s request queue returns from Survey with the same name and pagination filters', async locale => {
    const api = stubSurvey('expert');
    const origin = `/imbc/site-survey-requests?name=Demo&profileId=${PROFILE}&offset=0&limit=25`;
    const { user, router } = renderRoute(origin, { locale }); await screen.findByText(request().organizationName);
    await user.click(screen.getByRole('link', { name: messages[locale].openSurveys })); await screen.findByText(record().comment!);
    const back = screen.getByRole('link', { name: messages[locale].backToRequests }); expect(back.getAttribute('href')).toBe(origin);
    await user.click(back); await screen.findByRole('heading', { name: messages[locale].requestsTitle });
    expect(router.state.location.pathname + router.state.location.search).toBe(origin);
    expect(api.mock.calls.some(([url]) => String(url).includes('/catalog/companies/'))).toBe(false);
  });
  it.each(['expert', 'director'] as const)('%s returns to a matching company only after entering Survey from that actual company page', async role => {
    stubSurvey(role, { [`GET /api/v1/catalog/companies/${PROFILE}`]: { body: company } }, list({ canEdit: role === 'expert' }));
    const { user, router } = renderRoute(`/companies/${PROFILE}`, { locale: 'en' }); await screen.findByRole('heading', { name: company.nameEn });
    await user.click(screen.getByRole('link', { name: messages.en.openSurveys })); await screen.findByText(record().comment!);
    const back = screen.getByRole('link', { name: messages.en.backToCompany }); expect(back.getAttribute('href')).toBe(`/companies/${PROFILE}`);
    await user.click(back); await screen.findByRole('heading', { name: company.nameEn }); expect(router.state.location.pathname).toBe(`/companies/${PROFILE}`);
  });
  it.each(['expert', 'director'] as const)('%s deep link defaults to its permitted queue without assuming company visibility', async role => {
    const api = stubSurvey(role, {}, list({ canEdit: role === 'expert' })); renderRoute(URL, { locale: 'en' }); await screen.findByText(record().comment!);
    const back = screen.getByRole('link', { name: role === 'expert' ? messages.en.backToQueue : messages.en.backToCatalog });
    expect(back.getAttribute('href')).toBe(role === 'expert' ? '/reviews' : '/catalog');
    expect(screen.queryByRole('link', { name: messages.en.backToCompany })).toBeNull();
    expect(api.mock.calls.some(([url]) => String(url).includes('/catalog/companies/'))).toBe(false);
  });
  it.each([
    'https://outside.invalid/reviews', '//outside.invalid/reviews', '/reviews/assignments/foreign', '/reviews\\?q=Demo',
    '/%72eviews?q=Demo', '/reviews?q=Demo#outside', '/reviews?next=https%3A%2F%2Foutside.invalid', '/reviews?q=A&q=B',
    '/reviews?offset=NaN', `/companies/${uuid(999)}`, `/companies/${PROFILE}?next=/companies/${uuid(999)}`,
    '/imbc/site-survey-requests?offset=NaN', '/imbc/site-survey-requests?name=A&name=B', '/imbc/site-survey-requests/foreign',
    42, null, { from: '/reviews?q=Demo' },
  ])('unsafe or unsupported origin %j falls back to the expert queue', async from => {
    const api = stubSurvey('expert');
    const { user, router } = renderRoute('/survey-origin', { locale: 'en', routes: [
      { path: '/survey-origin', element: <Link to={URL} state={{ from }}>Open fixture Survey</Link> },
      { path: URL, element: <SurveyPage profileId={PROFILE} /> }, { path: '/reviews', element: <h1>Safe review queue</h1> },
    ] });
    await user.click(screen.getByRole('link', { name: 'Open fixture Survey' })); await screen.findByText(record().comment!);
    const back = screen.getByRole('link', { name: messages.en.backToQueue }); expect(back.getAttribute('href')).toBe('/reviews');
    await user.click(back); await screen.findByRole('heading', { name: 'Safe review queue' }); expect(router.state.location.pathname).toBe('/reviews');
    expect(api.mock.calls.some(([url]) => String(url).includes('/catalog/companies/') || String(url).includes('outside.invalid'))).toBe(false);
  });
  it.each(['/reviews?q=Demo', '/imbc/site-survey-requests?name=Demo'])('director does not return to the expert-only origin %s', async from => {
    stubSurvey('director', {}, list({ canEdit: false }));
    const { user } = renderRoute('/survey-origin', { locale: 'en', routes: [
      { path: '/survey-origin', element: <Link to={URL} state={{ from }}>Open fixture Survey</Link> },
      { path: URL, element: <SurveyPage profileId={PROFILE} /> },
    ] });
    await user.click(screen.getByRole('link', { name: 'Open fixture Survey' })); await screen.findByText(record().comment!);
    expect(screen.getByRole('link', { name: messages.en.backToCatalog }).getAttribute('href')).toBe('/catalog');
  });
  it('the administrator metadata queue does not expose a survey link or query', async () => {
    const item = REVIEW_QUEUE.items[0]!;
    const api = stubReview('administrator', { 'GET /api/v1/reviews/assignment-queue': { body: { items: [{ profileId: item.profileId, organizationName: item.organizationName,
      status: item.status, hasPendingChanges: item.hasPendingChanges, assignmentId: item.assignmentId, assignedExpertId: null, assignedExpert: null, unresolved: item.unresolved }], total: 1, offset: 0, limit: 25 } } });
    renderRoute('/admin/reviews', { locale: 'en' }); await screen.findByText(item.organizationName);
    expect(screen.queryByRole('link', { name: messages.en.openSurveys })).toBeNull(); expect(api.mock.calls.some(([url]) => String(url).includes('/site-surveys'))).toBe(false);
  });
  it.each(['expert', 'director'] as const)('the real %s application route reads the exact collection with the existing review routes intact', async role => {
    const api = stubSurvey(role, {}, list({ canEdit: role === 'expert' })); renderRoute(URL, { locale: 'en' });
    await screen.findByRole('heading', { name: messages.en.title }); await screen.findByText('Demo original survey comment');
    expect(api.mock.calls.some(([url]) => String(url) === `${PATH}?offset=0&limit=50`)).toBe(true);
    expect(api.mock.calls.some(([url]) => String(url).includes('/reviews/assignments/') || String(url).includes('/own/sections'))).toBe(false);
  });
  it('the actual director request-list route shows denial without loading requests or displaying its nav link', async () => {
    const api = stubSurvey('director'); renderRoute('/imbc/site-survey-requests', { locale: 'en' }); await screen.findByText(messages.en.errors.forbidden);
    expect(screen.queryByRole('link', { name: en.nav.siteSurveyRequests })).toBeNull(); expect(api.mock.calls.some(([url]) => String(url).includes('site-survey-requests'))).toBe(false);
  });
  it('the SME sidebar opens the real request route and retains the review queue navigation', async () => {
    const api = stubSurvey('expert'); const { user, router } = renderRoute(URL, { locale: 'en' }); await screen.findByText('Demo original survey comment');
    expect(screen.getByRole('link', { name: en.nav.reviews }).getAttribute('href')).toBe('/reviews'); await user.click(screen.getByRole('link', { name: en.nav.siteSurveyRequests }));
    await screen.findByRole('heading', { name: messages.en.requestsTitle }); expect(router.state.location.pathname).toBe('/imbc/site-survey-requests');
    expect(api.mock.calls.some(([url]) => String(url).includes('/v1/site-survey-requests?offset=0&limit=50'))).toBe(true);
  });
  it.each(ROLES)('company survey navigation is exposed only to the allowed %s role and does not fetch Class C content', async role => {
    const api = stubSurvey(role, { [`GET /api/v1/catalog/companies/${PROFILE}`]: { body: { ...company, siteSurvey: { visitStartedOn: '2026-10-01', visitEndedOn: null, expiresOn: null, report: file() } } } });
    renderRoute(`/companies/${PROFILE}`, { locale: 'en', routes: [{ path: '/companies/:profileId', element: <CompanyPage /> }, { path: URL, element: <SurveyPage profileId={PROFILE} /> }] });
    await screen.findByRole('heading', { name: 'Demo public company' });
    if (['expert', 'director'].includes(role)) await screen.findByRole('link', { name: messages.en.openSurveys });
    if (['expert', 'director', 'operator', 'observer'].includes(role)) await screen.findByText(messages.en.companyEvidence);
    const link = screen.queryByRole('link', { name: messages.en.openSurveys }); expect(Boolean(link)).toBe(['expert', 'director'].includes(role));
    expect(Boolean(screen.queryByText(messages.en.companyEvidence))).toBe(['expert', 'director', 'operator', 'observer'].includes(role));
    if (link) expect(link.getAttribute('href')).toBe(URL); expect(api.mock.calls.some(([url]) => String(url).includes('/site-surveys'))).toBe(false);
  });
  it.each(['operator', 'observer'].flatMap(role => (['en', 'ru', 'kk'] as const).map(locale => [role, locale] as const)))(
    'the actual %s company page shows the captured report and dates in %s without full-record queries', async (role, locale) => {
      const api = stubSurvey(role as 'operator' | 'observer', { [`GET /api/v1/catalog/companies/${PROFILE}`]: { body: { ...company, siteSurveyed: true, tier: 'tier_2',
        siteSurvey: { visitStartedOn: '2026-10-01', visitEndedOn: null, expiresOn: null, report: file(11) } } } });
      renderRoute(`/companies/${PROFILE}`, { locale });
      await screen.findByText(messages[locale].companyEvidence);
      const report = within(screen.getByRole('region', { name: messages[locale].report }));
      expect(report.getByText('Demo signed report v11.pdf')).toBeTruthy();
      expect(report.getByRole('link').getAttribute('href')).toBe(`/api/v1/files/${file().fileId}/content?version=11`);
      expect(screen.getByText(messages[locale].noExpiry)).toBeTruthy();
      expect(screen.queryByRole('link', { name: messages[locale].openSurveys })).toBeNull();
      expect(screen.queryByRole('button', { name: messages[locale].newRecord })).toBeNull();
      expect(screen.queryByRole('button', { name: messages[locale].editRecord })).toBeNull();
      expect(screen.queryByRole('button', { name: messages[locale].history })).toBeNull();
      expect(screen.queryByText(messages[locale].result)).toBeNull();
      expect(screen.queryByText(messages[locale].comment)).toBeNull();
      expect(screen.queryByText(messages[locale].recordedBy)).toBeNull();
      expect(api.mock.calls.some(([url]) => /site-surveys|due-diligence|\/profiles\/own|\/files\//.test(String(url)))).toBe(false);
      expect(api.mock.calls.some(([, init]) => init?.method === 'POST' || init?.method === 'PUT')).toBe(false);
    });
  it.each([null, undefined])('an absent current company report (%s) keeps the normal company card without a guessed file', async siteSurvey => {
    const api = stubSurvey('operator', { [`GET /api/v1/catalog/companies/${PROFILE}`]: { body: { ...company, siteSurvey } } });
    renderRoute(`/companies/${PROFILE}`, { locale: 'en' }); await screen.findByRole('heading', { name: company.nameEn });
    expect(screen.queryByText(messages.en.companyEvidence)).toBeNull();
    expect(screen.getAllByRole('link').some(link => link.getAttribute('href')?.includes('/files/'))).toBe(false);
    expect(api.mock.calls.some(([url]) => String(url).includes('/site-surveys'))).toBe(false);
  });
  it.each(ROLES.filter(role => role !== 'expert' && role !== 'director'))('%s does not mount any Class C query', async role => {
    const api = stubSurvey(role); mount(<SurveyPage profileId={PROFILE} />); await screen.findByText(messages.en.errors.forbidden);
    expect(api.mock.calls.some(([url]) => String(url).includes('/site-surveys'))).toBe(false);
  });
  it.each(['en', 'ru', 'kk'] as const)('%s director sees multiple records, server-selected older eligible visit and no mutations', async locale => {
    const newerNo = record({ id: uuid(105), visitStartedOn: '2026-11-15', result: 'no', comment: 'Demo later no result' });
    const legacy = record({ id: uuid(106), visitStartedOn: null, source: 'migration', reportFileId: null, reportFileVersionId: null, reportFileVersionNumber: null, report: null, recordedBy: null, recordedByName: null, needsReconciliation: true });
    const api = stubSurvey('director', {}, list({ canEdit: false, items: [newerNo, record(), legacy], total: 3 })); const { user } = mount(<SurveyPage profileId={PROFILE} />, locale);
    await screen.findByText('Demo later no result'); expect(screen.getByText(messages[locale].surveyed)).toBeTruthy(); expect(screen.getByText(messages[locale].selectedCurrentReport)).toBeTruthy();
    expect(screen.getAllByText(messages[locale].noExpiry)).toHaveLength(3); expect(screen.getByText(messages[locale].unknownVisitDate)).toBeTruthy();
    expect(screen.queryByRole('button', { name: messages[locale].newRecord })).toBeNull(); expect(screen.queryByRole('button', { name: messages[locale].editRecord })).toBeNull();
    const links = screen.getAllByRole('link').map(link => link.getAttribute('href')); expect(links).toContain(`/api/v1/files/${file().fileId}/content?version=2`);
    await user.click(screen.getAllByRole('button', { name: messages[locale].history })[1]!); await screen.findByRole('dialog');
    expect(api.mock.calls.some(([url]) => String(url).includes(`/${RECORD}/history?limit=25`))).toBe(true);
    expect(api.mock.calls.some(([, init]) => init?.method === 'POST' || init?.method === 'PUT')).toBe(false);
  });
  it('expert cannot edit an unresolved original record or turn its raw file into a latest-version link', async () => {
    const legacy = record({ visitStartedOn: null, source: 'migration', report: { ...file(), versionId: null, versionNumber: null, canDownload: false }, reportFileVersionId: null, reportFileVersionNumber: null, needsReconciliation: true });
    const api = stubSurvey('expert', {}, list({ items: [legacy] })); mount(<SurveyPage profileId={PROFILE} />); await screen.findByText(messages.en.unknownVisitDate);
    expect(screen.queryByRole('button', { name: messages.en.editRecord })).toBeNull(); expect(screen.getAllByRole('link').map(link => link.getAttribute('href')).some(href => href?.includes('/files/'))).toBe(false);
    expect(api.mock.calls.some(([url]) => String(url).includes('/files/') || String(url).includes('/own/sections'))).toBe(false);
  });
  it('history before and after keep independent captured numeric versions despite a newer current report', async () => {
    const before = record({ report: file(1), reportFileVersionId: file(1).versionId, reportFileVersionNumber: 1 });
    const after = record({ report: file(2), updatedAt: NEW_TIME, comment: 'Demo historical edit' });
    const current = record({ report: file(7), reportFileVersionId: file(7).versionId, reportFileVersionNumber: 7, updatedAt: NEW_TIME });
    stubSurvey('director', { [`GET ${PATH}/${RECORD}/history`]: { body: { items: [{ id: uuid(400), at: NEW_TIME, action: 'site_survey.updated', actorName: 'Demo history author', before, after }], nextCursor: null } } }, list({ canEdit: false, items: [current] }));
    const { user } = mount(<SurveyPage profileId={PROFILE} />); await screen.findByText('Demo signed report v7.pdf'); await user.click(screen.getByRole('button', { name: messages.en.history }));
    const dialog = within(await screen.findByRole('dialog')); await user.click(await dialog.findByText(messages.en.historyActions.updated));
    const old = within(await dialog.findByRole('region', { name: messages.en.before })), newer = within(dialog.getByRole('region', { name: messages.en.after }));
    expect(old.getByRole('link').getAttribute('href')).toBe(`/api/v1/files/${file().fileId}/content?version=1`); expect(newer.getByRole('link').getAttribute('href')).toBe(`/api/v1/files/${file().fileId}/content?version=2`);
    expect(dialog.queryByText('Demo signed report v7.pdf')).toBeNull(); await user.keyboard('{Escape}'); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: messages.en.history }));
  });
  it('rejects a foreign record in a scoped list instead of displaying its data', async () => {
    stubSurvey('expert', {}, list({ items: [record({ profileId: uuid(999), organizationId: uuid(998), comment: 'Demo foreign secret' })] })); mount(<SurveyPage profileId={PROFILE} />);
    await screen.findByText(messages.en.errors.internal); expect(screen.queryByText('Demo foreign secret')).toBeNull();
  });
  it('history uses the exact beforeId cursor and preserves the original creation snapshot on the next page', async () => {
    const original = record({ report: file(1), reportFileVersionId: file(1).versionId, reportFileVersionNumber: 1 }), after = record({ updatedAt: NEW_TIME });
    const cursor = uuid(430), api = stubSurvey('director', { [`GET ${PATH}/${RECORD}/history`]: url => Response.json(url.searchParams.has('beforeId')
      ? { items: [{ id: uuid(429), at: TIME, action: 'site_survey.created', actorName: 'Demo original SME', before: null, after: original }], nextCursor: null }
      : { items: [{ id: cursor, at: NEW_TIME, action: 'site_survey.updated', actorName: 'Demo original SME', before: original, after }], nextCursor: cursor }) }, list({ canEdit: false }));
    const { user } = mount(<SurveyPage profileId={PROFILE} />); await screen.findByText('Demo original survey comment'); await user.click(screen.getByRole('button', { name: messages.en.history }));
    const dialog = within(await screen.findByRole('dialog')); await user.click(await dialog.findByRole('button', { name: messages.en.loadMore })); await user.click(await dialog.findByText(messages.en.historyActions.created));
    await dialog.findByText(messages.en.noRecord); expect(within(dialog.getByRole('region', { name: messages.en.after })).getByRole('link').getAttribute('href')).toBe(`/api/v1/files/${file().fileId}/content?version=1`);
    expect(api.mock.calls.some(([url]) => String(url) === `${PATH}/${RECORD}/history?limit=25&beforeId=${cursor}`)).toBe(true); expect(dialog.queryByRole('button', { name: messages.en.loadMore })).toBeNull();
  });
  it.each(['operator', 'observer'] as const)('%s company evidence is a pure allow-list without Class C fields or queries', role => {
    const api = stubSurvey(role), current = { visitStartedOn: '2026-10-01', visitEndedOn: null, expiresOn: null, report: file(), comment: 'Demo private comment', result: 'no', source: 'migration', recordedByName: 'Demo private author' } as unknown as SiteSurveyCurrentReport;
    mount(<SurveyCompanyReport current={current} />); expect(screen.getByRole('link').getAttribute('href')).toBe(`/api/v1/files/${file().fileId}/content?version=2`);
    expect(screen.queryByText('Demo private comment')).toBeNull(); expect(screen.queryByText('Demo private author')).toBeNull(); expect(screen.queryByText(messages.en.result)).toBeNull();
    expect(screen.queryByRole('button', { name: messages.en.history })).toBeNull(); expect(api.mock.calls).toHaveLength(0);
  });
  it.each(ROLES.filter(role => role !== 'expert'))('%s does not mount the SME request queue', async role => {
    const api = stubSurvey(role); mount(<SurveyRequestsPage />, 'en', '/imbc/site-survey-requests'); await screen.findByText(messages.en.errors.forbidden);
    expect(api.mock.calls.some(([url]) => String(url).includes('site-survey-requests'))).toBe(false);
  });
  it('SME request paging keeps filters in the URL and a name change resets offset', async () => {
    const api = stubSurvey('expert', { 'GET /api/v1/site-survey-requests': { body: { items: [request()], total: 120, offset: 50, limit: 50 } } });
    const { user, router } = mount(<SurveyRequestsPage />, 'en', '/imbc/site-survey-requests?offset=50&limit=50&name=Demo&profileId=' + PROFILE);
    await screen.findByText('Demo own manufacturer'); expect(screen.getByRole('link').getAttribute('href')).toBe(`/imbc/profiles/${PROFILE}/site-surveys`);
    await user.clear(screen.getByRole('textbox', { name: messages.en.manufacturerName })); await user.type(screen.getByRole('textbox', { name: messages.en.manufacturerName }), 'Changed'); await user.click(screen.getByRole('button', { name: messages.en.search }));
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get('offset')).toBe('0'));
    const paths = api.mock.calls.map(([url]) => String(url)); expect(paths).toContain(`/api/v1/site-survey-requests?offset=0&limit=50&name=Changed&profileId=${PROFILE}`);
    expect(paths.some(path => path.includes('/site-surveys'))).toBe(false);
  });
  it('repeated known URL filters are invalid and not forwarded', async () => {
    const api = stubSurvey(); mount(<SurveyPage profileId={PROFILE} />, 'en', `${URL}?offset=0&offset=50`); await screen.findByText(messages.en.errors.invalidFilters);
    expect(api.mock.calls.some(([url]) => String(url).startsWith(PATH))).toBe(false);
  });
  it.each(['pending', 'rejected', 'unavailable'] as const)('%s report metadata never offers a latest or captured download', state => {
    const api = stubSurvey(); mount(<SurveyReport file={{ ...file(), scanState: state === 'unavailable' ? null : state, canDownload: false, rejectionReason: state === 'rejected' ? 'malware' : null }} label={messages.en.report} />);
    expect(screen.queryByRole('link')).toBeNull(); expect(api.mock.calls).toHaveLength(0);
  });
});
