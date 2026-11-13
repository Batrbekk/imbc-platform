import type { AccountState, AdminAccount, AdminAccounts, AdminOrganization, OrganizationType } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { useId, useRef } from "react";
import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";
import { useMe } from "@/lib/session";

import { AccountActions, MajorOperatorToggle } from "./admin-account-actions";
import { ActionStatus } from "./action-status";
import { ADMIN_ACCOUNTS_KEY, AnnounceContext, useActionStatus } from "./admin-actions";
import { CreateOrganizationDialog, ImbcMailboxDialog, InviteDialog } from "./admin-dialogs";

/**
 * Бейдж состояния аккаунта: обычное состояние («Активен») — спокойное, самым ярким пятном страницы остаётся
 * только блокировка (красный); приглашён и неактивен — контурные.
 */
const STATE_BADGE: Record<AccountState, "default" | "secondary" | "outline" | "destructive"> = {
  active: "secondary",
  invited: "outline",
  inactive: "outline",
  blocked: "destructive",
};

/** Порядок разделов страницы: IMBC, операторы, наблюдатели, производители. */
const TYPE_ORDER: readonly OrganizationType[] = ["imbc", "operator", "observer", "manufacturer"];

/**
 * Организации по разделам в порядке `TYPE_ORDER`. Производитель без аккаунта карточки не получает —
 * приглашать в его организацию нельзя (GEN-01, ADM-06), аккаунт появляется при регистрации, — он лишь
 * учитывается в `hidden`. Раздел без организаций к показу не попадает.
 */
function groupOrganizations(organizations: readonly AdminOrganization[]) {
  return TYPE_ORDER.map((type) => {
    const all = organizations.filter((organization) => organization.type === type);
    const shown = type === "manufacturer" ? all.filter((organization) => organization.accounts.length > 0) : all;
    return { type, shown, hidden: all.length - shown.length };
  }).filter((group) => group.shown.length > 0 || group.hidden > 0);
}

/**
 * Кабинет администратора IMBC: организации и аккаунты (ADM-01, ADM-02, ADM-03, ADM-05, GEN-05).
 * Профиля производителя, БИН и документов нет ни в ответе, ни на странице (ADM-06). Ответ читается без
 * строгой схемы: новое необязательное поле API страницу не ломает (NFR-06). Права проверяет сервер
 * (GEN-08); интерфейс только не предлагает недоступное.
 */
export function AdminAccountsPage() {
  const t = useTranslations("adminAccounts");
  const common = useTranslations("common");
  const { status, announce, dismiss } = useActionStatus();

  const result = useQuery({
    queryKey: ADMIN_ACCOUNTS_KEY,
    queryFn: () => api<AdminAccounts>("/v1/admin/accounts"),
  });
  const organizations = result.data?.organizations ?? [];
  const groups = groupOrganizations(organizations);

  return (
    <AnnounceContext.Provider value={announce}>
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <PageTitle title={t("title")} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          {/* На узком экране кнопки — столбцом во всю ширину, как кнопки диалогов; с `sm` — в ряд справа. */}
          {result.data && (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <CreateOrganizationDialog />
              <InviteDialog organizations={organizations} />
            </div>
          )}
        </div>

        <ActionStatus status={status} onDismiss={dismiss} dismissLabel={t("dismiss")} />

        {result.isError ? (
          // Кнопка — под текстом, а не в AlertAction: у Alert для неё отведено 4,5rem справа, а «Повторить»
          // и «Қайталау» шире и на узком экране легли бы на текст.
          <Alert variant="destructive">
            <AlertDescription>{t("loadError")}</AlertDescription>
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={() => void result.refetch()}>
                {common("retry")}
              </Button>
            </div>
          </Alert>
        ) : result.isPending ? (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-40" />)
        ) : (
          <>
            <MailboxCard mailbox={result.data.imbcMailbox} />
            {organizations.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyDescription>{t("empty")}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex flex-col gap-6">
                {groups.map((group) => (
                  <OrganizationGroup key={group.type} {...group} organizations={organizations} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AnnounceContext.Provider>
  );
}

/** Ящик IMBC для писем платформы (раздел 8.2): адрес или «не задан». */
function MailboxCard({ mailbox }: { mailbox: string | null }) {
  const t = useTranslations("adminAccounts");
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t("imbcMailbox")}</CardTitle>
        <CardDescription>{t("imbcMailboxHint")}</CardDescription>
        <CardAction>
          <ImbcMailboxDialog mailbox={mailbox} />
        </CardAction>
      </CardHeader>
      <CardContent>
        {mailbox ? (
          <p className="font-medium wrap-anywhere">{mailbox}</p>
        ) : (
          <p className="text-muted-foreground">{t("imbcMailboxNotSet")}</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Раздел страницы — организации одного типа: заголовок h2 с числом карточек и сами карточки. Под разделом
 * производителей — строка о тех, у кого аккаунта ещё нет: их карточки пусты и прятали бы настоящие аккаунты.
 */
function OrganizationGroup({
  type,
  shown,
  hidden,
  organizations,
}: {
  type: OrganizationType;
  shown: readonly AdminOrganization[];
  hidden: number;
  organizations: readonly AdminOrganization[];
}) {
  const t = useTranslations("adminAccounts");
  const format = useFormat();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="flex items-baseline gap-2 text-lg font-semibold tracking-tight">
        {t(`typeGroup.${type}`)}
        {/* Пробел нужен имени заголовка («Операторы 2»): у flex-элементов его не видно, программа чтения его слышит. */}{" "}
        <span className="text-sm font-normal text-muted-foreground tabular-nums">{format.number(shown.length)}</span>
      </h2>
      {shown.map((organization) => (
        <OrganizationCard key={organization.id} organization={organization} organizations={organizations} />
      ))}
      {hidden > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("manufacturersWithoutAccount", { count: hidden, total: format.number(hidden) })}
        </p>
      )}
    </section>
  );
}

function OrganizationCard({
  organization,
  organizations,
}: {
  organization: AdminOrganization;
  organizations: readonly AdminOrganization[];
}) {
  const t = useTranslations("adminAccounts");
  const format = useFormat();
  const me = useMe();
  const count = organization.accounts.length;
  // После приглашения из пустой карточки кнопка-триггер исчезает (в карточке появляется аккаунт):
  // фокус уходит на заголовок карточки, а не теряется в body.
  const title = useRef<HTMLDivElement>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle
          ref={title}
          tabIndex={-1}
          className="rounded-sm wrap-anywhere outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {organization.name}
        </CardTitle>
        <CardDescription>
          <span>{t(`typeValue.${organization.type}`)}</span>
          <span aria-hidden="true"> · </span>
          <span>{t("accountCount", { count, total: format.number(count) })}</span>
        </CardDescription>
        {organization.isMajorOperator && (
          <CardAction>
            <Badge variant="secondary">{t("majorOperator")}</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {count === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-4 text-sm">
            <p className="font-medium">{t("noAccounts")}</p>
            {/* Пустая карточка бывает только у IMBC, оператора и наблюдателя: производитель без аккаунта
                карточки не получает (`groupOrganizations`), а приглашать в его организацию нельзя (ADM-06). */}
            <p className="text-muted-foreground">{t("noAccountsInvite")}</p>
            <InviteDialog
              organizations={organizations}
              organizationId={organization.id}
              invitedFocus={title}
              trigger={
                <Button variant="outline" size="sm">
                  {t("inviteUser")}
                </Button>
              }
            />
          </div>
        ) : (
          <ItemGroup className="gap-2">
            {organization.accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                organization={organization}
                isSelf={account.id === me.data?.user.id}
              />
            ))}
          </ItemGroup>
        )}
      </CardContent>
      {organization.type === "operator" && (
        <CardFooter>
          <MajorOperatorToggle organization={organization} />
        </CardFooter>
      )}
    </Card>
  );
}

/**
 * Строка аккаунта (ADM-02): почта, имя и роль, состояние с пояснением, последний вход, меню действий.
 * На узком экране строка переносится по частям, без горизонтальной прокрутки; с `md` колонки строк
 * одной организации выровнены сеткой.
 */
function AccountRow({
  account,
  organization,
  isSelf,
}: {
  account: AdminAccount;
  organization: AdminOrganization;
  isSelf: boolean;
}) {
  const t = useTranslations("adminAccounts");
  const roles = useTranslations("roles");
  const format = useFormat();
  const hint = account.state === "active" ? null : t(`stateHint.${account.state}`);
  const role = roles(account.role);
  // У демо-аккаунтов имя совпадает с подписью роли («Администратор IMBC») — тогда оно выводится один раз.
  const showName = !!account.fullName && account.fullName.trim().toLowerCase() !== role.toLowerCase();

  return (
    <Item
      role="listitem"
      variant="outline"
      size="sm"
      data-account={account.email}
      className="grid grid-cols-[minmax(0,1fr)_2rem] items-start gap-x-3 gap-y-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_2rem] md:items-center"
    >
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="line-clamp-none flex-wrap wrap-anywhere">
          {account.email}
          {/* Своя строка без блокировки и смены роли: отметка объясняет, почему меню нет. */}
          {isSelf && <Badge variant="outline">{t("you")}</Badge>}
        </ItemTitle>
        <ItemDescription className="line-clamp-none">
          {showName && (
            <>
              <span>{account.fullName}</span>
              <span aria-hidden="true"> · </span>
            </>
          )}
          <span>{role}</span>
        </ItemDescription>
      </ItemContent>
      <ItemActions className="col-start-2 row-start-1 justify-end md:col-start-4">
        <AccountActions account={account} organizationType={organization.type} isSelf={isSelf} />
      </ItemActions>
      {/* Состояние и последний вход: под почтой на узком экране, отдельными колонками с md. */}
      <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 md:col-span-1 md:col-start-2 md:row-start-1 md:flex-col md:items-start">
        <Badge variant={STATE_BADGE[account.state]}>{t(`stateValue.${account.state}`)}</Badge>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      <p className="col-span-2 text-xs text-muted-foreground md:col-span-1 md:col-start-3 md:row-start-1">
        {t("lastSignInAt", { date: account.lastSignInAt ? format.dateTime(account.lastSignInAt) : t("never") })}
      </p>
    </Item>
  );
}
