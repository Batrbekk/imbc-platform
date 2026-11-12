import type { ProtoState, ReferenceListId, SiteSurvey } from "@/prototype/data";

/** Подпись значения справочника (данные IMBC, не переводятся); неизвестный код — сам код. */
export function referenceLabel(state: ProtoState, list: ReferenceListId, code: string): string {
  return state.referenceLists.find((l) => l.id === list)?.items.find((i) => i.code === code)?.label ?? code;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Запись даёт отметку site surveyed (IMBC-02): «да», файл есть, срок не прошёл или не задан. */
export function surveyCounts(survey: SiteSurvey, on: string = today()): boolean {
  return survey.result && survey.report !== null && (survey.expiresOn === null || survey.expiresOn > on);
}

/** Организации, которые работают с производителем: последняя подтверждённая отметка — «да» (IMBC-16). */
export function worksWithOrganizations(state: ProtoState, profileId: string): string[] {
  const latest = new Map<string, boolean>();
  for (const mark of state.worksWithMarks
    .filter((m) => m.profileId === profileId && m.state === "validated")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    latest.set(mark.operatorOrgId, mark.value);
  }
  return [...latest].filter(([, value]) => value).map(([org]) => org);
}

/**
 * Тексты имитации внешних проверок хранятся ключом словаря частей досье с префиксом и переводятся
 * при показе (`ExternalChecksTable`); значение без префикса — данные, показываются как есть.
 */
export const SIM_PREFIX = "expert:";
export type SimTextKey =
  | "sim.legal_active"
  | "sim.accounting_ok"
  | "sim.eondiris_none"
  | "simSource.legal_registry"
  | "simSource.accounting"
  | "simSource.e_ondiris";
export const simText = (key: SimTextKey) => `${SIM_PREFIX}${key}`;

/** Следующая плановая проверка — через квартал (IMBC-07); нет такого дня в месяце — последний день месяца. */
export function nextCheckDate(checkedAt: string): string {
  const date = new Date(checkedAt);
  // Дата проверки по календарю Алматы (UTC+5), как её видит SME.
  const local = new Date(date.getTime() + 5 * 3_600_000);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + 3;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const target = new Date(Date.UTC(year, month, Math.min(local.getUTCDate(), lastDay)));
  return target.toISOString().slice(0, 10);
}
