import { describe, expect, it } from "vitest";

import { LOCALE_COOKIE, localeCookie, readLocale } from "@/i18n/locale";

// Язык — cookie NEXT_LOCALE без префикса в адресе, по умолчанию казахский (LANG-01).
describe("cookie языка", () => {
  it("имя cookie общее с темой Keycloak", () => {
    expect(LOCALE_COOKIE).toBe("NEXT_LOCALE");
  });

  it("читает язык из cookie, неизвестное значение и отсутствие — kk (LANG-01)", () => {
    expect(readLocale("")).toBe("kk");
    expect(readLocale("imbc-device=x; NEXT_LOCALE=ru")).toBe("ru");
    expect(readLocale("NEXT_LOCALE=de")).toBe("kk");
    // Первая — с более точным Path.
    expect(readLocale("NEXT_LOCALE=en; NEXT_LOCALE=ru")).toBe("en");
  });

  it("пишет cookie на год для всего сайта, на HTTPS — с Secure", () => {
    expect(localeCookie("ru", false)).toBe("NEXT_LOCALE=ru; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(localeCookie("en", true)).toBe("NEXT_LOCALE=en; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
  });
});
