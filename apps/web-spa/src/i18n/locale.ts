import { DEFAULT_LOCALE, LOCALES, type Locale } from "@imbc/contracts";

/**
 * Язык интерфейса без префикса в адресе: ссылки с фильтрами одинаковы для всех языков
 * (OPR-05). Имя cookie общее с темой Keycloak, поэтому остаётся прежним (LANG-01).
 */
export const LOCALE_COOKIE = "NEXT_LOCALE";

const MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return (LOCALES as readonly unknown[]).includes(value);
}

/**
 * Язык из `document.cookie`. Браузер ставит первой cookie с более точным Path, её и берём.
 * Неизвестное значение или его отсутствие — казахский (LANG-01, GEN-20).
 */
export function readLocale(cookie: string): Locale {
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === LOCALE_COOKIE) {
      const value = rest.join("=");
      return isLocale(value) ? value : DEFAULT_LOCALE;
    }
  }
  return DEFAULT_LOCALE;
}

/** Строка для `document.cookie`: на год для всего сайта, на HTTPS — только по защищённому каналу. */
export function localeCookie(locale: Locale, secure: boolean): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
