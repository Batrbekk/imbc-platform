import type { ProfileTier } from "@imbc/contracts";

import type { ProtoProfile, ProtoState } from "./data";
import { isTier3 } from "./data/tier-records";

/**
 * Общие правила раздела 4 поверх демо-данных. Экран роли показывает ровно то, что роль вправе
 * видеть; эти функции — одна формулировка правила на все кабинеты.
 */

const today = () => new Date().toISOString().slice(0, 10);

/** Site surveyed (IMBC-02): есть запись с результатом «да» и отчётом, срок не прошёл или не задан. */
export function isSiteSurveyed(state: ProtoState, profileId: string, on: string = today()): boolean {
  return state.siteSurveys.some(
    (s) => s.profileId === profileId && s.result && s.report !== null && (s.expiresOn === null || s.expiresOn > on),
  );
}

/** Тир профиля (IMBC-19, IMBC-20): не Verified — не тир. */
export function profileTier(state: ProtoState, profile: ProtoProfile): ProfileTier | null {
  if (profile.status !== "verified") return null;
  return isSiteSurveyed(state, profile.id) ? "tier_2" : "tier_1";
}

/** Итог due diligence профиля (IMBC-11); у каждого профиля одна запись. */
export function ddResult(state: ProtoState, profileId: string) {
  return state.dueDiligence.find((d) => d.profileId === profileId)?.result ?? null;
}

/**
 * Visible verified (раздел 4): Verified и итог due diligence green или amber, при любом статусе
 * актуальности. Только такие профили видят оператор и наблюдатель (OPR-01, GEN-13).
 */
export function isVisible(state: ProtoState, profile: ProtoProfile): boolean {
  const result = ddResult(state, profile.id);
  // Без записи due diligence профиль не видим.
  return profile.status === "verified" && (result === "green" || result === "amber");
}

/** Профили для оператора и наблюдателя: видимые, unresponsive — ниже остальных (UPD-04). */
export function visibleProfiles(state: ProtoState): ProtoProfile[] {
  return state.profiles
    .filter((p) => isVisible(state, p))
    .sort((a, b) => Number(a.updateStatus === "unresponsive") - Number(b.updateStatus === "unresponsive"));
}

/** Продуктовые линии tier 3 (IMBC-21): AGAR или CDP со статусом report issued и дальше. */
export function tier3ProductIds(state: ProtoState, profileId: string): string[] {
  return state.tierRecords.filter((r) => r.profileId === profileId && isTier3(r)).map((r) => r.productId);
}

/**
 * Сколько из major operators работают с производителем (OPR-10, OPR-20): по каждой организации —
 * последняя подтверждённая отметка; снятая отметка (`value: false`) не считается.
 */
export function worksWithCount(state: ProtoState, profileId: string): number {
  const latest = new Map<string, boolean>();
  for (const mark of state.worksWithMarks
    .filter((m) => m.profileId === profileId && m.state === "validated")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    latest.set(mark.operatorOrgId, mark.value);
  }
  const majors = new Set(state.organizations.filter((o) => o.majorOperator).map((o) => o.id));
  return [...latest].filter(([org, value]) => value && majors.has(org)).length;
}

/** Текущая версия NDA — опубликованная последней (FC-03). */
export function currentNda(state: ProtoState) {
  return [...state.ndaVersions].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0]!;
}

/** Прогноз и STR/KTRE открыты производителю: Verified и принята текущая NDA (FC-01, FC-03). */
export function forecastOpen(state: ProtoState, profile: ProtoProfile): boolean {
  return profile.status === "verified" && profile.nda?.versionId === currentNda(state).id;
}

/** Опубликованная последней версия прогноза (ADM-14) или null. */
export function publishedForecast(state: ProtoState) {
  return (
    [...state.forecastVersions]
      .filter((v) => v.publishedAt !== null)
      .sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!))[0] ?? null
  );
}

/** Имя аккаунта по ключу; неизвестный — «—». */
export function accountName(state: ProtoState, accountId: string | null): string {
  return state.accounts.find((a) => a.id === accountId)?.fullName ?? "—";
}

/** Название организации по ключу; неизвестная — «—». */
export function organizationName(state: ProtoState, organizationId: string | null): string {
  return state.organizations.find((o) => o.id === organizationId)?.name ?? "—";
}

/** Профиль по ключу. */
export function profileById(state: ProtoState, profileId: string): ProtoProfile | undefined {
  return state.profiles.find((p) => p.id === profileId);
}
