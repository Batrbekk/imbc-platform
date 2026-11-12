import { file, type FileRef } from "./common";

/** Справочники ADM-08. */
export type ReferenceListId =
  | "regions"
  | "legal_forms"
  | "oked"
  | "tnved"
  | "kpved"
  | "commodity_groups"
  | "commodity_types"
  | "processes"
  | "equipment_types"
  | "contact_roles"
  | "certificate_types"
  | "document_types";

/**
 * Значение справочника. Используемое значение не удаляется, а выводится из оборота (DATA-04).
 * `mandatory` — только у типов сертификатов и документов (ADM-09). Подписи — данные IMBC, не переводятся.
 */
export interface ReferenceItem {
  code: string;
  label: string;
  mandatory?: boolean;
  retired: boolean;
}

export interface ReferenceList {
  id: ReferenceListId;
  items: ReferenceItem[];
}

const items = (pairs: [code: string, label: string][]): ReferenceItem[] =>
  pairs.map(([code, label]) => ({ code, label, retired: false }));

export const referenceLists: ReferenceList[] = [
  {
    id: "regions",
    items: items([
      ["KZ-AKT", "Актюбинская область"],
      ["KZ-ALA", "Алматы"],
      ["KZ-AST", "Астана"],
      ["KZ-ATY", "Атырауская область"],
      ["KZ-KAR", "Карагандинская область"],
      ["KZ-KUS", "Костанайская область"],
      ["KZ-MAN", "Мангистауская область"],
      ["KZ-PAV", "Павлодарская область"],
      ["KZ-ZAP", "Западно-Казахстанская область"],
    ]),
  },
  {
    id: "legal_forms",
    items: items([
      ["LLP", "ТОО"],
      ["JSC", "АО"],
      ["LLC", "ООО"],
    ]),
  },
  {
    id: "oked",
    items: items([
      ["25110", "Производство строительных металлических конструкций"],
      ["28131", "Производство насосов"],
      ["27320", "Производство электрических проводов и кабелей"],
      ["33120", "Ремонт машин и оборудования"],
    ]),
  },
  {
    id: "tnved",
    items: items([
      ["7308909809", "Конструкции из чёрных металлов прочие"],
      ["8481805190", "Краны шаровые"],
      ["8413702100", "Насосы центробежные"],
      ["8544499108", "Проводники электрические прочие"],
    ]),
  },
  {
    id: "kpved",
    items: items([
      ["25.11.23", "Конструкции металлические прочие"],
      ["28.13.14", "Насосы центробежные"],
    ]),
  },
  {
    id: "commodity_groups",
    items: items([
      ["A", "Группа A"],
      ["B", "Группа B"],
      ["C", "Группа C"],
      ["D", "Группа D"],
      ["E", "Группа E"],
    ]),
  },
  {
    id: "commodity_types",
    items: [
      ...items([
        ["steel_structures", "Steel structures"],
        ["valves", "Valves"],
        ["pumps", "Pumps"],
        ["cables", "Cables"],
        ["workwear", "Workwear"],
      ]),
      { code: "misc", label: "Прочее (выведено из оборота)", retired: true },
    ],
  },
  {
    id: "processes",
    items: items([
      ["welding", "Сварка"],
      ["machining", "Механическая обработка"],
      ["painting", "Покраска"],
    ]),
  },
  {
    id: "equipment_types",
    items: items([
      ["metalworking", "Металлообработка"],
      ["lifting", "Грузоподъёмное"],
    ]),
  },
  {
    id: "contact_roles",
    items: items([
      ["management", "Руководство"],
      ["technical", "Техническое"],
      ["commercial", "Коммерческое"],
    ]),
  },
  {
    id: "certificate_types",
    items: [
      ...(["ISO 9001", "ISO 14001", "ISO 45001"] as const).map((code) => ({
        code,
        label: code,
        mandatory: true,
        retired: false,
      })),
      ...(["ASME", "API", "IEC", "IECEx", "ATEX", "Extract from e-Ondiris", "Other"] as const).map((code) => ({
        code,
        label: code,
        mandatory: false,
        retired: false,
      })),
    ],
  },
  {
    id: "document_types",
    items: [
      { code: "registration_certificate", label: "Свидетельство о регистрации", mandatory: true, retired: false },
      { code: "charter", label: "Устав", mandatory: true, retired: false },
      { code: "licence", label: "Лицензии", mandatory: true, retired: false },
    ],
  },
];

/** Образец оргструктуры (ADM-11, MAN-19). */
export const orgChartSample: FileRef = file("imbc-org-chart-sample.pdf", 180, "2026-09-01T09:00:00+05:00");
