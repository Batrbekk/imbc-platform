import type { Locale } from "@imbc/contracts";

import { type Dictionary, defineDictionary, translate } from "@/prototype/i18n";

/** Пункты меню и общие тексты кабинета администратора IMBC. Казахский — на проверку носителю. */
export const texts = defineDictionary({
  en: {
    "menu.assignments": "Assign reviews",
    "menu.references": "Reference lists",
    "menu.nda": "NDA versions",
    "menu.forecast": "Demand forecast",
    "menu.techFiles": "STR and KTRE files",
    "menu.migration": "Migrated manufacturers",
    "menu.api": "Pull API",
    "menu.audit": "Audit log",
    "orgType.imbc": "IMBC",
    "orgType.operator": "Operator",
    "orgType.observer": "Observer",
    "orgType.manufacturer": "Manufacturer",
    majorOperator: "Major operator",
    email: "Email",
    fullName: "Name",
    role: "Role",
    state: "State",
    lastSignIn: "Last sign-in",
    never: "Never",
    organization: "Organisation",
    actions: "Actions",
    required: "Required.",
    emailInvalid: "Enter a valid email address.",
    emailTaken: "An account with this email already exists: one account per person.",
    notAssigned: "Not assigned",
  },
  ru: {
    "menu.assignments": "Назначение проверок",
    "menu.references": "Справочники",
    "menu.nda": "Версии NDA",
    "menu.forecast": "Прогноз спроса",
    "menu.techFiles": "Файлы STR и KTRE",
    "menu.migration": "Перенесённые производители",
    "menu.api": "Pull API",
    "menu.audit": "Журнал аудита",
    "orgType.imbc": "IMBC",
    "orgType.operator": "Оператор",
    "orgType.observer": "Наблюдатель",
    "orgType.manufacturer": "Производитель",
    majorOperator: "Major operator",
    email: "Email",
    fullName: "Имя",
    role: "Роль",
    state: "Состояние",
    lastSignIn: "Последний вход",
    never: "Не входил",
    organization: "Организация",
    actions: "Действия",
    required: "Обязательное поле.",
    emailInvalid: "Введите корректный адрес почты.",
    emailTaken: "Аккаунт с этим адресом уже есть: один аккаунт на человека.",
    notAssigned: "Не назначен",
  },
  kk: {
    "menu.assignments": "Тексеруді тағайындау",
    "menu.references": "Анықтамалықтар",
    "menu.nda": "NDA нұсқалары",
    "menu.forecast": "Сұраныс болжамы",
    "menu.techFiles": "STR және KTRE файлдары",
    "menu.migration": "Көшірілген өндірушілер",
    "menu.api": "Pull API",
    "menu.audit": "Аудит журналы",
    "orgType.imbc": "IMBC",
    "orgType.operator": "Оператор",
    "orgType.observer": "Бақылаушы",
    "orgType.manufacturer": "Өндіруші",
    majorOperator: "Major operator",
    email: "Email",
    fullName: "Аты",
    role: "Рөлі",
    state: "Күйі",
    lastSignIn: "Соңғы кіру",
    never: "Кірмеген",
    organization: "Ұйым",
    actions: "Әрекеттер",
    required: "Міндетті өріс.",
    emailInvalid: "Дұрыс пошта мекенжайын енгізіңіз.",
    emailTaken: "Бұл мекенжаймен аккаунт бар: бір адамға бір аккаунт.",
    notAssigned: "Тағайындалмаған",
  },
});

/** Простая проверка адреса: один `@`, домен с точкой, без пробелов. */
export function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

/** Фраза журнала на трёх языках, когда подстановка сама зависит от языка (подпись роли, типа). */
export function localizedWith<K extends string>(
  dictionary: Dictionary<K>,
  key: K,
  values: (locale: Locale) => Record<string, string>,
): Record<Locale, string> {
  return {
    en: translate(dictionary, "en", key, values("en")),
    ru: translate(dictionary, "ru", key, values("ru")),
    kk: translate(dictionary, "kk", key, values("kk")),
  };
}
