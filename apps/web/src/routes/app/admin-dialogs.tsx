import {
  type AdminAccount,
  type AdminAccountResult,
  type AdminOrganization,
  type AdminOrganizationResult,
  type AdminProblemCode,
  changeEmailSchema,
  CREATABLE_ORGANIZATION_TYPES,
  createOrganizationSchema,
  imbcMailboxSchema,
  type ImbcMailboxResult,
  INVITABLE_ROLES,
  inviteAccountSchema,
  type Role,
} from "@imbc/contracts";
import {
  type ComponentProps,
  type FormEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslations } from "use-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";

import { type Action, problemCode, useAdminAction, useProblemMessage } from "./admin-actions";

/** Куда уходит фокус при закрытии диалога: ссылка на элемент или функция (Base UI `finalFocus`). */
type FinalFocus = ComponentProps<typeof DialogContent>["finalFocus"];

/**
 * Диалог действия: своя переведённая кнопка «Отмена» (у встроенной подпись «Close» не переводится),
 * закрытие возвращает фокус на кнопку-триггер или на `finalFocus` (кнопку меню строки). Пока `locked`
 * (запрос в пути), диалог не закрывается ни Escape, ни щелчком по подложке: итог действия не придёт
 * на уже закрытый диалог.
 */
function AdminDialog({
  open,
  onOpenChange,
  trigger,
  finalFocus,
  locked = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactElement;
  finalFocus?: FinalFocus;
  locked?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && locked) return;
        onOpenChange(next);
      }}
    >
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent
        showCloseButton={false}
        finalFocus={finalFocus}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-md"
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Форма в диалоге: поля, ошибка запроса и кнопки. Enter в поле отправляет форму. После неудачной
 * проверки (`focusRequest` растёт) фокус уходит на первое поле с ошибкой. Пока запрос в пути, «Отмена»
 * недоступна (диалог не закрывается); `submitDisabled` — «Сохранить» недоступна, пока значение не изменено.
 */
function DialogForm({
  title,
  description,
  submitLabel,
  pending,
  submitDisabled = false,
  error,
  focusRequest,
  onSubmit,
  children,
}: {
  title: string;
  description?: string;
  submitLabel: string;
  pending: boolean;
  submitDisabled?: boolean;
  error?: string;
  focusRequest: number;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("adminAccounts");
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (focusRequest) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitDisabled) return;
    onSubmit();
  };
  return (
    <form ref={formRef} onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="leading-snug wrap-anywhere">{title}</DialogTitle>
        {description && <DialogDescription className="wrap-anywhere">{description}</DialogDescription>}
      </DialogHeader>
      <FieldGroup className="gap-4">{children}</FieldGroup>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <DialogClose disabled={pending} render={<Button type="button" variant="outline" />}>
          {t("cancel")}
        </DialogClose>
        <Button type="submit" disabled={pending || submitDisabled}>
          {pending && <Spinner aria-hidden="true" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Текстовое поле с подсказкой и ошибкой, связанными через aria-describedby. */
function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  type = "text",
  autoComplete,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  type?: "text" | "email";
  autoComplete?: string;
  maxLength?: number;
}) {
  const describedBy = [hint && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <Field data-invalid={!!error || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={!!error}
        aria-describedby={describedBy}
      />
      {hint && <FieldDescription id={`${id}-help`}>{hint}</FieldDescription>}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </Field>
  );
}

/** Выпадающий список с подписью над ним; `items` с вариантом `null` — подпись пустого выбора (Base UI). */
function SelectField<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  error,
  hint,
}: {
  id: string;
  label: string;
  value: T | null;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  hint?: string;
}) {
  const labelId = `${id}-label`;
  const items = placeholder ? [{ value: null, label: placeholder }, ...options] : [...options];
  const describedBy = [hint && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <Field data-invalid={!!error || undefined}>
      <FieldLabel id={labelId} htmlFor={id}>
        {label}
      </FieldLabel>
      <Select
        items={items}
        value={value}
        disabled={disabled}
        // Base UI передаёт null при сбросе: принимаем только варианты списка.
        onValueChange={(next) => {
          const option = options.find((o) => o.value === next);
          if (option) onChange(option.value);
        }}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          aria-labelledby={labelId}
          aria-invalid={!!error}
          aria-describedby={describedBy}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <FieldDescription id={`${id}-help`}>{hint}</FieldDescription>}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </Field>
  );
}

/** Ошибка сервера, которая показывается у поля: после неё фокус уходит на это поле. */
const focusOn = (fieldCode: AdminProblemCode, request: (update: (n: number) => number) => void) => (error: unknown) => {
  if (problemCode(error) === fieldCode) request((n) => n + 1);
};

/** Поля, у которых ошибка проверки схемы контракта: первый сегмент пути каждого замечания. */
function issueFields(issues: readonly { path: readonly PropertyKey[] }[]): Set<string> {
  return new Set(issues.map((issue) => String(issue.path[0] ?? "")));
}

/** Ящик IMBC (раздел 8.2): адрес или пустое поле — null снимает ящик. */
export function ImbcMailboxDialog({ mailbox }: { mailbox: string | null }) {
  const t = useTranslations("adminAccounts");
  const [open, setOpen] = useState(false);
  const action = useAdminAction({
    request: (email: string | null) =>
      api<ImbcMailboxResult>("/v1/admin/imbc-mailbox", { method: "PUT", json: { email } }),
    done: (result) => (result.imbcMailbox ? t("mailboxSaved") : t("mailboxCleared")),
  });
  return (
    <AdminDialog
      open={open}
      onOpenChange={(next) => {
        if (next) action.reset();
        setOpen(next);
      }}
      locked={action.isPending}
      trigger={
        <Button variant="outline" size="sm">
          {t("change")}
        </Button>
      }
    >
      <MailboxForm mailbox={mailbox} action={action} close={() => setOpen(false)} />
    </AdminDialog>
  );
}

function MailboxForm({
  mailbox,
  action,
  close,
}: {
  mailbox: string | null;
  action: Action<string | null>;
  close: () => void;
}) {
  const t = useTranslations("adminAccounts");
  const problem = useProblemMessage();
  const id = useId();
  const [value, setValue] = useState(mailbox ?? "");
  const [invalid, setInvalid] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  // Адрес хранится в нижнем регистре (imbcMailboxSchema): отличие только регистром или пробелами — не изменение.
  const unchanged = value.trim().toLowerCase() === (mailbox ?? "").toLowerCase();
  const submit = () => {
    const email = value.trim();
    const parsed = imbcMailboxSchema.safeParse({ email: email === "" ? null : email });
    if (!parsed.success) {
      setInvalid(true);
      setFocusRequest((n) => n + 1);
      return;
    }
    action.run(parsed.data.email, { onSuccess: close });
  };
  return (
    <DialogForm
      title={t("imbcMailbox")}
      description={t("imbcMailboxHint")}
      submitLabel={t("save")}
      pending={action.isPending}
      submitDisabled={unchanged}
      error={action.isError ? problem(action.error) : undefined}
      focusRequest={focusRequest}
      onSubmit={submit}
    >
      <TextField
        id={`${id}-email`}
        label={t("email")}
        type="email"
        autoComplete="off"
        maxLength={254}
        value={value}
        onChange={(next) => {
          setValue(next);
          setInvalid(false);
        }}
        hint={t("imbcMailboxClearHint")}
        error={invalid ? t("fieldErrors.email") : undefined}
      />
    </DialogForm>
  );
}

/** Новая организация оператора или наблюдателя (ADM-03); отметка major — только у оператора (GEN-05). */
export function CreateOrganizationDialog() {
  const t = useTranslations("adminAccounts");
  const [open, setOpen] = useState(false);
  const action = useAdminAction({
    request: (input: OrganizationInput) =>
      api<AdminOrganizationResult>("/v1/admin/organizations", { method: "POST", json: input }),
    done: (result) => t("organizationCreated", { name: result.organization.name }),
  });
  return (
    <AdminDialog
      open={open}
      onOpenChange={(next) => {
        if (next) action.reset();
        setOpen(next);
      }}
      locked={action.isPending}
      trigger={<Button variant="outline">{t("createOrganization")}</Button>}
    >
      <OrganizationForm action={action} close={() => setOpen(false)} />
    </AdminDialog>
  );
}

type OrganizationInput = {
  name: string;
  type: (typeof CREATABLE_ORGANIZATION_TYPES)[number];
  isMajorOperator: boolean;
};

function OrganizationForm({ action, close }: { action: Action<OrganizationInput>; close: () => void }) {
  const t = useTranslations("adminAccounts");
  const problem = useProblemMessage();
  const id = useId();
  const [name, setName] = useState("");
  const [type, setType] = useState<OrganizationInput["type"]>("operator");
  const [major, setMajor] = useState(false);
  const [nameInvalid, setNameInvalid] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const code = problemCode(action.error);
  const submit = () => {
    const parsed = createOrganizationSchema.safeParse({ name, type, isMajorOperator: type === "operator" && major });
    if (!parsed.success) {
      setNameInvalid(issueFields(parsed.error.issues).has("name"));
      setFocusRequest((n) => n + 1);
      return;
    }
    // Занятое название — ошибка у поля, фокус на нём.
    action.run(parsed.data, { onSuccess: close, onError: focusOn("organization_exists", setFocusRequest) });
  };
  const nameError = nameInvalid
    ? t("fieldErrors.organizationName")
    : code === "organization_exists"
      ? t("errors.organization_exists")
      : undefined;
  return (
    <DialogForm
      title={t("createOrganization")}
      description={t("createOrganizationHint")}
      submitLabel={t("create")}
      pending={action.isPending}
      error={action.isError && code !== "organization_exists" ? problem(action.error) : undefined}
      focusRequest={focusRequest}
      onSubmit={submit}
    >
      <TextField
        id={`${id}-name`}
        label={t("organizationName")}
        autoComplete="organization"
        maxLength={300}
        value={name}
        onChange={(next) => {
          setName(next);
          setNameInvalid(false);
          if (action.isError) action.reset();
        }}
        error={nameError}
      />
      <SelectField
        id={`${id}-type`}
        label={t("organizationType")}
        value={type}
        options={CREATABLE_ORGANIZATION_TYPES.map((value) => ({ value, label: t(`typeValue.${value}`) }))}
        onChange={(next) => {
          setType(next);
          if (next !== "operator") setMajor(false);
        }}
      />
      {type === "operator" && (
        <Field orientation="horizontal">
          <Checkbox id={`${id}-major`} checked={major} onCheckedChange={(checked) => setMajor(checked === true)} />
          <FieldLabel htmlFor={`${id}-major`} className="font-normal">
            {t("majorOperator")}
          </FieldLabel>
        </Field>
      )}
    </DialogForm>
  );
}

type InviteInput = { email: string; fullName: string; organizationId: string; role: Role };
type InvitableOrganization = AdminOrganization & { type: keyof typeof INVITABLE_ROLES };

/**
 * Приглашение сотрудника IMBC, оператора или наблюдателя (ADM-01): в организацию производителя не
 * приглашают (GEN-01), роли — по типу организации (`INVITABLE_ROLES`).
 */
export function InviteDialog({
  organizations,
  organizationId = null,
  trigger,
  invitedFocus,
}: {
  organizations: readonly AdminOrganization[];
  /** Организация, выбранная заранее (приглашение из карточки организации без аккаунтов). */
  organizationId?: string | null;
  trigger?: ReactElement;
  /**
   * Куда перевести фокус после удачного приглашения, если триггер исчезнет со страницы (кнопка из пустой
   * карточки: в ней появляется аккаунт). Отмена и закрытие без приглашения возвращают фокус на триггер.
   */
  invitedFocus?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("adminAccounts");
  const [open, setOpen] = useState(false);
  const invited = useRef(false);
  const action = useAdminAction({
    request: (input: InviteInput) => api<AdminAccountResult>("/v1/admin/accounts", { method: "POST", json: input }),
    done: (result) => t("invited", { email: result.account.email }),
  });
  return (
    <AdminDialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          action.reset();
          invited.current = false;
        }
        setOpen(next);
      }}
      locked={action.isPending}
      finalFocus={invitedFocus && (() => (invited.current ? invitedFocus.current : true))}
      trigger={trigger ?? <Button>{t("inviteUser")}</Button>}
    >
      <InviteForm
        organizations={organizations}
        organizationId={organizationId}
        action={action}
        close={() => {
          invited.current = true;
          setOpen(false);
        }}
      />
    </AdminDialog>
  );
}

type InviteField = "email" | "fullName" | "organizationId" | "role";

/** Роль по умолчанию: у оператора и наблюдателя она одна — она и выбрана. */
const defaultRole = (type: InvitableOrganization["type"] | undefined): Role | null => {
  const allowed: readonly Role[] = type ? INVITABLE_ROLES[type] : [];
  return allowed.length === 1 ? allowed[0]! : null;
};

function InviteForm({
  organizations,
  organizationId,
  action,
  close,
}: {
  organizations: readonly AdminOrganization[];
  organizationId: string | null;
  action: Action<InviteInput>;
  close: () => void;
}) {
  const t = useTranslations("adminAccounts");
  const roles = useTranslations("roles");
  const problem = useProblemMessage();
  const id = useId();
  const invitable = organizations.filter((o): o is InvitableOrganization => o.type !== "manufacturer");
  const [form, setForm] = useState(() => ({
    email: "",
    fullName: "",
    organizationId,
    role: defaultRole(invitable.find((o) => o.id === organizationId)?.type),
  }));
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [focusRequest, setFocusRequest] = useState(0);
  const code = problemCode(action.error);
  const organization = invitable.find((o) => o.id === form.organizationId);
  const roleOptions = organization
    ? INVITABLE_ROLES[organization.type].map((value) => ({ value: value as Role, label: roles(value) }))
    : [];
  const edit = (field: InviteField, patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }));
    setInvalid((current) => {
      const next = new Set(current);
      next.delete(field);
      if (patch.role !== undefined) next.delete("role");
      return next;
    });
    if (action.isError) action.reset();
  };
  const submit = () => {
    const parsed = inviteAccountSchema.safeParse(form);
    if (!parsed.success) {
      setInvalid(issueFields(parsed.error.issues));
      setFocusRequest((n) => n + 1);
      return;
    }
    action.run(parsed.data, { onSuccess: close, onError: focusOn("email_exists", setFocusRequest) });
  };
  const emailError = invalid.has("email")
    ? t("fieldErrors.email")
    : code === "email_exists"
      ? t("errors.email_exists")
      : undefined;
  return (
    <DialogForm
      title={t("inviteUser")}
      description={t("inviteHint")}
      submitLabel={t("invite")}
      pending={action.isPending}
      error={action.isError && code !== "email_exists" ? problem(action.error) : undefined}
      focusRequest={focusRequest}
      onSubmit={submit}
    >
      <TextField
        id={`${id}-email`}
        label={t("email")}
        type="email"
        autoComplete="off"
        maxLength={254}
        value={form.email}
        onChange={(email) => edit("email", { email })}
        hint={t("inviteEmailHint")}
        error={emailError}
      />
      <TextField
        id={`${id}-name`}
        label={t("name")}
        autoComplete="off"
        maxLength={200}
        value={form.fullName}
        onChange={(fullName) => edit("fullName", { fullName })}
        error={invalid.has("fullName") ? t("fieldErrors.fullName") : undefined}
      />
      <SelectField
        id={`${id}-organization`}
        label={t("organization")}
        value={form.organizationId}
        placeholder={t("chooseOrganization")}
        options={invitable.map((o) => ({ value: o.id, label: o.name }))}
        onChange={(next) =>
          edit("organizationId", {
            organizationId: next,
            role: defaultRole(invitable.find((o) => o.id === next)?.type),
          })
        }
        error={invalid.has("organizationId") ? t("fieldErrors.organization") : undefined}
      />
      <SelectField
        id={`${id}-role`}
        label={t("role")}
        value={form.role}
        placeholder={t("chooseRole")}
        options={roleOptions}
        disabled={!organization}
        onChange={(role) => edit("role", { role })}
        hint={organization && organization.type !== "imbc" ? t("inviteRoleHint") : undefined}
        // Без организации роль не выбрать: о ней говорит ошибка поля организации.
        error={organization && invalid.has("role") ? t("fieldErrors.role") : undefined}
      />
    </DialogForm>
  );
}

/** Смена роли сотрудника IMBC (AUTH-06): открытые сеансы завершаются сразу — сказано до сохранения. */
export function ChangeRoleDialog({
  account,
  open,
  onOpenChange,
  finalFocus,
}: {
  account: AdminAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("adminAccounts");
  const action = useAdminAction({
    request: (role: Role) =>
      api<AdminAccountResult>(`/v1/admin/accounts/${account.id}/role`, { method: "PUT", json: { role } }),
    done: () => t("roleChanged", { email: account.email }),
  });
  return (
    <AdminDialog
      open={open}
      onOpenChange={(next) => {
        if (next) action.reset();
        onOpenChange(next);
      }}
      locked={action.isPending}
      finalFocus={finalFocus}
    >
      <RoleForm account={account} action={action} close={() => onOpenChange(false)} />
    </AdminDialog>
  );
}

function RoleForm({ account, action, close }: { account: AdminAccount; action: Action<Role>; close: () => void }) {
  // Адрес на момент открытия: перечитанный после успеха список не меняет заголовок закрывающегося диалога.
  const [email] = useState(account.email);
  const t = useTranslations("adminAccounts");
  const roles = useTranslations("roles");
  const problem = useProblemMessage();
  const id = useId();
  const imbcRoles: readonly Role[] = INVITABLE_ROLES.imbc;
  const [role, setRole] = useState<Role | null>(imbcRoles.includes(account.role) ? account.role : null);
  const [invalid, setInvalid] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const submit = () => {
    if (!role) {
      setInvalid(true);
      setFocusRequest((n) => n + 1);
      return;
    }
    action.run(role, { onSuccess: close });
  };
  return (
    <DialogForm
      title={t("changeRoleTitle", { email })}
      description={t("changeRoleHint")}
      submitLabel={t("save")}
      pending={action.isPending}
      submitDisabled={role === account.role}
      error={action.isError ? problem(action.error) : undefined}
      focusRequest={focusRequest}
      onSubmit={submit}
    >
      <SelectField
        id={`${id}-role`}
        label={t("role")}
        value={role}
        placeholder={t("chooseRole")}
        options={imbcRoles.map((value) => ({ value, label: roles(value) }))}
        onChange={(next) => {
          setRole(next);
          setInvalid(false);
          if (action.isError) action.reset();
        }}
        error={invalid ? t("fieldErrors.role") : undefined}
      />
    </DialogForm>
  );
}

/**
 * Смена почты-логина производителя (ADM-05, MAN-05): сеансы и доверенные устройства завершаются, код
 * следующего входа придёт на новый адрес; приглашённому туда же уйдёт письмо установки пароля.
 */
export function ChangeEmailDialog({
  account,
  open,
  onOpenChange,
  finalFocus,
}: {
  account: AdminAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("adminAccounts");
  const action = useAdminAction({
    request: (email: string) =>
      api<AdminAccountResult>(`/v1/admin/accounts/${account.id}/email`, { method: "PUT", json: { email } }),
    done: (result) => t("emailChanged", { email: result.account.email }),
  });
  return (
    <AdminDialog
      open={open}
      onOpenChange={(next) => {
        if (next) action.reset();
        onOpenChange(next);
      }}
      locked={action.isPending}
      finalFocus={finalFocus}
    >
      <EmailForm account={account} action={action} close={() => onOpenChange(false)} />
    </AdminDialog>
  );
}

function EmailForm({ account, action, close }: { account: AdminAccount; action: Action<string>; close: () => void }) {
  // Адрес на момент открытия: перечитанный после успеха список не меняет заголовок закрывающегося диалога.
  const [email] = useState(account.email);
  const t = useTranslations("adminAccounts");
  const problem = useProblemMessage();
  const id = useId();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const code = problemCode(action.error);
  // Письмо на новый адрес уходит только приглашённому (установка пароля); у неактивного и заблокированного
  // его нет — подсказка не обещает ни сеансов, ни письма.
  const emailHint =
    account.state === "invited"
      ? `${t("changeEmailHint")} ${t("changeEmailInvitedHint")}`
      : account.state === "inactive" || account.state === "blocked"
        ? t("changeEmailHintIdle")
        : t("changeEmailHint");
  const submit = () => {
    const parsed = changeEmailSchema.safeParse({ email: value });
    if (!parsed.success) {
      setInvalid(true);
      setFocusRequest((n) => n + 1);
      return;
    }
    action.run(parsed.data.email, { onSuccess: close, onError: focusOn("email_exists", setFocusRequest) });
  };
  return (
    <DialogForm
      title={t("changeEmailTitle", { email })}
      description={emailHint}
      submitLabel={t("save")}
      pending={action.isPending}
      error={action.isError && code !== "email_exists" ? problem(action.error) : undefined}
      focusRequest={focusRequest}
      onSubmit={submit}
    >
      <TextField
        id={`${id}-email`}
        label={t("newEmail")}
        type="email"
        autoComplete="off"
        maxLength={254}
        value={value}
        onChange={(next) => {
          setValue(next);
          setInvalid(false);
          if (action.isError) action.reset();
        }}
        error={invalid ? t("fieldErrors.email") : code === "email_exists" ? t("errors.email_exists") : undefined}
      />
    </DialogForm>
  );
}
