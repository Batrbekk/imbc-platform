import { DEFAULT_LOCALE, type Locale } from "@imbc/contracts";
import { useCallback } from "react";
import { useLocale } from "use-intl";

import { isLocale } from "@/i18n/locale";

/** Словарь прототипа: одни и те же ключи на трёх языках (LANG-01, LANG-02). */
export type Dictionary<K extends string> = Record<Locale, Record<K, string>>;

/**
 * Типизированный словарь модуля. Английский — источник ключей; в `ru` и `kk` нужен каждый ключ
 * `en` и только они: пропущенный или лишний ключ не компилируется. Подстановки — `{name}`.
 * Числа и даты в подстановку передаются уже отформатированными через `useFormat` (LANG-04).
 */
export function defineDictionary<const K extends string>(dictionary: {
  en: Record<K, string>;
  ru: NoInfer<Record<K, string>>;
  kk: NoInfer<Record<K, string>>;
}): Dictionary<K> {
  return dictionary;
}

/** Строка словаря с подстановками `{name}`; неизвестная подстановка остаётся как есть. */
export function translate<K extends string>(
  dictionary: Dictionary<K>,
  locale: Locale,
  key: K,
  values?: Record<string, string>,
): string {
  const text = dictionary[locale][key];
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/** Строка на всех трёх языках — для `summary` события журнала (`AuditInput` в `store.ts`). */
export function localized<K extends string>(
  dictionary: Dictionary<K>,
  key: K,
  values?: Record<string, string>,
): Record<Locale, string> {
  return {
    en: translate(dictionary, "en", key, values),
    ru: translate(dictionary, "ru", key, values),
    kk: translate(dictionary, "kk", key, values),
  };
}

/** Язык интерфейса как `Locale`; неизвестное значение — казахский (LANG-01). */
export function useProtoLocale(): Locale {
  const locale = useLocale();
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

/** Функция перевода словаря модуля на языке интерфейса: `const t = useDictionary(texts); t("title")`. */
export function useDictionary<K extends string>(
  dictionary: Dictionary<K>,
): (key: K, values?: Record<string, string>) => string {
  const locale = useProtoLocale();
  return useCallback((key, values) => translate(dictionary, locale, key, values), [dictionary, locale]);
}
