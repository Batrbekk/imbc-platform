// Тир и AGAR: свой тир, статус каждой записи AGAR и CDP, запрос site survey и AGAR.
// IMBC-19, IMBC-20, IMBC-21, IMBC-22, IMBC-23, IMBC-24, IMBC-25.
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";

import { AgarStatusBadge, ConfirmAction, FileRow, TierBadge } from "../components";
import { isTier3 } from "../data/tier-records";
import { useDictionary } from "../i18n";
import { isSiteSurveyed, profileTier } from "../rules";
import { useProto } from "../store";
import { useManufacturerActions } from "./actions";
import { ManufacturerPage } from "./page";
import { screenTexts } from "./screen-texts";
import { useViewedProfile } from "./view-as";

export function TierPage() {
  const t = useDictionary(screenTexts);
  const format = useFormat();
  const state = useProto();
  const { profile } = useViewedProfile();
  const actions = useManufacturerActions(profile);

  if (profile.status !== "verified") {
    return (
      <ManufacturerPage title={t("tierTitle")}>
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{t("tierNotVerified")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ManufacturerPage>
    );
  }

  const tier = profileTier(state, profile);
  const surveyed = isSiteSurveyed(state, profile.id);
  const openSurvey = state.siteSurveyRequests.find((r) => r.profileId === profile.id && r.status === "open");
  const records = state.tierRecords.filter((r) => r.profileId === profile.id);
  const strCodes = new Set(state.techFiles.filter((f) => f.kind === "str").map((f) => f.tnved));
  // Тир 3 — у верифицированных продуктовых линий; ожидающие правки сюда не входят.
  const products = profile.sections.products;

  return (
    <ManufacturerPage title={t("tierTitle")}>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {t("tierCurrent")} <TierBadge tier={tier} />
          </CardTitle>
          <CardDescription>{t("tierExplain")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm">{surveyed ? t("tierSurveyed") : t("tierNotSurveyed")}</p>
          {openSurvey ? (
            <Alert>
              <AlertDescription>
                {t("tierSurveyRequested", { date: format.date(openSurvey.requestedAt) })}
              </AlertDescription>
            </Alert>
          ) : (
            <div>
              <ConfirmAction
                variant="outline"
                label={t("tierRequestSurvey")}
                title={t("tierRequestSurveyTitle")}
                description={t("tierRequestSurveyDescription")}
                confirmLabel={t("tierRequestSurvey")}
                onConfirm={actions.requestSurvey}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("tierProducts")}</CardTitle>
          <CardDescription>{t("tierAgarExplain")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("tierProduct")}</TableHead>
                  <TableHead>{t("tierRecord")}</TableHead>
                  <TableHead>{t("tierStr")}</TableHead>
                  <TableHead>{t("tierAction")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => {
                  const record = records.find((r) => r.productId === p.id);
                  const hasStr = strCodes.has(p.tnved);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-normal">
                        <span className="flex flex-col">
                          <span className="font-medium">{p.nameRu}</span>
                          <span className="font-mono text-xs text-muted-foreground">{p.tnved}</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        {record ? (
                          <span className="flex flex-wrap items-center gap-1">
                            <Badge variant="secondary">{t(`tierKind.${record.kind}`)}</Badge>
                            <AgarStatusBadge status={record.status} />
                            {isTier3(record) && <TierBadge tier="tier_3" />}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{t("tierNoRecord")}</span>
                        )}
                      </TableCell>
                      <TableCell>{hasStr ? t("tierHasStr") : t("tierNoStr")}</TableCell>
                      <TableCell className="whitespace-normal">
                        {record ? (
                          <span className="text-sm text-muted-foreground">{t("tierOnePerProduct")}</span>
                        ) : hasStr ? (
                          <ConfirmAction
                            size="sm"
                            label={t("tierRequestAgar")}
                            title={t("tierRequestAgarTitle", { product: p.nameRu })}
                            description={t("tierRequestAgarDescription")}
                            confirmLabel={t("tierRequestAgar")}
                            onConfirm={() => actions.requestAgar(p.id, p.nameRu)}
                          />
                        ) : (
                          <span className="text-sm text-muted-foreground">{t("tierAgarRefused")}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {records
            .filter((r) => r.report)
            .map((r) => (
              <FileRow
                key={r.id}
                label={t("tierReport", {
                  kind: t(`tierKind.${r.kind}`),
                  product: products.find((p) => p.id === r.productId)?.nameRu ?? "—",
                })}
                file={r.report}
              />
            ))}
        </CardContent>
      </Card>
    </ManufacturerPage>
  );
}
