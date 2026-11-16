import type { Locale, ProfileFile, Role, SiteSurveyListRead, SiteSurveyRecordView } from '@imbc/contracts';
import type { RouteObject } from 'react-router';
import en from '../../messages/en.json';
import ru from '../../messages/ru.json';
import kk from '../../messages/kk.json';
import type { Me } from '@/lib/session';
import { renderRoute } from './render';
import { stubApi, type ApiReply } from './api';

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const PROFILE = uuid(100), ORGANIZATION = uuid(101), ACTOR = uuid(102), RECORD = uuid(103), FILE = uuid(104);
export const TIME = '2026-11-01T08:09:10.123456Z', NEW_TIME = '2026-11-16T08:09:10.654321Z';
export const PATH = `/api/v1/profiles/${PROFILE}/site-surveys`, URL = `/imbc/profiles/${PROFILE}/site-surveys`, REQUEST_PATH = `/api/v1/profiles/${PROFILE}/site-survey-requests`;
export const messages = { en: en.siteSurvey, ru: ru.siteSurvey, kk: kk.siteSurvey };
export const file = (version = 2): ProfileFile => ({ fileId: FILE, versionId: uuid(200 + version), versionNumber: version, originalName: `Demo signed report v${version}.pdf`,
  byteSize: 2048, mediaType: 'application/pdf', scanState: 'passed', rejectionReason: null, uploadedAt: TIME, canDownload: true });
export const record = (overrides: Partial<SiteSurveyRecordView> = {}): SiteSurveyRecordView => ({
  id: RECORD, profileId: PROFILE, organizationId: ORGANIZATION, visitStartedOn: '2026-10-01', visitEndedOn: null, result: 'yes', reportFileId: FILE,
  reportFileVersionId: file().versionId, reportFileVersionNumber: 2, report: file(), expiresOn: null, comment: 'Demo original survey comment',
  source: 'expert', recordedBy: ACTOR, recordedByName: 'Demo original SME', recordedAt: TIME, updatedAt: TIME, needsReconciliation: false, ...overrides,
});
export const list = (overrides: Partial<SiteSurveyListRead> = {}): SiteSurveyListRead => ({ profileId: PROFILE, organizationId: ORGANIZATION, organizationName: 'Demo surveyed manufacturer', profileStatus: 'verified',
  tier: 2, summary: { siteSurveyed: true, siteSurveyedOn: '2026-10-01', currentSurveyId: RECORD }, canEdit: true, items: [record()], total: 1, offset: 0, limit: 50, ...overrides });
export const ownProfile = { profileId: PROFILE, organizationName: 'Demo own manufacturer', bin: '000100000001', status: 'verified', hasPendingChanges: false,
  updateStatus: 'active', tier: 'tier_2', completenessPct: 100, registeredAt: TIME, verifiedAt: TIME };
export const request = (n = 1) => ({ id: uuid(300 + n), profileId: PROFILE, organizationId: ORGANIZATION, organizationName: 'Demo own manufacturer', requestedBy: ACTOR, requestedAt: NEW_TIME });
export function me(role: Role): Me {
  return { user: { id: ACTOR, email: `${role}@survey.local`, fullName: 'Demo account', role, organizationId: role === 'manufacturer' ? ORGANIZATION : uuid(110), organizationType: role === 'manufacturer' ? 'manufacturer' : role === 'operator' ? 'operator' : role === 'observer' ? 'observer' : 'imbc', locale: 'en' },
    gates: { mfa: true, responsibility: true }, homePath: '/', otpDelivery: 'email' };
}
export function stubSurvey(role: Role = 'expert', overrides: Record<string, ApiReply> = {}, fixture = list()) {
  return stubApi({ 'GET /api/auth/me': { body: me(role) }, [`GET ${PATH}`]: { body: fixture }, [`GET ${PATH}/${RECORD}`]: { body: fixture.items[0] },
    [`GET ${PATH}/${RECORD}/history`]: { body: { items: [], nextCursor: null } }, 'GET /api/v1/profiles/own': { body: ownProfile },
    [`GET ${REQUEST_PATH}`]: { body: { items: [], total: 0, offset: 0, limit: 50 } }, 'GET /api/v1/site-survey-requests': { body: { items: [request()], total: 1, offset: 0, limit: 50 } }, ...overrides });
}
export function mount(element: React.ReactNode, locale: Locale = 'en', entry = URL, additional: RouteObject[] = []) {
  return renderRoute(entry, { locale, routes: [{ path: new globalThis.URL(entry, 'http://fixture.local').pathname, element }, { path: '/away', element: <h1>Demo destination</h1> }, ...additional] });
}
