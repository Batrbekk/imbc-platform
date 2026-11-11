import type { Locale } from "@imbc/contracts";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { IntlProvider } from "use-intl";

import { reloadApp } from "@/lib/leave-app";

import { localeCookie } from "./locale";
import { loadMessages, type Messages } from "./messages";

interface LocaleSwitch {
  locale: Locale;
  pending: boolean;
  change(next: Locale): Promise<void>;
}

const LocaleSwitchContext = createContext<LocaleSwitch | null>(null);

/**
 * Переводы и форматы для всего приложения. Даты и числа — по выбранному языку
 * и в часовом поясе Казахстана (LANG-04, DATA-08).
 */
export function I18nProvider({
  initialLocale,
  initialMessages,
  children,
}: {
  initialLocale: Locale;
  initialMessages: Messages;
  children: ReactNode;
}) {
  const [current, setCurrent] = useState({ locale: initialLocale, messages: initialMessages });
  const [pending, setPending] = useState(false);

  // Язык меняется на месте: адрес и состояние страницы сохраняются (LANG-01, OPR-05).
  const change = useCallback(async (next: Locale) => {
    document.cookie = localeCookie(next, window.location.protocol === "https:");
    setPending(true);
    let messages: Messages;
    try {
      messages = await loadMessages(next);
    } catch {
      // Чанка языка нет — вкладка старше выката. Cookie уже записан, после перезагрузки
      // страница откроется на выбранном языке.
      reloadApp();
      return;
    }
    setCurrent({ locale: next, messages });
    setPending(false);
    document.documentElement.lang = next;
  }, []);

  const value = useMemo(() => ({ locale: current.locale, pending, change }), [current.locale, pending, change]);

  return (
    <LocaleSwitchContext value={value}>
      <IntlProvider locale={current.locale} messages={current.messages} timeZone="Asia/Almaty">
        {children}
      </IntlProvider>
    </LocaleSwitchContext>
  );
}

// Хук живёт рядом с провайдером, чей контекст читает; правка файла перезагрузит страницу целиком.
// eslint-disable-next-line react-refresh/only-export-components
export function useLocaleSwitch(): LocaleSwitch {
  const value = useContext(LocaleSwitchContext);
  if (!value) throw new Error("useLocaleSwitch вызван вне I18nProvider");
  return value;
}
