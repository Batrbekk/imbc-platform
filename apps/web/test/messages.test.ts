import { describe, expect, it } from "vitest";

import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";

// Три языка не расходятся (LANG-01, AGENTS.md): каждый видимый текст есть в kk, ru и en.
const messages = { en, kk, ru } as const;
const LOCALES = ["kk", "ru", "en"] as const;

/** Пары «путь ключа — строка» в порядке файла. */
function entries(node: unknown, prefix = ""): [string, unknown][] {
  if (node === null || typeof node !== "object") return [[prefix, node]];
  return Object.entries(node).flatMap(([key, value]) => entries(value, prefix ? `${prefix}.${key}` : key));
}

function keyPaths(locale: (typeof LOCALES)[number]): string[] {
  return entries(messages[locale]).map(([path]) => path);
}

function placeholders(text: unknown): string[] {
  return [...new Set([...String(text).matchAll(/\{(\w+)/g)].map((match) => match[1]))].sort();
}

describe("файлы переводов", () => {
  it("kk и ru содержат ровно ключи en — английский исходный (LANG-02)", () => {
    const reference = keyPaths("en").sort();
    for (const locale of ["kk", "ru"] as const) expect(keyPaths(locale).sort(), locale).toEqual(reference);
  });

  it("плейсхолдеры ICU каждой строки совпадают с en", () => {
    const reference = new Map(entries(en));
    for (const locale of ["kk", "ru"] as const) {
      for (const [path, text] of entries(messages[locale]))
        expect(placeholders(text), `${locale}: ${path}`).toEqual(placeholders(reference.get(path)));
    }
  });

  it("пустых строк нет", () => {
    for (const locale of LOCALES) {
      for (const [path, text] of entries(messages[locale])) {
        expect(typeof text, `${locale}: ${path}`).toBe("string");
        expect(String(text).trim(), `${locale}: ${path}`).not.toBe("");
      }
    }
  });

  it("переводы v1.3 на месте, прежних ключей нет", () => {
    // Раздел 3.1 и UPD-06: observer вместо spectator, unresponsive вместо inactive.
    for (const locale of LOCALES) {
      const keys = keyPaths(locale);
      for (const path of ["roles.observer", "catalog.status.unresponsive", "dashboard.unresponsive"])
        expect(keys, `${locale}: нет ключа ${path}`).toContain(path);
      for (const path of ["roles.spectator", "catalog.status.inactive", "dashboard.inactive"])
        expect(keys, `${locale}: остался ключ ${path}`).not.toContain(path);
      // Состояние аккаунта inactive (AUTH-07) не переименовывается.
      expect(keys, `${locale}: нет ключа login.errors.account_inactive`).toContain("login.errors.account_inactive");
    }
  });
});
