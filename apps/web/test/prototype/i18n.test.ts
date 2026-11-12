// Словари прототипа: одни и те же ключи на трёх языках (LANG-01, LANG-02).
import { LOCALES } from "@imbc/contracts";
import { describe, expect, it } from "vitest";

import { defineDictionary, localized, translate } from "@/prototype/i18n";
import { commonTexts } from "@/prototype/labels";

const texts = defineDictionary({
  en: { hello: "Hello, {name}", plain: "Plain" },
  ru: { hello: "Здравствуйте, {name}", plain: "Просто" },
  kk: { hello: "Сәлем, {name}", plain: "Жай" },
});

describe("словарь модуля", () => {
  it("подставляет значения и оставляет неизвестные подстановки", () => {
    expect(translate(texts, "ru", "hello", { name: "Айгерим" })).toBe("Здравствуйте, Айгерим");
    expect(translate(texts, "en", "hello")).toBe("Hello, {name}");
    expect(translate(texts, "kk", "plain")).toBe("Жай");
  });

  it("localized — строка на всех трёх языках для журнала аудита", () => {
    expect(localized(texts, "hello", { name: "X" })).toEqual({ en: "Hello, X", ru: "Здравствуйте, X", kk: "Сәлем, X" });
  });

  it("пропущенный или лишний ключ не компилируется", () => {
    defineDictionary({
      en: { a: "A", b: "B" },
      // @ts-expect-error — в ru нет ключа b.
      ru: { a: "А" },
      kk: { a: "А", b: "Б" },
    });
    defineDictionary({
      en: { a: "A" },
      ru: { a: "А" },
      // @ts-expect-error — в kk лишний ключ.
      kk: { a: "А", extra: "Қосымша" },
    });
    // @ts-expect-error — ключа нет в словаре.
    translate(texts, "en", "missing");
    expect(true).toBe(true);
  });

  it("общие тексты: те же ключи и без пустых строк во всех языках", () => {
    const keys = Object.keys(commonTexts.en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(commonTexts[locale]).sort(), locale).toEqual(keys);
      for (const key of keys)
        expect(commonTexts[locale][key as keyof typeof commonTexts.en].trim(), `${locale}.${key}`).not.toBe("");
    }
  });
});
