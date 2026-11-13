// Запросы производителей в списке SME: site survey (без продукта, без письма) и AGAR на продукт со STR; запрос
// не создаёт запись и не начинает визит — SME решает, браться ли (IMBC-20, IMBC-24, IMBC-25).
import { cn } from "cn";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { AgarStatusBadge, ProtoPage } from "@/prototype/components";
import { localized, useDictionary } from "@/prototype/i18n";
import { profileById } from "@/prototype/rules";
import { useProto, useProtoUpdate } from "@/prototype/store";

import { dossierPath } from "./paths";
import { texts } from "./texts";

export function ManufacturerRequestsScreen() {
  const t = useDictionary(texts);
  const format = useFormat();
  const update = useProtoUpdate();
  const state = useProto();
  const surveys = [...state.siteSurveyRequests].sort(
    (a, b) => Number(b.status === "open") - Number(a.status === "open") || b.requestedAt.localeCompare(a.requestedAt),
  );
  const agar = state.tierRecords.filter((r) => r.requestedByManufacturer);
  const company = (id: string) => profileById(state, id)?.nameRu ?? id;

  const done = (id: string, profileId: string) =>
    update(
      {
        action: "site_survey.request_done",
        subject: { type: "site_survey", id, label: company(profileId) },
        summary: localized(texts, "auditSurveyRequestDone"),
      },
      (draft) => {
        draft.siteSurveyRequests.find((r) => r.id === id)!.status = "done";
      },
    );

  return (
    <ProtoPage title={t("mrTitle")} description={t("mrHint")}>
      <Card>
        <CardHeader>
          <CardTitle>{t("mrSurveys")}</CardTitle>
        </CardHeader>
        <CardContent>
          {surveys.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("mrSurveysEmpty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("manufacturer")}</TableHead>
                    <TableHead>{t("requestedAt")}</TableHead>
                    <TableHead>{t("state")}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t("actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {surveys.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{company(r.profileId)}</TableCell>
                      <TableCell className="text-xs">{format.dateTime(r.requestedAt)}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "open" ? "secondary" : "outline"}>
                          {t(`mrState.${r.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap gap-2">
                          <Link
                            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                            to={dossierPath(r.profileId, "site-survey")}
                          >
                            {t("openSurvey")}
                          </Link>
                          {r.status === "open" && (
                            <Button size="sm" variant="ghost" onClick={() => done(r.id, r.profileId)}>
                              {t("surveyRequestDone")}
                            </Button>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("mrAgar")}</CardTitle>
        </CardHeader>
        <CardContent>
          {agar.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("mrAgarEmpty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("manufacturer")}</TableHead>
                    <TableHead>{t("product")}</TableHead>
                    <TableHead>{t("state")}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t("actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agar.map((r) => {
                    const product = profileById(state, r.profileId)?.sections.products.find(
                      (p) => p.id === r.productId,
                    );
                    return (
                      <TableRow key={r.id}>
                        <TableCell>{company(r.profileId)}</TableCell>
                        <TableCell className="whitespace-normal">{product?.nameRu ?? r.productId}</TableCell>
                        <TableCell>
                          <AgarStatusBadge status={r.status} />
                        </TableCell>
                        <TableCell>
                          <Link
                            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                            to={dossierPath(r.profileId, "tiers")}
                          >
                            {t("openTiers")}
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </ProtoPage>
  );
}
