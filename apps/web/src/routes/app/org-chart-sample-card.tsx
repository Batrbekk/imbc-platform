import {
  ALLOWED_FILE_TYPES,
  MAX_FILE_BYTES,
  type OrgChartSampleFile,
  type OrgChartSampleState,
  type OrgChartSampleUpload,
} from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { DownloadIcon, UploadIcon } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { type AppFormat, useFormat } from "@/i18n/format";
import { api } from "@/lib/api";

import { useAdminAction, useAnnounce } from "./admin-actions";
import { ORG_CHART_SAMPLE_KEY, useReferenceProblemMessage } from "./references-actions";

/** Пока последняя загрузка на проверке антивирусом, состояние перечитывается каждые 5 секунд (DATA-07). */
const SAMPLE_POLL_MS = 5_000;

/** Те же пять типов, что принимает сервер (DATA-06): MIME-типы и расширения, чтобы окно выбора файла их предлагало. */
const ACCEPT = [
  ...Object.keys(ALLOWED_FILE_TYPES),
  ...Object.values(ALLOWED_FILE_TYPES).map((extension) => `.${extension}`),
  ".jpeg",
].join(",");

/** Адрес текущего образца не зависит от файла: ссылка не устаревает при замене образца (MAN-19). */
const CURRENT_CONTENT_URL = "/api/v1/org-chart-sample/current/content";

const oneDecimal = (value: number) => Math.round(value * 10) / 10;

/**
 * Образец оргструктуры (ADM-11, MAN-19): производители скачивают его в разделе «Персонал». Показан текущий
 * образец (только прошедший проверку антивирусом, DATA-07) и последняя загрузка, если она ещё проверяется
 * или не прошла проверку: текущий остаётся доступным. Загружает только тот, у кого есть право
 * `reference.manage`; директор читает (GEN-08, права проверяет сервер).
 */
export function OrgChartSampleCard({ canManage }: { canManage: boolean }) {
  const t = useTranslations("references");
  const common = useTranslations("common");
  const format = useFormat();
  const problem = useReferenceProblemMessage();
  const announce = useAnnounce();
  const picker = useRef<HTMLInputElement>(null);
  // Отказ до отправки (файл больше предела): сервер сказал бы то же, но без лишнего ожидания.
  const [tooLarge, setTooLarge] = useState(false);

  const state = useQuery({
    queryKey: ORG_CHART_SAMPLE_KEY,
    queryFn: () => api<OrgChartSampleState>("/v1/org-chart-sample"),
    refetchInterval: (query) => (query.state.data?.latest?.scanState === "pending" ? SAMPLE_POLL_MS : false),
  });

  const upload = useAdminAction({
    request: (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api<OrgChartSampleUpload>("/v1/org-chart-sample", { method: "POST", body });
    },
    done: () => t("sample.uploaded"),
    invalidate: [ORG_CHART_SAMPLE_KEY],
  });

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Тот же файл можно выбрать снова: значение поля сбрасывается.
    event.target.value = "";
    if (!file) return;
    upload.reset();
    if (file.size > MAX_FILE_BYTES) {
      setTooLarge(true);
      return;
    }
    setTooLarge(false);
    upload.run(file);
  };

  const failure = tooLarge ? t("errors.file_too_large") : upload.isError ? problem(upload.error) : null;
  const current = state.data?.current ?? null;
  const latest = state.data?.latest ?? null;

  // Проверка закончилась, пока страница открыта: строка итога объявляет результат, а не остаётся на «проверяется».
  // Переход виден по ответу опроса: `pending` → последней загрузки нет, а текущий образец сменился (прошла проверку
  // и стала текущим) или `pending` → `rejected` (не прошла; текущий прежний). Первый ответ при открытии страницы
  // ничего не объявляет: человек не ждал этого результата. Прежнее значение — в `watched`, а не в состоянии:
  // повторный запуск эффекта с тем же ответом ничего не объявит второй раз.
  const watched = useRef<{ pendingId: string | null; currentId: string | null } | null>(null);
  useEffect(() => {
    const data = state.data;
    if (!data) return;
    const before = watched.current;
    watched.current = {
      pendingId: data.latest?.scanState === "pending" ? data.latest.fileId : null,
      currentId: data.current?.fileId ?? null,
    };
    if (!before?.pendingId) return;
    if (data.latest?.scanState === "rejected") {
      const kept = data.current ? ` ${t("sample.keptCurrent")}` : "";
      announce({ tone: "error", text: `${t("sample.checkRejected")}${kept}` });
    } else if (data.latest === null && data.current && data.current.fileId !== before.currentId) {
      announce({ tone: "success", text: t("sample.checkPassed") });
    }
  }, [state.data, announce, t]);

  return (
    <Card className="@container">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-base">
          {t("sample.title")}
        </CardTitle>
        <CardDescription>{t("sample.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{t("sample.loadError")}</AlertDescription>
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={() => void state.refetch()}>
                {common("retry")}
              </Button>
            </div>
          </Alert>
        ) : state.isPending ? (
          <Skeleton className="h-16" />
        ) : (
          <div className="flex flex-col gap-3 @lg:flex-row @lg:items-center @lg:justify-between">
            {current ? (
              <CurrentSample file={current} format={format} />
            ) : (
              <p className="text-muted-foreground">{t("sample.none")}</p>
            )}
            <div className="flex flex-col gap-2 @lg:flex-row @lg:shrink-0">
              {current && (
                // Обычная ссылка на API: браузер скачивает файл, а не React Router. `cn` сводит конфликт
                // `border-transparent` и `border-border` у outline: без него у ссылки нет рамки, как у кнопки рядом.
                <a className={cn(buttonVariants({ variant: "outline" }))} href={CURRENT_CONTENT_URL}>
                  <DownloadIcon aria-hidden="true" />
                  {t("sample.download")}
                </a>
              )}
              {canManage && (
                <>
                  <Button
                    variant={current ? "outline" : "default"}
                    // Кнопка остаётся в порядке Tab, пока файл уходит: фокус не теряется.
                    focusableWhenDisabled
                    disabled={upload.isPending}
                    onClick={() => picker.current?.click()}
                  >
                    {upload.isPending ? <Spinner aria-hidden="true" /> : <UploadIcon aria-hidden="true" />}
                    {upload.isPending ? t("sample.uploading") : current ? t("sample.replace") : t("sample.upload")}
                  </Button>
                  <input
                    ref={picker}
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={choose}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {latest && <LatestUpload file={latest} hasCurrent={current !== null} canManage={canManage} />}
        {failure && (
          <Alert variant="destructive">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

/** Размер файла по-человечески: байты, КБ или МБ с одним знаком после запятой. */
function useFileSize(format: AppFormat) {
  const t = useTranslations("references.sample");
  return (bytes: number) => {
    if (bytes < 1024) return t("bytes", { size: format.number(bytes) });
    if (bytes < 1024 * 1024) return t("kb", { size: format.number(oneDecimal(bytes / 1024)) });
    return t("mb", { size: format.number(oneDecimal(bytes / (1024 * 1024))) });
  };
}

/** Текущий образец: имя, размер и дата загрузки. */
function CurrentSample({ file, format }: { file: OrgChartSampleFile; format: AppFormat }) {
  const t = useTranslations("references.sample");
  const size = useFileSize(format);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{t("current")}</span>
      <span className="font-medium wrap-anywhere">{file.originalName}</span>
      <span className="text-sm text-muted-foreground">
        {t("fileMeta", { size: size(file.byteSize), date: format.dateTime(file.uploadedAt) })}
      </span>
    </div>
  );
}

/**
 * Последняя загрузка, которая не стала текущей: на проверке («Проверяется антивирусом») или не прошла её
 * («Не прошёл проверку»). Область — role=status: смена состояния читается программой чтения с экрана.
 */
function LatestUpload({
  file,
  hasCurrent,
  canManage,
}: {
  file: OrgChartSampleFile;
  hasCurrent: boolean;
  canManage: boolean;
}) {
  const t = useTranslations("references.sample");
  const pending = file.scanState === "pending";
  return (
    <div role="status" className="flex flex-col gap-1.5 rounded-lg border border-dashed p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {pending ? (
          <Badge variant="secondary">
            <Spinner aria-hidden="true" />
            {t("pending")}
          </Badge>
        ) : (
          <Badge variant="destructive">{t("rejected")}</Badge>
        )}
        <span className="min-w-0 wrap-anywhere">{file.originalName}</span>
      </div>
      <div className="flex flex-col gap-0.5 text-muted-foreground">
        {pending ? (
          <>
            {/* Проверка может идти дольше минуты: человек знает, что ждать и что страницу можно закрыть. */}
            <p>{t("pendingDuration")}</p>
            <p>{hasCurrent ? t("pendingHint") : t("pendingFirstHint")}</p>
          </>
        ) : canManage ? (
          <>
            <p>{t("rejectedHint")}</p>
            {hasCurrent && <p>{t("keptCurrent")}</p>}
          </>
        ) : (
          // Тому, кто загружать не может, «Загрузите другой» ни к чему: файл не принят, текущий образец прежний.
          <p>{hasCurrent ? `${t("rejectedPlain")} ${t("keptCurrent")}` : t("rejectedPlain")}</p>
        )}
      </div>
    </div>
  );
}
