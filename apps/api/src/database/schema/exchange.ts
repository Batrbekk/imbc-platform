import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './_shared.js';
import { userAccounts } from './access.js';
import { commodityGroup, exportFormat, runResult, subscriptionPeriod } from './enums.js';
import { fileObjects, manufacturerProfiles } from './profiles.js';

/** Подписка пользователя-оператора на сохранённый поиск (OPR-21…24, R2). */
export const exportSubscriptions = pgTable('export_subscriptions', {
  id: id(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => userAccounts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  filters: jsonb('filters').notNull(),
  format: exportFormat('format').notNull(),
  period: subscriptionPeriod('period').notNull(),
  paused: boolean('paused').notNull().default(false),
  pausedReason: text('paused_reason'),
  createdAt: createdAt(),
});

/** Запуск подписки или разовая выгрузка; файл хранится 90 дней (OPR-23). */
export const exportFiles = pgTable(
  'export_files',
  {
    id: id(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => exportSubscriptions.id, { onDelete: 'set null' }),
    format: exportFormat('format').notNull(),
    filters: jsonb('filters').notNull(),
    result: runResult('result').notNull(),
    rowCount: integer('row_count'),
    bucket: text('bucket'),
    objectKey: text('object_key'),
    sha256: text('sha256'),
    contractVersion: text('contract_version').notNull().default('1'),
    error: text('error'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('export_files_owner_idx').on(t.ownerId, t.createdAt)],
);

/** Версии прогноза; опубликованная заменяет предыдущую одним указателем (ADM-20…22). */
export const forecastVersions = pgTable('forecast_versions', {
  id: id(),
  sourceFileId: uuid('source_file_id').references(() => fileObjects.id),
  importReport: jsonb('import_report'),
  rowCount: integer('row_count').notNull().default(0),
  isPublished: boolean('is_published').notNull().default(false),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  importedBy: uuid('imported_by').references(() => userAccounts.id),
  createdAt: createdAt(),
});

/** Строка прогноза (FC-05): без оператора и без FPAL. ~85 тыс. строк на версию. */
export const forecastLines = pgTable(
  'forecast_lines',
  {
    id: id(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => forecastVersions.id, { onDelete: 'cascade' }),
    tnved: text('tnved').notNull(),
    commodityGroup: commodityGroup('commodity_group').notNull(),
    commodityType: text('commodity_type').notNull(),
    description: text('description').notNull(),
    unit: text('unit').notNull(),
    totalQuantity: numeric('total_quantity', { precision: 18, scale: 3 }).notNull(),
  },
  (t) => [
    index('forecast_lines_filter_idx').on(t.versionId, t.commodityGroup, t.commodityType),
    index('forecast_lines_tnved_idx').on(t.versionId, t.tnved.op('text_pattern_ops')),
  ],
);

/** Файлы обобщённых технических спецификаций (FC-08, ADM-23). */
export const techSpecFiles = pgTable('tech_spec_files', {
  id: id(),
  name: text('name').notNull(),
  commodityGroup: commodityGroup('commodity_group').notNull(),
  fileId: uuid('file_id')
    .notNull()
    .references(() => fileObjects.id),
  createdAt: createdAt(),
  removedAt: timestamp('removed_at', { withTimezone: true }),
});
