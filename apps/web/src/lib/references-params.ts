import {
  CLOSED_DICTIONARIES,
  DICTIONARY_CODES,
  DICTIONARY_ENTRY_STATUSES,
  DICTIONARY_PARENT,
  type DictionaryCode,
  type DictionaryEntryStatus,
  MANDATORY_DICTIONARIES,
} from "@imbc/contracts";
import { createLoader, parseAsInteger, parseAsString, parseAsStringLiteral } from "nuqs";

/**
 * Состояние страницы «Справочники» в адресе (ADM-08): открытый справочник, поиск, вкладка статуса и страница.
 * По умолчанию — типы сертификатов, действующие значения, первая страница. Смена справочника, поиска или
 * статуса начинает с первой страницы (страница сбрасывается в самом изменении адреса). Запрос в
 * `GET /api/v1/dictionaries/:code/entries` строится из записанного адреса (`entriesPath`), поэтому
 * скопированная ссылка воспроизводит страницу.
 */
export const referencesParsers = {
  list: parseAsStringLiteral(DICTIONARY_CODES).withDefault("certificate_type"),
  q: parseAsString.withDefault(""),
  status: parseAsStringLiteral(DICTIONARY_ENTRY_STATUSES).withDefault("active"),
  page: parseAsInteger.withDefault(1),
};

/** Состояние из строки адреса (`?list=…`) теми же парсерами, что у полей. */
export const loadReferences = createLoader(referencesParsers);

export interface ReferencesState {
  list: DictionaryCode;
  q: string;
  status: DictionaryEntryStatus;
  page: number;
}

/** Предел поиска у API (`dictionaryEntriesQuerySchema`): длиннее запрос не принимается. */
const MAX_QUERY = 100;

/**
 * Путь запроса списка значений. `q` — без пробелов по краям, пустой не передаётся; страница — целое от 1
 * (`?page=0` и `?page=abc` в адресе не ломают запрос).
 */
export function entriesPath({ list, q, status, page }: ReferencesState): string {
  const params = new URLSearchParams();
  const query = q.trim().slice(0, MAX_QUERY).trim();
  if (query) params.set("q", query);
  params.set("status", status);
  params.set("page", String(Math.max(1, Math.trunc(page) || 1)));
  return `/v1/dictionaries/${list}/entries?${params}`;
}

/** Справочник, где значения задаёт спецификация: меняются только названия и порядок (MAN-13, MAN-23). */
export const isClosedDictionary = (dictionary: DictionaryCode) =>
  (CLOSED_DICTIONARIES as readonly string[]).includes(dictionary);

/** Справочник с признаком «обязательный»: типы сертификатов и документов (ADM-09). */
export const hasMandatoryMark = (dictionary: DictionaryCode) =>
  (MANDATORY_DICTIONARIES as readonly string[]).includes(dictionary);

/** Справочник, значения которого указывают на значение другого: тип товара — на товарную группу. */
export const parentDictionaryOf = (dictionary: DictionaryCode): DictionaryCode | null =>
  DICTIONARY_PARENT[dictionary] ?? null;
