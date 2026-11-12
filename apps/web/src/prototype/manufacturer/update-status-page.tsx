// Актуальность данных: статус, срок квартала, подтверждение; из unresponsive — по секциям.
// UPD-01, UPD-02, UPD-03, UPD-04, UPD-05, UPD-06, NOT-31.
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useFormat } from "@/i18n/format";

import { ConfirmAction, UpdateStatusBadge } from "../components";
import { useDictionary } from "../i18n";
import { useCommonTexts } from "../labels";
import { useExt } from "../store";
import { useManufacturerActions } from "./actions";
import { nextQuarter, readExt, SECTIONS } from "./model";
import { ManufacturerPage } from "./page";
import { screenTexts } from "./screen-texts";
import { useViewedProfile } from "./view-as";

export function UpdateStatusPage() {
  const t = useDictionary(screenTexts);
  const common = useCommonTexts();
  const format = useFormat();
  const { profile } = useViewedProfile();
  const actions = useManufacturerActions(profile);
  const ext = readExt(useExt<unknown>("manufacturer", null));
  const status = profile.updateStatus;

  if (profile.status !== "verified" || !status) {
    return (
      <ManufacturerPage title={t("updTitle")}>
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{t("updNotVerified")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ManufacturerPage>
    );
  }

  const confirmed = new Set(ext.confirmations[profile.id] ?? []);
  const last = profile.lastConfirmedAt ?? profile.verifiedAt;

  return (
    <ManufacturerPage title={t("updTitle")}>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {t("updCurrent")} <UpdateStatusBadge status={status} />
          </CardTitle>
          <CardDescription>{t(`updMeaning.${status}`)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t("updLast")}</dt>
              <dd>{format.date(last)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("updNext")}</dt>
              <dd>{last ? format.date(nextQuarter(last)) : common("none")}</dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">{t("updHow")}</p>
          {status !== "unresponsive" ? (
            <div>
              <ConfirmAction
                label={t("updConfirm")}
                title={t("updConfirmTitle")}
                description={t("updConfirmDescription")}
                confirmLabel={t("updConfirm")}
                onConfirm={actions.confirmCurrent}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Alert>
                <AlertDescription>
                  {t("updBySection", {
                    done: format.number(confirmed.size),
                    total: format.number(SECTIONS.length),
                  })}
                </AlertDescription>
              </Alert>
              <ul className="flex flex-col divide-y rounded-lg border">
                {SECTIONS.map((s) => (
                  <li key={s} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <span className="font-medium">{common(`section.${s}`)}</span>
                    {confirmed.has(s) ? (
                      <span className="text-muted-foreground">{t("updSectionDone")}</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={t("updConfirmSectionOf", { section: common(`section.${s}`) })}
                        onClick={() => actions.confirmSection(s)}
                      >
                        {t("updConfirmSection")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("updStatusesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-3 text-sm">
            {(["active", "outdated", "unresponsive"] as const).map((s) => (
              <div key={s} className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                <dt className="shrink-0 sm:w-32">
                  <UpdateStatusBadge status={s} />
                </dt>
                <dd className="text-muted-foreground">{t(`updMeaning.${s}`)}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </ManufacturerPage>
  );
}
