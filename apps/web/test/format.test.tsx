// Даты и числа по языку интерфейса (LANG-04) в часовом поясе Алматы (DATA-08).
import type { Locale } from "@imbc/contracts";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { type AppFormat, useFormat } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import { I18nProvider } from "@/i18n/provider";

import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";

const MESSAGES: Record<Locale, Messages> = { en, kk, ru };

function formatFor(locale: Locale): AppFormat {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider initialLocale={locale} initialMessages={MESSAGES[locale]}>
      {children}
    </I18nProvider>
  );
  return renderHook(() => useFormat(), { wrapper }).result.current;
}

const NBSP = " ";

describe("useFormat", () => {
  it("неверная или отсутствующая дата — «—» на всех трёх языках, страница не падает", () => {
    for (const locale of ["kk", "ru", "en"] as const) {
      const format = formatFor(locale);
      for (const value of [new Date("not a date"), "not a date", Number.NaN, null, undefined]) {
        expect(format.date(value), `${locale} date(${String(value)})`).toBe("—");
        expect(format.dateTime(value), `${locale} dateTime(${String(value)})`).toBe("—");
      }
    }
  });

  it("kk: дата и время через границу года и ровно в полночь по Алматы", () => {
    const format = formatFor("kk");
    // 19:30 UTC 31 декабря — уже 00:30 1 января в Алматы (UTC+5).
    expect(format.dateTime("2026-12-31T19:30:00Z")).toBe("01.01.2027, 00:30");
    expect(format.date("2026-12-31T19:30:00Z")).toBe("01.01.2027");
    // Ровно полночь — 00:00, а не 24:00 предыдущего дня.
    expect(format.dateTime("2026-10-14T19:00:00Z")).toBe("15.10.2026, 00:00");
  });

  it("kk: числа — отрицательные, ноль, тысячи; разделитель разрядов — неразрывный пробел", () => {
    const format = formatFor("kk");
    expect(format.number(0)).toBe("0");
    expect(format.number(-0)).toBe("0");
    expect(format.number(-1234.5)).toBe(`-1${NBSP}234,5`);
    expect(format.number(-0.25)).toBe("-0,25");
    expect(format.number(1000)).toBe(`1${NBSP}000`);
    expect(format.number(999)).toBe("999");
    expect(format.number(1234567)).toBe(`1${NBSP}234${NBSP}567`);
  });

  it("ru и en: числа — отрицательные, ноль, тысячи — по правилам языка", () => {
    for (const locale of ["ru", "en"] as const) {
      const format = formatFor(locale);
      const intl = new Intl.NumberFormat(locale);
      for (const value of [0, -1234.5, 1000, 1234567]) expect(format.number(value)).toBe(intl.format(value));
    }
  });
});
