// Правила кабинета оператора поверх общих данных: только своя организация (GEN-12), только видимые
// профили (OPR-01), сохранённый поиск в виде строки адреса (OPR-05, OPR-15).
import { COMMODITY_GROUPS, type CommodityGroup, PROFILE_TIERS, type ProfileTier } from "@imbc/contracts";

import type { ProtoProfile, ProtoState, WorksWithMark } from "../data";
import { isSiteSurveyed, isVisible, profileById, profileTier, visibleProfiles } from "../rules";

/** Записи своей организации: оператор не видит данных другого оператора (GEN-12). */
export function ownOrg<T extends { operatorOrgId: string }>(items: T[], organizationId: string): T[] {
  return items.filter((item) => item.operatorOrgId === organizationId);
}

/** Профиль, который оператор может открыть: видимый Verified (раздел 4, NOT-32). */
export function visibleProfile(state: ProtoState, profileId: string | null | undefined): ProtoProfile | undefined {
  const profile = profileId ? profileById(state, profileId) : undefined;
  return profile && isVisible(state, profile) ? profile : undefined;
}

/**
 * Отметка works-with своей организации на профиле (OPR-19): текущее значение — последняя
 * подтверждённая отметка; изменение, ждущее IMBC, — последняя отметка в состоянии waiting.
 */
export function worksWithOf(marks: WorksWithMark[], organizationId: string, profileId: string) {
  const history = marks
    .filter((m) => m.operatorOrgId === organizationId && m.profileId === profileId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const validated = history.filter((m) => m.state === "validated").at(-1);
  const last = history.at(-1) ?? null;
  return {
    current: validated?.value ?? false,
    waiting: last?.state === "waiting" ? last : null,
    rejected: last?.state === "rejected" ? last : null,
    history,
  };
}

/** Фильтры поиска прототипа: подмножество фильтров каталога (OPR-02), ключи — как в адресе каталога. */
export interface SearchFilters {
  q: string;
  group: CommodityGroup | null;
  region: string | null;
  tier: ProfileTier | null;
  surveyed: boolean;
}

export function parseFilters(params: URLSearchParams | string): SearchFilters {
  const p = typeof params === "string" ? new URLSearchParams(params) : params;
  const group = p.get("group");
  const tier = p.get("tier");
  return {
    q: p.get("q")?.trim() ?? "",
    group: COMMODITY_GROUPS.includes(group as CommodityGroup) ? (group as CommodityGroup) : null,
    region: p.get("region") || null,
    tier: PROFILE_TIERS.includes(tier as ProfileTier) ? (tier as ProfileTier) : null,
    surveyed: p.get("surveyed") === "true",
  };
}

/** Строка адреса фильтров (`group=B&surveyed=true`): так поиск сохраняется в выгрузке и подписке. */
export function serializeFilters(filters: SearchFilters): string {
  const p = new URLSearchParams();
  if (filters.q) p.set("q", filters.q);
  if (filters.group) p.set("group", filters.group);
  if (filters.region) p.set("region", filters.region);
  if (filters.tier) p.set("tier", filters.tier);
  if (filters.surveyed) p.set("surveyed", "true");
  return p.toString();
}

/** Видимые профили под фильтрами; разные фильтры — И (OPR-04), unresponsive ниже (UPD-04). */
export function searchProfiles(state: ProtoState, filters: SearchFilters): ProtoProfile[] {
  const q = filters.q.toLowerCase();
  return visibleProfiles(state).filter(
    (p) =>
      (!q || p.nameRu.toLowerCase().includes(q) || p.nameEn.toLowerCase().includes(q) || p.bin.includes(q)) &&
      (!filters.group || p.sections.products.some((line) => line.group === filters.group)) &&
      (!filters.region || p.sections.main.region === filters.region) &&
      (!filters.tier || profileTier(state, p) === filters.tier) &&
      (!filters.surveyed || isSiteSurveyed(state, p.id)),
  );
}

/** Регионы видимых профилей — варианты фильтра. */
export function visibleRegions(state: ProtoState): string[] {
  return [...new Set(visibleProfiles(state).map((p) => p.sections.main.region))].sort();
}

/** Число major operators — знаменатель «работают с» (OPR-10). */
export function majorOperatorCount(state: ProtoState): number {
  return state.organizations.filter((o) => o.majorOperator).length;
}
