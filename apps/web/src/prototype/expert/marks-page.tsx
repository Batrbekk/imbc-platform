// Отметки операторов: SME подтверждает или отклоняет каждое изменение «works with» (поставить или снять) и
// принимает или отклоняет отметки визитов; видно, какие операторы с кем работают (IMBC-04, IMBC-16, OPR-19,
// OPR-20, OPR-21). Решение по визиту видит только IMBC.
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { MarkStateBadge, ProtoPage } from "@/prototype/components";
import type { VisitMark, WorksWithMark } from "@/prototype/data";
import { localized, useDictionary } from "@/prototype/i18n";
import { accountName, organizationName, profileById, worksWithCount } from "@/prototype/rules";
import { nowIso, useProto, useProtoUpdate } from "@/prototype/store";

import { useExpertId } from "./actor";
import { worksWithOrganizations } from "./dossier";
import { dossierPath } from "./paths";
import { texts } from "./texts";

const waitingFirst =
  <T extends { createdAt: string }>(waiting: (x: T) => boolean) =>
  (a: T, b: T) =>
    Number(waiting(b)) - Number(waiting(a)) || b.createdAt.localeCompare(a.createdAt);

export function MarksScreen() {
  const t = useDictionary(texts);
  const format = useFormat();
  const me = useExpertId();
  const update = useProtoUpdate();
  const state = useProto();
  const marks = [...state.worksWithMarks].sort(waitingFirst<WorksWithMark>((m) => m.state === "waiting"));
  const visits = [...state.visitMarks].sort(waitingFirst<VisitMark>((v) => v.decision === "waiting"));
  const company = (id: string) => profileById(state, id)?.nameRu ?? id;

  const decideMark = (mark: WorksWithMark, value: "validated" | "rejected") =>
    update(
      {
        action: value === "validated" ? "works_with.validate" : "works_with.reject",
        subject: { type: "works_with", id: mark.id, label: company(mark.profileId) },
        summary: localized(texts, value === "validated" ? "auditMarkValidate" : "auditMarkReject", {
          operator: organizationName(state, mark.operatorOrgId),
        }),
      },
      (draft) => {
        const m = draft.worksWithMarks.find((x) => x.id === mark.id)!;
        m.state = value;
        m.decidedBy = me;
        m.decidedAt = nowIso();
      },
    );

  const decideVisit = (visit: VisitMark, value: "accepted" | "rejected") =>
    update(
      {
        action: value === "accepted" ? "visit.accept" : "visit.reject",
        subject: { type: "visit", id: visit.id, label: company(visit.profileId) },
        summary: localized(texts, value === "accepted" ? "auditVisitAccept" : "auditVisitReject", {
          operator: organizationName(state, visit.operatorOrgId),
        }),
      },
      (draft) => {
        const v = draft.visitMarks.find((x) => x.id === visit.id)!;
        v.decision = value;
        v.decidedBy = me;
        v.decidedAt = nowIso();
      },
    );

  const working = state.profiles
    .map((p) => ({ profile: p, orgs: worksWithOrganizations(state, p.id) }))
    .filter((row) => row.orgs.length > 0);

  return (
    <ProtoPage title={t("marksTitle")} description={t("marksHint")}>
      <Card>
        <CardHeader>
          <CardTitle>{t("worksWithChanges")}</CardTitle>
        </CardHeader>
        <CardContent>
          {marks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("marksEmpty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("manufacturer")}</TableHead>
                    <TableHead>{t("operator")}</TableHead>
                    <TableHead>{t("change")}</TableHead>
                    <TableHead>{t("date")}</TableHead>
                    <TableHead>{t("state")}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t("actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {marks.map((m) => {
                    const name = `${company(m.profileId)} · ${organizationName(state, m.operatorOrgId)}`;
                    return (
                      <TableRow key={m.id}>
                        <TableCell>
                          <Link
                            className="underline-offset-4 hover:underline"
                            to={dossierPath(m.profileId, "operators")}
                          >
                            {company(m.profileId)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {organizationName(state, m.operatorOrgId)}
                          <div className="text-xs text-muted-foreground">{accountName(state, m.createdBy)}</div>
                        </TableCell>
                        <TableCell>{m.value ? t("markSetValue") : t("markRemoveValue")}</TableCell>
                        <TableCell className="text-xs">{format.date(m.createdAt)}</TableCell>
                        <TableCell>
                          <MarkStateBadge state={m.state} />
                        </TableCell>
                        <TableCell>
                          {m.state === "waiting" && (
                            <span className="flex gap-2">
                              <Button
                                size="sm"
                                aria-label={t("validateNamed", { name })}
                                onClick={() => decideMark(m, "validated")}
                              >
                                {t("validate")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={t("rejectNamed", { name })}
                                onClick={() => decideMark(m, "rejected")}
                              >
                                {t("reject")}
                              </Button>
                            </span>
                          )}
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

      <Card>
        <CardHeader>
          <CardTitle>{t("visitMarks")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{t("visitHint")}</p>
          {visits.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("visitsEmpty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("manufacturer")}</TableHead>
                    <TableHead>{t("operator")}</TableHead>
                    <TableHead>{t("visitDate")}</TableHead>
                    <TableHead>{t("file")}</TableHead>
                    <TableHead>{t("state")}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t("actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visits.map((v) => {
                    const name = `${company(v.profileId)} · ${organizationName(state, v.operatorOrgId)}`;
                    return (
                      <TableRow key={v.id}>
                        <TableCell>
                          <Link
                            className="underline-offset-4 hover:underline"
                            to={dossierPath(v.profileId, "operators")}
                          >
                            {company(v.profileId)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {organizationName(state, v.operatorOrgId)}
                          <div className="text-xs text-muted-foreground">{accountName(state, v.createdBy)}</div>
                        </TableCell>
                        <TableCell>{format.date(v.visitedOn)}</TableCell>
                        <TableCell className="text-xs break-all whitespace-normal">
                          {v.file?.name ?? t("noFile")}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              v.decision === "rejected"
                                ? "destructive"
                                : v.decision === "accepted"
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {t(`visit.${v.decision}`)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {v.decision === "waiting" && (
                            <span className="flex gap-2">
                              <Button
                                size="sm"
                                aria-label={t("acceptNamed", { name })}
                                onClick={() => decideVisit(v, "accepted")}
                              >
                                {t("accept")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={t("rejectNamed", { name })}
                                onClick={() => decideVisit(v, "rejected")}
                              >
                                {t("reject")}
                              </Button>
                            </span>
                          )}
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

      <Card>
        <CardHeader>
          <CardTitle>{t("whoWorksWithWhom")}</CardTitle>
        </CardHeader>
        <CardContent>
          {working.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("nobodyWorks")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("manufacturer")}</TableHead>
                    <TableHead>{t("operators")}</TableHead>
                    <TableHead>{t("majorCount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {working.map(({ profile, orgs }) => (
                    <TableRow key={profile.id}>
                      <TableCell>{profile.nameRu}</TableCell>
                      <TableCell className="whitespace-normal">
                        {orgs.map((o) => organizationName(state, o)).join(", ")}
                      </TableCell>
                      <TableCell>{format.number(worksWithCount(state, profile.id))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </ProtoPage>
  );
}
