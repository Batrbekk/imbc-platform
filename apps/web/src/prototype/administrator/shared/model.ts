import type { ReferenceList, TechFile } from "@/prototype/data";

/** У этих справочников есть отметка «обязательный» (ADM-09). */
export function hasMandatoryMark(list: ReferenceList): boolean {
  return list.id === "certificate_types" || list.id === "document_types";
}

/** Продукт — пара «название + ТН ВЭД» внутри группы: у него не больше одного STR и одного KTRE. */
export interface TechProduct {
  key: string;
  group: TechFile["group"];
  product: string;
  tnved: string;
  str: TechFile | null;
  ktre: TechFile | null;
}

export function techProducts(files: TechFile[]): TechProduct[] {
  const products = new Map<string, TechProduct>();
  for (const file of files) {
    const key = `${file.group}|${file.tnved}|${file.product}`;
    const entry = products.get(key) ?? {
      key,
      group: file.group,
      product: file.product,
      tnved: file.tnved,
      str: null,
      ktre: null,
    };
    entry[file.kind] = file;
    products.set(key, entry);
  }
  return [...products.values()];
}
