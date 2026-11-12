import type { Locale } from "@imbc/contracts";

import { type Dictionary, translate } from "@/prototype/i18n";

/**
 * Фраза журнала на трёх языках, где подстановка тоже переводится (название секции, итог, статус):
 * `localized` подставил бы одно значение во все языки.
 */
export function summaryOf<K extends string>(
  dictionary: Dictionary<K>,
  key: K,
  values: (locale: Locale) => Record<string, string>,
): Record<Locale, string> {
  return {
    en: translate(dictionary, "en", key, values("en")),
    ru: translate(dictionary, "ru", key, values("ru")),
    kk: translate(dictionary, "kk", key, values("kk")),
  };
}
