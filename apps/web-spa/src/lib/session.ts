import type { OrganizationType, Role } from "@imbc/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { api, ApiError } from "./api";
import { leaveApp } from "./leave-app";

export { authDestination } from "./auth-navigation";

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
  homePath: string;
  otpDelivery?: "email" | "development_code";
}

export const meKey = ["auth", "me"] as const;

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: () => api<Me>("/auth/me"), retry: false, staleTime: 60_000 });
}

export function useLogout() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api<{ redirectTo: string }>("/auth/logout", { method: "POST" }),
    onSuccess: ({ redirectTo }) => {
      client.clear();
      // Адрес выхода из IdP обслуживает не SPA.
      leaveApp(redirectTo);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        client.clear();
        void navigate("/login", { replace: true });
      }
    },
  });
}
