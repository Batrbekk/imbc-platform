import { COMMODITY_GROUPS } from "@imbc/contracts";
import {
  createSerializer,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs";

/**
 * Фильтры каталога в адресе страницы (OPR-05, D-21). Формат совпадает с catalogFilterSchema
 * из @imbc/contracts: списки через запятую, логические — true/false. Поэтому query string
 * страницы без преобразований уходит в GET /api/v1/catalog/search, а ссылку можно переслать.
 */
export const catalogParsers = {
  q: parseAsString.withDefault(""),
  region: parseAsArrayOf(parseAsString).withDefault([]),
  group: parseAsArrayOf(parseAsStringLiteral(COMMODITY_GROUPS)).withDefault([]),
  surveyed: parseAsBoolean,
  unifiedRegister: parseAsBoolean,
  tnved: parseAsString.withDefault(""),
  sort: parseAsStringLiteral(["name", "verified_at", "region"] as const).withDefault("name"),
  page: parseAsInteger.withDefault(1),
};

export const serializeCatalog = createSerializer(catalogParsers);
