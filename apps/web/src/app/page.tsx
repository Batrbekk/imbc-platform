"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SessionStatus } from "@/components/auth/session-status";
import { ApiError } from "@/lib/api";
import { authDestination, useMe } from "@/lib/session";

export default function Home() {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) router.replace("/login");
    else if (me.data) {
      const target = authDestination(me.data);
      if (!me.data.gates.mfa) router.replace(`/auth/verify?returnTo=${encodeURIComponent(target)}`);
      else if (!me.data.gates.responsibility)
        router.replace(`/auth/responsibility?returnTo=${encodeURIComponent(target)}`);
      else router.replace(target);
    }
  }, [me.error, me.data, router]);
  return (
    <div className="flex min-h-svh items-center justify-center">
      <SessionStatus
        error={me.isError && !(me.error instanceof ApiError && me.error.status === 401)}
        retry={() => void me.refetch()}
      />
    </div>
  );
}
