"use client";

import type { OrganizationType, Role } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export interface Me {
  user: {
    id: string;
    email: string;
    fullName: string | null;
    role: Role;
    organizationId: string;
    organizationType: OrganizationType;
    locale: string;
  };
  gates: { mfa: boolean; responsibility: boolean };
}

export const meKey = ["auth", "me"] as const;

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: () => api<Me>("/auth/me"), retry: false, staleTime: 60_000 });
}
