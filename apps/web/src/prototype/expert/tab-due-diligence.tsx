// Due diligence профиля для SME: отчёт по каталогу, повторный запуск (имитация, Adata не вызывается),
// итог SME green/amber/red с комментарием и его влияние на видимость, enhanced due diligence, пометка SME
// к строке (IMBC-07, IMBC-08, IMBC-09, IMBC-11, IMBC-13, IMBC-14, EXT-03).
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmAction, FileRow } from "@/prototype/components";
import type { DdCheckValue, DdResult, FileRef, ProtoProfile } from "@/prototype/data";
import { DD_CHECKS } from "@/prototype/data/due-diligence";
import { localized, translate, useDictionary, useProtoLocale } from "@/prototype/i18n";
import { commonTexts, useCommonTexts } from "@/prototype/labels";
import { isVisible } from "@/prototype/rules";
import { nowIso, useProto, useProtoUpdate } from "@/prototype/store";

import { useExpertId } from "./actor";
import { DueDiligenceView, EnhancedDueDiligenceCard } from "./dossier";
import { draftExt, lineKey, useExpertExt } from "./ext";
import { rerunDueDiligence } from "./simulate";
import { summaryOf } from "./summary";
import { texts } from "./texts";

const RESULTS: DdResult[] = ["green", "amber", "red"];

export function DueDiligenceTab({ profile }: { profile: ProtoProfile }) {
  const t = useDictionary(texts);
  const update = useProtoUpdate();
  const state = useProto();
  const ext = useExpertExt();
  const record = state.dueDiligence.find((d) => d.profileId === profile.id);
  const subject = { type: "due_diligence" as const, id: profile.id, label: profile.nameRu };

  if (!record) return <p className="text-sm text-muted-foreground">{t("ddMissing")}</p>;

  const rerun = () =>
    update({ action: "due_diligence.run", subject, summary: localized(texts, "auditDdRun") }, (draft) =>
      rerunDueDiligence(draft, profile.id, nowIso()),
    );

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertDescription>{t("ddSimulated")}</AlertDescription>
      </Alert>
      <p className="text-sm">
        {isVisible(state, profile)
          ? t("visibleYes")
          : profile.status !== "verified"
            ? t("visibleNoStatus")
            : t("visibleNoRed")}
      </p>
      <p className="text-xs text-muted-foreground">{t("ddOperatorsSee")}</p>
      <div>
        <ConfirmAction
          variant="outline"
          label={t("ddRun")}
          title={t("ddRunTitle")}
          description={t("ddRunDescription")}
          confirmLabel={t("ddRun")}
          onConfirm={rerun}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ResultForm
          key={`${record.checkedAt}-${record.result}-${record.comment ?? ""}`}
          profile={profile}
          current={record.result}
          auto={record.autoResult}
          comment={record.comment}
        />
        <EnhancedDueDiligenceCard record={record}>
          <EnhancedForm
            key={record.enhanced.at ?? "none"}
            profile={profile}
            done={record.enhanced.done}
            comment={record.enhanced.comment}
            report={record.enhanced.report}
          />
        </EnhancedDueDiligenceCard>
      </div>

      <DueDiligenceView
        record={record}
        lineNotes={ext.ddLineNotes}
        lineAction={(line) => (
          <LineNoteAction
            profile={profile}
            line={line}
            current={ext.ddLineNotes[lineKey(profile.id, line.checkId, line.subject)]?.text ?? ""}
          />
        )}
      />
    </div>
  );
}

/** Итог SME (IMBC-08): green, amber или red; отличие от итога по строкам — с комментарием. */
function ResultForm({
  profile,
  current,
  auto,
  comment,
}: {
  profile: ProtoProfile;
  current: DdResult;
  auto: DdResult;
  comment: string | null;
}) {
  const t = useDictionary(texts);
  const common = useCommonTexts();
  const me = useExpertId();
  const update = useProtoUpdate();
  const [result, setResult] = useState<DdResult>(current);
  const [text, setText] = useState(comment ?? "");
  const needsComment = result !== auto && !text.trim();
  const unchanged = result === current && text.trim() === (comment ?? "");
  const save = () =>
    update(
      {
        action: "due_diligence.set_result",
        subject: { type: "due_diligence", id: profile.id, label: profile.nameRu },
        summary: summaryOf(texts, "auditDdResult", (l) => ({ result: translate(commonTexts, l, `dd.${result}`) })),
      },
      (draft) => {
        const record = draft.dueDiligence.find((d) => d.profileId === profile.id)!;
        record.result = result;
        record.resultSetBy = me;
        record.comment = text.trim() || null;
      },
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("ddResultTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("ddResultTitle")}>
          {RESULTS.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={result === r ? "default" : "outline"}
              aria-pressed={result === r}
              onClick={() => setResult(r)}
            >
              {common(`dd.${r}`)}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t(`ddMeans.${result}`)}</p>
        <Textarea
          aria-label={t("ddComment")}
          placeholder={t("ddComment")}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {needsComment && <p className="text-xs text-muted-foreground">{t("ddCommentNeeded")}</p>}
        <div>
          <Button disabled={needsComment || unchanged} onClick={save}>
            {t("ddSaveResult")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Enhanced due diligence (IMBC-08): сделана или нет, комментарий, отчёт. */
function EnhancedForm({
  profile,
  done,
  comment,
  report,
}: {
  profile: ProtoProfile;
  done: boolean;
  comment: string | null;
  report: FileRef | null;
}) {
  const t = useDictionary(texts);
  const me = useExpertId();
  const update = useProtoUpdate();
  const [value, setValue] = useState(done);
  const [text, setText] = useState(comment ?? "");
  const [file, setFile] = useState<FileRef | null>(report);
  const save = () =>
    update(
      {
        action: "due_diligence.enhanced",
        subject: { type: "due_diligence", id: profile.id, label: profile.nameRu },
        summary: localized(texts, value ? "auditEnhancedDone" : "auditEnhancedNotDone"),
      },
      (draft) => {
        const record = draft.dueDiligence.find((d) => d.profileId === profile.id)!;
        record.enhanced = { done: value, comment: text.trim() || null, report: file, at: nowIso(), by: me };
      },
    );
  return (
    <div className="flex flex-col gap-3 border-t pt-3 text-sm">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("enhancedState")}>
        <Button size="sm" variant={value ? "default" : "outline"} aria-pressed={value} onClick={() => setValue(true)}>
          {t("enhancedMarkDone")}
        </Button>
        <Button
          size="sm"
          variant={!value ? "default" : "outline"}
          aria-pressed={!value}
          onClick={() => setValue(false)}
        >
          {t("enhancedMarkNotDone")}
        </Button>
      </div>
      <Textarea
        aria-label={t("enhancedComment")}
        placeholder={t("enhancedComment")}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <FileRow label={t("enhancedReportFile")} file={file} onSelect={setFile} />
      <p className="text-xs text-muted-foreground">{t("enhancedHint")}</p>
      <div>
        <Button onClick={save}>{t("enhancedSave")}</Button>
      </div>
    </div>
  );
}

/** Пометка SME к строке: строку SME не правит (IMBC-13), вывод пишет рядом. */
function LineNoteAction({ profile, line, current }: { profile: ProtoProfile; line: DdCheckValue; current: string }) {
  const t = useDictionary(texts);
  const locale = useProtoLocale();
  const me = useExpertId();
  const update = useProtoUpdate();
  const [text, setText] = useState(current);
  const title = DD_CHECKS.find((c) => c.id === line.checkId)?.title[locale] ?? line.checkId;
  return (
    <ConfirmAction
      size="sm"
      variant="ghost"
      label={<span aria-label={t("lineNoteNamed", { check: title, subject: line.subject })}>{t("lineNote")}</span>}
      title={t("lineNoteTitle", { check: title })}
      description={line.subject}
      confirmLabel={t("save")}
      confirmDisabled={!text.trim()}
      onConfirm={() =>
        update(
          {
            action: "due_diligence.line_note",
            subject: { type: "due_diligence", id: profile.id, label: profile.nameRu },
            summary: localized(texts, "auditLineNote"),
          },
          (draft) => {
            draftExt(draft).ddLineNotes[lineKey(profile.id, line.checkId, line.subject)] = {
              text: text.trim(),
              by: me,
              at: nowIso(),
            };
          },
        )
      }
    >
      <Textarea aria-label={t("lineNote")} value={text} onChange={(e) => setText(e.target.value)} />
    </ConfirmAction>
  );
}
