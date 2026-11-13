import { MAX_FILE_BYTES } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id } from './_shared.js';
import { organizations, userAccounts } from './access.js';
import { dataClass, filePurpose, fileScanState } from './enums.js';

/*
 * Файлы по DBML (`file_object`, `file_version`, `org_chart_sample`): байты — в объектном хранилище,
 * сначала в карантине, после скана — в рабочем бакете; строка домена указывает на file_object (DATA-05).
 * Скелетные `file_objects` и `file_versions` (profiles.ts) живут до contract: их читает предыдущая
 * версия приложения (NFR-06).
 */

/** Файл: владелец, назначение и класс данных. Организация пуста только у отчёта обследования без БИН. */
export const fileObject = pgTable(
  'file_object',
  {
    id: id(),
    organizationId: uuid('organization_id').references(() => organizations.id),
    purpose: filePurpose('purpose').notNull(),
    dataClass: dataClass('data_class').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('file_object_id_org_uq').on(t.id, t.organizationId)],
);

/**
 * Версия файла: имя, размер, тип, контрольная сумма и время загрузки (DATA-05). До `passed` версию
 * никто не открывает (DATA-07); прежние версии остаются.
 *
 * Отступления от DBML: номер версии больше нуля; размер от 1 байта до 25 МБ (`MAX_FILE_BYTES`, DATA-06);
 * ключ объекта уникален; частичный индекс версий, ждущих скана, — для повторной постановки в очередь;
 * тип состояния — `file_scan_state` (имя `scan_state` занято скелетом до contract).
 */
export const fileVersion = pgTable(
  'file_version',
  {
    id: id(),
    fileObjectId: uuid('file_object_id')
      .notNull()
      .references(() => fileObject.id),
    versionNumber: integer('version_number').notNull(),
    originalName: text('original_name').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    declaredMediaType: text('declared_media_type').notNull(),
    /** Тип по содержимому, а не по имени (DATA-06). */
    detectedMediaType: text('detected_media_type'),
    checksum: text('checksum').notNull(),
    scanState: fileScanState('scan_state').notNull().default('pending'),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    uploadedBy: uuid('uploaded_by').references(() => userAccounts.id),
    /** Случайный ключ объекта без имени файла (NFR-09). */
    storageKey: text('storage_key').notNull(),
  },
  (t) => [
    uniqueIndex('file_version_number_uq').on(t.fileObjectId, t.versionNumber),
    uniqueIndex('file_version_storage_key_uq').on(t.storageKey),
    check('file_version_number_ck', sql`${t.versionNumber} > 0`),
    check('file_version_byte_size_ck', sql`${t.byteSize} between 1 and ${sql.raw(String(MAX_FILE_BYTES))}`),
    index('file_version_pending_idx')
      .on(t.uploadedAt)
      .where(sql`${t.scanState} = 'pending'`),
  ],
);

/**
 * Образец оргструктуры, который производитель может скачать (MAN-19, ADM-11); не обязательный шаблон.
 * Текущий — один. Отступление от DBML: один файл — один образец. По умолчанию `is_current` — true
 * (DBML), но новый образец вставляется с false и становится текущим после скана (DATA-07).
 */
export const orgChartSample = pgTable(
  'org_chart_sample',
  {
    id: id(),
    fileObjectId: uuid('file_object_id')
      .notNull()
      .references(() => fileObject.id),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => userAccounts.id),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull(),
    isCurrent: boolean('is_current').notNull().default(true),
  },
  (t) => [
    uniqueIndex('org_chart_sample_file_uq').on(t.fileObjectId),
    // Частичный уникальный индекс не откладывается: смена текущего образца — два UPDATE (снять, затем поставить).
    uniqueIndex('org_chart_sample_current_uq')
      .on(t.isCurrent)
      .where(sql`${t.isCurrent}`),
  ],
);
