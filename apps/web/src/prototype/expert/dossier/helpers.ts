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
