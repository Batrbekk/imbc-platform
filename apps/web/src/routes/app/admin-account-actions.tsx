import type {
  AdminAccount,
  AdminAccountResult,
  AdminOrganization,
  AdminOrganizationResult,
  OrganizationType,
} from "@imbc/contracts";
import { MoreHorizontalIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslations } from "use-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";

import { useAdminAction, useAnnounce, useProblemMessage } from "./admin-actions";
import { ChangeEmailDialog, ChangeRoleDialog } from "./admin-dialogs";

/**
 * Какие действия предлагаются аккаунту (интерфейс только прячет — права проверяет сервер, GEN-08).
 * Повтор приглашения — только `invited`: у `inactive` пароль восстанавливают через «Забыли пароль»
 * на странице входа. Себя не блокируют и себе роль не меняют; роль меняется только у сотрудника IMBC,
 * почта-логин — только у производителя (ADM-05).
 */
function accountActions(account: AdminAccount, organizationType: OrganizationType, isSelf: boolean) {
  return {
    resend: account.state === "invited",
    block: !isSelf && account.state !== "blocked",
    unblock: account.state === "blocked",
    changeRole: !isSelf && organizationType === "imbc",
    changeEmail: !isSelf && account.role === "manufacturer",
  };
}

/**
 * Меню действий строки аккаунта (ADM-02, ADM-05, AUTH-06). Повтор приглашения и разблокировка идут
 * сразу; блокировка — после подтверждения, смена роли и почты — в диалоге с последствием. Диалоги
 * возвращают фокус на кнопку меню. Пока запрос в пути, кнопка показывает Spinner, а пункты недоступны.
 */
export function AccountActions({
  account,
  organizationType,
  isSelf,
}: {
  account: AdminAccount;
  organizationType: OrganizationType;
  isSelf: boolean;
}) {
  const t = useTranslations("adminAccounts");
  const problem = useProblemMessage();
  const announce = useAnnounce();
  const trigger = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<"block" | "role" | "email" | null>(null);
  const offered = accountActions(account, organizationType, isSelf);
  const path = `/v1/admin/accounts/${account.id}`;

  const resend = useAdminAction({
    request: () => api<unknown>(`${path}/invitation`, { method: "POST" }),
    done: () => t("invitationResent"),
  });
  const unblock = useAdminAction({
    request: () => api<AdminAccountResult>(`${path}/unblock`, { method: "POST" }),
    // Неактивный до блокировки аккаунт остаётся inactive: путь назад — сброс пароля (AUTH-07).
    done: (result) =>
      result.account.state === "inactive"
        ? t("unblockedInactive", { email: account.email })
        : t("unblocked", { email: account.email }),
  });
  const block = useAdminAction({
    request: () => api<AdminAccountResult>(`${path}/block`, { method: "POST" }),
    done: () => t("blocked", { email: account.email }),
  });
  const immediate = (action: typeof resend | typeof unblock) =>
    action.run(undefined, {
      onError: (error) => announce({ tone: "error", text: problem(error) }),
    });

  if (!Object.values(offered).some(Boolean)) return null;
  const pending = resend.isPending || unblock.isPending || block.isPending;
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={trigger}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("actions", { email: account.email })}
              aria-busy={pending || undefined}
            />
          }
        >
          {pending ? <Spinner aria-hidden="true" /> : <MoreHorizontalIcon aria-hidden="true" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-56 max-w-[calc(100vw-2rem)]">
          <DropdownMenuGroup>
            {/* Над пунктами — адрес аккаунта: видно, над кем действие. */}
            <DropdownMenuLabel className="wrap-anywhere">{account.email}</DropdownMenuLabel>
            {offered.resend && (
              <DropdownMenuItem disabled={pending} onClick={() => immediate(resend)}>
                {t("resendInvitation")}
              </DropdownMenuItem>
            )}
            {offered.unblock && (
              <DropdownMenuItem disabled={pending} onClick={() => immediate(unblock)}>
                {t("unblock")}
              </DropdownMenuItem>
            )}
            {offered.changeRole && (
              <DropdownMenuItem disabled={pending} onClick={() => setDialog("role")}>
                {t("changeRole")}
              </DropdownMenuItem>
            )}
            {offered.changeEmail && (
              <DropdownMenuItem disabled={pending} onClick={() => setDialog("email")}>
                {t("changeEmail")}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          {offered.block && (
            <>
              {/* Блокировка — отдельно и красным: она завершает сеансы сразу. */}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={pending}
                onClick={() => {
                  block.reset();
                  setDialog("block");
                }}
              >
                {t("block")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {offered.block && (
        <AlertDialog open={dialog === "block"} onOpenChange={close}>
          <AlertDialogContent finalFocus={trigger}>
            <AlertDialogHeader>
              <AlertDialogTitle className="wrap-anywhere">
                {t("blockConfirmTitle", { email: account.email })}
              </AlertDialogTitle>
              <AlertDialogDescription>{t("blockConfirmText")}</AlertDialogDescription>
            </AlertDialogHeader>
            {block.isError && (
              <Alert variant="destructive">
                <AlertDescription>{problem(block.error)}</AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={block.isPending}
                onClick={() => block.run(undefined, { onSuccess: () => setDialog(null) })}
              >
                {block.isPending && <Spinner aria-hidden="true" />}
                {t("block")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {offered.changeRole && (
        <ChangeRoleDialog account={account} open={dialog === "role"} onOpenChange={close} finalFocus={trigger} />
      )}
      {offered.changeEmail && (
        <ChangeEmailDialog account={account} open={dialog === "email"} onOpenChange={close} finalFocus={trigger} />
      )}
    </>
  );
}

/** Отметка major operator у организации оператора (ADM-03, GEN-05) — сразу, без подтверждения. */
export function MajorOperatorToggle({ organization }: { organization: AdminOrganization }) {
  const t = useTranslations("adminAccounts");
  const problem = useProblemMessage();
  const announce = useAnnounce();
  const toggle = useAdminAction({
    request: (isMajorOperator: boolean) =>
      api<AdminOrganizationResult>(`/v1/admin/organizations/${organization.id}/major-operator`, {
        method: "PUT",
        json: { isMajorOperator },
      }),
    done: (result) =>
      result.organization.isMajorOperator
        ? t("majorMarked", { name: organization.name })
        : t("majorUnmarked", { name: organization.name }),
  });
  return (
    <Button
      variant="outline"
      size="sm"
      // Кнопка остаётся в порядке Tab, пока запрос в пути: фокус не теряется.
      focusableWhenDisabled
      disabled={toggle.isPending}
      onClick={() =>
        toggle.run(!organization.isMajorOperator, {
          onError: (error) => announce({ tone: "error", text: problem(error) }),
        })
      }
    >
      {toggle.isPending && <Spinner aria-hidden="true" />}
      {organization.isMajorOperator ? t("unmarkMajor") : t("markMajor")}
    </Button>
  );
}
