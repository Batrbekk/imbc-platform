// Организации и аккаунты администратора IMBC: GEN-01, GEN-02, GEN-03, GEN-05, GEN-06, ADM-01, ADM-02, ADM-03,
// ADM-05, ADM-06 (данных профилей нет), AUTH-01, AUTH-06, NOT-24.
import type { Role } from "@imbc/contracts";
import { cn } from "cn";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFormat } from "@/i18n/format";
import { ConfirmAction, ProtoPage } from "@/prototype/components";
import type { ProtoAccount, ProtoOrganization } from "@/prototype/data";
import { localized, translate, useDictionary } from "@/prototype/i18n";
import { commonTexts, useCommonTexts } from "@/prototype/labels";
import { protoPath } from "@/prototype/registry";
import { newId, nowIso, useProto, useProtoUpdate } from "@/prototype/store";

import { useAdminAccountId, useGuardedUpdate } from "./actor";
import { ChoiceField, TextField } from "./fields";
import { organizationsTexts } from "./organizations-texts";
import { isEmail, localizedWith, texts } from "./texts";

const TYPES = ["operator", "observer", "imbc", "manufacturer"] as const;
type OrgTab = (typeof TYPES)[number];

/** Роли, которые администратор приглашает в организацию данного типа (раздел 3.1, ADM-01). */
const ROLES_BY_TYPE: Record<Exclude<OrgTab, "manufacturer">, Role[]> = {
  imbc: ["expert", "administrator", "director"],
  operator: ["operator"],
  observer: ["observer"],
};

/** Адрес уже занят каким-либо аккаунтом: один аккаунт на человека (GEN-02, GEN-06). */
function emailTaken(accounts: ProtoAccount[], email: string, exceptId?: string) {
  const wanted = email.trim().toLowerCase();
  return accounts.some((a) => a.id !== exceptId && a.email.toLowerCase() === wanted);
}

function emailError(accounts: ProtoAccount[], email: string, exceptId?: string): "emailInvalid" | "emailTaken" | null {
  if (!isEmail(email)) return "emailInvalid";
  if (emailTaken(accounts, email, exceptId)) return "emailTaken";
  return null;
}

export function OrganizationsScreen() {
  const t = useDictionary(organizationsTexts);
  const admin = useDictionary(texts);
  const [params, setParams] = useSearchParams();
  const tab: OrgTab = TYPES.find((type) => type === params.get("type")) ?? "operator";
  const organizations = useProto((s) => s.organizations.filter((o) => o.type === tab));

  return (
    <ProtoPage
      title={t("title")}
      description={t("description")}
      actions={<CreateOrganization onCreated={(type) => setParams({ type }, { replace: true })} />}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (typeof value === "string") setParams({ type: value }, { replace: true });
        }}
      >
        <TabsList aria-label={t("tabs")} className="h-auto flex-wrap">
          {TYPES.map((type) => (
            <TabsTrigger key={type} value={type}>
              {admin(`orgType.${type}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab === "manufacturer" ? (
        <ManufacturerAccounts organizations={organizations} />
      ) : (
        organizations.map((organization) => (
          <OrganizationCard key={organization.id} organization={organization} roles={ROLES_BY_TYPE[tab]} />
        ))
      )}
    </ProtoPage>
  );
}

function CreateOrganization({ onCreated }: { onCreated: (type: "operator" | "observer") => void }) {
  const t = useDictionary(organizationsTexts);
  const admin = useDictionary(texts);
  const update = useProtoUpdate();
  const names = useProto((s) => s.organizations.map((o) => o.name.toLowerCase()));
  const [name, setName] = useState("");
  const [type, setType] = useState<"operator" | "observer">("operator");
  const [major, setMajor] = useState(false);
  const taken = names.includes(name.trim().toLowerCase());

  const create = () => {
    const id = newId("org");
    const isMajor = type === "operator" && major;
    update(
      {
        action: "organization.create",
        subject: { type: "organization", id, label: name.trim() },
        summary: localizedWith(organizationsTexts, isMajor ? "createdMajor" : "created", (l) => ({
          type: translate(texts, l, `orgType.${type}`),
          name: name.trim(),
        })),
      },
      (draft) => {
        draft.organizations.push({
          id,
          type,
          name: name.trim(),
          bin: null,
          majorOperator: isMajor,
          createdAt: nowIso(),
        });
      },
    );
    onCreated(type);
    setName("");
    setMajor(false);
  };

  return (
    <ConfirmAction
      label={t("create")}
      title={t("createTitle")}
      description={t("createDescription")}
      confirmLabel={t("create")}
      confirmDisabled={!name.trim() || taken}
      onConfirm={create}
    >
      <div className="flex flex-col gap-4">
        <TextField label={t("name")} value={name} onChange={setName} error={taken ? t("nameTaken") : null} />
        <ChoiceField
          label={t("type")}
          value={type}
          onChange={setType}
          options={[
            { value: "operator", label: admin("orgType.operator") },
            { value: "observer", label: admin("orgType.observer") },
          ]}
        />
        {type === "operator" && (
          <div className="flex flex-col gap-1">
            <Label className="font-normal">
              <Switch checked={major} onCheckedChange={(checked) => setMajor(checked)} />
              {admin("majorOperator")}
            </Label>
            <p className="text-sm text-muted-foreground">{t("majorHint")}</p>
          </div>
        )}
      </div>
    </ConfirmAction>
  );
}

function OrganizationCard({ organization, roles }: { organization: ProtoOrganization; roles: Role[] }) {
  const t = useDictionary(organizationsTexts);
  const admin = useDictionary(texts);
  const format = useFormat();
  const update = useGuardedUpdate();
  const accounts = useProto((s) => s.accounts.filter((a) => a.organizationId === organization.id));

  const setMajor = (value: boolean) =>
    update(
      {
        action: value ? "organization.mark_major" : "organization.unmark_major",
        subject: { type: "organization", id: organization.id, label: organization.name },
        summary: localized(organizationsTexts, value ? "markedMajor" : "unmarkedMajor", { name: organization.name }),
      },
      (draft) => {
        const target = draft.organizations.find((o) => o.id === organization.id);
        if (!target) return false;
        target.majorOperator = value;
        return true;
      },
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{organization.name}</CardTitle>
        <CardDescription>
          {admin(`orgType.${organization.type}`)} · {t("accounts", { total: format.number(accounts.length) })}
        </CardDescription>
        <CardAction className="flex flex-wrap items-center gap-2">
          {organization.type === "operator" && (
            <Label className="font-normal">
              <Switch checked={organization.majorOperator} onCheckedChange={(checked) => setMajor(checked)} />
              {admin("majorOperator")}
            </Label>
          )}
          <InviteAccount organization={organization} roles={roles} />
        </CardAction>
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noAccounts")}</p>
        ) : (
          <AccountsTable accounts={accounts} />
        )}
      </CardContent>
    </Card>
  );
}

function InviteAccount({ organization, roles }: { organization: ProtoOrganization; roles: Role[] }) {
  const t = useDictionary(organizationsTexts);
  const admin = useDictionary(texts);
  const common = useCommonTexts();
  const update = useProtoUpdate();
  const accounts = useProto((s) => s.accounts);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>(roles[0]!);
  const error = emailError(accounts, email);

  const invite = () => {
    const id = newId("acc");
    const address = email.trim();
    update(
      {
        action: "account.invite",
        subject: { type: "account", id, label: address },
        summary: localizedWith(organizationsTexts, "invited", (l) => ({
          email: address,
          role: translate(commonTexts, l, `role.${role}`),
        })),
      },
      (draft) => {
        draft.accounts.push({
          id,
          organizationId: organization.id,
          email: address,
          fullName: name.trim(),
          role,
          state: "invited",
          lastSignInAt: null,
          invitedAt: nowIso(),
        });
      },
    );
    setEmail("");
    setName("");
  };

  return (
    <ConfirmAction
      variant="outline"
      size="sm"
      label={t("invite")}
      title={t("inviteTitle", { name: organization.name })}
      description={t("inviteDescription")}
      confirmLabel={t("inviteSend")}
      confirmDisabled={error !== null || !name.trim()}
      onConfirm={invite}
    >
      <div className="flex flex-col gap-4">
        <TextField
          label={admin("email")}
          type="email"
          value={email}
          onChange={setEmail}
          error={error && admin(error)}
        />
        <TextField label={admin("fullName")} value={name} onChange={setName} />
        {roles.length > 1 && (
          <ChoiceField
            label={admin("role")}
            value={role}
            onChange={setRole}
            options={roles.map((r) => ({ value: r, label: common(`role.${r}`) }))}
          />
        )}
      </div>
    </ConfirmAction>
  );
}

function AccountsTable({ accounts }: { accounts: ProtoAccount[] }) {
  const admin = useDictionary(texts);
  const common = useCommonTexts();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{admin("email")}</TableHead>
          <TableHead>{admin("fullName")}</TableHead>
          <TableHead>{admin("role")}</TableHead>
          <TableHead>{admin("state")}</TableHead>
          <TableHead>{admin("lastSignIn")}</TableHead>
          <TableHead>{admin("actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.map((account) => (
          <TableRow key={account.id}>
            <TableCell>{account.email}</TableCell>
            <TableCell>{account.fullName}</TableCell>
            <TableCell>{common(`role.${account.role}`)}</TableCell>
            <TableCell>
              <AccountStateBadge account={account} />
            </TableCell>
            <TableCell>
              <LastSignIn account={account} />
            </TableCell>
            <TableCell>
              <BlockToggle account={account} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AccountStateBadge({ account }: { account: ProtoAccount }) {
  const common = useCommonTexts();
  return (
    <Badge variant={account.state === "active" ? "default" : account.state === "blocked" ? "destructive" : "outline"}>
      {common(`accountState.${account.state}`)}
    </Badge>
  );
}

function LastSignIn({ account }: { account: ProtoAccount }) {
  const admin = useDictionary(texts);
  const format = useFormat();
  return (
    <span className={cn("text-xs", !account.lastSignInAt && "text-muted-foreground")}>
      {account.lastSignInAt ? format.dateTime(account.lastSignInAt) : admin("never")}
    </span>
  );
}

/** Блокировка и разблокировка (ADM-02); блокировка завершает открытые сеансы (AUTH-06). */
function BlockToggle({ account }: { account: ProtoAccount }) {
  const t = useDictionary(organizationsTexts);
  const update = useGuardedUpdate();
  const self = useAdminAccountId();
  if (account.id === self) return <span className="text-xs text-muted-foreground">{t("self")}</span>;
  const blocked = account.state === "blocked";
  const toggle = () =>
    update(
      {
        action: blocked ? "account.unblock" : "account.block",
        subject: { type: "account", id: account.id, label: account.email },
        summary: localized(organizationsTexts, blocked ? "unblocked" : "blocked"),
      },
      (draft) => {
        const target = draft.accounts.find((a) => a.id === account.id);
        if (!target) return false;
        target.state = blocked ? (target.lastSignInAt ? "active" : "invited") : "blocked";
        return true;
      },
    );
  return (
    <ConfirmAction
      variant={blocked ? "outline" : "destructive"}
      size="sm"
      label={blocked ? t("unblock") : t("block")}
      title={t(blocked ? "unblockTitle" : "blockTitle", { email: account.email })}
      description={t(blocked ? "unblockDescription" : "blockDescription")}
      confirmLabel={blocked ? t("unblock") : t("block")}
      onConfirm={toggle}
    />
  );
}

/** Аккаунты производителей: организация, почта для входа, состояние, вход. Профиля и БИН нет (ADM-06). */
function ManufacturerAccounts({ organizations }: { organizations: ProtoOrganization[] }) {
  const t = useDictionary(organizationsTexts);
  const admin = useDictionary(texts);
  const accounts = useProto((s) => s.accounts.filter((a) => a.role === "manufacturer"));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("manufacturersTitle")}</CardTitle>
        <CardDescription>{t("manufacturersDescription")}</CardDescription>
        <CardAction>
          <Link
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            to={protoPath("administrator", "migration")}
          >
            {t("inviteMigrated")}
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{admin("organization")}</TableHead>
              <TableHead>{admin("email")}</TableHead>
              <TableHead>{admin("state")}</TableHead>
              <TableHead>{admin("lastSignIn")}</TableHead>
              <TableHead>{admin("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {organizations.map((organization) => {
              const account = accounts.find((a) => a.organizationId === organization.id);
              return (
                <TableRow key={organization.id}>
                  <TableCell className="whitespace-normal">{organization.name}</TableCell>
                  {account ? (
                    <>
                      <TableCell>{account.email}</TableCell>
                      <TableCell>
                        <AccountStateBadge account={account} />
                      </TableCell>
                      <TableCell>
                        <LastSignIn account={account} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <ChangeLoginEmail account={account} organization={organization} />
                          <BlockToggle account={account} />
                        </div>
                      </TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={4} className="text-muted-foreground">
                      {t("noManufacturerAccount")}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Смена почты для входа аккаунта производителя (ADM-05, GEN-01). */
function ChangeLoginEmail({ account, organization }: { account: ProtoAccount; organization: ProtoOrganization }) {
  const t = useDictionary(organizationsTexts);
  const admin = useDictionary(texts);
  const update = useGuardedUpdate();
  const accounts = useProto((s) => s.accounts);
  const [email, setEmail] = useState("");
  const same = email.trim().toLowerCase() === account.email.toLowerCase();
  const error = same ? "emailSame" : emailError(accounts, email, account.id);

  const change = () => {
    const to = email.trim();
    update(
      {
        action: "account.change_email",
        subject: { type: "account", id: account.id, label: to },
        summary: localized(organizationsTexts, "emailChanged", { from: account.email, to }),
      },
      (draft) => {
        const target = draft.accounts.find((a) => a.id === account.id);
        if (!target) return false;
        target.email = to;
        return true;
      },
    );
    setEmail("");
  };

  return (
    <ConfirmAction
      variant="outline"
      size="sm"
      label={t("changeEmail")}
      title={t("changeEmailTitle", { name: organization.name })}
      description={t("changeEmailDescription")}
      confirmLabel={t("changeEmail")}
      confirmDisabled={error !== null}
      onConfirm={change}
    >
      <TextField
        label={t("newEmail")}
        type="email"
        value={email}
        onChange={setEmail}
        error={error === "emailSame" ? t("emailSame") : error && admin(error)}
      />
    </ConfirmAction>
  );
}
