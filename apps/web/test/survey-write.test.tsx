import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { SurveyPage } from '@/features/site-survey/collection';
import { SurveyOwnRequestCard } from '@/features/site-survey/own-request';
import { problem } from './support/api';
import { file, list, messages, mount, NEW_TIME, ownProfile, PATH, PROFILE, record, RECORD, request, REQUEST_PATH, stubSurvey, TIME, uuid } from './support/survey';
import { ownProfileSchema, ROLES, type SiteSurveyCreate, type SiteSurveyUpdate } from '@imbc/contracts';

async function openEditor(user: ReturnType<typeof mount>['user']) {
  await screen.findByText('Demo original survey comment'); await user.click(screen.getByRole('button', { name: messages.en.editRecord }));
  return within(await screen.findByRole('dialog'));
}
describe('Survey writes retain intent and exact evidence', () => {
  it.each(['en', 'ru', 'kk'] as const)('%s opens a localized empty editor and closes cleanly by keyboard without a dirty warning', async locale => {
    stubSurvey(); const { user } = mount(<SurveyPage profileId={PROFILE} />, locale); await screen.findByText('Demo surveyed manufacturer');
    const trigger = screen.getByRole('button', { name: messages[locale].newRecord }); await user.click(trigger); const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByLabelText(messages[locale].visitStartedOn)).toBeTruthy(); expect(dialog.getByLabelText(messages[locale].visitEndedOn)).toBeTruthy();
    expect(dialog.getByRole('combobox', { name: messages[locale].result })).toBeTruthy(); expect(dialog.getByRole('textbox', { name: messages[locale].comment })).toBeTruthy();
    await user.keyboard('{Escape}'); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(screen.queryByRole('alertdialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
  it('stale UTC6 CAS reload keeps the draft and uses the exact fresh token', async () => {
    let stale = false; const writes: SiteSurveyUpdate[] = [], conflict = problem(409, 'conflict') as (url: URL) => Response;
    stubSurvey('expert', { [`GET ${PATH}/${RECORD}`]: () => Response.json(record(stale ? { updatedAt: NEW_TIME, comment: 'Demo other editor' } : {})),
      [`PUT ${PATH}/${RECORD}`]: (url, init) => { const body = JSON.parse(String(init?.body)); writes.push(body); if (!stale) { stale = true; return conflict(url); } return Response.json(record({ ...body, updatedAt: NEW_TIME })); } });
    const { user } = mount(<SurveyPage profileId={PROFILE} />), dialog = await openEditor(user);
    await user.clear(dialog.getByRole('textbox', { name: messages.en.comment })); await user.type(dialog.getByRole('textbox', { name: messages.en.comment }), 'Demo preserved intent');
    await user.click(dialog.getByRole('button', { name: messages.en.saveRecord })); await dialog.findByText(messages.en.errors.changed);
    expect(dialog.getByRole('button', { name: messages.en.saveRecord }).hasAttribute('disabled')).toBe(true);
    await user.click(dialog.getByRole('button', { name: messages.en.reloadKeepDraft })); await dialog.findByText(messages.en.rebased);
    expect((dialog.getByRole('textbox', { name: messages.en.comment }) as HTMLTextAreaElement).value).toBe('Demo preserved intent');
    await user.click(dialog.getByRole('button', { name: messages.en.saveRecord })); await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.map(body => body.expectedUpdatedAt)).toEqual([TIME, NEW_TIME]); expect(writes[1]!.comment).toBe('Demo preserved intent');
    expect(writes[1]).not.toHaveProperty('source'); expect(writes[1]).not.toHaveProperty('recordedBy'); expect(writes[1]).not.toHaveProperty('reportFileVersionId');
  });
  it('403 latches record mutations and a readonly fresh list cannot authorize the dirty editor', async () => {
    let refused = false; const forbidden = problem(403, 'forbidden') as (url: URL) => Response;
    const api = stubSurvey('expert', { [`GET ${PATH}`]: () => Response.json(list({ canEdit: !refused })), [`PUT ${PATH}/${RECORD}`]: url => { refused = true; return forbidden(url); } });
    const { user } = mount(<SurveyPage profileId={PROFILE} />), dialog = await openEditor(user);
    await user.type(dialog.getByRole('textbox', { name: messages.en.comment }), ' Demo retained dirty text'); await user.click(dialog.getByRole('button', { name: messages.en.saveRecord }));
    await dialog.findByText(messages.en.errors.forbidden); expect(dialog.getByRole('button', { name: messages.en.saveRecord }).hasAttribute('disabled')).toBe(true);
    expect(dialog.getByRole('textbox', { name: messages.en.comment }).hasAttribute('disabled')).toBe(true);
    const detailReads = api.mock.calls.filter(([url]) => String(url) === `${PATH}/${RECORD}`).length;
    await user.click(dialog.getByRole('button', { name: messages.en.reloadKeepDraft })); await waitFor(() => expect(api.mock.calls.filter(([url]) => String(url).startsWith(PATH + '?')).length).toBeGreaterThan(1));
    expect(api.mock.calls.filter(([url]) => String(url) === `${PATH}/${RECORD}`)).toHaveLength(detailReads);
    expect((dialog.getByRole('textbox', { name: messages.en.comment }) as HTMLTextAreaElement).value).toContain('Demo retained dirty text');
    expect(api.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  });
  it('dirty close offers Stay, preserves the comment and returns focus only after deliberate discard', async () => {
    stubSurvey(); const { user } = mount(<SurveyPage profileId={PROFILE} />), dialog = await openEditor(user);
    await user.type(dialog.getByRole('textbox', { name: messages.en.comment }), ' Demo dirty'); await user.keyboard('{Escape}');
    const confirmation = within(await screen.findByRole('alertdialog')); await user.click(confirmation.getByRole('button', { name: 'Stay here' }));
    expect((dialog.getByRole('textbox', { name: messages.en.comment }) as HTMLTextAreaElement).value).toContain('Demo dirty');
    await user.click(dialog.getByRole('button', { name: messages.en.cancel })); await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard and leave' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(document.activeElement).toBe(screen.getByRole('button', { name: messages.en.editRecord }));
  });
  it('unknown create acknowledgement retries the identical body/key and shows the original captured receipt', async () => {
    const candidate = { ...file(1), fileId: uuid(500), versionId: uuid(502), canDownload: false, originalName: 'Demo newly signed report.pdf' }, writes: { body: SiteSurveyCreate; key: string }[] = [];
    const receipt = record({ id: uuid(510), reportFileId: candidate.fileId, reportFileVersionId: candidate.versionId, reportFileVersionNumber: 1, report: { ...candidate, canDownload: true }, comment: 'Demo original create intent', visitStartedOn: '2026-09-01' });
    let committed = false;
    const api = stubSurvey('expert', { [`POST ${PATH}/files`]: { status: 202, body: { upload: { ...candidate, scanState: 'pending' } } }, [`GET ${PATH}/files/${candidate.fileId}/state`]: { body: { upload: candidate } },
      [`GET ${PATH}`]: () => Response.json(list({ items: committed ? [record({ ...receipt, reportFileId: uuid(506), report: { ...candidate, fileId: uuid(506), versionId: uuid(507), originalName: 'Demo later replacement.pdf', canDownload: true }, reportFileVersionId: uuid(507) })] : [] })),
      [`POST ${PATH}`]: (_url, init) => { writes.push({ body: JSON.parse(String(init?.body)), key: String((init?.headers as Record<string, string>)['Idempotency-Key']) });
        if (!committed) { committed = true; throw new TypeError('Demo response lost after commit'); } return Response.json(receipt, { status: 201 }); } });
    const { user } = mount(<SurveyPage profileId={PROFILE} />); await screen.findByText('Demo surveyed manufacturer'); await user.click(screen.getByRole('button', { name: messages.en.newRecord }));
    const dialog = within(await screen.findByRole('dialog')); fireEvent.change(dialog.getByLabelText(messages.en.visitStartedOn), { target: { value: '2026-09-01' } });
    await user.click(dialog.getByRole('combobox', { name: messages.en.result })); await user.click(await screen.findByRole('option', { name: 'Yes' }));
    await user.type(dialog.getByRole('textbox', { name: messages.en.comment }), 'Demo original create intent'); await user.upload(dialog.getByLabelText(messages.en.chooseReport), new File(['demo bytes'], 'demo.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(dialog.getByRole('button', { name: messages.en.saveRecord }).hasAttribute('disabled')).toBe(false)); expect(dialog.queryByRole('link')).toBeNull(); await user.click(dialog.getByRole('button', { name: messages.en.saveRecord }));
    await dialog.findByText(messages.en.createRetryHint); expect(dialog.getByRole('textbox', { name: messages.en.comment }).hasAttribute('disabled')).toBe(true);
    await user.click(dialog.getByRole('button', { name: 'Retry' })); await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toEqual(writes[0]); expect(writes[0]!.key).toMatch(/^[0-9a-f-]{36}$/); expect(writes[0]!.body.reportFileId).toBe(candidate.fileId);
    await user.click(await screen.findByText(messages.en.recordSaved)); const acknowledged = within(screen.getByText(messages.en.recordSaved).closest('details')!);
    expect(acknowledged.getByRole('link').getAttribute('href')).toBe(`/api/v1/files/${candidate.fileId}/content?version=1`); expect(acknowledged.queryByText('Demo later replacement.pdf')).toBeNull();
    expect(api.mock.calls.some(([url]) => String(url).includes('/own/sections') || String(url).includes('/notifications'))).toBe(false);
  });
  it('candidate scan read failure keeps Save blocked until explicit retry passes', async () => {
    const candidate = { ...file(1), fileId: uuid(520), versionId: uuid(522), scanState: 'pending' as const, canDownload: false }, clean = { ...candidate, scanState: 'passed' as const };
    let fail = true; const unavailable = problem(503, 'storage_unavailable') as (url: URL) => Response;
    const api = stubSurvey('expert', { [`POST ${PATH}/files`]: { status: 202, body: { upload: candidate } }, [`GET ${PATH}/files/${candidate.fileId}/state`]: url => fail ? unavailable(url) : Response.json({ upload: clean }) });
    const { user } = mount(<SurveyPage profileId={PROFILE} />), dialog = await openEditor(user);
    await user.upload(dialog.getByLabelText(messages.en.chooseReport), new File(['demo bytes'], 'demo.pdf', { type: 'application/pdf' })); await dialog.findByText(messages.en.errors.storage);
    expect(dialog.getByRole('button', { name: messages.en.saveRecord }).hasAttribute('disabled')).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 3100)); expect(api.mock.calls.filter(([url]) => String(url).endsWith(`/files/${candidate.fileId}/state`))).toHaveLength(1);
    fail = false; await user.click(dialog.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(dialog.getByRole('button', { name: messages.en.saveRecord }).hasAttribute('disabled')).toBe(false));
  });
  it('a create-key conflict cannot retry until an explicit new save intent is confirmed', async () => {
    const candidate = { ...file(1), fileId: uuid(540), versionId: uuid(542), canDownload: false }, writes: { body: SiteSurveyCreate; key: string }[] = [];
    const conflict = problem(409, 'conflict') as (url: URL) => Response;
    stubSurvey('expert', { [`POST ${PATH}/files`]: { status: 202, body: { upload: { ...candidate, scanState: 'pending' } } }, [`GET ${PATH}/files/${candidate.fileId}/state`]: { body: { upload: candidate } },
      [`POST ${PATH}`]: (url, init) => { writes.push({ body: JSON.parse(String(init?.body)), key: String((init?.headers as Record<string, string>)['Idempotency-Key']) });
        return writes.length === 1 ? conflict(url) : Response.json(record({ reportFileId: candidate.fileId, reportFileVersionId: candidate.versionId, reportFileVersionNumber: 1, report: { ...candidate, canDownload: true } }), { status: 201 }); } });
    const { user } = mount(<SurveyPage profileId={PROFILE} />); await screen.findByText('Demo surveyed manufacturer'); await user.click(screen.getByRole('button', { name: messages.en.newRecord }));
    const dialog = within(await screen.findByRole('dialog')); fireEvent.change(dialog.getByLabelText(messages.en.visitStartedOn), { target: { value: '2026-10-01' } });
    await user.click(dialog.getByRole('combobox', { name: messages.en.result })); await user.click(await screen.findByRole('option', { name: 'Yes' }));
    await user.upload(dialog.getByLabelText(messages.en.chooseReport), new File(['demo bytes'], 'demo.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(dialog.getByRole('button', { name: messages.en.saveRecord }).hasAttribute('disabled')).toBe(false)); await user.click(dialog.getByRole('button', { name: messages.en.saveRecord }));
    await dialog.findByText(messages.en.errors.operationConflict); expect(dialog.getByRole('button', { name: 'Retry' }).hasAttribute('disabled')).toBe(true);
    await user.click(dialog.getByRole('button', { name: messages.en.startNewSave })); await waitFor(() => expect(dialog.getByRole('button', { name: messages.en.saveRecord }).hasAttribute('disabled')).toBe(false));
    await user.click(dialog.getByRole('button', { name: messages.en.saveRecord })); await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]!.body).toEqual(writes[0]!.body); expect(writes[1]!.key).not.toBe(writes[0]!.key);
  });
  it('a canonical unsigned migration row can be edited without inventing a report, source or author', async () => {
    const original = record({ source: 'migration', report: null, reportFileId: null, reportFileVersionId: null, reportFileVersionNumber: null, recordedBy: null, recordedByName: null });
    const writes: SiteSurveyUpdate[] = [];
    const api = stubSurvey('expert', { [`PUT ${PATH}/${RECORD}`]: (_url, init) => { const body = JSON.parse(String(init?.body)); writes.push(body); return Response.json(record({ ...original, comment: body.comment, updatedAt: NEW_TIME })); } },
      list({ tier: 1, summary: { siteSurveyed: false, siteSurveyedOn: null, currentSurveyId: null }, items: [original] }));
    const { user } = mount(<SurveyPage profileId={PROFILE} />), dialog = await openEditor(user); await user.clear(dialog.getByRole('textbox', { name: messages.en.comment }));
    await user.type(dialog.getByRole('textbox', { name: messages.en.comment }), 'Demo migration correction'); await user.click(dialog.getByRole('button', { name: messages.en.saveRecord }));
    await waitFor(() => expect(writes).toHaveLength(1)); expect(writes[0]).toMatchObject({ reportFileId: null, expectedUpdatedAt: TIME, comment: 'Demo migration correction' });
    expect(writes[0]).not.toHaveProperty('source'); expect(writes[0]).not.toHaveProperty('recordedBy'); expect(api.mock.calls.some(([url]) => String(url).includes('/files'))).toBe(false);
  });
  it.each(ROLES.filter(role => role !== 'manufacturer'))('%s own request card does not fetch producer data or mount mutations', async role => {
    const api = stubSurvey(role); mount(<SurveyOwnRequestCard />); await waitFor(() => expect(api.mock.calls.some(([url]) => String(url) === '/api/auth/me')).toBe(true));
    expect(api.mock.calls.some(([url]) => String(url).includes('/profiles/own') || String(url).includes('site-survey-requests'))).toBe(false);
    expect(screen.queryByRole('button', { name: messages.en.requestSurvey })).toBeNull();
  });
  it('non-verified own manufacturer cannot send a survey request', async () => {
    const api = stubSurvey('manufacturer', { 'GET /api/v1/profiles/own': { body: { ...ownProfile, status: 'returned', tier: null } } }); mount(<SurveyOwnRequestCard />);
    await screen.findByText(messages.en.requestVerifiedOnly); expect(screen.getByRole('button', { name: messages.en.requestSurvey }).hasAttribute('disabled')).toBe(true);
    expect(api.mock.calls.some(([url]) => String(url).includes('site-survey-requests'))).toBe(false);
  });
  it('reuses the current authenticated profile read and disables the card after a newer parent status downgrade', async () => {
    const api = stubSurvey('manufacturer');
    function Parent() {
      const [profile, setProfile] = useState(() => ownProfileSchema.parse(ownProfile));
      return <><button onClick={() => setProfile({ ...profile, status: 'returned', tier: null })}>Demo newer parent response</button><SurveyOwnRequestCard currentProfile={profile} /></>;
    }
    const { user } = mount(<Parent />); await waitFor(() => expect(screen.getByRole('button', { name: messages.en.requestSurvey }).hasAttribute('disabled')).toBe(false));
    expect(api.mock.calls.some(([url]) => String(url) === '/api/v1/profiles/own')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Demo newer parent response' })); await screen.findByText(messages.en.requestVerifiedOnly);
    expect(screen.getByRole('button', { name: messages.en.requestSurvey }).hasAttribute('disabled')).toBe(true); expect(api.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
  it('own request unknown retry keeps the same UUID and empty body while a deliberate later request has a new UUID', async () => {
    const writes: { key: string; body: unknown }[] = [];
    const api = stubSurvey('manufacturer', { [`POST ${REQUEST_PATH}`]: (_url, init) => {
      writes.push({ key: String((init?.headers as Record<string, string>)['Idempotency-Key']), body: JSON.parse(String(init?.body)) });
      if (writes.length === 1) throw new TypeError('Demo lost request response'); return Response.json(request(writes.length - 1), { status: 201 });
    } });
    const { user } = mount(<SurveyOwnRequestCard />); await waitFor(() => expect(screen.getByRole('button', { name: messages.en.requestSurvey }).hasAttribute('disabled')).toBe(false));
    await user.click(screen.getByRole('button', { name: messages.en.requestSurvey })); const dialog = within(await screen.findByRole('dialog')); await user.click(dialog.getByRole('button', { name: messages.en.sendRequest }));
    await dialog.findByText(messages.en.requestRetryHint); await user.click(dialog.getByRole('button', { name: messages.en.close }));
    await user.click(screen.getByRole('button', { name: messages.en.resumeRequest })); await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: messages.en.retryRequest }));
    await screen.findByText(/Request recorded:/); await user.click(screen.getByRole('button', { name: messages.en.anotherRequest })); await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: messages.en.sendRequest }));
    await waitFor(() => expect(writes).toHaveLength(3)); expect(writes[0]).toEqual(writes[1]); expect(writes[2]!.key).not.toBe(writes[1]!.key); expect(writes.map(write => write.body)).toEqual([{}, {}, {}]);
    expect(api.mock.calls.some(([url]) => String(url).includes('/site-surveys') || String(url).includes('/mail') || String(url).includes('/notifications'))).toBe(false);
  });
  it('a server verified-gate refusal disables request actions and explicit reload observes the status downgrade', async () => {
    let refused = false; const gate = problem(409, 'site_survey_request_requires_verified') as (url: URL) => Response;
    const api = stubSurvey('manufacturer', { 'GET /api/v1/profiles/own': () => Response.json(refused ? { ...ownProfile, status: 'returned', tier: null } : ownProfile), [`POST ${REQUEST_PATH}`]: url => { refused = true; return gate(url); } });
    const { user } = mount(<SurveyOwnRequestCard />); await waitFor(() => expect(screen.getByRole('button', { name: messages.en.requestSurvey }).hasAttribute('disabled')).toBe(false));
    await user.click(screen.getByRole('button', { name: messages.en.requestSurvey })); const dialog = within(await screen.findByRole('dialog')); await user.click(dialog.getByRole('button', { name: messages.en.sendRequest }));
    await dialog.findByText(messages.en.errors.verifiedRequired); expect(dialog.queryByRole('button', { name: messages.en.sendRequest })).toBeNull();
    await user.click(dialog.getByRole('button', { name: messages.en.reloadAccess })); await screen.findByText(messages.en.requestVerifiedOnly);
    expect(api.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
  it('a request-key conflict requires explicit fresh scope and a new key before retrying', async () => {
    const writes: string[] = [], conflict = problem(409, 'conflict') as (url: URL) => Response;
    stubSurvey('manufacturer', { [`POST ${REQUEST_PATH}`]: (url, init) => { writes.push(String((init?.headers as Record<string, string>)['Idempotency-Key'])); return writes.length === 1 ? conflict(url) : Response.json(request(), { status: 201 }); } });
    const { user } = mount(<SurveyOwnRequestCard />); await waitFor(() => expect(screen.getByRole('button', { name: messages.en.requestSurvey }).hasAttribute('disabled')).toBe(false));
    await user.click(screen.getByRole('button', { name: messages.en.requestSurvey })); const dialog = within(await screen.findByRole('dialog')); await user.click(dialog.getByRole('button', { name: messages.en.sendRequest }));
    await dialog.findByText(messages.en.errors.operationConflict); expect(dialog.queryByRole('button', { name: messages.en.sendRequest })).toBeNull();
    await user.click(dialog.getByRole('button', { name: messages.en.startNewRequest })); await user.click(await dialog.findByRole('button', { name: messages.en.sendRequest }));
    await waitFor(() => expect(writes).toHaveLength(2)); expect(writes[1]).not.toBe(writes[0]);
  });
  it('own request history paging stays on the authenticated profile and does not create a request', async () => {
    const api = stubSurvey('manufacturer', { [`GET ${REQUEST_PATH}`]: url => { const offset = Number(url.searchParams.get('offset') ?? 0);
      return Response.json({ items: Array.from({ length: 50 }, (_, n) => request(offset + n + 1)), total: 120, offset, limit: 50 }); } });
    const { user } = mount(<SurveyOwnRequestCard />); await waitFor(() => expect(screen.getByRole('button', { name: messages.en.next }).hasAttribute('disabled')).toBe(false));
    await user.click(screen.getByRole('button', { name: messages.en.next })); await waitFor(() => expect(api.mock.calls.some(([url]) => String(url) === `${REQUEST_PATH}?offset=50&limit=50`)).toBe(true));
    expect(api.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false); expect(api.mock.calls.some(([url]) => String(url).includes('/site-surveys'))).toBe(false);
  });
});
