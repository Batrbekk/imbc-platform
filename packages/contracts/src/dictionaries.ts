import { z } from 'zod';
import { LOCALES, type Locale } from './enums.js';

/**
 * Справочники, которые ведёт администратор IMBC (ADM-08), в порядке требования. Коды — DBML
 * `dictionary.code`; строки `dictionary` кладёт миграция `0010_stage2_reference_data`.
 */
export const DICTIONARY_CODES = [
  'region',
  'legal_form',
  'oked',
  'tn_ved',
  'kpved',
  'commodity_group',
  'commodity_type',
  'process',
  'equipment_type',
  'contact_role',
  'certificate_type',
  'document_type',
] as const;
export type DictionaryCode = (typeof DICTIONARY_CODES)[number];

/**
 * Справочники, где значения задаёт спецификация: товарные группы A–E (MAN-23, OPR-02) и роли контактов
 * (MAN-13). Администратор меняет только названия и порядок; добавить, вывести или удалить значение нельзя.
 */
export const CLOSED_DICTIONARIES = ['commodity_group', 'contact_role'] as const satisfies readonly DictionaryCode[];

/** Справочники с признаком «обязательное» (ADM-09, MAN-34, MAN-37, MAN-38). У остальных он пуст. */
export const MANDATORY_DICTIONARIES = [
  'certificate_type',
  'document_type',
] as const satisfies readonly DictionaryCode[];

/** Значение справочника указывает на значение родительского: тип товара — на свою товарную группу (DBML). */
export const DICTIONARY_PARENT: Partial<Record<DictionaryCode, DictionaryCode>> = {
  commodity_type: 'commodity_group',
};

/**
 * Остальные справочники: латинские буквы, цифры, пробел и `._-/`, 1–64 символа, без пробела по краям. Код —
 * устойчивый идентификатор, а не название (названия на трёх языках лежат в переводах), поэтому только ASCII:
 * уникальность без учёта регистра держится на `lower(code)` в индексе, а в базе с локалью `C` `lower()` не
 * меняет регистр не-ASCII букв.
 */
const GENERIC_CODE = /^[A-Za-z0-9._/-](?:[A-Za-z0-9._/ -]{0,62}[A-Za-z0-9._/-])?$/;

/**
 * Допустимый вид кода значения. Формат задаёт только MAN-25 (ТН ВЭД — десять цифр); остальные — решение
 * проекта до перечней IMBC (расхождение 7 плана этапа 2). Код — текст, ведущие нули не теряются (DATA-03);
 * после загрузки он неизменяем и уникален в справочнике без учёта регистра.
 */
export const DICTIONARY_CODE_PATTERNS: Record<DictionaryCode, RegExp> = {
  region: GENERIC_CODE,
  legal_form: GENERIC_CODE,
  oked: /^\d{5}$/,
  tn_ved: /^\d{10}$/,
  kpved: /^\d{2}(\.\d+)*$/,
  commodity_group: /^[A-E]$/,
  commodity_type: GENERIC_CODE,
  process: GENERIC_CODE,
  equipment_type: GENERIC_CODE,
  contact_role: GENERIC_CODE,
  certificate_type: GENERIC_CODE,
  document_type: GENERIC_CODE,
};

/**
 * Происхождение файла значений: `specification` — список, который фиксирует спецификация; `imbc` — перечень,
 * присланный IMBC; `provisional` — временные значения прототипа и демо-данных, только для стенда.
 */
export const REFERENCE_DATA_STATUSES = ['specification', 'imbc', 'provisional'] as const;
export type ReferenceDataStatus = (typeof REFERENCE_DATA_STATUSES)[number];

const entryName = z.string().trim().min(1).max(500);

/**
 * Наибольший порядок значения: его принимают и форма администратора, и файл загрузки — значение из файла
 * сохраняется из формы без смены порядка.
 */
export const DICTIONARY_SORT_ORDER_MAX = 100000;

/**
 * Файл значений одного справочника (`apps/api/reference-data`). Хотя бы одно название: классификаторы
 * приходят без английского, переводов не выдумываем (ADM-08). Код — только строка (DATA-03).
 */
export const referenceFileSchema = z
  .object({
    dictionary: z.enum(DICTIONARY_CODES),
    status: z.enum(REFERENCE_DATA_STATUSES),
    /** Откуда значения: требование спецификации или файл-источник. */
    source: z.string().min(1),
    entries: z
      .array(
        z
          .object({
            code: z.string().trim().min(1).max(64),
            /** Код значения родительского справочника (`DICTIONARY_PARENT`). */
            parent: z.string().trim().min(1).nullable().default(null),
            names: z
              .object({ kk: entryName.optional(), ru: entryName.optional(), en: entryName.optional() })
              .strict()
              .refine((n) => n.kk !== undefined || n.ru !== undefined || n.en !== undefined, {
                message: 'At least one name',
              }),
            mandatory: z.boolean().optional(),
            customNameAllowed: z.boolean().default(false),
            sortOrder: z.number().int().min(0).max(DICTIONARY_SORT_ORDER_MAX).default(0),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type ReferenceFile = z.infer<typeof referenceFileSchema>;

/**
 * Название значения для показа: язык пользователя → kk → ru → en → код (ADM-08). Пустое название — не название.
 */
export function entryDisplayName(names: Partial<Record<Locale, string | null>>, lang: Locale, code: string): string {
  for (const locale of [lang, 'kk', 'ru', 'en'] as const) {
    const name = names[locale];
    if (name) return name;
  }
  return code;
}

/*
 * API справочников (ADM-08, ADM-09, DATA-03, DATA-04). Список с выведенными значениями и обязательностью —
 * `reference.read`, изменения — `reference.manage`; выбор действующих значений — любой вошедший пользователь
 * (расхождение 3 плана этапа 2). Поиск и страницы — на сервере.
 */

/** Названия значения: форма администратора требует все три языка (расхождение 6 плана этапа 2). */
const names = z.object({ kk: entryName, ru: entryName, en: entryName }).strict();

/**
 * Новое значение. Код — строка (DATA-03), неизменяем после создания; порядка в форме нет: значение встаёт
 * в конец списка. `mandatory` — только у типов сертификатов и документов (ADM-09).
 */
export const createDictionaryEntrySchema = z
  .object({
    code: z.string().trim().min(1).max(64),
    parentCode: z.string().trim().min(1).max(64).nullable().default(null),
    names,
    mandatory: z.boolean().optional(),
  })
  .strict();
export type CreateDictionaryEntryInput = z.infer<typeof createDictionaryEntrySchema>;

/** Правка значения: названия, порядок и родитель; код не меняется. */
export const updateDictionaryEntrySchema = z
  .object({
    names,
    sortOrder: z.number().int().min(0).max(DICTIONARY_SORT_ORDER_MAX),
    parentCode: z.string().trim().min(1).max(64).nullable().default(null),
  })
  .strict();
export type UpdateDictionaryEntryInput = z.infer<typeof updateDictionaryEntrySchema>;

/** Обязательность типа сертификата или документа (ADM-09). */
export const entryMandatorySchema = z.object({ mandatory: z.boolean() }).strict();
export type EntryMandatoryInput = z.infer<typeof entryMandatorySchema>;

/** Какие значения показывает список администратора: действующие, выведенные из оборота (DATA-04) или все. */
export const DICTIONARY_ENTRY_STATUSES = ['active', 'retired', 'all'] as const;
export type DictionaryEntryStatus = (typeof DICTIONARY_ENTRY_STATUSES)[number];

const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(10).max(100).default(50);

/** Список администратора: `q` — начало кода или часть названия на любом языке, без учёта регистра. */
export const dictionaryEntriesQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(''),
    status: z.enum(DICTIONARY_ENTRY_STATUSES).default('active'),
    page,
    pageSize,
  })
  .strict();
export type DictionaryEntriesQuery = z.infer<typeof dictionaryEntriesQuerySchema>;

/** Выбор значения в формах и фильтрах: только действующие, одно название на языке `lang`. */
export const dictionaryChoicesQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(''),
    lang: z.enum(LOCALES).default('kk'),
    page,
    pageSize,
  })
  .strict();
export type DictionaryChoicesQuery = z.infer<typeof dictionaryChoicesQuerySchema>;

/**
 * Значение в списке администратора. Названия — по языкам, null — перевода нет (загруженные классификаторы
 * приходят без части языков). `mandatory` — null вне типов сертификатов и документов; `retiredAt` — ISO.
 */
export const dictionaryEntrySchema = z
  .object({
    id: z.uuid(),
    code: z.string(),
    parentCode: z.string().nullable(),
    names: z.object({ kk: z.string().nullable(), ru: z.string().nullable(), en: z.string().nullable() }).strict(),
    mandatory: z.boolean().nullable(),
    customNameAllowed: z.boolean(),
    sortOrder: z.number().int(),
    retiredAt: z.string().nullable(),
  })
  .strict();
export type DictionaryEntry = z.infer<typeof dictionaryEntrySchema>;

/** Справочник в списке: закрыт ли он, есть ли обязательность, родительский справочник и число значений. */
export const dictionarySummarySchema = z
  .object({
    code: z.enum(DICTIONARY_CODES),
    closed: z.boolean(),
    mandatoryApplicable: z.boolean(),
    parentDictionary: z.enum(DICTIONARY_CODES).nullable(),
    active: z.number().int(),
    retired: z.number().int(),
  })
  .strict();
export type DictionarySummary = z.infer<typeof dictionarySummarySchema>;

/** Двенадцать справочников в порядке `DICTIONARY_CODES` (ADM-08). */
export const dictionaryListSchema = z.object({ dictionaries: z.array(dictionarySummarySchema) }).strict();
export type DictionaryList = z.infer<typeof dictionaryListSchema>;

/** Страница значений; страница за последней — пустые `items` с прежним `total`. */
export const dictionaryEntriesPageSchema = z
  .object({
    dictionary: dictionarySummarySchema,
    items: z.array(dictionaryEntrySchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .strict();
export type DictionaryEntriesPage = z.infer<typeof dictionaryEntriesPageSchema>;

export const dictionaryEntryResultSchema = z.object({ entry: dictionaryEntrySchema }).strict();
export type DictionaryEntryResult = z.infer<typeof dictionaryEntryResultSchema>;

/** Значение для выбора: название — `entryDisplayName` на языке запроса. */
export const dictionaryChoiceSchema = z
  .object({ id: z.uuid(), code: z.string(), name: z.string(), parentCode: z.string().nullable() })
  .strict();
export type DictionaryChoice = z.infer<typeof dictionaryChoiceSchema>;

export const dictionaryChoicesPageSchema = z
  .object({
    items: z.array(dictionaryChoiceSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .strict();
export type DictionaryChoicesPage = z.infer<typeof dictionaryChoicesPageSchema>;

/**
 * Коды problem+json маршрутов справочников (их сервис, `actorTransaction` и SessionGuard): по ним экран
 * выбирает сообщение. `validation` — ошибка схемы тела или query, `internal` — сбой 500.
 */
export const REFERENCE_PROBLEM_CODES = [
  'validation',
  'unauthenticated',
  'mfa_required',
  'responsibility_required',
  'forbidden',
  'bad_origin',
  'not_found',
  'entry_exists',
  'code_format',
  'parent_invalid',
  'dictionary_closed',
  'mandatory_not_applicable',
  'entry_mandatory',
  'entry_retired',
  'entry_in_use',
  'busy',
  'internal',
] as const;
export type ReferenceProblemCode = (typeof REFERENCE_PROBLEM_CODES)[number];
