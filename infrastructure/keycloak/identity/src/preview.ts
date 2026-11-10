import { createGetKcContextMock } from "keycloakify/login/KcContext";
import type { KcContext } from "./login/KcContext";

export function createPreviewContext(): KcContext {
  const query = new URLSearchParams(location.search);
  const pageId = (query.get("page") || "login.ftl") as KcContext["pageId"];
  const locale = query.get("locale") || "ru";
  const { getKcContextMock } = createGetKcContextMock({
    kcContextExtension: {}, kcContextExtensionPerPage: {},
    overrides: {
      themeName: "imbc", realm: { name: "imbc", displayName: "IMBC", registrationEmailAsUsername: true },
      locale: { currentLanguageTag: locale, supported: ["kk", "ru", "en"].map(languageTag => ({ languageTag, label: languageTag, url: `?page=${pageId}&locale=${languageTag}` })) },
      url: { loginAction: "#preview-submit", loginUrl: "?page=login.ftl", loginRestartFlowUrl: "?page=login.ftl" },
    },
  });
  return getKcContextMock({ pageId });
}
