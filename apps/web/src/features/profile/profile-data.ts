import { SECTION_KINDS, type OwnSectionsOverview, type SectionKind } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const SECTION_PATHS: Record<SectionKind, string> = Object.fromEntries(
  SECTION_KINDS.map((kind) => [kind, kind.replaceAll("_", "-")]),
) as Record<SectionKind, string>;
export const sectionPath = (kind: SectionKind) => `/profile/${SECTION_PATHS[kind]}`;
export function routeSection(path: string | undefined): SectionKind | null {
  return SECTION_KINDS.find((kind) => SECTION_PATHS[kind] === path) ?? null;
}
export function useOwnSections() {
  return useQuery({
    queryKey: ["profile", "sections"],
    queryFn: () => api<OwnSectionsOverview>("/v1/profiles/own/sections"),
  });
}
