import { z } from 'zod';
import type { Locale } from './enums.js';

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
            sortOrder: z.number().int().min(0).default(0),
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
