import { COMMODITY_GROUPS, PROFILE_TIERS } from "@imbc/contracts";
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
 * из @imbc/contracts: списки через запятую, логические — true/false. Запрос в
 * GET /api/v1/catalog/search строится из этих ключей, поэтому известный ключ уходит в API в том
 * же виде, что и в адресе, а ссылку можно переслать. Ключи схемы без поля в интерфейсе в запрос
 * не попадают; их список — в test/catalog.test.tsx (KEYS_WITHOUT_CONTROL).
 */
export const catalogParsers = {
  q: parseAsString.withDefault(""),
  region: parseAsArrayOf(parseAsString).withDefault([]),
  group: parseAsArrayOf(parseAsStringLiteral(COMMODITY_GROUPS)).withDefault([]),
  // Тир профиля (OPR-02); неизвестное значение (tier_3) парсер отбрасывает, и в API оно не уходит.
  tier: parseAsArrayOf(parseAsStringLiteral(PROFILE_TIERS)).withDefault([]),
  surveyed: parseAsBoolean,
  unifiedRegister: parseAsBoolean,
  tnved: parseAsString.withDefault(""),
  sort: parseAsStringLiteral(["name", "verified_at", "region"] as const).withDefault("name"),
  page: parseAsInteger.withDefault(1),
};

export const serializeCatalog = createSerializer(catalogParsers);
