import "@fontsource-variable/inter";
import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { readLocale } from "./i18n/locale";
import { loadMessages } from "./i18n/messages";

// Язык — из cookie NEXT_LOCALE, по умолчанию казахский (LANG-01); грузится только его файл.
const locale = readLocale(document.cookie);
document.documentElement.lang = locale;

void loadMessages(locale).then((messages) =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App initialLocale={locale} initialMessages={messages} />
    </StrictMode>,
  ),
);
