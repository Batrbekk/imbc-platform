import { checkBin } from "@imbc/contracts";
import { useMutation } from "@tanstack/react-query";
import { MailCheckIcon } from "lucide-react";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { Link } from "react-router";
import { useLocale, useTranslations } from "use-intl";
import { z } from "zod";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useFormat } from "@/i18n/format";
import { api, ApiError, passwordResetUrl } from "@/lib/api";
import { useCooldown } from "@/lib/use-cooldown";

type FieldName = "companyName" | "bin" | "email" | "heardAboutUs" | "acceptTerms";
type RegistrationInput = {
  companyName: string;
  bin: string;
  email: string;
  heardAboutUs?: string;
  acceptTerms: true;
  locale: string;
};
type ErrorCode =
  | "company_name"
  | "bin_format"
  | "bin_check_digit"
  | "bin_exists"
  | "email_invalid"
  | "email_exists"
  | "heard_about_us"
  | "terms_required";

/** Заявка производителя: БИН с контрольной цифрой (MAN-02), письмо для пароля уходит с сервера (AUTH-01). */
export function RegisterForm() {
  const t = useTranslations("register");
  const format = useFormat();
  const common = useTranslations("common");
  const locale = useLocale();
  const [form, setForm] = useState({ companyName: "", bin: "", email: "", heardAboutUs: "", acceptTerms: false });
  const [errors, setErrors] = useState<Partial<Record<FieldName, ErrorCode>>>({});
  const cooldown = useCooldown();
  const submit = useMutation({
    mutationFn: (input: RegistrationInput) =>
      api<{ status: string }>("/v1/registrations", { method: "POST", json: input }),
    onSuccess: () => cooldown.start(60),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 429) cooldown.start(error.retryAfter ?? 60);
    },
  });
  const resend = useMutation({
    mutationFn: () =>
      api<{ status: string }>("/v1/registrations/resend", {
        method: "POST",
        json: { email: submit.variables?.email ?? form.email.trim() },
      }),
    onSuccess: () => cooldown.start(60),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 429) cooldown.start(error.retryAfter ?? 60);
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next: Partial<Record<FieldName, ErrorCode>> = {};
    const companyName = form.companyName.trim();
    const email = form.email.trim();
    const heardAboutUs = form.heardAboutUs.trim();
    const bin = checkBin(form.bin.trim());
    if (companyName.length < 2 || companyName.length > 300) next.companyName = "company_name";
    if (!bin.valid) next.bin = bin.reason === "format" ? "bin_format" : "bin_check_digit";
    if (!z.email().max(254).safeParse(email).success) next.email = "email_invalid";
    if (heardAboutUs.length > 500) next.heardAboutUs = "heard_about_us";
    if (!form.acceptTerms) next.acceptTerms = "terms_required";
    setErrors(next);
    if (Object.keys(next).length || !bin.valid) return;
    submit.mutate({
      companyName,
      bin: bin.bin,
      email,
      ...(heardAboutUs ? { heardAboutUs } : {}),
      acceptTerms: true,
      locale,
    });
  };

  const serverCode = submit.error instanceof ApiError ? submit.error.code : undefined;
  const fieldError = (field: FieldName): ErrorCode | undefined => {
    if (errors[field]) return errors[field];
    if (
      field === "bin" &&
      (serverCode === "bin_format" || serverCode === "bin_check_digit" || serverCode === "bin_exists")
    )
      return serverCode;
    if (field === "email" && serverCode === "email_exists") return serverCode;
    return undefined;
  };
  const change = (field: Exclude<FieldName, "acceptTerms">) => (event: ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (submit.isError) submit.reset();
  };
  const registrationError =
    submit.error instanceof ApiError && submit.error.status === 429 ? t("rateLimited") : t("requestError");

  if (submit.isSuccess) {
    return (
      <div className="space-y-5">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MailCheckIcon className="size-6" />
        </div>
        <div className="space-y-2" role="status">
          <h2 className="text-lg font-semibold">{t("successTitle")}</h2>
          <p className="break-words text-sm leading-relaxed text-muted-foreground">
            {t("success", { email: submit.variables?.email ?? form.email })}
          </p>
          <p className="text-sm text-muted-foreground">{t("deliveryHint")}</p>
        </div>
        {resend.isSuccess && (
          <Alert>
            <AlertDescription>{t("resendAccepted")}</AlertDescription>
          </Alert>
        )}
        {resend.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {resend.error instanceof ApiError && resend.error.status === 429 ? t("rateLimited") : t("requestError")}
            </AlertDescription>
          </Alert>
        )}
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={resend.isPending || cooldown.seconds > 0}
          onClick={() => resend.mutate()}
        >
          {resend.isPending && <Spinner />}
          {cooldown.seconds > 0 ? t("resendIn", { seconds: format.number(cooldown.seconds) }) : t("resend")}
        </Button>
        <Link className={buttonVariants({ className: "w-full" })} to="/login">
          {common("signIn")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup className="gap-5">
        <Field data-invalid={!!fieldError("companyName") || undefined}>
          <FieldLabel htmlFor="companyName">{t("companyName")}</FieldLabel>
          <Input
            id="companyName"
            autoComplete="organization"
            maxLength={300}
            required
            value={form.companyName}
            onChange={change("companyName")}
            aria-invalid={!!fieldError("companyName")}
            aria-describedby={fieldError("companyName") ? "companyName-error" : undefined}
          />
          {fieldError("companyName") && (
            <FieldError id="companyName-error">{t(`errors.${fieldError("companyName")}`)}</FieldError>
          )}
        </Field>
        <Field data-invalid={!!fieldError("bin") || undefined}>
          <FieldLabel htmlFor="bin">{t("bin")}</FieldLabel>
          <Input
            id="bin"
            inputMode="numeric"
            maxLength={12}
            required
            value={form.bin}
            onChange={change("bin")}
            aria-invalid={!!fieldError("bin")}
            aria-describedby={fieldError("bin") ? "bin-error" : "bin-help"}
          />
          <FieldDescription id="bin-help">{t("binHint")}</FieldDescription>
          {fieldError("bin") && <FieldError id="bin-error">{t(`errors.${fieldError("bin")}`)}</FieldError>}
        </Field>
        <Field data-invalid={!!fieldError("email") || undefined}>
          <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            value={form.email}
            onChange={change("email")}
            aria-invalid={!!fieldError("email")}
            aria-describedby={fieldError("email") ? "email-error" : "email-help"}
          />
          <FieldDescription id="email-help">{t("emailHint")}</FieldDescription>
          {fieldError("email") && <FieldError id="email-error">{t(`errors.${fieldError("email")}`)}</FieldError>}
          {serverCode === "email_exists" && (
            <a href={passwordResetUrl("/", locale)} className="text-sm text-primary hover:underline">
              {t("recoverAccount")}
            </a>
          )}
        </Field>
        <Field data-invalid={!!fieldError("heardAboutUs") || undefined}>
          <FieldLabel htmlFor="heardAboutUs">
            {t("heardAboutUs")} <span className="font-normal text-muted-foreground">{t("optional")}</span>
          </FieldLabel>
          <Input
            id="heardAboutUs"
            maxLength={500}
            value={form.heardAboutUs}
            onChange={change("heardAboutUs")}
            aria-invalid={!!fieldError("heardAboutUs")}
          />
          {fieldError("heardAboutUs") && <FieldError>{t(`errors.${fieldError("heardAboutUs")}`)}</FieldError>}
        </Field>
        <Field data-invalid={!!fieldError("acceptTerms") || undefined}>
          <div className="flex items-start gap-3">
            <Checkbox
              id="acceptTerms"
              className="mt-0.5"
              checked={form.acceptTerms}
              onCheckedChange={(checked) => {
                setForm((current) => ({ ...current, acceptTerms: checked === true }));
                setErrors((current) => ({ ...current, acceptTerms: undefined }));
              }}
              aria-invalid={!!fieldError("acceptTerms")}
            />
            <FieldLabel htmlFor="acceptTerms" className="font-normal leading-relaxed">
              {t("acceptTerms")}
            </FieldLabel>
          </div>
          {fieldError("acceptTerms") && <FieldError>{t(`errors.${fieldError("acceptTerms")}`)}</FieldError>}
        </Field>
        {submit.isError && !fieldError("bin") && !fieldError("email") && (
          <Alert variant="destructive">
            <AlertDescription>{registrationError}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="w-full" size="lg" disabled={submit.isPending || cooldown.seconds > 0}>
          {submit.isPending && <Spinner />}
          {cooldown.seconds > 0 ? t("resendIn", { seconds: format.number(cooldown.seconds) }) : t("submit")}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          {t("alreadyRegistered")}{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            {common("signIn")}
          </Link>
        </p>
      </FieldGroup>
    </form>
  );
}
