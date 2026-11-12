import { type OwnAdataRead, PREFILL_FIELDS, type PrefillField } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { useId } from "react";
import { useTranslations } from "use-intl";

import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";

type Field = OwnAdataRead["fields"][number];

/** Длинное значение без пробелов (email, адрес сайта, склеенное название ОКЭД) переносится, а не обрезается. */
const WRAP = "min-w-0 max-w-full [overflow-wrap:anywhere]";

/** Текст конечного состояния без значений. */
const STATE_TEXT = {
  unavailable: "unavailable",
  not_configured: "notConfigured",
  quota_exhausted: "quotaExhausted",
  not_requested: "notRequested",
} as const;

/**
 * Данные Adata своего профиля, только для чтения (MAN-06, MAN-07): состояние чтения и девять предзаполненных
 * значений, у каждого — источник. Сервер отдаёт только чтение организации сеанса (GEN-11). Пока чтение ждёт
 * ответа Adata, блок опрашивает сервер раз в 5 секунд; в конечном состоянии опрос останавливается.
 * Отдельный запрос: его загрузка и сбой карточку профиля не задевают.
 */
export function AdataReadCard() {
  const t = useTranslations("profile.adata");
  const common = useTranslations("common");
  const format = useFormat();
  const titleId = useId();
  const result = useQuery({
    queryKey: ["profile", "own", "adata"],
    queryFn: () => api<OwnAdataRead>("/v1/profiles/own/adata"),
    refetchInterval: (query) => (query.state.data?.state === "waiting" ? 5000 : false),
  });
  const read = result.data;

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>{t("title")}</CardTitle>
        {read && (
          // Живая область: смена waiting → received объявляется программе чтения с экрана.
          <CardDescription aria-live="polite" className="flex items-center gap-2">
            {read.state === "waiting" && <Spinner aria-hidden />}
            {read.state === "waiting"
              ? t("waiting")
              : read.state === "received"
                ? t("received", { date: format.dateTime(read.readAt) })
                : t(STATE_TEXT[read.state])}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {read ? (
          read.state === "received" && (
            <div className="flex flex-col gap-3">
              <dl className="grid gap-3 text-sm">
                {PREFILL_FIELDS.map((field) => (
                  <PrefilledRow key={field} field={field} value={read.fields.find((f) => f.field === field)} />
                ))}
              </dl>
              <p className="text-sm text-muted-foreground">{t("confirmLater")}</p>
            </div>
          )
        ) : result.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{t("loadError")}</AlertDescription>
            <AlertAction>
              <Button size="sm" variant="outline" onClick={() => void result.refetch()}>
                {common("retry")}
              </Button>
            </AlertAction>
          </Alert>
        ) : (
          <Skeleton className="h-40" />
        )}
      </CardContent>
    </Card>
  );
}

/** Строка «подпись — значение» с отметкой источника; поле, которого Adata не вернул, — пояснение. */
function PrefilledRow({ field, value }: { field: PrefillField; value: Field | undefined }) {
  const t = useTranslations("profile.adata");
  const format = useFormat();

  const text = (item: Field["items"][number]) =>
    field === "state_registered_on"
      ? format.date(item.value)
      : field === "activity" && item.label
        ? `${item.value} — ${item.label}`
        : item.value;

  return (
    <div className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
      <dt className="text-muted-foreground">{t(`field.${field}`)}</dt>
      <dd className={cn("flex flex-col items-start gap-1", WRAP)}>
        {value ? (
          <>
            {value.items.length === 1 && field !== "shareholders" ? (
              <span className={WRAP}>{text(value.items[0]!)}</span>
            ) : (
              <ul className={cn("flex flex-col gap-0.5", WRAP)}>
                {value.items.map((item) => (
                  <li key={item.value} className={WRAP}>
                    {text(item)}
                  </li>
                ))}
              </ul>
            )}
            <Badge variant="outline">{t("sourceAdata")}</Badge>
            {/* Долей и гражданства в ответе Adata нет (MAN-21). */}
            {field === "shareholders" && <p className="text-xs text-muted-foreground">{t("shareholdersNamesOnly")}</p>}
          </>
        ) : (
          <span className="text-muted-foreground">{t("notReturned")}</span>
        )}
      </dd>
    </div>
  );
}
