import type { DictionaryCode } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';

/** Колонка, где хранится код значения справочника: текст или массив текстов (DATA-03). */
export interface DictionaryUsage {
  table: string;
  column: string;
  array: boolean;
}

/**
 * Где используется значение (DATA-04, расхождение 8 плана этапа 2): таблиц профиля DBML ещё нет, коды лежат
 * текстом в проекции каталога и скелетных таблицах редакций. С этапа 3 ссылки по внешнему ключу ловит и БД
 * (`23503` при удалении — тоже 409 `entry_in_use`). Закрытые справочники не удаляются — ссылок нет.
 */
export const DICTIONARY_USAGES: Record<DictionaryCode, readonly DictionaryUsage[]> = {
  region: [{ table: 'catalog_visible', column: 'region', array: false }],
  legal_form: [],
  oked: [{ table: 'catalog_visible', column: 'oked_codes', array: true }],
  tn_ved: [
    { table: 'catalog_visible', column: 'tnved_codes', array: true },
    { table: 'catalog_visible', column: 'main_tnved', array: false },
    { table: 'product_lines', column: 'tnved', array: false },
  ],
  kpved: [
    { table: 'catalog_visible', column: 'kpved_codes', array: true },
    { table: 'product_lines', column: 'kpved', array: false },
  ],
  commodity_group: [],
  commodity_type: [
    { table: 'catalog_visible', column: 'commodity_types', array: true },
    { table: 'product_lines', column: 'commodity_type', array: false },
  ],
  process: [],
  equipment_type: [{ table: 'equipment_items', column: 'type', array: false }],
  contact_role: [],
  certificate_type: [
    { table: 'catalog_visible', column: 'certificate_types', array: true },
    { table: 'certificates', column: 'type_code', array: false },
  ],
  document_type: [{ table: 'documents', column: 'type_code', array: false }],
};

/**
 * Используется ли код значения: точное совпадение текста, у массивов — `= any(column)`. Вызывается под
 * блокировкой строки значения (`for no key update`), в транзакции удаления.
 */
export async function entryInUse(tx: Database, dictionary: DictionaryCode, code: string): Promise<boolean> {
  for (const usage of DICTIONARY_USAGES[dictionary]) {
    const column = sql.identifier(usage.column);
    const matches = usage.array ? sql`${code} = any(${column})` : sql`${column} = ${code}`;
    const { rows } = await tx.execute<{ used: boolean }>(
      sql`select exists (select 1 from ${sql.identifier(usage.table)} where ${matches}) as used`,
    );
    if (rows[0]?.used) return true;
  }
  return false;
}
