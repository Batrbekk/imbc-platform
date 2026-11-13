// Карточка работы с компанией: тир и продукты tier 3, отметки works-with и визита, заметки организации.
// OPR-10, OPR-12, OPR-19, OPR-20, OPR-21, OPR-22, OPR-23, IMBC-04, IMBC-21, IMBC-22, GEN-12.
import { cn } from "cn";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFormat } from "@/i18n/format";

import { ConfirmAction, FileRow, MarkStateBadge, ProtoPage, TierBadge, UpdateStatusBadge } from "../components";
import type { FileRef } from "../data";
import { localized, useDictionary } from "../i18n";
import { protoPath } from "../registry";
import { accountName, profileTier, tier3ProductIds, worksWithCount } from "../rules";
import { newId, nowIso, useProto, useProtoUpdate } from "../store";
import { useOperator } from "./hooks";
import { NotFound, Row } from "./parts";
import { majorOperatorCount, ownOrg, visibleProfile, worksWithOf } from "./scope";
import { texts } from "./texts";

const today = () => new Date().toISOString().slice(0, 10);

export function CompanyCardScreen() {
  const t = useDictionary(texts);
  const { profileId } = useParams();
  const state = useProto();
  const profile = visibleProfile(state, profileId);

  if (!profile) {
    return (
      <ProtoPage title={t("mfTitle")}>
        <NotFound text={t("notAvailable")} backLabel={t("back")} backTo={protoPath("operator", "manufacturers")} />
      </ProtoPage>
    );
  }
  return <CompanyCard profileId={profile.id} />;
}

function CompanyCard({ profileId }: { profileId: string }) {
  const t = useDictionary(texts);
  const format = useFormat();
  const state = useProto();
  const { organizationId } = useOperator();
  const profile = visibleProfile(state, profileId)!;
  const tier3 = new Set(tier3ProductIds(state, profile.id));
  const requests =
    ownOrg(state.imbcRequests, organizationId).filter((r) => r.profileId === profile.id).length +
    ownOrg(state.operatorRequests, organizationId).filter((r) => r.profileId === profile.id).length;

  return (
    <ProtoPage
      title={profile.nameRu}
      description={profile.nameEn}
      actions={
        <>
          <Link
            className={cn(buttonVariants({ variant: "outline" }))}
            to={`${protoPath("operator", "requests")}?tab=operator&profile=${profile.id}`}
          >
            {t("askManufacturer")}
          </Link>
          <Link
            className={cn(buttonVariants({ variant: "outline" }))}
            to={`${protoPath("operator", "requests")}?tab=imbc&profile=${profile.id}`}
          >
            {t("askImbc")}
          </Link>
        </>
      }
    >
      <div>
        <Link
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          to={protoPath("operator", "manufacturers")}
        >
          ← {t("back")}
        </Link>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("company")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm">
              <Row label={t("bin")}>
                <span className="font-mono">{profile.bin}</span>
              </Row>
              <Row label={t("region")}>{profile.sections.main.region}</Row>
              <Row label={t("updateStatus")}>
                {profile.updateStatus && <UpdateStatusBadge status={profile.updateStatus} />}
              </Row>
              <Row label={t("verifiedAt")}>{format.date(profile.verifiedAt)}</Row>
              <Row label={t("tier")}>
                <TierBadge tier={profileTier(state, profile)} />
              </Row>
              <Row label={t("majors")}>
                <span className="flex flex-col">
                  {t("majorsValue", {
                    count: format.number(worksWithCount(state, profile.id)),
                    total: format.number(majorOperatorCount(state)),
                  })}
                  <span className="text-xs text-muted-foreground">{t("majorsHint")}</span>
                </span>
              </Row>
            </dl>
            <p className="mt-3 text-sm text-muted-foreground">
              {t("requestsAbout", { count: format.number(requests) })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("products")}</CardTitle>
            <CardDescription>{t("tier3Hint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {profile.sections.products.map((line) => (
                <li key={line.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{line.nameRu}</span>
                    <span className="font-mono text-xs text-muted-foreground">{line.tnved}</span>
                  </span>
                  {tier3.has(line.id) && <TierBadge tier="tier_3" />}
                </li>
              ))}
            </ul>
            {tier3.size === 0 && <p className="mt-2 text-sm text-muted-foreground">{t("noTier3")}</p>}
          </CardContent>
        </Card>

        <WorksWithCard profileId={profile.id} company={profile.nameRu} />
        <VisitCard profileId={profile.id} company={profile.nameRu} />
      </div>
      <NotesCard profileId={profile.id} company={profile.nameRu} />
    </ProtoPage>
  );
}

function WorksWithCard({ profileId, company }: { profileId: string; company: string }) {
  const t = useDictionary(texts);
  const format = useFormat();
  const state = useProto();
  const update = useProtoUpdate();
  const { organizationId, accountId } = useOperator();
  const ww = worksWithOf(state.worksWithMarks, organizationId, profileId);
  const nextValue = !ww.current;

  const change = () => {
    const id = newId("ww");
    update(
      {
        action: nextValue ? "works_with.set" : "works_with.remove",
        subject: { type: "works_with", id, label: company },
        summary: localized(texts, nextValue ? "auditWwSet" : "auditWwRemove"),
      },
      (draft) => {
        draft.worksWithMarks.push({
          id,
          operatorOrgId: organizationId,
          profileId,
          value: nextValue,
          state: "waiting",
          createdBy: accountId,
          createdAt: nowIso(),
          decidedBy: null,
          decidedAt: null,
        });
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("wwTitle")}</CardTitle>
        <CardDescription>{t("wwHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>{ww.current ? t("wwCurrentYes") : t("wwCurrentNo")}</p>
        {ww.waiting && (
          <p className="flex flex-wrap items-center gap-2">
            <MarkStateBadge state="waiting" />
            {t(ww.waiting.value ? "wwWaitingSet" : "wwWaitingRemove", { date: format.date(ww.waiting.createdAt) })}
          </p>
        )}
        {ww.rejected && (
          <p className="flex flex-wrap items-center gap-2">
            <MarkStateBadge state="rejected" />
            {t("wwRejected", { date: format.date(ww.rejected.createdAt) })}
          </p>
        )}
        {/* Пока изменение ждёт IMBC, новое не отправляется: решение принимается по одному изменению. */}
        <div>
          <ConfirmAction
            label={nextValue ? t("wwSet") : t("wwRemove")}
            variant={nextValue ? "default" : "outline"}
            title={t(nextValue ? "wwSetTitle" : "wwRemoveTitle", { company })}
            description={t("wwConfirmHint")}
            disabled={ww.waiting !== null}
            onConfirm={change}
          />
        </div>
        {ww.history.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="font-medium">{t("wwHistory")}</span>
            <ul className="flex flex-col gap-1">
              {[...ww.history].reverse().map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  <span className="text-foreground">{m.value ? t("wwHistorySet") : t("wwHistoryRemove")}</span>
                  <MarkStateBadge state={m.state} />
                  {t("byOn", { name: accountName(state, m.createdBy), date: format.date(m.createdAt) })}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VisitCard({ profileId, company }: { profileId: string; company: string }) {
  const t = useDictionary(texts);
  const format = useFormat();
  const state = useProto();
  const update = useProtoUpdate();
  const { organizationId, accountId } = useOperator();
  const [date, setDate] = useState("");
  const [file, setFile] = useState<FileRef | null>(null);
  const visits = ownOrg(state.visitMarks, organizationId)
    .filter((v) => v.profileId === profileId)
    .sort((a, b) => b.visitedOn.localeCompare(a.visitedOn));
  const future = date > today();

  const send = () => {
    const id = newId("visit");
    update(
      {
        action: "visit.create",
        subject: { type: "visit", id, label: company },
        summary: localized(texts, "auditVisit"),
      },
      (draft) => {
        draft.visitMarks.push({
          id,
          operatorOrgId: organizationId,
          profileId,
          visitedOn: date,
          file,
          decision: "waiting",
          createdBy: accountId,
          createdAt: nowIso(),
          decidedBy: null,
          decidedAt: null,
        });
      },
    );
    setDate("");
    setFile(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("visitTitle")}</CardTitle>
        <CardDescription>{t("visitHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {visits.length === 0 ? (
          <p className="text-muted-foreground">{t("visitNone")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visits.map((v) => (
              <li key={v.id} className="flex flex-col gap-1 rounded-lg border p-3">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{t("visitOn", { date: format.date(v.visitedOn) })}</span>
                  {/* Решение по отметке визита видит только IMBC (IMBC-04). */}
                  <span className="text-xs text-muted-foreground">{t("visitSent")}</span>
                </span>
                <span className="text-muted-foreground">
                  {t("byOn", { name: accountName(state, v.createdBy), date: format.date(v.createdAt) })}
                  {v.file && ` · ${v.file.name}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="operator-visit-date">{t("visitDate")}</Label>
          <Input
            id="operator-visit-date"
            type="date"
            max={today()}
            value={date}
            aria-invalid={future || undefined}
            onChange={(e) => setDate(e.target.value)}
          />
          {future && <p className="text-sm text-destructive">{t("visitFuture")}</p>}
        </div>
        <FileRow label={t("visitFile")} file={file} onSelect={setFile} />
        <div>
          <Button disabled={!date || future} onClick={send}>
            {t("visitAdd")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function NotesCard({ profileId, company }: { profileId: string; company: string }) {
  const t = useDictionary(texts);
  const format = useFormat();
  const state = useProto();
  const update = useProtoUpdate();
  const { organizationId, accountId } = useOperator();
  const [text, setText] = useState("");
  const notes = ownOrg(state.operatorNotes, organizationId)
    .filter((n) => n.profileId === profileId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const add = () => {
    const id = newId("opn");
    update(
      {
        action: "operator_note.create",
        subject: { type: "operator_note", id, label: company },
        summary: localized(texts, "auditNoteAdd"),
      },
      (draft) => {
        draft.operatorNotes.push({
          id,
          operatorOrgId: organizationId,
          authorId: accountId,
          profileId,
          text: text.trim(),
          createdAt: nowIso(),
        });
      },
    );
    setText("");
  };
  const remove = (id: string) =>
    update(
      {
        action: "operator_note.delete",
        subject: { type: "operator_note", id, label: company },
        summary: localized(texts, "auditNoteDelete"),
      },
      (draft) => {
        draft.operatorNotes = draft.operatorNotes.filter((n) => n.id !== id);
      },
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("notesTitle")}</CardTitle>
        <CardDescription>{t("notesHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {notes.length === 0 ? (
          <p className="text-muted-foreground">{t("noNotes")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((n) => (
              <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="whitespace-pre-wrap">{n.text}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("byOn", { name: accountName(state, n.authorId), date: format.dateTime(n.createdAt) })}
                  </span>
                </span>
                {/* Удаляет только автор, правок нет (OPR-23). */}
                {n.authorId === accountId && (
                  <ConfirmAction
                    label={t("noteDelete")}
                    variant="destructive"
                    size="sm"
                    title={t("noteDeleteTitle")}
                    description={n.text}
                    confirmLabel={t("noteDelete")}
                    onConfirm={() => remove(n.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        <Textarea
          aria-label={t("noteLabel")}
          placeholder={t("noteLabel")}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div>
          <Button disabled={!text.trim()} onClick={add}>
            {t("noteAdd")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
