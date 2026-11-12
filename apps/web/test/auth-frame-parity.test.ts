import { describe, expect, it } from "vitest";

import { copy } from "../../../infrastructure/keycloak/identity/src/login/translations";
import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";

// Тема Keycloak — отдельный пакет со своим словарём; тексты рамки скопированы туда из messages/*.json.
describe("рамка экранов входа", () => {
  it("рамка темы Keycloak и рамка SPA показывают одни и те же тексты на kk, ru и en (LANG-01)", () => {
    for (const [locale, messages] of [
      ["kk", kk],
      ["ru", ru],
      ["en", en],
    ] as const) {
      const theme = copy[locale];
      expect(
        {
          registry: theme.registry,
          description: theme.description,
          security: theme.security,
          footer: theme.footer,
          platform: theme.platform,
        },
        locale,
      ).toEqual({
        registry: messages.authLayout.title,
        description: messages.authLayout.description,
        security: messages.authLayout.security,
        footer: messages.authLayout.footer,
        platform: messages.common.appName,
      });
    }
  });
});
