import { useSearchParams } from "react-router";

import { protoPath } from "@/prototype/registry";

export const directorPath = (screen: string) => protoPath("director", screen);

/** Вкладки досье: выбор вкладки — в адресе (`?tab=`), не в хранилище. */
export const DOSSIER_TABS = [
  "sections",
  "due-diligence",
  "site-survey",
  "tiers",
  "checks",
  "notes",
  "operators",
] as const;
export type DossierTab = (typeof DOSSIER_TABS)[number];

/** Досье профиля: `/proto/director/profiles/p11?tab=due-diligence`. */
export function dossierPath(profileId: string, tab?: DossierTab): string {
  return `${directorPath(`profiles/${profileId}`)}${tab && tab !== "sections" ? `?tab=${tab}` : ""}`;
}

export const ALL = "all";

/** Значение из списка допустимых или `fallback`: адрес мог прийти из ссылки с чем угодно. */
export function pick<T extends string>(values: readonly T[], value: string | null, fallback: T): T {
  return (values as readonly (string | null)[]).includes(value) ? (value as T) : fallback;
}

/**
 * Фильтры и вкладки экрана — в адресе: это выбор того, кто смотрит, не данные. В хранилище не
 * пишутся и событий журнала не дают (GEN-04).
 */
export function useAddress() {
  const [params, setParams] = useSearchParams();
  const set = (key: string, value: string | null, fallback: string = ALL) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null || value === "" || value === fallback) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  const clear = (keys: readonly string[]) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of keys) next.delete(key);
        return next;
      },
      { replace: true },
    );
  return { params, set, clear };
}

/** Дата события по часовому поясу Алматы (UTC+5, DATA-08) — для фильтра периода. */
export function almatyDay(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  return new Date(time + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
