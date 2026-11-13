import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id } from './_shared.js';
import { locale } from './enums.js';

/*
 * Справочники ADM-08 по DBML (`dictionary`, `dictionary_entry`, `dictionary_entry_translation`).
 * Скелетные `dictionaries` и `dictionary_entries` (platform.ts) живут до contract (NFR-06).
 */

/**
 * Справочник (ADM-08). Двенадцать строк кладёт миграция 0010 (коды — `DICTIONARY_CODES`); справочники
 * меняются только релизом: у роли приложения есть лишь SELECT (app-role.ts).
 */
export const dictionary = pgTable(
  'dictionary',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('dictionary_code_uq').on(t.code)],
);

/**
 * Значение справочника. Код — текст: ведущие нули не теряются (DATA-03). Используемое значение не
 * удаляется, а выводится из оборота (`retired_at`, DATA-04); обязательность — только у типов
 * сертификатов и документов (ADM-09).
 *
 * Отступления от DBML: уникальность кода без учёта регистра — `(dictionary_id, lower(code))` вместо
 * `(dictionary_id, code)`: «ISO 9001» и «iso 9001» — одно значение; тот же индекс с `text_pattern_ops`
 * служит поиску по префиксу кода. Код без пробелов по краям и не пустой; значение не родитель самому себе.
 */
export const dictionaryEntry = pgTable(
  'dictionary_entry',
  {
    id: id(),
    dictionaryId: uuid('dictionary_id')
      .notNull()
      .references(() => dictionary.id),
    code: text('code').notNull(),
    /** Тип товара указывает на свою товарную группу (DBML). */
    parentEntryId: uuid('parent_entry_id').references((): AnyPgColumn => dictionaryEntry.id),
    mandatory: boolean('mandatory'),
    /** Тип сертификата «Other»: производитель вводит название сам (MAN-34). */
    customNameAllowed: boolean('custom_name_allowed').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('dictionary_entry_code_uq').on(t.dictionaryId, sql`lower(${t.code}) text_pattern_ops`),
    check('dictionary_entry_code_ck', sql`${t.code} <> '' and ${t.code} = btrim(${t.code})`),
    check('dictionary_entry_parent_ck', sql`${t.parentEntryId} <> ${t.id}`),
  ],
);

/**
 * Название значения на одном языке — отдельная строка (DATA-02). Тексты интерфейса живут в языковых
 * файлах, здесь — только названия значений (LANG-05). Отступления от DBML: язык — тип `locale`
 * (значения DBML `language_code` те же); переводы удаляются вместе со значением; триграммный индекс
 * названия — для поиска администратора.
 */
export const dictionaryEntryTranslation = pgTable(
  'dictionary_entry_translation',
  {
    dictionaryEntryId: uuid('dictionary_entry_id').notNull(),
    language: locale('language').notNull(),
    name: text('name').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.dictionaryEntryId, t.language] }),
    // Имя задано: имя по умолчанию длиннее 63 символов, и PostgreSQL обрезал бы его.
    foreignKey({
      name: 'dictionary_entry_translation_entry_fk',
      columns: [t.dictionaryEntryId],
      foreignColumns: [dictionaryEntry.id],
    }).onDelete('cascade'),
    index('dictionary_entry_translation_name_trgm').using('gin', sql`${t.name} gin_trgm_ops`),
    check('dictionary_entry_translation_name_ck', sql`${t.name} <> '' and ${t.name} = btrim(${t.name})`),
  ],
);
