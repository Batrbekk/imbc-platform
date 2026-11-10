import { i18nBuilder } from "keycloakify/login";
// The UI uses translations.ts; this preserves native server validation and action messages.
export const { useI18n } = i18nBuilder.withExtraLanguages({
  kk: { label: "Қазақша", getMessages: () => import("./messages_kk") },
}).build();
