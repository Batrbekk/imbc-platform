import "@fontsource-variable/inter";
import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { readLocale } from "./i18n/locale";
import { loadMessages } from "./i18n/messages";
import { reloadApp } from "./lib/leave-app";

// Флаг одной перезагрузки при сбое старта: второй сбой подряд не зацикливает вкладку.
const STARTUP_RELOAD = "imbc:startup-reload";

// Язык — из cookie NEXT_LOCALE, по умолчанию казахский (LANG-01); грузится только его файл.
const locale = readLocale(document.cookie);
document.documentElement.lang = locale;

loadMessages(locale)
  .then((messages) => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App initialLocale={locale} initialMessages={messages} />
      </StrictMode>,
    );
    sessionStorage.removeItem(STARTUP_RELOAD);
  })
  .catch(() => {
    // Файла переводов нет — вкладка старше выката или сбой сети. Одна перезагрузка
    // подтянет свежий index.html; если и она не помогла, страницу не перезагружаем снова.
    if (sessionStorage.getItem(STARTUP_RELOAD)) return;
    sessionStorage.setItem(STARTUP_RELOAD, "1");
    reloadApp();
  });
