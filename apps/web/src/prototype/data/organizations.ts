import type { OrganizationType } from "@imbc/contracts";

/** Организация (раздел 9.1): тип, название, отметка major operator (GEN-05). */
export interface ProtoOrganization {
  id: string;
  type: OrganizationType;
  name: string;
  /** Только у производителя: БИН (DATA-03, текст). */
  bin: string | null;
  majorOperator: boolean;
  createdAt: string;
}

/** Организации IMBC, операторов и наблюдателей. Настоящих названий операторов нет. */
export const ORG = {
  imbc: "org-imbc",
  /** Организация демо-оператора seed (`operator@operator.local`). */
  operatorDemo: "org-operator-demo",
  operatorB: "org-operator-b",
  operatorC: "org-operator-c",
  observerDemo: "org-observer-demo",
} as const;

/**
 * Двенадцать производителей — как в seed: восемь в каталоге, четыре вне его (очередь и Draft).
 * БИН — те же, что даёт `demoBin(1…12)` seed.
 */
export const MANUFACTURERS = [
  { id: "org-m01", name: "ТОО «Демо Металл Конструкция»", nameEn: "Demo Metal Structures LLP", bin: "240100001001" },
  { id: "org-m02", name: "ТОО «Каспий Демо Сервис»", nameEn: "Caspian Demo Service LLP", bin: "240100002006" },
  { id: "org-m03", name: "АО «Пример Кабель»", nameEn: "Example Cable JSC", bin: "240100003008" },
  { id: "org-m04", name: "ТОО «Тест Химия»", nameEn: "Test Chemicals LLP", bin: "240100004006" },
  { id: "org-m05", name: "ТОО «Образец Спецодежда»", nameEn: "Sample Workwear LLP", bin: "240100005004" },
  { id: "org-m06", name: "ТОО «Демо Насос Завод»", nameEn: "Demo Pump Plant LLP", bin: "240100006002" },
  { id: "org-m07", name: "ТОО «Степь Пластик»", nameEn: "Steppe Plastics LLP", bin: "240100007000" },
  { id: "org-m08", name: "ТОО «Атырау Демо Арматура»", nameEn: "Atyrau Demo Valves LLP", bin: "240100008009" },
  { id: "org-m09", name: "ТОО «Жаңа Демо Құрылыс»", nameEn: "Zhana Demo Construction LLP", bin: "240100009007" },
  { id: "org-m10", name: "ТОО «Демо Агро Өнім»", nameEn: "Demo Agro Product LLP", bin: "240100010000" },
  { id: "org-m11", name: "ТОО «Демо Электро Монтаж»", nameEn: "Demo Electrical Installation LLP", bin: "240100011009" },
  { id: "org-m12", name: "ТОО «Демо Жоба»", nameEn: "Demo Project LLP", bin: "240100012007" },
] as const;

export const organizations: ProtoOrganization[] = [
  { id: ORG.imbc, type: "imbc", name: "IMBC", bin: null, majorOperator: false, createdAt: "2026-09-01T09:00:00+05:00" },
  {
    id: ORG.operatorDemo,
    type: "operator",
    name: "Оператор (демо)",
    bin: null,
    majorOperator: true,
    createdAt: "2026-09-01T09:00:00+05:00",
  },
  {
    id: ORG.operatorB,
    type: "operator",
    name: "Оператор Б (демо)",
    bin: null,
    majorOperator: true,
    createdAt: "2026-09-01T09:00:00+05:00",
  },
  {
    id: ORG.operatorC,
    type: "operator",
    name: "Оператор В (демо)",
    bin: null,
    majorOperator: true,
    createdAt: "2026-09-01T09:00:00+05:00",
  },
  {
    id: ORG.observerDemo,
    type: "observer",
    name: "Наблюдатель (демо)",
    bin: null,
    majorOperator: false,
    createdAt: "2026-09-02T09:00:00+05:00",
  },
  ...MANUFACTURERS.map((m, i) => ({
    id: m.id,
    type: "manufacturer" as const,
    name: m.name,
    bin: m.bin,
    majorOperator: false,
    createdAt: `2026-${i < 8 ? "09" : "11"}-${String(3 + i).padStart(2, "0")}T10:00:00+05:00`,
  })),
];
