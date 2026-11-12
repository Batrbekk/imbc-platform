import type { CommodityGroup } from "@imbc/contracts";

import { ACCOUNT } from "./accounts";

/**
 * Версия прогноза спроса (ADM-12…ADM-14): импорт XLSX, отчёт о строках с ошибками, публикация.
 * Производителям видна только опубликованная последней; прежние IMBC хранит.
 */
export interface ForecastVersion {
  id: string;
  fileName: string;
  importedAt: string;
  importedBy: string;
  publishedAt: string | null;
  publishedBy: string | null;
  rowsTotal: number;
  problems: { row: number; message: string }[];
}

/** Строка прогноза (FC-05): без оператора, проекта и бренда, без разбивки количества. */
export interface ForecastLine {
  id: string;
  versionId: string;
  tnved: string;
  group: CommodityGroup;
  commodityType: string;
  description: string;
  unit: string;
  /** Общее ожидаемое количество до конца горизонта прогноза. */
  quantity: number;
}

export const forecastVersions: ForecastVersion[] = [
  {
    id: "fc-2026-10",
    fileName: "forecast-2026-10.xlsx",
    importedAt: "2026-10-14T10:00:00+05:00",
    importedBy: ACCOUNT.administrator,
    publishedAt: "2026-10-15T09:00:00+05:00",
    publishedBy: ACCOUNT.administrator,
    rowsTotal: 14,
    problems: [],
  },
  {
    id: "fc-2026-11",
    fileName: "forecast-2026-11.xlsx",
    importedAt: "2026-11-05T10:00:00+05:00",
    importedBy: ACCOUNT.administrator,
    publishedAt: "2026-11-06T09:00:00+05:00",
    publishedBy: ACCOUNT.administrator,
    rowsTotal: 16,
    problems: [],
  },
  // Импортирована, не опубликована; строки с ошибками не остановили импорт (ADM-13).
  {
    id: "fc-2026-11b",
    fileName: "forecast-2026-11-update.xlsx",
    importedAt: "2026-11-11T16:00:00+05:00",
    importedBy: ACCOUNT.administrator,
    publishedAt: null,
    publishedBy: null,
    rowsTotal: 18,
    problems: [
      { row: 7, message: "Нет описания" },
      { row: 12, message: "Количество не число: «около 300»" },
    ],
  },
];

const LINES: [tnved: string, group: CommodityGroup, type: string, description: string, unit: string, qty: number][] = [
  ["7308909809", "A", "Steel structures", "Металлоконструкции каркасов зданий", "т", 4200],
  ["7308905900", "A", "Steel structures", "Площадки обслуживания стальные", "т", 860],
  ["7304190000", "A", "Pipes", "Трубы стальные бесшовные", "т", 12500],
  ["8481805190", "B", "Valves", "Краны шаровые DN50 PN40", "шт", 3100],
  ["8481809907", "B", "Valves", "Задвижки клиновые DN150", "шт", 740],
  ["8413702100", "B", "Pumps", "Насосы центробежные одноступенчатые", "шт", 120],
  ["8419500000", "B", "Heat exchangers", "Теплообменники кожухотрубные", "шт", 45],
  ["8544499108", "C", "Cables", "Кабель силовой 1 кВ с медными жилами", "км", 380],
  ["8537109100", "C", "Electrical equipment", "Щиты распределительные низковольтные", "шт", 260],
  ["8504409000", "C", "Electrical equipment", "Источники бесперебойного питания", "шт", 90],
  ["3824999609", "D", "Chemicals", "Реагенты для буровых растворов", "т", 1500],
  ["3917400009", "D", "Pipes and fittings", "Фитинги из полимерных материалов", "шт", 26000],
  ["2710198200", "D", "Lubricants", "Масла индустриальные", "т", 640],
  ["6211339000", "E", "Workwear", "Костюмы огнестойкие летние", "компл", 18000],
  ["6403400000", "E", "Workwear", "Обувь защитная с металлическим подноском", "пар", 21000],
  ["1101001500", "E", "Food", "Мука пшеничная высшего сорта", "т", 900],
];

export const forecastLines: ForecastLine[] = [
  ...LINES.map(([tnved, group, commodityType, description, unit, quantity], i) => ({
    id: `fl-11-${i + 1}`,
    versionId: "fc-2026-11",
    tnved,
    group,
    commodityType,
    description,
    unit,
    quantity,
  })),
  ...LINES.slice(0, 14).map(([tnved, group, commodityType, description, unit, quantity], i) => ({
    id: `fl-10-${i + 1}`,
    versionId: "fc-2026-10",
    tnved,
    group,
    commodityType,
    description,
    unit,
    quantity: Math.round(quantity * 0.9),
  })),
];
