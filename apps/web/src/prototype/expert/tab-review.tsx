// Проверка профиля: решение по каждой секции и каждому документу и сертификату, комментарий — на секции,
// «Submit result» после решения по всем секциям; ожидающие изменения — только изменённые секции
// (REV-05, REV-06, REV-07, REV-08, REV-09, MAN-16, MAN-35, MAN-44, MAN-45, NOT-05, NOT-28).
import type { Locale, ProfileSection } from "@imbc/contracts";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useFormat } from "@/i18n/format";
import { ConfirmAction } from "@/prototype/components";
import type { ProfileDocument, ProtoProfile, ProtoState } from "@/prototype/data";
import { localized, translate, useDictionary } from "@/prototype/i18n";
import { commonTexts, useCommonTexts } from "@/prototype/labels";
import { accountName, ddResult } from "@/prototype/rules";
import { nowIso, useProto, useProtoUpdate } from "@/prototype/store";

import { useExpertId } from "./actor";
import { DossierSections, type ReviewItemRef } from "./dossier";
import { dossierTexts } from "./dossier/texts";
import {
  canSubmitResult,
  changesRoundStuck,
  isDecided,
  mandatoryCertificateTypes,
  resultOf,
  reviewItems,
  reviewMode,
  sectionsToDecide,
  verifyBlockers,
} from "./review";
import { closeStuckRound, decideChange, decideSectionFull, submitResult } from "./rounds";
import { summaryOf } from "./summary";
import { texts } from "./texts";

const profileIn = (draft: ProtoState, id: string) => draft.profiles.find((p) => p.id === id)!;

export function ReviewTab({ profile }: { profile: ProtoProfile }) {
  const t = useDictionary(texts);
  const common = useCommonTexts();
  const dt = useDictionary(dossierTexts);
  const docType = (type: ProfileDocument["type"]) => dt(`docType.${type}`);
  const format = useFormat();
  const me = useExpertId();
  const update = useProtoUpdate();
  const state = useProto();
  const mode = reviewMode(profile);
  const mine = profile.assignedExpertId === me;
  // Решает только назначенный SME; полная проверка — когда профиль открыт (Under review, REV-02).
  const canAct = mine && (mode === "changes" || profile.status === "under_review");
  const toDecide = sectionsToDecide(profile);
  const decided = toDecide.filter((s) => isDecided(profile, s)).length;
  const subject = { type: "profile" as const, id: profile.id, label: profile.nameRu };

  const decideSection = (section: ProfileSection, decision: "verified" | "rejected", comment: string | null) => {
    const label = common(`section.${section}`);
    const sectionIn = (l: Locale) => ({ section: translate(commonTexts, l, `section.${section}`) });
    const sectionSubject = {
      type: "section" as const,
      id: `${profile.id}:${section}`,
      label: `${profile.nameRu} · ${label}`,
    };
    if (mode === "changes") {
      update(
        {
          action: decision === "verified" ? "section.accept_change" : "section.reject_change",
          subject: sectionSubject,
          summary: summaryOf(texts, decision === "verified" ? "auditAcceptChange" : "auditRejectChange", sectionIn),
        },
        (draft) => decideChange(draft, profile.id, section, decision, comment, me, nowIso()),
      );
      return;
    }
    update(
      {
        action: decision === "verified" ? "section.verify" : "section.reject",
        subject: sectionSubject,
        summary: summaryOf(texts, decision === "verified" ? "auditVerifySection" : "auditRejectSection", sectionIn),
      },
      (draft) => decideSectionFull(draft, profile.id, section, decision, comment, me, nowIso()),
    );
  };

  const decideItem = (section: ProfileSection, item: ReviewItemRef, status: "verified" | "rejected") => {
    const name = itemLabel(profile, section, item, docType);
    update(
      {
        action: status === "verified" ? "document.verify" : "document.reject",
        subject: { type: "document", id: item.id, label: `${profile.nameRu} · ${name}` },
        summary: summaryOf(texts, status === "verified" ? "auditVerifyItem" : "auditRejectItem", (l) => ({
          item: itemLabel(profile, section, item, (type) => translate(dossierTexts, l, `docType.${type}`)),
        })),
      },
      (draft) => {
        const p = profileIn(draft, profile.id);
        const source =
          section === "certificates"
            ? (p.pending.certificates ?? p.sections.certificates)
            : (p.pending.documents ?? p.sections.documents);
        const target = (source as { id: string; status: string; comment?: string | null }[]).find(
          (i) => i.id === item.id,
        );
        if (target) {
          target.status = status;
          // Принятый документ теряет прежний комментарий отклонения.
          if (status === "verified" && "comment" in target) target.comment = null;
        }
        // Секция, уже принятая, снова ждёт решения: документ в ней изменил статус.
        if (p.review[section].decision === "verified" && mode === "full") {
          p.review[section] = { ...p.review[section], decision: null, decidedBy: null, decidedAt: null };
        }
      },
    );
  };

  const submit = () => {
    const result = resultOf(profile);
    update(
      {
        action: "profile.submit_result",
        subject,
        summary: localized(texts, result === "verified" ? "auditSubmitVerified" : "auditSubmitReturned"),
      },
      (draft) => submitResult(draft, profile.id, result, nowIso()),
    );
  };

  const closeRound = () =>
    update({ action: "profile.close_changes", subject, summary: localized(texts, "auditCloseRound") }, (draft) =>
      closeStuckRound(draft, profile, nowIso()),
    );

  const dd = ddResult(state, profile.id);
  const outcome = resultOf(profile);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("reviewTitle")}</CardTitle>
          <CardDescription>
            {mode === "full"
              ? t("reviewFull")
              : mode === "changes"
                ? t("reviewChanges")
                : t(`reviewNone.${profile.status}`)}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {mode && !mine && (
            <p className="text-sm text-muted-foreground">
              {profile.assignedExpertId
                ? t("reviewOther", { name: accountName(state, profile.assignedExpertId) })
                : t("reviewTakeFirst")}
            </p>
          )}
          {mode === "full" && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-sm">
                  {t("decidedCount", { done: format.number(decided), total: format.number(toDecide.length) })}
                </span>
                <Progress value={(decided / toDecide.length) * 100} aria-label={t("reviewTitle")} />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("mandatoryHint", {
                  types: mandatoryCertificateTypes(state)
                    .map((m) => m.label)
                    .join(", "),
                })}
              </p>
              {canAct && (
                <div>
                  <SubmitResult
                    profile={profile}
                    outcome={outcome}
                    redDueDiligence={dd === "red"}
                    disabled={!canSubmitResult(profile)}
                    onConfirm={submit}
                  />
                </div>
              )}
            </>
          )}
          {mode === "changes" && !changesRoundStuck(profile) && (
            <p className="text-sm">{t("changesLeft", { count: format.number(toDecide.length) })}</p>
          )}
          {changesRoundStuck(profile) && (
            <div className="flex flex-col gap-2">
              <p className="text-sm">{t("roundStuck")}</p>
              {mine && (
                <div>
                  <ConfirmAction
                    variant="outline"
                    label={t("closeRound")}
                    title={t("closeRoundTitle")}
                    description={t("closeRoundHint")}
                    confirmLabel={t("closeRound")}
                    onConfirm={closeRound}
                  />
                </div>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("noEditHint")}</p>
        </CardContent>
      </Card>

      <DossierSections
        profile={profile}
        readOnly={!canAct}
        sectionActions={(section) =>
          toDecide.includes(section) ? (
            <SectionActions
              profile={profile}
              section={section}
              changes={mode === "changes"}
              onDecide={(decision, comment) => decideSection(section, decision, comment)}
            />
          ) : null
        }
        itemActions={(section, item) =>
          toDecide.includes(section) ? (
            <ItemActions
              label={itemLabel(profile, section, item, docType)}
              onDecide={(status) => decideItem(section, item, status)}
            />
          ) : null
        }
      />
    </div>
  );
}

function itemLabel(
  profile: ProtoProfile,
  section: ProfileSection,
  item: ReviewItemRef,
  docType: (type: ProfileDocument["type"]) => string,
): string {
  const found = reviewItems(profile, section).find((i) => i.id === item.id);
  if (!found) return item.id;
  return "number" in found ? found.type : docType(found.type);
}

function SectionActions({
  profile,
  section,
  changes,
  onDecide,
}: {
  profile: ProtoProfile;
  section: ProfileSection;
  changes: boolean;
  onDecide: (decision: "verified" | "rejected", comment: string | null) => void;
}) {
  const t = useDictionary(texts);
  const common = useCommonTexts();
  const state = useProto();
  const [comment, setComment] = useState("");
  const blockers = verifyBlockers(state, profile, section);
  const name = common(`section.${section}`);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={blockers.length > 0}
          aria-label={t(changes ? "acceptChangeNamed" : "verifySectionNamed", { section: name })}
          onClick={() => onDecide("verified", null)}
        >
          {changes ? t("acceptChange") : t("verifySection")}
        </Button>
        <ConfirmAction
          size="sm"
          variant="outline"
          label={changes ? t("rejectChange") : t("rejectSection")}
          title={t("rejectTitle", { section: name })}
          description={t("rejectDescription")}
          confirmLabel={changes ? t("rejectChange") : t("rejectSection")}
          confirmDisabled={!comment.trim()}
          onConfirm={() => {
            onDecide("rejected", comment.trim());
            setComment("");
          }}
        >
          <Textarea
            aria-label={t("sectionComment")}
            placeholder={t("sectionComment")}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </ConfirmAction>
      </div>
      {blockers.map((b) => (
        <span key={b} className="text-xs text-muted-foreground">
          {t(`blocker.${b}`)}
        </span>
      ))}
    </div>
  );
}

function ItemActions({ label, onDecide }: { label: string; onDecide: (status: "verified" | "rejected") => void }) {
  const t = useDictionary(texts);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        aria-label={t("verifyItemNamed", { item: label })}
        onClick={() => onDecide("verified")}
      >
        {t("verifyItem")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label={t("rejectItemNamed", { item: label })}
        onClick={() => onDecide("rejected")}
      >
        {t("rejectItem")}
      </Button>
    </>
  );
}

function SubmitResult({
  profile,
  outcome,
  redDueDiligence,
  disabled,
  onConfirm,
}: {
  profile: ProtoProfile;
  outcome: "verified" | "returned";
  redDueDiligence: boolean;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const t = useDictionary(texts);
  const common = useCommonTexts();
  const [contacted, setContacted] = useState(false);
  const rejected = (Object.keys(profile.review) as ProfileSection[]).filter(
    (s) => profile.review[s].decision === "rejected",
  );
  return (
    <ConfirmAction
      label={t("submitResult")}
      title={t("submitTitle")}
      description={outcome === "verified" ? t("submitVerified") : t("submitReturned")}
      confirmLabel={t("submitResult")}
      disabled={disabled}
      confirmDisabled={outcome === "verified" && !contacted}
      onConfirm={onConfirm}
    >
      <div className="flex flex-col gap-3 text-sm">
        {outcome === "returned" && (
          <ul className="flex flex-col gap-1">
            {rejected.map((s) => (
              <li key={s}>
                <span className="font-medium">{common(`section.${s}`)}</span>: {profile.review[s].comment}
              </li>
            ))}
          </ul>
        )}
        {outcome === "verified" && redDueDiligence && (
          <Alert variant="destructive">
            <AlertDescription>{t("submitRedWarning")}</AlertDescription>
          </Alert>
        )}
        {outcome === "verified" && (
          <label className="flex items-start gap-2">
            <Checkbox
              checked={contacted}
              onCheckedChange={(checked) => setContacted(checked)}
              aria-label={t("contactedFocal")}
            />
            <span>{t("contactedFocal")}</span>
          </label>
        )}
        <p className="text-xs text-muted-foreground">{t("submitEmail")}</p>
      </div>
    </ConfirmAction>
  );
}
