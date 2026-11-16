import {
  siteSurveyHistorySchema, siteSurveyListReadSchema, siteSurveyRecordViewSchema,
  siteSurveyRequestListSchema, siteSurveyRequestReadSchema, type SiteSurveyCreate, type SiteSurveyUpdate,
} from "@imbc/contracts";
import { api } from "@/lib/api";
import { sameSurveyScope } from './scope';

export const surveyPath = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}/site-surveys`;
export const surveyRequestPath = (profileId?: string) => profileId ? `/v1/profiles/${encodeURIComponent(profileId)}/site-survey-requests` : "/v1/site-survey-requests";
export const surveyKeys = {
  all: ["site-surveys"] as const,
  list: (profileId: string, actorId: string, offset: number, limit: number) => ["site-surveys", profileId, actorId, "list", offset, limit] as const,
  history: (profileId: string, recordId: string, actorId: string) => ["site-surveys", profileId, actorId, "history", recordId] as const,
  requests: (actorId: string, query: string, profileId?: string) => ["site-surveys", "requests", actorId, profileId ?? "expert", query] as const,
};
export const readSurveys = async (profileId: string, query: string, signal?: AbortSignal) => {
  const result = siteSurveyListReadSchema.parse(await api(`${surveyPath(profileId)}?${query}`, { signal }));
  if (result.profileId !== profileId || result.items.some(row => !sameSurveyScope(row, profileId) || row.organizationId !== result.organizationId)) throw new Error('survey_scope');
  return result;
};
export const readSurvey = async (profileId: string, recordId: string, signal?: AbortSignal) => {
  const result = siteSurveyRecordViewSchema.parse(await api(`${surveyPath(profileId)}/${encodeURIComponent(recordId)}`, { signal }));
  if (!sameSurveyScope(result, profileId, recordId)) throw new Error('survey_scope'); return result;
};
export const createSurvey = async (profileId: string, write: SiteSurveyCreate, intentId: string) => {
  const result = siteSurveyRecordViewSchema.parse(await api(surveyPath(profileId), { method: "POST", json: write, headers: { "Idempotency-Key": intentId } }));
  if (!sameSurveyScope(result, profileId)) throw new Error('survey_scope'); return result;
};
export const updateSurvey = async (profileId: string, recordId: string, write: SiteSurveyUpdate) => {
  const result = siteSurveyRecordViewSchema.parse(await api(`${surveyPath(profileId)}/${encodeURIComponent(recordId)}`, { method: "PUT", json: write }));
  if (!sameSurveyScope(result, profileId, recordId)) throw new Error('survey_scope'); return result;
};
export const readSurveyHistory = async (profileId: string, recordId: string, beforeId?: string, signal?: AbortSignal) => {
  const query = new URLSearchParams({ limit: "25", ...(beforeId ? { beforeId } : {}) });
  const result = siteSurveyHistorySchema.parse(await api(`${surveyPath(profileId)}/${encodeURIComponent(recordId)}/history?${query}`, { signal }));
  if (result.items.some(entry => !sameSurveyScope(entry.after, profileId, recordId) || entry.before !== null && !sameSurveyScope(entry.before, profileId, recordId))) throw new Error('survey_history_scope');
  return result;
};
export const readSurveyRequests = async (query: string, profileId?: string, signal?: AbortSignal) => {
  const result = siteSurveyRequestListSchema.parse(await api(`${surveyRequestPath(profileId)}?${query}`, { signal }));
  if (profileId && result.items.some(row => row.profileId !== profileId)) throw new Error('survey_request_scope'); return result;
};
export const requestSurvey = async (profileId: string, intentId: string) => {
  const result = siteSurveyRequestReadSchema.parse(await api(surveyRequestPath(profileId), {
    method: "POST", json: {}, headers: { "Idempotency-Key": intentId },
  }));
  if (result.profileId !== profileId) throw new Error('survey_request_scope'); return result;
};
