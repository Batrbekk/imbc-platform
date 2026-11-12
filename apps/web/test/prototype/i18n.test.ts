// Словари прототипа: одни и те же ключи на трёх языках (LANG-01, LANG-02).
import { LOCALES, PROFILE_STATUSES, PROFILE_TIERS, UPDATE_STATUSES } from "@imbc/contracts";
import { describe, expect, it } from "vitest";

import { defineDictionary, localized, translate } from "@/prototype/i18n";
import { commonTexts } from "@/prototype/labels";

import kk from "../../messages/kk.json";
import ru from "../../messages/ru.json";

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

  it("статусы профиля, актуальности и тиры по-русски и по-казахски — как в готовых страницах", () => {
    for (const [locale, messages] of [
      ["ru", ru],
      ["kk", kk],
    ] as const) {
      const labels = commonTexts[locale];
      for (const status of PROFILE_STATUSES)
        expect(labels[`profileStatus.${status}`], `${locale} ${status}`).toBe(messages.profile.statusValue[status]);
      for (const status of UPDATE_STATUSES)
        expect(labels[`updateStatus.${status}`], `${locale} ${status}`).toBe(messages.catalog.status[status]);
      for (const tier of PROFILE_TIERS)
        expect(labels[`tier.${tier}`], `${locale} ${tier}`).toBe(messages.catalog.tierShort[tier]);
    }
    // Tier 3 — по тому же образцу.
    expect(commonTexts.ru["tier.tier_3"]).toBe("Тир 3");
    expect(commonTexts.kk["tier.tier_3"]).toBe("3-тир");
  });

  it("по-русски и по-казахски нет английских подписей, кроме терминов глоссария", () => {
    const KEPT = /^(SME|STR|KTRE|AGAR|CDP|NDA|Release 2|—)$/;
    for (const locale of ["ru", "kk"] as const) {
      for (const [key, value] of Object.entries(commonTexts[locale])) {
        if (KEPT.test(value)) continue;
        expect(value === commonTexts.en[key as keyof typeof commonTexts.en], `${locale}.${key}: ${value}`).toBe(false);
        expect(/^[A-Za-z0-9 .,]+$/.test(value), `${locale}.${key}: ${value}`).toBe(false);
      }
    }
  });
});
