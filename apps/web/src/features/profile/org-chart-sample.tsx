import { orgChartSampleCurrentSchema } from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import { useId } from "react";
import { useTranslations } from "use-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/** MAN-19/ADM-11: producer-only current metadata, without administrator upload history. */
export function ProfileOrgChartSample() {
  const t = useTranslations("profileOrgChartSample");
  const format = useFormat();
  const titleId = useId();
  const sample = useQuery({
    queryKey: ["profile", "org-chart-sample", "current"],
    queryFn: async ({ signal }) => orgChartSampleCurrentSchema.parse(await api("/v1/org-chart-sample/current", { signal })),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  // Do not show cached metadata while the current sample is being revalidated, or after a failed read.
  const current = !sample.isFetching && !sample.isError ? sample.data?.current : null;
  return <section aria-labelledby={titleId}>
    <Card size="sm">
      <CardHeader>
        <CardTitle><h3 id={titleId}>{t("title")}</h3></CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sample.isPending || sample.isFetching ? <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>
          : sample.isError ? <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-destructive">{t("readError")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void sample.refetch()}>{t("retry")}</Button>
          </div>
            : current ? <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="break-all text-sm font-medium">{current.originalName}</p>
                <p className="text-xs text-muted-foreground">{t("fileMeta", {
                  size: format.number(current.byteSize / 1024), date: format.dateTime(current.uploadedAt),
                })}</p>
              </div>
              {/* The producer DTO has no file/version ID. This BFF route rechecks the current passed version. */}
              <a className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                href="/api/v1/org-chart-sample/current/content"><DownloadIcon aria-hidden="true" />{t("download")}</a>
            </div>
              : <p role="status" className="text-sm text-muted-foreground">{t("unavailable")}</p>}
      </CardContent>
    </Card>
  </section>;
}
