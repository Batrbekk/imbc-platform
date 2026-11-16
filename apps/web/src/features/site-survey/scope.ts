import { ApiError } from '@/lib/api';
export const surveyAuthorityLost = (error: unknown) => error instanceof ApiError && [401, 403, 404].includes(error.status);
export const sameSurveyScope = (row: { profileId: string; id: string }, profileId: string, recordId?: string) =>
  row.profileId === profileId && (recordId === undefined || row.id === recordId);
