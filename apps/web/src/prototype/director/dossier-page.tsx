// Досье профиля для генерального директора IMBC — только чтение (GEN-04): секции и документы с решениями SME
// (REV-05, REV-06, REV-08), due diligence (IMBC-07, IMBC-08, IMBC-11, IMBC-13), site survey (IMBC-01, IMBC-02,
// IMBC-20), тиры, AGAR и CDP (IMBC-21, IMBC-23, IMBC-24), внешние проверки (EXT-01, EXT-04), заметки IMBC
// (IMBC-15), операторы (IMBC-16, IMBC-18, OPR-22). Части досье — из кабинета SME с `readOnly`. Вкладка — в адресе.
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFormat } from "@/i18n/format";
import { DueDiligenceBadge, ProfileStatusBadge, ProtoPage, TierBadge, UpdateStatusBadge } from "@/prototype/components";
import type { ProtoProfile } from "@/prototype/data";
import {
  DossierSections,
  DueDiligenceView,
  EnhancedDueDiligenceCard,
  ExternalChecksTable,
  ImbcNotesList,
  OperatorActivity,
  SiteSurveyList,
  TierRecordsList,
} from "@/prototype/expert/dossier";
// Чтение своих данных SME (`ext.expert`) с проверкой формы — тем же кодом, что у кабинета SME; без записи.
import { readExt } from "@/prototype/expert/ext";
import { useDictionary } from "@/prototype/i18n";
import { accountName, ddResult, isVisible, profileTier } from "@/prototype/rules";
import { useProto } from "@/prototype/store";

import { DOSSIER_TABS, directorPath, pick, useAddress } from "./paths";
import { texts } from "./texts";

export function DossierScreen() {
  const { profileId = "" } = useParams();
  const t = useDictionary(texts);
  const format = useFormat();
  const state = useProto();
  const { params, set } = useAddress();
  const profile = state.profiles.find((p) => p.id === profileId);
  const tab = pick(DOSSIER_TABS, params.get("tab"), "sections");

  if (!profile) {
    return (
      <ProtoPage hideReset title={t("profileNotFound")}>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("profileNotFound")}</EmptyTitle>
            <EmptyDescription>{t("profileNotFoundHint")}</EmptyDescription>
          </EmptyHeader>
          <Link className={buttonVariants({ variant: "outline" })} to={directorPath("profiles")}>
            {t("backToProfiles")}
          </Link>
        </Empty>
      </ProtoPage>
    );
  }

  const dd = ddResult(state, profile.id);
  const ndaVersion = state.ndaVersions.find((v) => v.id === profile.nda?.versionId);

  return (
    <ProtoPage
      hideReset
      title={profile.nameRu}
      description={
        <>
          <p>{t("dossierHint", { bin: profile.bin, name: profile.nameEn })}</p>
          <p>{t("readOnly")}</p>
        </>
      }
      actions={
        <Link className={buttonVariants({ variant: "outline" })} to={directorPath("profiles")}>
          {t("backToProfiles")}
        </Link>
      }
    >
      <Card>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Item label={t("status")}>
              <ProfileStatusBadge status={profile.status} pendingChanges={profile.pendingChanges} />
            </Item>
            <Item label={t("dueDiligence")}>{dd ? <DueDiligenceBadge result={dd} /> : t("none")}</Item>
            <Item label={t("tier")}>
              <TierBadge tier={profileTier(state, profile)} />
            </Item>
            <Item label={t("updateStatus")}>
              {profile.updateStatus ? <UpdateStatusBadge status={profile.updateStatus} /> : t("none")}
            </Item>
            <Item label={t("visibleToOperators")}>
              {isVisible(state, profile)
                ? t("visibleYes")
                : profile.status !== "verified"
                  ? t("visibleNoStatus")
                  : t("visibleNoRed")}
            </Item>
            <Item label={t("assignedSme")}>
              {profile.assignedExpertId ? accountName(state, profile.assignedExpertId) : t("unassigned")}
            </Item>
            <Item label={t("registeredAt")}>{format.date(profile.registeredAt)}</Item>
            <Item label={t("submittedAt")}>{profile.submittedAt ? format.date(profile.submittedAt) : t("none")}</Item>
            <Item label={t("verifiedAt")}>{profile.verifiedAt ? format.date(profile.verifiedAt) : t("none")}</Item>
            <Item label={t("origin")}>{t(`origin.${profile.origin}`)}</Item>
            <Item label={t("heardAbout")}>{profile.heardAbout}</Item>
            <Item label={t("nda")}>
              {profile.nda && ndaVersion
                ? t("ndaAccepted", { version: ndaVersion.version, date: format.dateTime(profile.nda.at) })
                : t("ndaNotAccepted")}
            </Item>
          </dl>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(value) => set("tab", String(value), "sections")}>
        <div className="max-w-full overflow-x-auto pb-1">
          <TabsList>
            {DOSSIER_TABS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {t(`tab.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="sections">
          <DossierSections profile={profile} readOnly />
        </TabsContent>
        <TabsContent value="due-diligence">
          <DueDiligenceTab profile={profile} />
        </TabsContent>
        <TabsContent value="site-survey">
          <SiteSurveyTab profile={profile} />
        </TabsContent>
        <TabsContent value="tiers">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t("profileTier")}:</span>
              <TierBadge tier={profileTier(state, profile)} />
              {profile.status !== "verified" && <span className="text-muted-foreground">{t("notVerifiedTier")}</span>}
            </div>
            <TierRecordsList
              profile={profile}
              records={state.tierRecords.filter((r) => r.profileId === profile.id)}
              readOnly
            />
          </div>
        </TabsContent>
        <TabsContent value="checks">
          <ExternalChecksTable checks={state.externalChecks.filter((c) => c.profileId === profile.id)} />
        </TabsContent>
        <TabsContent value="notes">
          <ImbcNotesList notes={state.imbcNotes.filter((n) => n.profileId === profile.id)} />
        </TabsContent>
        <TabsContent value="operators">
          <div className="flex flex-col gap-4">
            <div>
              <Link
                className={buttonVariants({ variant: "outline", size: "sm" })}
                to={`${directorPath("operators")}?q=${encodeURIComponent(profile.nameRu)}`}
              >
                {t("toOperators")}
              </Link>
            </div>
            <OperatorActivity profileId={profile.id} />
          </div>
        </TabsContent>
      </Tabs>
    </ProtoPage>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function DueDiligenceTab({ profile }: { profile: ProtoProfile }) {
  const t = useDictionary(texts);
  const state = useProto();
  const record = state.dueDiligence.find((d) => d.profileId === profile.id);
  if (!record) return <p className="text-sm text-muted-foreground">{t("ddMissing")}</p>;
  return (
    <div className="flex flex-col gap-4">
      <DueDiligenceView record={record} readOnly lineNotes={readExt(state).ddLineNotes} />
      <EnhancedDueDiligenceCard record={record} />
    </div>
  );
}

function SiteSurveyTab({ profile }: { profile: ProtoProfile }) {
  const t = useDictionary(texts);
  const format = useFormat();
  const state = useProto();
  const requests = state.siteSurveyRequests
    .filter((r) => r.profileId === profile.id)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  return (
    <div className="flex flex-col gap-4">
      <SiteSurveyList surveys={state.siteSurveys.filter((s) => s.profileId === profile.id)} readOnly />
      <Card>
        <CardHeader>
          <CardTitle>{t("surveyRequests")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {requests.length === 0 ? (
            <p className="text-muted-foreground">{t("surveyRequestsEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
                  <span>{t("requestedAt", { date: format.dateTime(r.requestedAt) })}</span>
                  <Badge variant={r.status === "open" ? "secondary" : "outline"}>
                    {t(`surveyRequest.${r.status}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
