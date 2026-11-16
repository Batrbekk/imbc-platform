import type { ImbcRecordRead } from "@imbc/contracts";
import { useTranslations } from "use-intl";
import { useFormat } from "@/i18n/format";
import { ReferenceLabels } from "./references";
export function RecordSnapshot({
  row,
  profileId,
  actorId,
  lost,
}: {
  row: ImbcRecordRead;
  profileId: string;
  actorId: string;
  lost: (error: unknown) => void;
}) {
  const t = useTranslations("imbcRecords"),
    f = useFormat();
  const pair = (key: string, value: React.ReactNode) => (
    <div key={key} className="min-w-0">
      <dt className="text-sm text-muted-foreground">{t(key)}</dt>
      <dd className="whitespace-pre-wrap wrap-anywhere text-sm">{value}</dd>
    </div>
  );
  const truth = (value: boolean | null) => t(value === null ? "unknown" : value ? "yes" : "no");
  return (
    <div className="min-w-0 space-y-4">
      <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
        {pair("source", t(`sources.${row.source}`))}
        {pair("originalAuthor", ("authorName" in row ? row.authorName : row.recordedByName) ?? t("unknownAuthor"))}
        {pair("createdAt", f.dateTime(row.createdAt))}
        {pair("updatedAt", f.dateTime(row.updatedAt))}
        {"id" in row ? (
          <>
            {pair("noteKind", t(`noteKinds.${row.kind}`))}
            {pair("noteBody", row.body)}
          </>
        ) : "productLineIdentityId" in row ? (
          <>
            {pair(
              "programme",
              <ReferenceLabels
                profileId={profileId}
                actorId={actorId}
                code="programme"
                ids={row.programmeId ? [row.programmeId] : []}
                lost={lost}
              />,
            )}
            {pair(
              "priority",
              <ReferenceLabels
                profileId={profileId}
                actorId={actorId}
                code="imbc_priority"
                ids={row.priorityId ? [row.priorityId] : []}
                lost={lost}
              />,
            )}
          </>
        ) : (
          <>
            {pair("receiptConfirmed", truth(row.receiptConfirmed))}
            {pair("response", row.response ? t(`responses.${row.response}`) : t("unknown"))}
            {pair("responseSummary", row.responseSummary ?? t("unknown"))}
            {pair("readyForSiteVisit", truth(row.readyForSiteVisit))}
            {pair("addedToImbcYear", row.addedToImbcYear === null ? t("unknown") : f.number(row.addedToImbcYear))}
            {pair(
              "folderUrl",
              row.folderUrl ? (
                <a
                  className="text-primary underline wrap-anywhere"
                  href={row.folderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {row.folderUrl}
                </a>
              ) : (
                t("unknown")
              ),
            )}
            {pair(
              "acquisitionSources",
              <ReferenceLabels
                profileId={profileId}
                actorId={actorId}
                code="acquisition_source"
                ids={row.sourceEntryIds}
                lost={lost}
              />,
            )}
          </>
        )}
      </dl>
      {!("id" in row) && !("productLineIdentityId" in row) && (
        <section className="min-w-0 space-y-2">
          <h3 className="text-sm font-medium">{t("historicalEoiDates")}</h3>
          {!row.eoiEvents.length ? (
            <p className="text-sm">{t("noHistoricalDates")}</p>
          ) : (
            <ul className="space-y-3">
              {row.eoiEvents.map((event) => (
                <li key={event.id} className="rounded-lg border p-3 text-sm">
                  <p>{f.date(event.sentOn)}</p>
                  <p className="text-muted-foreground">
                    {t("originalAuthor")}: {event.recordedByName ?? t("unknownAuthor")} · {t("createdAt")}:{" "}
                    {f.dateTime(event.createdAt)} · {t("updatedAt")}: {f.dateTime(event.updatedAt)} ·{" "}
                    {t("sources." + event.source)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
