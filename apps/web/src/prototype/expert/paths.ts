import { protoPath } from "@/prototype/registry";

/** Вкладки досье: выбор вкладки — в адресе (`?tab=`), не в хранилище. */
export const DOSSIER_TABS = [
  "review",
  "due-diligence",
  "site-survey",
  "tiers",
  "checks",
  "notes",
  "operators",
] as const;
export type DossierTab = (typeof DOSSIER_TABS)[number];

export const isDossierTab = (value: string | null): value is DossierTab =>
  (DOSSIER_TABS as readonly (string | null)[]).includes(value);

export const expertPath = (screen: string) => protoPath("expert", screen);

/** Досье профиля: `/proto/expert/profiles/p11?tab=due-diligence`. */
export function dossierPath(profileId: string, tab?: DossierTab): string {
  return `${expertPath(`profiles/${profileId}`)}${tab && tab !== "review" ? `?tab=${tab}` : ""}`;
}
