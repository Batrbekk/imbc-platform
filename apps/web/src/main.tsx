// Шрифт Inter подключает index.css рядом с темой (--font-sans).
import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { readLocale } from "./i18n/locale";
import { loadMessages } from "./i18n/messages";
import { watchBackForwardCache } from "./lib/bfcache";
import { clearReloadFlag, reloadOnce, STARTUP_RELOAD } from "./lib/reload-guard";

// Вкладка из back/forward cache перезагружается и проверяет сеанс заново (NFR-11).
watchBackForwardCache();

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
    clearReloadFlag(STARTUP_RELOAD);
  })
  .catch(() => {
    // Файла переводов нет — вкладка старше выката или сбой сети. Одна перезагрузка
    // подтянет свежий index.html. Если она уже была или sessionStorage недоступен —
    // статичное сообщение из index.html на трёх языках вместо пустой страницы.
    if (reloadOnce(STARTUP_RELOAD) !== "reloaded") document.getElementById("startup-error")?.removeAttribute("hidden");
  });
