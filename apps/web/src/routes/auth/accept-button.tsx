import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { SessionExit } from "@/components/auth/session-exit";
import { SessionStatus } from "@/components/auth/session-status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError } from "@/lib/api";
import { authDestination, meKey, useMe } from "@/lib/session";

export function AcceptButton({ returnTo }: { returnTo: string }) {
  const t = useTranslations("responsibility");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const accept = useMutation({
    mutationFn: () => api("/auth/responsibility", { method: "POST" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: meKey });
      void navigate(me.data ? authDestination(me.data, returnTo) : returnTo, { replace: true });
    },
    onError: async (error) => {
      if (!(error instanceof ApiError && error.status === 401)) return;
      // Ответ /me в кеше (staleTime 60 с) мог устареть: без свежего ответа /auth/verify
      // увидел бы «второй фактор пройден» и вернул сюда же. Следующая страница решает по новому.
      await qc.invalidateQueries({ queryKey: meKey });
      const path = error.code === "mfa_required" ? "/auth/verify" : "/login?error=session_expired";
      void navigate(`${path}${path.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}`, {
        replace: true,
      });
    },
  });
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      void navigate(`/login?error=session_expired&returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
    } else if (me.data && !me.data.gates.mfa) {
      void navigate(`/auth/verify?returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
    } else if (me.data?.gates.responsibility) {
      void navigate(authDestination(me.data, returnTo), { replace: true });
    }
  }, [me.error, me.data, returnTo, navigate]);

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
