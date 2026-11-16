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
 * Compatibility text references in catalog projection and legacy profile skeleton (DATA-04, NFR-06).
 * Keep them until an explicit contract migration; new v1.4 profile references are dictionary_entry FKs,
 * including sites, OKED/KPVED, units and submission requirements. Their 23503 is mapped by the service to
 * 409 entry_in_use, so FK columns must not be added to these code comparisons. Closed lists cannot be deleted.
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
  unit: [],
  // LPS references are UUID FKs; database 23503 is translated to entry_in_use by the service.
  country: [],
  programme: [],
  lps_status: [],
  acquisition_source: [],
  imbc_priority: [],
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
