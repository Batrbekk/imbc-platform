import { checkBin, DEFAULT_LOCALE, type RegistrationRequest, registrationTermsReadSchema } from "@imbc/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useLocale, useTranslations } from "use-intl";
import { z } from "zod";

import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useFormat } from "@/i18n/format";
import { isLocale } from "@/i18n/locale";
import { api, ApiError, passwordResetUrl } from "@/lib/api";
import { useCooldown } from "@/lib/use-cooldown";

import { LegalDialog } from "./legal-dialog";

type TextField = "companyName" | "bin" | "email" | "heardAboutUs";
type FieldName = TextField | "acceptPlatformTerms" | "acceptPersonalData" | "acceptNda";
type ErrorCode =
  | "company_name"
  | "bin_format"
  | "bin_check_digit"
  | "bin_exists"
  | "email_invalid"
  | "email_exists"
  | "heard_about_us"
  | "heard_about_us_required"
  | "platform_terms_required"
  | "personal_data_required"
  | "nda_required"
  | "nda_version_changed";
/** Ошибки сервера, которые показываются у своего поля, а не общим сообщением. */
const FIELD_CODES = new Set(["bin_format", "bin_check_digit", "bin_exists", "email_exists", "nda_version_changed"]);
/** Ошибки сервера, после которых фокус уходит на поле с ошибкой. */
const FOCUS_CODES = new Set(["bin_format", "bin_check_digit", "bin_exists", "email_exists"]);
const TERMS_STATUS = "registration-terms-status";

/**
 * Заявка производителя (MAN-01): название, БИН с контрольной цифрой (MAN-02), почта, ответ «Как вы узнали
 * о нас», согласие с условиями платформы и политикой персональных данных, принятие текущей версии NDA
 * (FC-02). Пароля в форме нет: письмо для пароля уходит с сервера (AUTH-01).
 */
export function RegisterForm() {
  const t = useTranslations("register");
  const legal = useTranslations("legal");
  const format = useFormat();
  const common = useTranslations("common");
  const locale = useLocale();
  const [form, setForm] = useState({
    companyName: "",
    bin: "",
    email: "",
    heardAboutUs: "",
    acceptPlatformTerms: false,
    acceptPersonalData: false,
    // Номер версии NDA, которую отметил человек: новая версия с сервера снимает галочку сама.
    ndaVersion: null as number | null,
  });
  const [errors, setErrors] = useState<Partial<Record<FieldName, ErrorCode>>>({});
  const formRef = useRef<HTMLFormElement>(null);
  // Просьба перевести фокус на первое поле с ошибкой — после отрисовки ошибок.
  const [focusRequest, setFocusRequest] = useState(0);
  const cooldown = useCooldown();
  const terms = useQuery({
    queryKey: ["registration", "terms"],
    // Ответ неверной формы — ошибка загрузки, а не «undefined нұсқа» и галочка без номера версии.
    queryFn: async () => registrationTermsReadSchema.parse(await api<unknown>("/v1/registrations/terms")),
  });
  const ndaUnavailable = terms.error instanceof ApiError && terms.error.code === "nda_unavailable";
  // Последний удачный ответ остаётся на экране и при сбое перечитывания; устаревшую версию отвергнет сервер (409).
  // NDA снята с публикации (503 nda_unavailable) — отправка получила бы тот же 503: галочку заменяет сообщение.
  const nda = ndaUnavailable ? undefined : terms.data?.nda;
  const ndaAccepted = nda !== undefined && form.ndaVersion === nda.version;
  // Отмечена версия, которой больше нет: фоновое перечитывание принесло новую.
  const ndaOutdated = nda !== undefined && form.ndaVersion !== null && form.ndaVersion !== nda.version;
  useEffect(() => {
    if (focusRequest) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);
  const submit = useMutation({
    mutationFn: (input: RegistrationRequest) =>
      api<{ status: string }>("/v1/registrations", { method: "POST", json: input }),
    onSuccess: () => cooldown.start(60),
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      if (error.status === 429) cooldown.start(error.retryAfter ?? 60);
      if (FOCUS_CODES.has(error.code)) setFocusRequest((n) => n + 1);
      if (error.code === "nda_version_changed") {
        // IMBC опубликовала новую версию, пока форма была открыта: прочитать текст и принять заново (FC-02).
        setForm((current) => ({ ...current, ndaVersion: null }));
        setErrors((current) => ({ ...current, acceptNda: "nda_version_changed" }));
        setFocusRequest((n) => n + 1);
        void terms.refetch();
      }
      if (error.code === "nda_unavailable") void terms.refetch();
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
    // Недоступность кнопки доходит до DOM на такт позже: второй Enter не шлёт заявку дважды.
    if (submit.isPending) return;
    const next: Partial<Record<FieldName, ErrorCode>> = {};
    const companyName = form.companyName.trim();
    const email = form.email.trim();
    const heardAboutUs = form.heardAboutUs.trim();
    const bin = checkBin(form.bin.trim());
    if (companyName.length < 2 || companyName.length > 300) next.companyName = "company_name";
    if (!bin.valid) next.bin = bin.reason === "format" ? "bin_format" : "bin_check_digit";
    if (!z.email().max(254).safeParse(email).success) next.email = "email_invalid";
    if (!heardAboutUs) next.heardAboutUs = "heard_about_us_required";
    else if (heardAboutUs.length > 500) next.heardAboutUs = "heard_about_us";
    if (!form.acceptPlatformTerms) next.acceptPlatformTerms = "platform_terms_required";
    if (!form.acceptPersonalData) next.acceptPersonalData = "personal_data_required";
    if (!ndaAccepted) next.acceptNda = ndaOutdated ? "nda_version_changed" : "nda_required";
    setErrors(next);
    if (Object.keys(next).length) setFocusRequest((n) => n + 1);
    if (Object.keys(next).length || !bin.valid || !ndaAccepted) return;
    // Ровно поля registrationRequestSchema: принятие NDA — номер отмеченной версии (FC-02).
    submit.mutate({
      companyName,
      bin: bin.bin,
      email,
      heardAboutUs,
      acceptPlatformTerms: true,
      acceptPersonalData: true,
      ndaVersion: nda.version,
      locale: isLocale(locale) ? locale : DEFAULT_LOCALE,
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
    if (field === "acceptNda" && ndaOutdated) return "nda_version_changed";
    return undefined;
  };
  const change = (field: TextField) => (event: ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (submit.isError) submit.reset();
  };
  const tick = (field: "acceptPlatformTerms" | "acceptPersonalData") => (checked: boolean) => {
    setForm((current) => ({ ...current, [field]: checked }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  // Без текста NDA сообщение стоит на месте галочки, при сбое перечитывания — под ней.
  const termsAlert = terms.isError && (
    <Alert variant="destructive">
      <AlertDescription id={TERMS_STATUS}>
        {ndaUnavailable ? t("ndaUnavailable") : t("termsLoadError")}
      </AlertDescription>
      {!ndaUnavailable && (
        <AlertAction>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={terms.isFetching}
            onClick={() => void terms.refetch()}
          >
            {terms.isFetching && <Spinner />}
            {common("retry")}
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
  // Текст «NDA не опубликована» уже стоит на месте галочки NDA — общим сообщением он не повторяется.
  const showSubmitError =
    submit.isError && !FIELD_CODES.has(serverCode ?? "") && !(serverCode === "nda_unavailable" && terms.isError);
  const registrationError =
    submit.error instanceof ApiError && submit.error.status === 429
      ? t("rateLimited")
      : serverCode === "nda_unavailable"
        ? t("ndaUnavailable")
        : t("requestError");

  if (submit.isSuccess) {
    return (
      <div className="space-y-5">
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
    <form ref={formRef} onSubmit={onSubmit} noValidate>
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
          <FieldLabel htmlFor="heardAboutUs">{t("heardAboutUs")}</FieldLabel>
          <Input
            id="heardAboutUs"
            maxLength={500}
            required
            value={form.heardAboutUs}
            onChange={change("heardAboutUs")}
            aria-invalid={!!fieldError("heardAboutUs")}
            aria-describedby={fieldError("heardAboutUs") ? "heardAboutUs-error" : undefined}
          />
          {fieldError("heardAboutUs") && (
            <FieldError id="heardAboutUs-error">{t(`errors.${fieldError("heardAboutUs")}`)}</FieldError>
          )}
        </Field>
        <Consent
          id="acceptPlatformTerms"
          label={t("acceptPlatformTerms")}
          checked={form.acceptPlatformTerms}
          onCheckedChange={tick("acceptPlatformTerms")}
          error={fieldError("acceptPlatformTerms") && t(`errors.${fieldError("acceptPlatformTerms")}`)}
          legalText={{ title: legal("terms.title"), body: legal("terms.body") }}
        />
        <Consent
          id="acceptPersonalData"
          label={t("acceptPersonalData")}
          checked={form.acceptPersonalData}
          onCheckedChange={tick("acceptPersonalData")}
          error={fieldError("acceptPersonalData") && t(`errors.${fieldError("acceptPersonalData")}`)}
          legalText={{ title: legal("privacy.title"), body: legal("privacy.body") }}
        />
        {nda ? (
          <Consent
            id="acceptNda"
            label={t("acceptNda", { version: format.number(nda.version) })}
            hint={t("ndaHint")}
            checked={ndaAccepted}
            onCheckedChange={(checked) => {
              setForm((current) => ({ ...current, ndaVersion: checked ? nda.version : null }));
              setErrors((current) => ({ ...current, acceptNda: undefined }));
            }}
            error={fieldError("acceptNda") && t(`errors.${fieldError("acceptNda")}`)}
            legalText={{ title: legal("nda.title", { version: format.number(nda.version) }), body: nda.body }}
          />
        ) : null}
        {termsAlert}
        {!nda && !terms.isError && (
          <div className="flex items-start gap-3">
            <Skeleton className="mt-0.5 size-4 shrink-0" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <span id={TERMS_STATUS} className="sr-only" role="status">
              {common("loading")}
            </span>
          </div>
        )}
        {showSubmitError && (
          <Alert variant="destructive">
            <AlertDescription>{registrationError}</AlertDescription>
          </Alert>
        )}
        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={submit.isPending || cooldown.seconds > 0 || !nda}
          // Без текста NDA отправить нельзя: причина — сообщение на месте галочки NDA.
          aria-describedby={nda ? undefined : TERMS_STATUS}
        >
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

/**
 * Одно согласие: галочка с подписью, пояснение, кнопка «Прочитать» с текстом в диалоге и ошибка.
 * Кнопка стоит под подписью, вне label: щелчок по ней открывает текст и не ставит галочку.
 */
function Consent({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
  error,
  legalText,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  error?: string | false;
  legalText: { title: string; body: string };
}) {
  const t = useTranslations("register");
  return (
    <Field data-invalid={!!error || undefined}>
      <div className="flex items-start gap-3">
        <Checkbox
          id={id}
          className="mt-0.5"
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          aria-invalid={!!error}
          aria-describedby={[hint && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") || undefined}
        />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <FieldLabel htmlFor={id} className="font-normal leading-relaxed break-words">
            {label}
          </FieldLabel>
          {hint && <FieldDescription id={`${id}-help`}>{hint}</FieldDescription>}
          <LegalDialog
            title={legalText.title}
            body={legalText.body}
            trigger={
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0 py-0.5"
                // Имя для программ чтения называет, что открывается; видимое «Прочитать» в нём есть.
                aria-label={t("readDocument", { title: legalText.title })}
              >
                {t("read")}
              </Button>
            }
          />
          {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
        </div>
      </div>
    </Field>
  );
}
