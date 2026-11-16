import type { ProductOptions, Reference } from "./api";
export function referenceName(row: Reference, locale: string) {
  return row.names[locale as keyof Reference["names"]] ?? row.names.ru ?? row.names.en ?? row.names.kk ?? row.code;
}
export function productName(row: ProductOptions["items"][number], locale: string, fallback: string) {
  return (locale === "en" ? (row.nameEn ?? row.nameRu) : (row.nameRu ?? row.nameEn)) ?? fallback;
}
