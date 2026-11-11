import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MailCheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { SessionExit } from "@/components/auth/session-exit";
import { SessionStatus } from "@/components/auth/session-status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Spinner } from "@/components/ui/spinner";
import { useFormat } from "@/i18n/format";
import { api, ApiError } from "@/lib/api";
import { authDestination, meKey, useMe } from "@/lib/session";
import { useCooldown } from "@/lib/use-cooldown";

type SendResult = { sent: boolean; reason?: string; retryAfter?: number; expiresAt?: string };

export function VerifyForm({ returnTo }: { returnTo: string }) {
  const t = useTranslations("verify");
  const format = useFormat();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const [code, setCode] = useState("");
  const sentFor = useRef<string | null>(null);
  const cooldown = useCooldown();

  const verify = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; responsibility: boolean }>("/auth/otp/verify", { method: "POST", json: { code } }),
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: meKey });
      const target = me.data ? authDestination(me.data, returnTo) : returnTo;
      void navigate(result.responsibility ? target : `/auth/responsibility?returnTo=${encodeURIComponent(target)}`, {
        replace: true,
      });
    },
  });
  const send = useMutation({
    mutationFn: () => api<SendResult>("/auth/otp/send", { method: "POST" }),
    onSuccess: (result) => {
      if (result.reason === "not_required") {
        void qc.invalidateQueries({ queryKey: meKey });
        return;
      }
      cooldown.start(result.retryAfter ?? 60);
      if (result.sent || result.reason === "development_code") {
        setCode("");
        verify.reset();
      }
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 429) cooldown.start(error.retryAfter ?? 60);
    },
  });
  const sendCode = send.mutate;

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      void navigate(`/login?error=session_expired&returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
    } else if (me.data?.gates.mfa) {
      const target = authDestination(me.data, returnTo);
      void navigate(
        me.data.gates.responsibility ? target : `/auth/responsibility?returnTo=${encodeURIComponent(target)}`,
        { replace: true },
      );
    } else if (me.data && sentFor.current !== me.data.user.id) {
      sentFor.current = me.data.user.id;
      sendCode();
    }
  }, [me.data, me.error, returnTo, navigate, sendCode]);

  const errorCode = verify.error instanceof ApiError ? verify.error.code : undefined;
  const sessionExpired =
    (send.error instanceof ApiError && send.error.status === 401) ||
    (verify.error instanceof ApiError && verify.error.status === 401);
  useEffect(() => {
    if (sessionExpired)
      void navigate(`/login?error=session_expired&returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
  }, [sessionExpired, returnTo, navigate]);

  if (!me.data || me.data.gates.mfa) {
    return (
      <SessionStatus
        error={me.isError && !(me.error instanceof ApiError && me.error.status === 401)}
        retry={() => void me.refetch()}
      />
    );
  }

  const verifyMessage =
    errorCode === "otp_locked"
      ? t("locked")
      : errorCode === "otp_expired"
        ? t("expired")
        : errorCode === "otp_invalid"
          ? t("invalid")
          : t("verifyError");
  const developmentCode = me.data.otpDelivery === "development_code";
  const sendMessage =
    send.error instanceof ApiError && send.error.status === 429
      ? t(developmentCode ? "developmentTooSoon" : "tooSoon")
      : t(developmentCode ? "developmentSendError" : "sendError");

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-muted/60 p-4 text-sm" aria-live="polite">
        <div className="mb-1 flex items-center gap-2 font-medium">
          <MailCheckIcon className="size-4 shrink-0 text-primary" />
          <span className="break-all">{me.data.user.email}</span>
        </div>
        <p className="text-muted-foreground">
          {developmentCode
            ? t("developmentCode")
            : send.isPending
              ? t("sending")
              : send.isError
                ? t("notSent")
                : send.data?.sent
                  ? t("sent")
                  : send.data?.reason === "too_soon"
                    ? t("alreadyRequested")
                    : t("preparing")}
        </p>
      </div>
      {send.isError && (
        <Alert variant="destructive">
          <AlertDescription>{sendMessage}</AlertDescription>
        </Alert>
      )}
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.length === 6 && !verify.isPending) verify.mutate();
        }}
      >
        <Field data-invalid={verify.isError || undefined} className="items-center">
          <FieldLabel htmlFor="email-code">{t("codeLabel")}</FieldLabel>
          {/* Класс cn-input-otp в base-nova без стилей: промежуток между группами цифр задаёт gap-2. */}
          <InputOTP
            id="email-code"
            containerClassName="justify-center gap-2"
            maxLength={6}
            value={code}
            onChange={setCode}
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="^[0-9]*$"
            aria-invalid={verify.isError}
            aria-describedby={verify.isError ? "code-error" : "code-help"}
          >
            <InputOTPGroup>
              {[0, 1, 2].map((index) => (
                <InputOTPSlot key={index} index={index} className="h-11 w-8 text-lg sm:w-10" />
              ))}
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              {[3, 4, 5].map((index) => (
                <InputOTPSlot key={index} index={index} className="h-11 w-8 text-lg sm:w-10" />
              ))}
            </InputOTPGroup>
          </InputOTP>
          {verify.isError && <FieldError id="code-error">{verifyMessage}</FieldError>}
          <p id="code-help" className="text-center text-xs text-muted-foreground">
            {t("expiryHint")}
          </p>
        </Field>
        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={code.length !== 6 || verify.isPending || errorCode === "otp_locked" || errorCode === "otp_expired"}
        >
          {verify.isPending && <Spinner />}
          {t("button")}
        </Button>
      </form>
      <div className="space-y-3">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => send.mutate()}
          disabled={send.isPending || cooldown.seconds > 0}
        >
          {send.isPending && <Spinner />}
          {cooldown.seconds > 0
            ? t(developmentCode ? "developmentResendIn" : "resendIn", { seconds: format.number(cooldown.seconds) })
            : t(developmentCode ? "developmentResend" : "resend")}
        </Button>
        {!developmentCode && (
          <p className="text-center text-xs leading-relaxed text-muted-foreground">{t("deliveryHint")}</p>
        )}
        <p className="text-center text-xs leading-relaxed text-muted-foreground">{t("trust")}</p>
      </div>
      <SessionExit changeAccount />
    </div>
  );
}
