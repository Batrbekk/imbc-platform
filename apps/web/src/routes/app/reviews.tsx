import { QUEUE_STATUSES, type ReviewQueue } from "@imbc/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useTranslations } from "use-intl";

import { PageTitle } from "@/components/app/page-title";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Select, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";

import { FilterSelectContent } from "./filter-select";

/** Колонки очереди (REV-04); скелет загрузки занимает их все. */
const COLUMNS = ["manufacturer", "status", "assignee", "registeredAt"] as const;

/** «Все» в селекте: параметра status в адресе нет. */
const ALL = "all";

/**
 * Очередь проверки SME, только для чтения (REV-01, REV-04). Фильтр статуса — в адресе страницы;
 * неизвестное значение парсер отбрасывает, и в API оно не уходит. Строки без ссылок: открытие
 * профиля — этап 5.
 */
export function ReviewsPage() {
  const t = useTranslations("reviews");
  const profile = useTranslations("profile");
  const common = useTranslations("common");
  const format = useFormat();
  // shallow: false — адрес видит и роутер (возврат после истёкшего сеанса сохранит фильтр), как в каталоге.
  const [status, setStatus] = useQueryState(
    "status",
    parseAsStringLiteral(QUEUE_STATUSES).withOptions({ history: "push", shallow: false }),
  );

  const result = useQuery({
    queryKey: ["reviews", "queue", status],
    queryFn: () => api<ReviewQueue>(`/v1/reviews/queue${status ? `?status=${status}` : ""}`),
    placeholderData: keepPreviousData,
  });
  const total = result.data?.total ?? 0;

  // Base UI показывает в SelectValue подпись из items, а не сырое значение из адреса.
  const statusItems = [
    { value: ALL, label: t("statusAll") },
    { value: "submitted", label: profile("statusValue.submitted") },
    { value: "under_review", label: profile("statusValue.under_review") },
    { value: "pending_changes", label: t("pendingChanges") },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <PageTitle title={t("title")} />
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={statusItems}
          value={status ?? ALL}
          onValueChange={(v) => v !== null && void setStatus(v === ALL ? null : (v as (typeof QUEUE_STATUSES)[number]))}
        >
          <SelectTrigger className="w-auto" aria-label={t("statusFilter")}>
            <span className="text-muted-foreground">{t("statusFilter")}:</span>
            <SelectValue />
          </SelectTrigger>
          <FilterSelectContent>
            {statusItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </FilterSelectContent>
        </Select>
      </div>

      <div className="text-sm text-muted-foreground">
        {result.data && t("found", { count: total, total: format.number(total) })}
      </div>

      {result.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t("loadError")}</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void result.refetch()}>
              {common("retry")}
            </Button>
          </AlertAction>
        </Alert>
      ) : (
        <div className={cn("rounded-lg border", result.isFetching && "opacity-70 transition-opacity")}>
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((column) => (
                  <TableHead key={column}>{t(column)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.isPending &&
                Array.from({ length: 4 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={COLUMNS.length}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {result.data?.items.map((item) => (
                <TableRow key={item.profileId}>
                  <TableCell>
                    <div className="font-medium">{item.organizationName}</div>
                    <div className="font-mono text-xs text-muted-foreground">{item.bin}</div>
                  </TableCell>
                  <TableCell>
                    {/* Verified с ожидающими изменениями в очереди — как «ожидающие изменения» (REV-03). */}
                    {item.status === "verified" && item.hasPendingChanges ? (
                      <Badge variant="outline">{t("pendingChanges")}</Badge>
                    ) : (
                      <Badge variant="secondary">{profile(`statusValue.${item.status}`)}</Badge>
                    )}
                  </TableCell>
                  <TableCell className={cn(!item.assignedExpert && "text-muted-foreground")}>
                    {item.assignedExpert ?? t("unassigned")}
                  </TableCell>
                  <TableCell className="text-xs">{format.date(item.registeredAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {result.data && result.data.items.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyDescription>{t("empty")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      )}
    </div>
  );
}
