"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError } from "@/lib/api";
import { meKey } from "@/lib/session";

/** Второй фактор: код на почту, доверенное устройство на 30 дней (AUTH-03, ADR-20). */
export function VerifyForm({ returnTo }: { returnTo: string }) {
  const t = useTranslations("verify");
  const router = useRouter();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const sentOnce = useRef(false);

  const send = useMutation({
    mutationFn: () => api<{ sent: boolean; reason?: string }>("/auth/otp/send", { method: "POST" }),
    onSuccess: (r) => {
      if (r.reason === "not_required") router.replace(returnTo);
    },
  });
  const verify = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; responsibility: boolean }>("/auth/otp/verify", { method: "POST", json: { code } }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: meKey });
      router.replace(r.responsibility ? returnTo : `/auth/responsibility?returnTo=${encodeURIComponent(returnTo)}`);
    },
  });

  useEffect(() => {
    if (sentOnce.current) return;
    sentOnce.current = true;
    send.mutate();
  }, [send]);

  const resend = () =>
    send.mutate(undefined, {
      onSuccess: (r) => (r.sent ? toast.success(t("resent")) : r.reason === "too_soon" && toast.info(t("tooSoon"))),
    });

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) verify.mutate();
      }}
    >
      <Field data-invalid={verify.isError || undefined} className="items-center">
        <InputOTP maxLength={6} value={code} onChange={setCode} autoFocus inputMode="numeric" pattern="^[0-9]*$">
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
        {verify.error instanceof ApiError && <FieldError>{t("invalid")}</FieldError>}
      </Field>
      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={code.length !== 6 || verify.isPending}>
          {verify.isPending && <Spinner />}
          {t("button")}
        </Button>
        <Button type="button" variant="ghost" onClick={resend} disabled={send.isPending}>
          {t("resend")}
        </Button>
      </div>
    </form>
  );
}
