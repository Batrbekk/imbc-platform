import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id } from './_shared.js';
import { organizations, userAccounts } from './access.js';
import {
  checkStatus,
  connectorCode,
  ddResult,
  decision,
  externalCheckState,
  externalCheckTrigger,
  markState,
  prefillField,
  prefillSource,
  profileSection,
  requestState,
  valueSource,
} from './enums.js';
import { fileObjects, manufacturerProfiles } from './profiles.js';

/** Обследование площадки (IMBC-01…05). Site surveyed вычисляется, не хранится. */
export const siteSurveyRecords = pgTable('site_survey_records', {
  id: id(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => manufacturerProfiles.id, { onDelete: 'cascade' }),
  visitFrom: date('visit_from'),
  visitTo: date('visit_to'),
  resultYes: boolean('result_yes').notNull(),
  reportFileId: uuid('report_file_id').references(() => fileObjects.id),
  expiresOn: date('expires_on'),
  comment: text('comment'),
  source: valueSource('source').notNull().default('manual'),
  recordedBy: uuid('recorded_by').references(() => userAccounts.id),
  createdAt: createdAt(),
});

/** Due diligence: Adata + правка эксперта + расширенная проверка (IMBC-10…12). */
export const dueDiligenceRecords = pgTable('due_diligence_records', {
  id: id(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => manufacturerProfiles.id, { onDelete: 'cascade' }),
  checkedOn: date('checked_on').notNull(),
  adataResult: ddResult('adata_result'),
  result: ddResult('result').notNull(),
  comment: text('comment'),
  reportFileId: uuid('report_file_id').references(() => fileObjects.id),
  enhancedDone: boolean('enhanced_done').notNull().default(false),
  enhancedComment: text('enhanced_comment'),
  enhancedReportFileId: uuid('enhanced_report_file_id').references(() => fileObjects.id),
  changedBy: uuid('changed_by').references(() => userAccounts.id),
  createdAt: createdAt(),
});

/** Попытка внешней проверки; результат заглушки помечен как тестовый (EXT-01…05). */
export const externalChecks = pgTable(
  'external_checks',
  {
    id: id(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => manufacturerProfiles.id, { onDelete: 'cascade' }),
    connector: text('connector').notNull(),
    bin: text('bin').notNull(),
    status: checkStatus('status').notNull(),
    value: jsonb('value'),
    source: text('source').notNull(),
    isTestData: boolean('is_test_data').notNull().default(false),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('external_checks_profile_idx').on(t.profileId, t.connector)],
);
// externalChecks — пустой каркас, удаляет релиз contract. Чтение Adata пишет в таблицы DBML ниже.

/*
 * Внешняя проверка и её попытки — по DBML (external_check, external_check_attempt), с расхождениями:
 * - external_check_attempt.value — jsonb, а не text: ответ нужен этапу 4а для IMBC-10 без второго запроса;
 * - status text и unavailable boolean заменены одним state;
 * - составные FK (profile_id, organization_id) не делаются: у manufacturer_profiles нет уникальности
 *   (id, organization_id).
 * Колонки подтверждения значения (MAN-07) добавит этап 4б тем же expand.
 */

/** Внешняя проверка профиля одним коннектором (EXT-01). Класс C: каталог, выгрузки и pull API её не читают. */
export const externalCheck = pgTable(
  'external_check',
  {
    id: id(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => manufacturerProfiles.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    connector: connectorCode('connector').notNull(),
    isMock: boolean('is_mock').notNull().default(false),
    latestAttemptId: uuid('latest_attempt_id').references((): AnyPgColumn => externalCheckAttempt.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('external_check_profile_connector_uq').on(t.profileId, t.connector)],
);

/**
 * Попытка проверки: один БИН — один запрос (IMBC-07). Попытка profile_created у проверки одна.
 * Для Adata is_test_data всегда false (EXT-02).
 */
export const externalCheckAttempt = pgTable(
  'external_check_attempt',
  {
    id: id(),
    externalCheckId: uuid('external_check_id')
      .notNull()
      .references((): AnyPgColumn => externalCheck.id, { onDelete: 'cascade' }),
    trigger: externalCheckTrigger('trigger').notNull(),
    state: externalCheckState('state').notNull().default('queued'),
    /** Текст, ведущие нули не теряются (DATA-03). */
    bin: text('bin').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    /** Get Request отправлен, единица квоты израсходована. */
    requestSentAt: timestamp('request_sent_at', { withTimezone: true }),
    allowancePeriod: date('allowance_period'),
    /** Токен проверки Adata (цифры) для продолжения опроса после рестарта. */
    pollToken: text('poll_token'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failure: text('failure'),
    /** data готового ответа, без токена. */
    value: jsonb('value'),
    source: text('source'),
    isTestData: boolean('is_test_data').notNull().default(false),
  },
  (t) => [
    uniqueIndex('external_check_attempt_created_uq')
      .on(t.externalCheckId)
      .where(sql`${t.trigger} = 'profile_created'`),
  ],
);

/** Предзаполненное значение с источником и временем чтения (MAN-06, MAN-07); строки поля — по position. */
export const prefilledValue = pgTable(
  'prefilled_value',
  {
    id: id(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => manufacturerProfiles.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => externalCheckAttempt.id, { onDelete: 'cascade' }),
    source: prefillSource('source').notNull(),
    field: prefillField('field').notNull(),
    position: smallint('position').notNull(),
    value: text('value').notNull(),
    /** Название ОКЭД. */
    label: text('label'),
    readAt: timestamp('read_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('prefilled_value_uq').on(t.attemptId, t.field, t.position),
    index('prefilled_value_profile_idx').on(t.profileId, t.source),
  ],
);

/** Израсходованная квота Adata за период (IMBC-07: 3 000 БИН в месяц). */
export const adataAllowance = pgTable(
  'adata_allowance',
  {
    periodStart: date('period_start').primaryKey(),
    used: integer('used').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('adata_allowance_used_check', sql`${t.used} >= 0`)],
);

/** Заметки IMBC и legacy-поля из Excel (IMBC-20, MIG-09). Видят эксперт и директор. */
export const imbcNotes = pgTable('imbc_notes', {
  id: id(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => manufacturerProfiles.id, { onDelete: 'cascade' }),
  text: text('text'),
  legacy: jsonb('legacy'),
  authorId: uuid('author_id').references(() => userAccounts.id),
  createdAt: createdAt(),
});

/** Works with: отметка оператора, валидирует IMBC (OPR-30, OPR-31, IMBC-30). */
export const worksWithMarks = pgTable(
  'works_with_marks',
  {
    id: id(),
    operatorOrgId: uuid('operator_org_id')
      .notNull()
      .references(() => organizations.id),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => manufacturerProfiles.id, { onDelete: 'cascade' }),
    worksWith: boolean('works_with').notNull(),
    state: markState('state').notNull().default('waiting'),
    requestedBy: uuid('requested_by').references(() => userAccounts.id),
    decidedBy: uuid('decided_by').references(() => userAccounts.id),
    createdAt: createdAt(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [index('works_with_marks_idx').on(t.profileId, t.operatorOrgId)],
);

/** Отметка визита оператора; решение видит только IMBC (OPR-40, IMBC-04). */
export const operatorVisitMarks = pgTable('operator_visit_marks', {
  id: id(),
  operatorOrgId: uuid('operator_org_id')
    .notNull()
    .references(() => organizations.id),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => manufacturerProfiles.id, { onDelete: 'cascade' }),
  visitedOn: date('visited_on').notNull(),
  fileId: uuid('file_id').references(() => fileObjects.id),
  decision: decision('decision'),
  decidedBy: uuid('decided_by').references(() => userAccounts.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => userAccounts.id),
  createdAt: createdAt(),
});

/** Заметка оператора: видна своей организации и IMBC; не редактируется (OPR-50…52). */
export const operatorNotes = pgTable(
  'operator_notes',
  {
    id: id(),
    operatorOrgId: uuid('operator_org_id')
      .notNull()
      .references(() => organizations.id),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => manufacturerProfiles.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => userAccounts.id),
    text: text('text').notNull(),
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('operator_notes_idx').on(t.profileId, t.operatorOrgId)],
);

/** Запрос оператора к IMBC (OPR-60, IMBC-31). */
export const imbcRequests = pgTable('imbc_requests', {
  id: id(),
  senderId: uuid('sender_id')
    .notNull()
    .references(() => userAccounts.id),
  operatorOrgId: uuid('operator_org_id')
    .notNull()
    .references(() => organizations.id),
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  profileId: uuid('profile_id').references(() => manufacturerProfiles.id),
  state: requestState('state').notNull().default('open'),
  reply: text('reply'),
  repliedBy: uuid('replied_by').references(() => userAccounts.id),
  repliedAt: timestamp('replied_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/** Запрос оператора к производителю: один ответ, профиль не меняет (OPR-62…65). */
export const operatorRequests = pgTable(
  'operator_requests',
  {
    id: id(),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => userAccounts.id),
    operatorOrgId: uuid('operator_org_id')
      .notNull()
      .references(() => organizations.id),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => manufacturerProfiles.id),
    section: profileSection('section'),
    freeText: text('free_text'),
    state: requestState('state').notNull().default('open'),
    reply: text('reply'),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('operator_requests_profile_idx').on(t.profileId)],
);

/** Однократная отправка NOT-11 при переходе «нет → да» (NOT-41). */
export const siteSurveyNotices = pgTable(
  'site_survey_notices',
  {
    id: id(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => manufacturerProfiles.id, { onDelete: 'cascade' }),
    surveyRecordId: uuid('survey_record_id')
      .notNull()
      .references(() => siteSurveyRecords.id),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('site_survey_notices_uq').on(t.surveyRecordId)],
);
