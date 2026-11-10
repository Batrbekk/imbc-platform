"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { SessionExit } from "@/components/auth/session-exit";
import { SessionStatus } from "@/components/auth/session-status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError } from "@/lib/api";
import { authDestination, meKey, useMe } from "@/lib/session";

export function AcceptButton({ returnTo }: { returnTo: string }) {
  const t = useTranslations("responsibility");
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const accept = useMutation({
    mutationFn: () => api("/auth/responsibility", { method: "POST" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: meKey });
      router.replace(me.data ? authDestination(me.data, returnTo) : returnTo);
    },
  });
  useEffect(() => {
    const error = accept.error ?? me.error;
    if (error instanceof ApiError && error.status === 401) {
      const path = error.code === "mfa_required" ? "/auth/verify" : "/login?error=session_expired";
      router.replace(`${path}${path.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}`);
    } else if (me.data && !me.data.gates.mfa) {
      router.replace(`/auth/verify?returnTo=${encodeURIComponent(returnTo)}`);
    } else if (me.data?.gates.responsibility) {
      router.replace(authDestination(me.data, returnTo));
    }
  }, [accept.error, me.error, me.data, returnTo, router]);

  if (!me.data || !me.data.gates.mfa || me.data.gates.responsibility) {
    return (
      <SessionStatus
        error={me.isError && !(me.error instanceof ApiError && me.error.status === 401)}
        retry={() => void me.refetch()}
      />
    );
  }
  return (
    <div className="space-y-4">
      {accept.isError && (
        <Alert variant="destructive">
          <AlertDescription>{t("error")}</AlertDescription>
        </Alert>
      )}
      <Button className="w-full" size="lg" onClick={() => accept.mutate()} disabled={accept.isPending}>
        {accept.isPending && <Spinner />}
        {t("accept")}
      </Button>
      <SessionExit />
    </div>
  );
}
