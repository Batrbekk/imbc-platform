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
