import { useFormatter, useLocale } from "use-intl";

/** Часовой пояс всех дат интерфейса (DATA-08). */
export const TIME_ZONE = "Asia/Almaty";

/** Даты и числа интерфейса. Все страницы форматируют только через `useFormat` (LANG-04). */
export interface AppFormat {
  /** Дата без времени: «15.10.2026» (kk, ru), «Oct 15, 2026» (en). */
  date(value: Date | string | number): string;
  /** Дата и время: «15.10.2026, 14:30» (kk, ru), «10/15/26, 2:30 PM» (en). */
  dateTime(value: Date | string | number): string;
  /** Число: «1 234 567,5» (kk, ru), «1,234,567.5» (en). */
  number(value: number): string;
}

/**
 * Даты и числа по языку интерфейса (LANG-04) в часовом поясе Алматы (DATA-08).
 *
 * Казахский форматируется здесь, без данных локали из ICU браузера: в Chrome их для kk нет,
 * и `Intl` с локалью kk отдаёт корневой шаблон («2026 M10 15», «1,234,567.5») при том, что
 * `supportedLocalesOf(['kk'])` отвечает `['kk']` (LANG-01, NFR-13). Правила — как у русского:
 * дата dd.MM.yyyy, время HH:mm, пробел между разрядами, запятая перед дробной частью.
 * Русский и английский — через use-intl, как раньше.
 */
export function useFormat(): AppFormat {
  const locale = useLocale();
  const format = useFormatter();
  if (locale === "kk") return KAZAKH;
  return {
    date: (value) => format.dateTime(toDate(value), { dateStyle: "medium" }),
    dateTime: (value) => format.dateTime(toDate(value), { dateStyle: "short", timeStyle: "short" }),
    number: (value) => format.number(value),
  };
}

const toDate = (value: Date | string | number) => (value instanceof Date ? value : new Date(value));
const pad = (value: number) => String(value).padStart(2, "0");

let almaty: Intl.DateTimeFormat | undefined;

/**
 * Поля даты по часам Алматы. `Intl` нужен только для правил часового пояса (база tz браузера):
 * локаль en-US есть в любом браузере, из её вывода берутся только числа по типам частей.
 */
function almatyFields(value: Date | string | number) {
  almaty ??= new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    numberingSystem: "latn",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });
  const fields: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of almaty.formatToParts(toDate(value))) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  return {
    date: `${pad(fields.day ?? 0)}.${pad(fields.month ?? 0)}.${fields.year}`,
    // Полночь — 00, а не 24 (h23).
    time: `${pad((fields.hour ?? 0) % 24)}:${pad(fields.minute ?? 0)}`,
  };
}

/** Число по правилам русской локали: до трёх знаков дроби, неразрывный пробел между разрядами. */
function kazakhNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const [whole, fraction = ""] = Math.abs(value).toFixed(3).split(".");
  const digits = fraction.replace(/0+$/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const sign = value < 0 && (whole !== "0" || digits) ? "-" : "";
  return `${sign}${grouped}${digits ? `,${digits}` : ""}`;
}

const KAZAKH: AppFormat = {
  date: (value) => almatyFields(value).date,
  dateTime: (value) => {
    const { date, time } = almatyFields(value);
    return `${date}, ${time}`;
  },
  number: kazakhNumber,
};
