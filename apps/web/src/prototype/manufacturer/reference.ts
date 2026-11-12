// Справочники IMBC для форм секций (ADM-08): выведенные из оборота значения не предлагаются (DATA-04).
import type { ReferenceListId } from "../data";
import { useProto } from "../store";
import type { Choice } from "./fields";

export function useReference(id: ReferenceListId, withCode = false): Choice[] {
  const items = useProto((s) => s.referenceLists.find((r) => r.id === id)?.items ?? []);
  return items
    .filter((i) => !i.retired)
    .map((i) => ({ value: i.code, label: withCode && i.label !== i.code ? `${i.code} — ${i.label}` : i.label }));
}

/** Текущее значение, которого нет в списке, остаётся выбранным (данные из e-Ondiris или переноса). */
export function withCurrent(items: Choice[], current: string | null): Choice[] {
  return current && !items.some((i) => i.value === current) ? [...items, { value: current, label: current }] : items;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Телефон: цифры, пробелы, скобки и дефисы, не меньше десяти цифр (MAN-15). */
export function isPhone(value: string): boolean {
  return /^\+?[\d\s()-]+$/.test(value) && value.replace(/\D/g, "").length >= 10;
}
