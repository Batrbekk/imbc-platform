"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { meKey } from "@/lib/session";

export function AcceptButton({ returnTo }: { returnTo: string }) {
  const t = useTranslations("responsibility");
  const router = useRouter();
  const qc = useQueryClient();
  const accept = useMutation({
    mutationFn: () => api("/auth/responsibility", { method: "POST" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: meKey });
      router.replace(returnTo);
    },
  });
  return (
    <Button className="w-full" onClick={() => accept.mutate()} disabled={accept.isPending}>
      {accept.isPending && <Spinner />}
      {t("accept")}
    </Button>
  );
}
