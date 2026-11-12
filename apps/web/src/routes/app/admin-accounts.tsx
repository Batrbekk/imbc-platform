import type { AdminAccounts, AdminOrganization } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";

/** Колонки таблицы аккаунтов (ADM-02). */
const COLUMNS = ["email", "name", "role", "state", "lastSignIn"] as const;

/**
 * Организации и аккаунты для администратора, только для чтения (ADM-02). Профиля производителя и БИН
 * в ответе нет (ADM-06). Приглашение и блокировка — этап 1.
 */
export function AdminAccountsPage() {
  const t = useTranslations("adminAccounts");
  const common = useTranslations("common");

  const result = useQuery({
    queryKey: ["admin", "accounts"],
    queryFn: () => api<AdminAccounts>("/v1/admin/accounts"),
  });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <PageTitle title={t("title")} />
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      {result.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t("loadError")}</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void result.refetch()}>
              {common("retry")}
            </Button>
          </AlertAction>
        </Alert>
      ) : result.isPending ? (
        Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-40" />)
      ) : result.data.organizations.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{t("empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        result.data.organizations.map((organization) => (
          <OrganizationCard key={organization.id} organization={organization} />
        ))
      )}
    </div>
  );
}

function OrganizationCard({ organization }: { organization: AdminOrganization }) {
  const t = useTranslations("adminAccounts");
  const roles = useTranslations("roles");
  const format = useFormat();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{organization.name}</CardTitle>
        <CardDescription>{t(`typeValue.${organization.type}`)}</CardDescription>
        {organization.isMajorOperator && (
          <CardAction>
            <Badge variant="secondary">{t("majorOperator")}</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {organization.accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noAccounts")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((column) => (
                  <TableHead key={column}>{t(column)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {organization.accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>{account.email}</TableCell>
                  <TableCell>{account.fullName}</TableCell>
                  <TableCell>{roles(account.role)}</TableCell>
                  <TableCell>
                    <Badge variant={account.state === "active" ? "default" : "outline"}>
                      {t(`stateValue.${account.state}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className={cn("text-xs", !account.lastSignInAt && "text-muted-foreground")}>
                    {account.lastSignInAt ? format.dateTime(account.lastSignInAt) : t("never")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
