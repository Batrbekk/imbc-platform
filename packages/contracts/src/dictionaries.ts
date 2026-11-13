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
