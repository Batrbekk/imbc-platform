import { DEFAULT_LOCALE, LOCALES, type Locale } from "@imbc/contracts";
import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export const LOCALE_COOKIE = "NEXT_LOCALE";

/**
 * Язык интерфейса без префикса в адресе: ссылки с фильтрами одинаковы для всех языков
 * (OPR-05). По умолчанию — казахский (GEN-20), переключатель пишет cookie.
 */
export default getRequestConfig(async () => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = (LOCALES as readonly string[]).includes(value ?? "") ? (value as Locale) : DEFAULT_LOCALE;
  return {
    locale,
    timeZone: "Asia/Almaty",
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
