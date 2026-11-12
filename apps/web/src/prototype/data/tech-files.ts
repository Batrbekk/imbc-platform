import type { CommodityGroup } from "@imbc/contracts";

import { ACCOUNT } from "./accounts";
import { file, type FileRef } from "./common";

/**
 * Файл технических требований (FC-08, ADM-15): STR или KTRE одного продукта одной товарной группы.
 * Текст IMBC без оператора, проекта и бренда; не каталог оператора. Открывается из своего раздела.
 */
export interface TechFile {
  id: string;
  group: CommodityGroup;
  product: string;
  /** Код продукта: по нему производитель видит, есть ли у его линии STR для запроса AGAR (IMBC-25). */
  tnved: string;
  kind: "str" | "ktre";
  file: FileRef;
  uploadedBy: string;
}

const at = "2026-11-01T10:00:00+05:00";
const tech = (id: string, group: CommodityGroup, product: string, tnved: string, kind: TechFile["kind"]): TechFile => ({
  id,
  group,
  product,
  tnved,
  kind,
  file: file(`${kind}-${tnved}.pdf`, kind === "str" ? 1400 : 320, at),
  uploadedBy: ACCOUNT.administrator,
});

export const techFiles: TechFile[] = [
  tech("tf-1", "A", "Металлоконструкции модульные", "7308909809", "str"),
  tech("tf-2", "B", "Краны шаровые DN50", "8481805190", "str"),
  tech("tf-3", "B", "Краны шаровые DN50", "8481805190", "ktre"),
  tech("tf-4", "B", "Насосы центробежные", "8413702100", "str"),
  tech("tf-5", "C", "Кабель силовой 1 кВ", "8544499108", "str"),
  tech("tf-6", "C", "Кабель силовой 1 кВ", "8544499108", "ktre"),
  tech("tf-7", "E", "Спецодежда огнестойкая", "6211339000", "ktre"),
];
