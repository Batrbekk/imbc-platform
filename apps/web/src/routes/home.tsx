import { useEffect } from "react";
import { useNavigate } from "react-router";

import { PageTitle } from "@/components/app/page-title";
import { SessionStatus } from "@/components/auth/session-status";
import { ApiError } from "@/lib/api";
import { authDestination, useMe } from "@/lib/session";

/** «/» сам ничего не показывает: уводит на вход, к недостающему шагу входа или на стартовую страницу роли. */
export function HomePage() {
  const me = useMe();
  const navigate = useNavigate();
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) void navigate("/login", { replace: true });
    else if (me.data) {
      const target = authDestination(me.data);
      if (!me.data.gates.mfa) void navigate(`/auth/verify?returnTo=${encodeURIComponent(target)}`, { replace: true });
      else if (!me.data.gates.responsibility)
        void navigate(`/auth/responsibility?returnTo=${encodeURIComponent(target)}`, { replace: true });
      else void navigate(target, { replace: true });
    }
  }, [me.error, me.data, navigate]);
  return (
    <div className="flex min-h-svh items-center justify-center">
      <PageTitle />
      <SessionStatus
        error={me.isError && !(me.error instanceof ApiError && me.error.status === 401)}
        retry={() => void me.refetch()}
      />
    </div>
  );
}
