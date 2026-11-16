import {
  entryDisplayName,
  profileOwnReviewDetailsSchema,
  type ProfileOwnReviewDetails,
  type ProfileOwnReviewItemLabel,
  type SectionKind,
} from "@imbc/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFormat } from "@/i18n/format";
import { api } from "@/lib/api";

type Decision = NonNullable<ProfileOwnReviewDetails["sections"][number]["decision"]>;
export function ProfileReviewDetails({ kind, returned }: { kind: SectionKind; returned: boolean }) {
  const t = useTranslations("profileReviewHistory");
  const [open, setOpen] = useState(returned);
  const query = useQuery({
    queryKey: ["profile", "review"],
    enabled: open,
    queryFn: async () => profileOwnReviewDetailsSchema.parse(await api<unknown>("/v1/profiles/own/review")),
  });
  const section = query.data?.sections.find((section) => section.kind === kind);
  const format = useFormat();
  return (
    <details open={open} className="rounded-lg border p-4" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium">{t("title")}</summary>
      {open && (
        <div className="mt-4 space-y-3">
          {query.isPending && <p role="status">{t("loading")}</p>}
          {query.isError && (
            <div className="flex flex-wrap items-center gap-3">
              <p role="alert">{t("error")}</p>
              <Button variant="outline" onClick={() => void query.refetch()}>
                {t("retry")}
              </Button>
            </div>
          )}
          {section &&
            (section.reviewedRevisionId ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {t(section.appliesToCurrentRevision ? "current" : "previous")}
                </p>
                {query.data?.assignment && (
                  <p className="text-xs text-muted-foreground">
                    {t("submittedAt", { date: format.dateTime(query.data.assignment.receivedAt) })}
                  </p>
                )}
                {section.decision ? (
                  <ReviewDecision decision={section.decision} />
                ) : (
                  <p className="text-sm">{t("pending")}</p>
                )}
                <ul className="space-y-3">
                  {section.items
                    .filter((item) => item.decision)
                    .map((item) => (
                      <li key={JSON.stringify(item.subject)} className="rounded-lg border p-3">
                        <ReviewItemLabel label={item.label} />
                        <ReviewDecision decision={item.decision!} />
                      </li>
                    ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            ))}
        </div>
      )}
    </details>
  );
}
function ReviewItemLabel({ label }: { label: ProfileOwnReviewItemLabel }) {
  const t = useTranslations("profileReviewHistory");
  const locale = useLocale() as "en" | "ru" | "kk";
  const format = useFormat();
  if (label.kind === "file")
    return (
      <div className="mb-2 space-y-1">
        <p className="text-sm font-medium">{t("attachment")}</p>
        <p className="break-words text-sm">{label.originalName}</p>
      </div>
    );
  const customName = label.kind === "document" ? label.customName : label.customTypeName;
  return (
    <div className="mb-2 space-y-1">
      <p className="text-sm font-medium">
        {t(`item.${label.kind}`, { number: format.number(label.positionInList + 1) })}
      </p>
      {label.type && (
        <p className="break-words text-sm">{entryDisplayName(label.type.names, locale, label.type.code)}</p>
      )}
      {customName && <p className="break-words text-sm">{customName}</p>}
      {label.kind === "certificate" && label.number && (
        <p className="break-words text-sm">{t("certificateNumber", { number: label.number })}</p>
      )}
    </div>
  );
}
function ReviewDecision({ decision }: { decision: Decision }) {
  const t = useTranslations("profileReviewHistory");
  const format = useFormat();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={decision.outcome === "rejected" ? "destructive" : "secondary"}>{t(decision.outcome)}</Badge>
        <span className="text-xs text-muted-foreground">{format.dateTime(decision.decidedAt)}</span>
      </div>
      {decision.comment && <p className="whitespace-pre-wrap break-words text-sm">{decision.comment}</p>}
    </div>
  );
}
