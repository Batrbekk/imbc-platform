import { z } from 'zod';
import { ALLOWED_FILE_TYPES } from './enums.js';

/**
 * Файлы платформы (DATA-05, DATA-06, DATA-07, GEN-09). Значения — перечисления DBML `file_purpose`,
 * `data_class`, `scan_state` (порядок тот же); типы PostgreSQL строятся из этих констант.
 */

/** Назначение файла: по нему решается, кто его читает (GEN-09). */
export const FILE_PURPOSES = [
  'organisation_chart',
  'cv',
  'unified_register_extract',
  'conformity_certificate',
  'production_photo',
  'certificate_file',
  'document_file',
  'site_survey_report',
  'due_diligence_report',
  'enhanced_due_diligence_report',
  'operator_visit_file',
  'technical_requirements',
  'agar_cdp_report',
  'organisation_chart_sample',
  'export',
] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

/** Класс данных (архитектура §9): A — реестр, B — производитель, C — IMBC, D — оператор, E — администрирование, F — прогноз. */
export const DATA_CLASSES = [
  'a_register',
  'b_manufacturer',
  'c_imbc',
  'd_operator',
  'e_administration',
  'f_forecast',
] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/**
 * Состояние проверки версии файла (DATA-07): до `passed` версию никто не открывает, не скачивает,
 * не верифицирует и не публикует. В БД тип называется `file_scan_state`: имя `scan_state` занято
 * скелетным перечислением до contract (NFR-06).
 */
export const FILE_SCAN_STATES = ['pending', 'passed', 'rejected'] as const;
export type FileScanState = (typeof FILE_SCAN_STATES)[number];

/**
 * Файлы секций профиля производителя (класс `b_manufacturer`): назначения, на которые ссылаются
 * таблицы профиля DBML — `main_information`, `personnel`, `personnel_cv`, `product_line`,
 * `production_photo`, `certificate`, `document`.
 */
export const MANUFACTURER_FILE_PURPOSES = [
  'organisation_chart',
  'cv',
  'unified_register_extract',
  'conformity_certificate',
  'production_photo',
  'certificate_file',
  'document_file',
] as const satisfies readonly FilePurpose[];
export type ManufacturerFilePurpose = (typeof MANUFACTURER_FILE_PURPOSES)[number];

/** Тип файла, который принимает платформа (DATA-06): PDF, JPG, PNG, DOCX, XLSX. */
export type AllowedMediaType = keyof typeof ALLOWED_FILE_TYPES;

export const isAllowedMediaType = (value: string): value is AllowedMediaType =>
  Object.hasOwn(ALLOWED_FILE_TYPES, value);

/**
 * Расширение имени соответствует типу по содержимому (DATA-06): без учёта регистра, `jpeg` — то же, что `jpg`.
 * Расширение — часть имени после последней точки; имя без точки или с точкой в конце не совпадает ни с чем.
 */
export function fileExtensionMatches(name: string, mediaType: AllowedMediaType): boolean {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  const extension = name.slice(dot + 1).toLowerCase();
  return (extension === 'jpeg' ? 'jpg' : extension) === ALLOWED_FILE_TYPES[mediaType];
}

/** Номер версии в `GET /api/v1/files/:id/content?version=`: целое от 1, без знака и дробей; нет — последняя. */
export const fileContentQuerySchema = z
  .object({
    version: z
      .string()
      .regex(/^[1-9]\d{0,8}$/)
      .transform(Number)
      .optional(),
  })
  .strict();
export type FileContentQuery = z.infer<typeof fileContentQuerySchema>;

/**
 * Коды problem+json маршрутов файлов (загрузка, скачивание; их сервис, правила чтения, транзакция исполнителя
 * и SessionGuard): по ним экран выбирает сообщение. `validation` — ошибка схемы query или разбора multipart,
 * `internal` — сбой 500.
 */
export const FILE_PROBLEM_CODES = [
  'validation',
  'unauthenticated',
  'mfa_required',
  'responsibility_required',
  'forbidden',
  'bad_origin',
  'not_found',
  'file_missing',
  'file_empty',
  'file_too_large',
  'file_type_not_allowed',
  'file_type_mismatch',
  'file_pending_scan',
  'file_rejected',
  'storage_unavailable',
  'busy',
  'internal',
] as const;
export type FileProblemCode = (typeof FILE_PROBLEM_CODES)[number];
