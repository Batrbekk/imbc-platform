"use client";

import { checkBin } from "@imbc/contracts";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2Icon } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError } from "@/lib/api";

type ErrorCode = "bin_format" | "bin_check_digit" | "bin_exists" | "email_exists";
const KNOWN: ErrorCode[] = ["bin_format", "bin_check_digit", "bin_exists", "email_exists"];

/** Самостоятельная регистрация производителя (REG-01…05): БИН проверяется ещё в браузере. */
export function RegisterForm() {
  const t = useTranslations("register");
  const common = useTranslations("common");
  const locale = useLocale();
  const [form, setForm] = useState({ companyName: "", bin: "", email: "", heardAboutUs: "", acceptTerms: false });
  const [binError, setBinError] = useState<ErrorCode | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      api<{ status: string }>("/v1/registrations", {
        method: "POST",
        json: { ...form, heardAboutUs: form.heardAboutUs || null, acceptTerms: true, locale },
      }),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const bin = checkBin(form.bin);
    if (!bin.valid) return setBinError(bin.reason === "format" ? "bin_format" : "bin_check_digit");
    setBinError(null);
    submit.mutate();
  };

  if (submit.isSuccess) {
    return (
      <Alert>
        <CheckCircle2Icon />
        <AlertDescription>{t("success")}</AlertDescription>
      </Alert>
    );
  }

  const serverCode =
    submit.error instanceof ApiError && KNOWN.includes(submit.error.code as ErrorCode)
      ? (submit.error.code as ErrorCode)
      : null;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="companyName">{t("companyName")}</FieldLabel>
          <Input id="companyName" required value={form.companyName} onChange={set("companyName")} />
        </Field>
        <Field data-invalid={!!binError || serverCode?.startsWith("bin") || undefined}>
          <FieldLabel htmlFor="bin">{t("bin")}</FieldLabel>
          <Input
            id="bin"
            inputMode="numeric"
            maxLength={12}
            required
            value={form.bin}
            onChange={set("bin")}
            aria-invalid={!!binError}
          />
          <FieldDescription>{t("binHint")}</FieldDescription>
          {(binError || serverCode?.startsWith("bin")) && (
            <FieldError>{t(`errors.${binError ?? serverCode!}`)}</FieldError>
          )}
        </Field>
        <Field data-invalid={serverCode === "email_exists" || undefined}>
          <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} />
          {serverCode === "email_exists" && <FieldError>{t("errors.email_exists")}</FieldError>}
        </Field>
        <Field>
          <FieldLabel htmlFor="heardAboutUs">{t("heardAboutUs")}</FieldLabel>
          <Input id="heardAboutUs" value={form.heardAboutUs} onChange={set("heardAboutUs")} />
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            id="acceptTerms"
            checked={form.acceptTerms}
            onCheckedChange={(v) => setForm({ ...form, acceptTerms: v === true })}
          />
          <FieldLabel htmlFor="acceptTerms" className="font-normal">
            {t("acceptTerms")}
          </FieldLabel>
        </Field>
        {submit.isError && !serverCode && (
          <Alert variant="destructive">
            <AlertDescription>{common("error")}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={!form.acceptTerms || submit.isPending}>
          {submit.isPending && <Spinner />}
          {t("submit")}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            {common("signIn")}
          </Link>
        </p>
      </FieldGroup>
    </form>
  );
}
