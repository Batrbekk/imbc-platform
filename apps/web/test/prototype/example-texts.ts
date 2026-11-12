import { defineDictionary } from "@/prototype/i18n";

/** Словарь примера модуля: английский — источник ключей, ru и kk — те же ключи. */
export const texts = defineDictionary({
  en: { menu: "Notes (example)", title: "Notes on {company}", add: "Add note", added: "Added an operator note" },
  ru: {
    menu: "Заметки (пример)",
    title: "Заметки о {company}",
    add: "Добавить заметку",
    added: "Добавлена заметка оператора",
  },
  kk: {
    menu: "Жазбалар (мысал)",
    title: "{company} туралы жазбалар",
    add: "Жазба қосу",
    added: "Оператор жазбасы қосылды",
  },
});
