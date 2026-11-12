import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Languages, Loader2, ShieldCheck } from "lucide-react";
import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { Attribute } from "keycloakify/login/KcContext";
import type { KcContext } from "./KcContext";
import { copy, getLocale, localeNames, type Copy, type Locale } from "./translations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import logoUrl from "@/assets/imbc-logo.png";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const translated = (value: string | undefined, kc: KcContext) => value?.replace(/^\$\{(.+)\}$/, (_, key) => kc["x-keycloakify"].messages[key] ?? key) ?? "";

function FieldError({ kc, name }: { kc: KcContext; name: string }) {
  const message = kc.messagesPerField.get(name);
  return message ? <p id={`${name}-error`} className="text-sm text-destructive" aria-live="polite" dangerouslySetInnerHTML={{ __html: kcSanitize(message) }} /> : null;
}
function PasswordField({ name, label, kc, t, autoFocus = false, isNew = false }: { name: string; label: string; kc: KcContext; t: Copy; autoFocus?: boolean; isNew?: boolean }) {
  const [visible, setVisible] = useState(false);
  const errorName = name === "password-new" ? "password" : name;
  return <div className="space-y-2">
    <Label htmlFor={name}>{label}</Label>
    <div className="relative">
      <Input id={name} name={name} type={visible ? "text" : "password"} className="pr-10" required autoFocus={autoFocus} minLength={isNew ? 12 : undefined} autoComplete={isNew ? "new-password" : "current-password"} aria-invalid={kc.messagesPerField.existsError(errorName)} aria-describedby={`${errorName}-error${isNew ? " password-hint" : ""}`} onInput={event => {
        const form = event.currentTarget.form;
        const confirm = form?.elements.namedItem("password-confirm") as HTMLInputElement | null;
        const first = form?.elements.namedItem("password-new") as HTMLInputElement | null;
        if (confirm && first) confirm.setCustomValidity(confirm.value && confirm.value !== first.value ? t.passwordMismatch : "");
      }} />
      <Button type="button" variant="ghost" size="icon" className="absolute right-0.5 top-0.5 size-8 text-muted-foreground" aria-label={visible ? t.hidePassword : t.showPassword} aria-controls={name} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button>
    </div>
    <FieldError kc={kc} name={errorName} />
  </div>;
}
function AccountField({ kc, value = "", t, usernameAllowed = false }: { kc: KcContext; value?: string; t: Copy; usernameAllowed?: boolean }) {
  return <div className="space-y-2">
    <Label htmlFor="username">{usernameAllowed ? t.username : t.email}</Label>
    <Input id="username" name="username" type={usernameAllowed ? "text" : "email"} inputMode={usernameAllowed ? "text" : "email"} defaultValue={value} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required aria-invalid={kc.messagesPerField.existsError("username")} aria-describedby="username-error" />
    <FieldError kc={kc} name="username" />
  </div>;
}
function ServerMessage({ kc }: { kc: KcContext }) {
  if (!kc.message) return null;
  const isError = kc.message.type === "error";
  return <Alert variant={isError ? "destructive" : "default"} className={isError ? "" : "border-primary/15 bg-primary/5"} role={isError ? "alert" : "status"}>
    {isError ? <AlertCircle className="size-4" /> : <CheckCircle2 className="size-4 text-primary" />}
    <AlertDescription className="break-words [&_a]:underline" dangerouslySetInnerHTML={{ __html: kcSanitize(kc.message.summary) }} />
  </Alert>;
}
// The customer's logo file, identical to apps/web/src/assets/imbc-logo.png, never cropped or redrawn (NFR-15).
// Always decorative here: the platform name is the link's aria-label.
function Logo({ className }: { className: string }) {
  return <img src={logoUrl} alt="" width={736} height={212} className={`w-auto ${className}`} />;
}
// Same frame as the web app's AuthLayout (apps/web/src/routes/auth/layout.tsx): two columns after the shadcn block login-02.
// Left: the logo once on the dark plate, the language switcher and the screen without a card; right: the registry panel.
function Frame({ kc, t, locale, title, hint, footer, children }: { kc: KcContext; t: Copy; locale: Locale; title: string; hint?: string; footer?: ReactNode; children: ReactNode }) {
  const languages = (kc.locale?.supported ?? []).filter(language => language.languageTag === "kk" || language.languageTag === "ru" || language.languageTag === "en");
  return <div className="grid min-h-svh bg-background lg:grid-cols-2">
    <div className="flex min-w-0 flex-col gap-4 p-6 md:p-10">
      <header className="flex items-center justify-between gap-4">
        <a href="/" className="inline-flex rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label={t.platform}><span className="inline-flex shrink-0 rounded-md bg-sidebar px-2.5 py-1.5"><Logo className="h-6" /></span></a>
        {languages.length > 1 && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-label={t.language}><Languages className="size-4" />{locale.toUpperCase()}</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{languages.map(language => <DropdownMenuItem key={language.languageTag} asChild><a href={language.url} lang={language.languageTag} aria-current={language.languageTag === locale ? "true" : undefined}>{localeNames[language.languageTag as Locale]}</a></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}
      </header>
      <main className="flex flex-1 items-center justify-center py-4">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <div className="flex flex-col items-center gap-1 text-center"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{hint && <p className="break-words text-sm text-balance text-muted-foreground">{hint}</p>}</div>
          <div className="space-y-4">{children}</div>
          {footer && <p className="flex flex-wrap justify-center gap-x-1 gap-y-1 text-center text-sm text-muted-foreground">{footer}</p>}
        </div>
      </main>
    </div>
    {/* Below lg the panel is display: none, so screen readers skip it too. A long form scrolls; the panel stays. */}
    <aside className="hidden bg-sidebar p-10 text-sidebar-foreground lg:sticky lg:top-0 lg:flex lg:h-svh lg:flex-col">
      <div className="flex max-w-lg flex-1 flex-col justify-center gap-6">
        <h2 className="text-4xl font-semibold leading-tight tracking-tight">{t.registry}</h2>
        <p className="max-w-md text-base leading-relaxed text-sidebar-foreground/80">{t.description}</p>
        <div className="flex max-w-md items-start gap-3 border-t border-sidebar-border pt-6 text-sm leading-relaxed text-sidebar-foreground/80"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-sidebar-primary" aria-hidden="true" /><p>{t.security}</p></div>
      </div>
      <p className="text-xs text-sidebar-foreground/70">{t.footer}</p>
    </aside>
  </div>;
}
function ProfileField({ attribute: a, kc, t }: { attribute: Attribute; kc: KcContext; t: Copy }) {
  const names: Record<string, string> = { username: t.username, email: t.email, firstName: t.firstName, lastName: t.lastName };
  const label = names[a.name] ?? translated(a.displayName, kc) ?? a.name;
  const options = a.validators.options?.options;
  return <div className="space-y-2"><Label htmlFor={a.name}>{label}{a.required && <span className="text-destructive" aria-hidden="true"> *</span>}</Label>{options && !a.multivalued ? <Select name={a.name} defaultValue={a.value} required={a.required} disabled={a.readOnly}><SelectTrigger id={a.name} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option} value={option}>{translated(a.annotations.inputOptionLabels?.[option], kc) || option}</SelectItem>)}</SelectContent></Select> : (a.multivalued ? a.values ?? [a.value ?? ""] : [a.value ?? ""]).map((value, index) => <Input key={`${a.name}-${index}`} id={index === 0 ? a.name : `${a.name}-${index}`} name={a.name} defaultValue={value} readOnly={a.readOnly} type={a.name === "email" ? "email" : "text"} autoComplete={a.autocomplete} required={a.required} aria-invalid={kc.messagesPerField.existsError(a.name)} aria-describedby={`${a.name}-error`} />)}<FieldError kc={kc} name={a.name} /></div>;
}

export default function KcPage({ kcContext: kc }: { kcContext: KcContext }) {
  const locale = getLocale(kc.locale?.currentLanguageTag);
  const t = copy[locale];
  const freshLoginUrl = `/api/auth/login?locale=${locale}`;
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { document.documentElement.lang = locale; document.title = t.platform; document.cookie = `NEXT_LOCALE=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; const reset = () => setSubmitting(false); window.addEventListener("pageshow", reset); return () => window.removeEventListener("pageshow", reset); }, [locale, t.platform]);
  const onSubmit = (_event: FormEvent<HTMLFormElement>) => setSubmitting(true);
  const submit = (label: string, extra?: { name: string; value: string }) => <Button type="submit" className="w-full" disabled={submitting} {...extra}>{submitting ? <><Loader2 className="size-4 animate-spin" />{t.submitting}</> : <>{label}<ArrowRight className="size-4" /></>}</Button>;
  const back = <Button asChild variant="ghost" className="h-auto w-full whitespace-normal text-muted-foreground"><a href={kc.pageId === "login-reset-password.ftl" ? freshLoginUrl : kc.url.loginUrl || freshLoginUrl}><ArrowLeft className="size-4 shrink-0" />{t.back}</a></Button>;
  const frame = (title: string, hint: string | undefined, children: ReactNode, footer?: ReactNode) => <Frame kc={kc} t={t} locale={locale} title={title} hint={hint} footer={footer}>{children}</Frame>;
  const message = <ServerMessage kc={kc} />;

  switch (kc.pageId) {
    case "login.ftl":
    case "login-username.ftl":
    case "login-password.ftl": {
      const passwordOnly = kc.pageId === "login-password.ftl";
      const usernameOnly = kc.pageId === "login-username.ftl";
      const hiddenUsername = passwordOnly || ("usernameHidden" in kc && kc.usernameHidden);
      const login = "login" in kc ? kc.login : undefined;
      const resetAllowed = "resetPasswordAllowed" in kc.realm && kc.realm.resetPasswordAllowed;
      return frame(t.loginTitle, passwordOnly && kc.auth?.attemptedUsername ? kc.auth.attemptedUsername : t.loginHint, <>
        {message}
        <form id="kc-form-login" action={kc.url.loginAction} method="post" className="space-y-5" onSubmit={onSubmit}>
          {!hiddenUsername && <AccountField kc={kc} t={t} value={login?.username} usernameAllowed={!kc.realm.registrationEmailAsUsername} />}
          {!usernameOnly && <PasswordField name="password" label={t.password} kc={kc} t={t} autoFocus={!!hiddenUsername} />}
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">{"rememberMe" in kc.realm && kc.realm.rememberMe && !hiddenUsername && <Label className="font-normal"><Checkbox name="rememberMe" defaultChecked={!!(login && "rememberMe" in login && login.rememberMe)} />{t.remember}</Label>}{resetAllowed && <a href={`/api/auth/password-reset?locale=${locale}`} className="ml-auto font-medium text-primary underline-offset-4 hover:underline">{t.forgot}</a>}</div>
          {"selectedCredential" in (kc.auth ?? {}) && <input type="hidden" name="credentialId" value={(kc.auth as { selectedCredential?: string }).selectedCredential ?? ""} />}
          {submit(usernameOnly ? t.continue : t.signIn)}
        </form>
        {hiddenUsername && <Button asChild variant="ghost" className="w-full whitespace-normal"><a href={kc.url.loginRestartFlowUrl}>{t.otherAccount}</a></Button>}
        {"social" in kc && kc.social?.providers?.length ? <div className="space-y-2">{kc.social.providers.map(provider => <Button asChild variant="outline" className="w-full" key={provider.alias}><a href={provider.loginUrl}>{provider.displayName}</a></Button>)}</div> : null}
      </>, <>{t.noAccount}<a href={`/register?locale=${locale}`} className="font-medium text-primary underline-offset-4 hover:underline">{t.register}</a></>);
    }
    case "login-reset-password.ftl":
      return frame(t.resetTitle, t.resetHint, <>{message}<form id="kc-reset-password-form" action={kc.url.loginAction} method="post" className="space-y-5" onSubmit={onSubmit}><AccountField kc={kc} t={t} value={kc.auth.attemptedUsername} usernameAllowed={false} />{submit(t.sendLink)}</form>{back}</>);
    case "login-update-password.ftl":
      return frame(t.updateTitle, t.updateHint, <>{message}<form id="kc-passwd-update-form" action={kc.url.loginAction} method="post" className="space-y-5" onSubmit={onSubmit}><PasswordField name="password-new" label={t.newPassword} kc={kc} t={t} isNew autoFocus /><PasswordField name="password-confirm" label={t.confirmPassword} kc={kc} t={t} isNew /><p id="password-hint" className="text-xs leading-5 text-muted-foreground">{t.passwordHint}</p><input type="hidden" name="logout-sessions" value="on" /><p className="text-xs leading-5 text-muted-foreground">{t.logoutOthers}</p>{submit(t.savePassword)}{kc.isAppInitiatedAction && <Button type="submit" variant="ghost" name="cancel-aia" value="true" className="w-full" formNoValidate>{t.cancel}</Button>}</form></>);
    case "login-verify-email.ftl":
      return frame(t.verifyTitle, t.verifyHint, <>{message}{kc.user?.email && <p className="rounded-lg border bg-muted/40 p-4 text-sm leading-6">{t.sentTo}<br /><strong className="break-all font-medium">{kc.user.email}</strong></p>}<p className="text-sm leading-6 text-muted-foreground">{t.noEmail}</p><Button asChild variant="outline" className="h-auto min-h-9 w-full whitespace-normal"><a href={kc.url.loginAction}>{t.resend}</a></Button>{back}</>);
    case "info.ftl": {
      const target = kc.pageRedirectUri || kc.actionUri || kc.client.baseUrl;
      const actions = kc.requiredActions?.map(action => ({ UPDATE_PASSWORD: t.requiredPassword, VERIFY_EMAIL: t.requiredEmail, UPDATE_PROFILE: t.requiredProfile }[action] ?? translated(`\${requiredAction.${action}}`, kc)));
      return frame(kc.actionUri ? t.actionTitle : kc.message.type === "success" ? t.doneTitle : t.infoTitle, kc.actionUri ? t.actionHint : undefined, <>{message}{actions?.length ? <ul className="space-y-2 text-sm">{actions.map(action => <li className="flex items-center gap-2" key={action}><CheckCircle2 className="size-4 text-primary" />{action}</li>)}</ul> : null}{!kc.skipLink && target && <Button asChild className="w-full"><a href={target}>{t.continue}<ArrowRight className="size-4" /></a></Button>}</>);
    }
    case "error.ftl":
      return frame(t.errorTitle, t.errorHint, <>{message}{!kc.skipLink && <Button asChild className="w-full"><a href={freshLoginUrl}>{t.restart}<ArrowRight className="size-4" /></a></Button>}</>);
    case "login-page-expired.ftl":
      return frame(t.expiredTitle, t.expiredHint, <>{message}<Button asChild className="w-full"><a href={freshLoginUrl}>{t.restart}<ArrowRight className="size-4" /></a></Button></>);
    case "logout-confirm.ftl":
      return frame(t.logoutTitle, t.logoutHint, <>{message}<form action={kc.url.logoutConfirmAction} method="post" onSubmit={onSubmit} className="space-y-3"><input type="hidden" name="session_code" value={kc.logoutConfirm.code} /><input type="hidden" name="confirmLogout" value="true" />{submit(t.logout)}</form>{!kc.logoutConfirm.skipLink && kc.client.baseUrl && <Button asChild variant="ghost" className="w-full"><a href={kc.client.baseUrl}>{t.cancel}</a></Button>}</>);
    case "login-update-profile.ftl":
    case "idp-review-user-profile.ftl":
    case "update-email.ftl":
      return frame(t.profileTitle, t.profileHint, <>{message}<form action={kc.url.loginAction} method="post" onSubmit={onSubmit} className="space-y-5">{Object.values(kc.profile.attributesByName).map(attribute => <ProfileField key={attribute.name} attribute={attribute} kc={kc} t={t} />)}{submit(t.save)}{kc.isAppInitiatedAction && <Button type="submit" name="cancel-aia" value="true" variant="ghost" formNoValidate className="w-full">{t.cancel}</Button>}</form></>);
    case "login-otp.ftl":
      return frame(t.codeTitle, t.codeHint, <>{message}<form action={kc.url.loginAction} method="post" onSubmit={onSubmit} className="space-y-5">{kc.otpLogin.userOtpCredentials.length > 1 && <Select name="selectedCredentialId" defaultValue={kc.otpLogin.selectedCredentialId}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{kc.otpLogin.userOtpCredentials.map(credential => <SelectItem key={credential.id} value={credential.id}>{credential.userLabel}</SelectItem>)}</SelectContent></Select>}<div className="space-y-2"><Label htmlFor="otp">{t.code}</Label><Input id="otp" name="otp" inputMode="numeric" autoComplete="one-time-code" autoFocus required className="h-12 text-center text-lg tracking-[0.3em]" /><FieldError kc={kc} name="totp" /></div>{submit(t.continue)}</form></>);
    case "select-authenticator.ftl":
      return frame(t.chooseMethod, undefined, <>{message}<form action={kc.url.loginAction} method="post" className="space-y-3">{kc.auth.authenticationSelections.map(choice => <Button type="submit" name="authenticationExecution" value={choice.authExecId} variant="outline" className="min-h-12 w-full whitespace-normal" key={choice.authExecId}>{translated(`\${${choice.displayName}}`, kc)}</Button>)}</form>{back}</>);
    case "login-idp-link-confirm.ftl":
      return frame(t.actionTitle, t.actionHint, <>{message}<form action={kc.url.loginAction} method="post" className="space-y-3"><Button name="submitAction" value="updateProfile" type="submit" variant="outline" className="w-full">{t.review}</Button><Button name="submitAction" value="linkAccount" type="submit" className="w-full">{t.linkAccount}</Button></form></>);
    case "login-idp-link-email.ftl":
      return frame(t.verifyTitle, t.verifyHint, <>{message}<Button asChild className="w-full"><a href={kc.url.loginAction}>{t.continue}</a></Button>{back}</>);
    case "terms.ftl":
      return frame(t.termsTitle, undefined, <>{message}<div className="max-h-72 overflow-y-auto rounded-lg border p-4 text-sm leading-6" dangerouslySetInnerHTML={{ __html: kcSanitize(kc["x-keycloakify"].messages.termsText ?? "") }} /><form action={kc.url.loginAction} method="post" className="space-y-2"><Button type="submit" name="accept" value="true" className="w-full">{t.accept}</Button><Button type="submit" name="cancel" value="true" variant="ghost" className="w-full">{t.decline}</Button></form></>);
    default:
      // Unconfigured identity methods never expose a vendor/default page.
      return frame(t.errorTitle, t.unavailable, <>{message}{back}</>);
  }
}
