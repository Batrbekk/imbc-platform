import type { Locale } from "@imbc/contracts";

import type en from "../../messages/en.json";

/** Форма файлов переводов; английский — исходный (LANG-02). */
export type Messages = typeof en;

/** Файл языка загружается отдельным чанком: в сборку попадает только выбранный язык. */
export async function loadMessages(locale: Locale): Promise<Messages> {
  return (await import(`../../messages/${locale}.json`)).default as Messages;
}
