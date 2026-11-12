// Site survey профиля: записи с датами, результатом, подписанным отчётом, сроком и комментарием, в том числе
// задним числом; срок записи можно поставить прошедшим; запрос производителя закрывается отдельно
// (IMBC-01, IMBC-02, IMBC-03, IMBC-20; tier 2 — IMBC-20).
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFormat } from "@/i18n/format";
import { ConfirmAction, FileRow, TierBadge } from "@/prototype/components";
import type { FileRef, ProtoProfile, SiteSurvey } from "@/prototype/data";
import { localized, useDictionary } from "@/prototype/i18n";
import { isSiteSurveyed, profileTier } from "@/prototype/rules";
import { newId, nowIso, useProto, useProtoUpdate } from "@/prototype/store";

import { useExpertId } from "./actor";
import { SiteSurveyList } from "./dossier";
import { texts } from "./texts";

export function SiteSurveyTab({ profile }: { profile: ProtoProfile }) {
  const t = useDictionary(texts);
  const format = useFormat();
  const update = useProtoUpdate();
  const state = useProto();
  const surveys = state.siteSurveys.filter((s) => s.profileId === profile.id);
  const requests = state.siteSurveyRequests.filter((r) => r.profileId === profile.id && r.status === "open");
  const surveyed = isSiteSurveyed(state, profile.id);

  const closeRequest = (id: string) =>
    update(
      {
        action: "site_survey.request_done",
        subject: { type: "site_survey", id, label: profile.nameRu },
        summary: localized(texts, "auditSurveyRequestDone"),
      },
      (draft) => {
        draft.siteSurveyRequests.find((r) => r.id === id)!.status = "done";
      },
    );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span>{surveyed ? t("siteSurveyedYes") : t("siteSurveyedNo")}</span>
            <TierBadge tier={profileTier(state, profile)} />
          </div>
          <p className="text-xs text-muted-foreground">{t("surveyRule")}</p>
          {requests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
              <span>{t("surveyRequestOpen", { date: format.dateTime(r.requestedAt) })}</span>
              <Button size="sm" variant="outline" onClick={() => closeRequest(r.id)}>
                {t("surveyRequestDone")}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t("surveyRecords")}</CardTitle>
          </CardHeader>
          <CardContent>
            <SiteSurveyList surveys={surveys} recordAction={(s) => <ExpiryAction profile={profile} survey={s} />} />
          </CardContent>
        </Card>
        <SurveyForm profile={profile} />
      </div>
    </div>
  );
}

function SurveyForm({ profile }: { profile: ProtoProfile }) {
  const t = useDictionary(texts);
  const me = useExpertId();
  const update = useProtoUpdate();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState(true);
  const [report, setReport] = useState<FileRef | null>(null);
  const [expires, setExpires] = useState("");
  const [comment, setComment] = useState("");
  const invalidRange = Boolean(to) && to < from;
  const valid = Boolean(from) && !invalidRange;

  const save = () => {
    const id = newId("ss");
    update(
      {
        action: "site_survey.create",
        subject: { type: "site_survey", id, label: profile.nameRu },
        summary: localized(texts, "auditSurvey"),
      },
      (draft) => {
        draft.siteSurveys.push({
          id,
          profileId: profile.id,
          visitFrom: from,
          visitTo: to || from,
          result,
          report,
          expiresOn: expires || null,
          comment: comment.trim() || null,
          recordedBy: me,
          recordedAt: nowIso(),
        });
      },
    );
    setFrom("");
    setTo("");
    setResult(true);
    setReport(null);
    setExpires("");
    setComment("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("surveyAdd")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          {t("visitFrom")}
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {t("visitTo")}
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={invalidRange} />
        </label>
        {invalidRange && <p className="text-xs text-destructive">{t("visitRangeError")}</p>}
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("surveyResult")}>
          <Button
            size="sm"
            variant={result ? "default" : "outline"}
            aria-pressed={result}
            onClick={() => setResult(true)}
          >
            {t("yes")}
          </Button>
          <Button
            size="sm"
            variant={!result ? "default" : "outline"}
            aria-pressed={!result}
            onClick={() => setResult(false)}
          >
            {t("no")}
          </Button>
        </div>
        <FileRow label={t("surveyReportFile")} file={report} onSelect={setReport} />
        <label className="flex flex-col gap-1">
          {t("surveyExpires")}
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </label>
        <Textarea
          aria-label={t("surveyComment")}
          placeholder={t("surveyComment")}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t("surveyFormHint")}</p>
        <div>
          <Button disabled={!valid} onClick={save}>
            {t("surveySave")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Срок записи (IMBC-02): прошедшая дата снимает отметку site surveyed. */
function ExpiryAction({ profile, survey }: { profile: ProtoProfile; survey: SiteSurvey }) {
  const t = useDictionary(texts);
  const update = useProtoUpdate();
  const [date, setDate] = useState(survey.expiresOn ?? "");
  return (
    <ConfirmAction
      size="sm"
      variant="outline"
      label={t("setExpiry")}
      title={t("setExpiry")}
      description={t("setExpiryHint")}
      confirmDisabled={!date}
      onConfirm={() =>
        update(
          {
            action: "site_survey.set_expiry",
            subject: { type: "site_survey", id: survey.id, label: profile.nameRu },
            summary: localized(texts, "auditSurveyExpiry"),
          },
          (draft) => {
            draft.siteSurveys.find((s) => s.id === survey.id)!.expiresOn = date;
          },
        )
      }
    >
      <Input type="date" aria-label={t("surveyExpires")} value={date} onChange={(e) => setDate(e.target.value)} />
    </ConfirmAction>
  );
}
