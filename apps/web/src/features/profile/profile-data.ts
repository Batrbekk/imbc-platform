import { useEffect, useRef } from "react";
import {
  SECTION_KINDS,
  ownSectionsOverviewSchema,
  profileSubmissionStateSchema,
  type SectionKind,
} from "@imbc/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
    queryFn: async () => ownSectionsOverviewSchema.parse(await api<unknown>("/v1/profiles/own/sections")),
  });
}

export function useSubmissionState() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["profile", "submission"],
    queryFn: async () => profileSubmissionStateSchema.parse(await api<unknown>("/v1/profiles/own/submission")),
    refetchInterval: (query) => (query.state.data?.activeAssignmentId ? 5000 : false),
  });
  const previous = useRef<string | null>(null);
  const fingerprint = query.data ? JSON.stringify(query.data) : null;
  useEffect(() => {
    if (fingerprint && previous.current && fingerprint !== previous.current) {
      void client.invalidateQueries({ queryKey: ["profile", "sections"] });
      void client.invalidateQueries({ queryKey: ["profile", "own"] });
      void client.invalidateQueries({ queryKey: ["profile", "review"] });
    }
    if (fingerprint) previous.current = fingerprint;
  }, [fingerprint, client]);
  return query;
}
