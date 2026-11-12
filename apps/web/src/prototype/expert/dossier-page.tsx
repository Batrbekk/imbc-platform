// Досье профиля для SME — центральный экран кабинета: секции и решения (REV-02, REV-05…REV-09), due diligence
// (IMBC-07…IMBC-14), site survey (IMBC-01…IMBC-04), тиры и AGAR (IMBC-19…IMBC-26), внешние проверки (EXT-01…EXT-04),
// заметки IMBC (IMBC-15), операторы (IMBC-16, IMBC-18). Вкладка — в адресе (`?tab=`), не в хранилище.
import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFormat } from "@/i18n/format";
import { DueDiligenceBadge, ProfileStatusBadge, ProtoPage, TierBadge, UpdateStatusBadge } from "@/prototype/components";
import { localized, useDictionary } from "@/prototype/i18n";
import { accountName, ddResult, isVisible, profileTier } from "@/prototype/rules";
import { getProtoState, useProto, useProtoUpdate } from "@/prototype/store";

import { useExpertId } from "./actor";
import { FieldItem, Fields } from "./dossier/parts";
import { DOSSIER_TABS, type DossierTab, expertPath, isDossierTab } from "./paths";
import { inQueue, receivedAt } from "./review";
import { ChecksTab } from "./tab-checks";
import { DueDiligenceTab } from "./tab-due-diligence";
import { NotesTab } from "./tab-notes";
import { OperatorsTab } from "./tab-operators";
import { ReviewTab } from "./tab-review";
import { SiteSurveyTab } from "./tab-site-survey";
import { TiersTab } from "./tab-tiers";
import { texts } from "./texts";

export function DossierScreen() {
  const { profileId = "" } = useParams();
  const t = useDictionary(texts);
  const format = useFormat();
  const me = useExpertId();
  const update = useProtoUpdate();
  const state = useProto();
  const profile = state.profiles.find((p) => p.id === profileId);
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: DossierTab = isDossierTab(raw) ? raw : "review";

  // REV-02: назначенный SME открыл профиль — статус Under review. Проверяется свежее состояние,
  // поэтому повторный вызов эффекта второго события не пишет.
  const opensReview = profile?.status === "submitted" && profile.assignedExpertId === me;
  useEffect(() => {
    if (!opensReview) return;
    const current = getProtoState().profiles.find((p) => p.id === profileId);
    if (current?.status !== "submitted" || current.assignedExpertId !== me) return;
    update(
      {
        action: "profile.open_review",
        subject: { type: "profile", id: current.id, label: current.nameRu },
        summary: localized(texts, "auditOpenReview"),
      },
      (draft) => {
        draft.profiles.find((p) => p.id === profileId)!.status = "under_review";
      },
    );
  }, [opensReview, profileId, me, update]);

  if (!profile) {
    return (
      <ProtoPage title={t("profileNotFound")}>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("profileNotFound")}</EmptyTitle>
            <EmptyDescription>{t("profileNotFoundHint")}</EmptyDescription>
          </EmptyHeader>
          <Link className={buttonVariants({ variant: "outline" })} to={expertPath("profiles")}>
            {t("backToProfiles")}
          </Link>
        </Empty>
      </ProtoPage>
    );
  }

  const dd = ddResult(state, profile.id);
  const tier = profileTier(state, profile);
  const canTake = profile.assignedExpertId === null && inQueue(profile);
  const take = () =>
    update(
      {
        action: "profile.take",
        subject: { type: "profile", id: profile.id, label: profile.nameRu },
        summary: localized(texts, "auditTake"),
      },
      (draft) => {
        draft.profiles.find((p) => p.id === profile.id)!.assignedExpertId = me;
      },
    );

  return (
    <ProtoPage
      title={profile.nameRu}
      description={t("dossierHint", { bin: profile.bin, name: profile.nameEn })}
      actions={
        <>
          <Link className={buttonVariants({ variant: "outline" })} to={expertPath("profiles")}>
            {t("backToProfiles")}
          </Link>
          {canTake && <Button onClick={take}>{t("take")}</Button>}
        </>
      }
    >
      <Card>
        <CardContent>
          <Fields>
            <FieldItem label={t("status")}>
              <ProfileStatusBadge status={profile.status} pendingChanges={profile.pendingChanges} />
            </FieldItem>
            <FieldItem label={t("assignedSme")}>
              {profile.assignedExpertId ? accountName(state, profile.assignedExpertId) : t("unassigned")}
            </FieldItem>
            <FieldItem label={t("received")}>{format.date(receivedAt(profile))}</FieldItem>
            <FieldItem label={t("updateStatus")}>
              {profile.updateStatus ? <UpdateStatusBadge status={profile.updateStatus} /> : t("none")}
            </FieldItem>
            <FieldItem label={t("tier")}>
              <TierBadge tier={tier} />
            </FieldItem>
            <FieldItem label={t("dueDiligence")}>{dd ? <DueDiligenceBadge result={dd} /> : t("none")}</FieldItem>
            <FieldItem label={t("visibleToOperators")}>
              {isVisible(state, profile)
                ? t("visibleYes")
                : profile.status !== "verified"
                  ? t("visibleNoStatus")
                  : t("visibleNoRed")}
            </FieldItem>
            <FieldItem label={t("heardAbout")}>{profile.heardAbout}</FieldItem>
          </Fields>
        </CardContent>
      </Card>

      <Tabs
        value={tab}
        onValueChange={(value) =>
          setParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              if (value === "review") next.delete("tab");
              else next.set("tab", String(value));
              return next;
            },
            { replace: true },
          )
        }
      >
        <div className="max-w-full overflow-x-auto pb-1">
          <TabsList>
            {DOSSIER_TABS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {t(`tab.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="review">
          <ReviewTab profile={profile} />
        </TabsContent>
        <TabsContent value="due-diligence">
          <DueDiligenceTab profile={profile} />
        </TabsContent>
        <TabsContent value="site-survey">
          <SiteSurveyTab profile={profile} />
        </TabsContent>
        <TabsContent value="tiers">
          <TiersTab profile={profile} />
        </TabsContent>
        <TabsContent value="checks">
          <ChecksTab profile={profile} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesTab profile={profile} />
        </TabsContent>
        <TabsContent value="operators">
          <OperatorsTab profile={profile} />
        </TabsContent>
      </Tabs>
    </ProtoPage>
  );
}
