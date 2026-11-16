import { useParams } from 'react-router';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { SurveyPage } from '@/features/site-survey/collection';
import { SurveyFailure } from '@/features/site-survey/feedback';
export function Component() {
  const { profileId } = useParams();
  return z.uuid().safeParse(profileId).success ? <SurveyPage profileId={profileId!} /> : <SurveyFailure error={new ApiError(404, 'not_found', '')} />;
}
