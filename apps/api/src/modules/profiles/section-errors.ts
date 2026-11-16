import { ProblemException } from '../../common/problem.js';
import type { ZodError } from 'zod';

/** MAN-43, MAN-45: sending is separate from saving; sent revisions cannot be edited. */
export const profileLocked = () =>
  new ProblemException(409, 'profile_locked', 'Профиль отправлен на проверку. Сначала разблокируйте его.');

/** MAN-40: keep the unsaved input on the client and offer to reload the current revision. */
export const sectionChanged = () =>
  new ProblemException(409, 'section_changed', 'Раздел уже изменён. Перечитайте данные перед сохранением.');

export const sectionUnavailable = () =>
  new ProblemException(409, 'section_unavailable', 'Этот раздел ещё недоступен для редактирования.');

/** DATA-04: paths refer to the strict write body, without echoing submitted business values. */
export function sectionFieldError(path: string, code: string): ProblemException {
  return new ProblemException(400, 'validation', 'Проверьте поля раздела.', undefined, {
    errors: [{ path, code, message: code }],
  });
}

const FIELD_CODES = new Set([
  'duplicate_email',
  'duplicate_phone',
  'multiple_focal_points',
  'phone_format',
  'email_format',
  'website_format',
  'reference_invalid',
  'reference_retired',
  'site_in_use',
  'identity_invalid',
  'duplicate_site',
  'text_format',
]);

/** Section validation exposes stable codes and field paths, without submitted values or arbitrary messages. */
export function sectionValidationError(error: ZodError): ProblemException {
  return new ProblemException(400, 'validation', 'Проверьте поля раздела.', undefined, {
    errors: error.issues.map((issue) => {
      const code = FIELD_CODES.has(issue.message) ? issue.message : issue.code;
      return { path: issue.path.join('.'), code, message: code };
    }),
  });
}
