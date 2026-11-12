// Секция профиля на своём адресе: форма, полнота, статус, комментарий SME, блокировка.
// MAN-40, MAN-41, MAN-43, MAN-44, MAN-45, MAN-46.
import type { ProfileSection } from "@imbc/contracts";
import { ArrowLeftIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useFormat } from "@/i18n/format";

import type { ProfileSections, ProtoProfile } from "../data";
import { useDictionary } from "../i18n";
import { useCommonTexts } from "../labels";
import { protoPath } from "../registry";
import { useProto } from "../store";
import { useManufacturerActions } from "./actions";
import { CertificatesForm, DocumentsForm } from "./forms-documents";
import { ContactsForm, MainForm, PersonnelForm, ShareholdersForm } from "./forms-company";
import { ProductionForm, ProductsForm } from "./forms-products";
import { LockedContext } from "./locked";
import { currentSections, isLocked, isSection, sectionCompleteness, sectionState } from "./model";
import { ManufacturerPage } from "./page";
import { MissingList, SectionStateBadge } from "./parts";
import { texts } from "./texts";
import { useViewedProfile, useWithViewAs } from "./view-as";

export function SectionPage() {
  const t = useDictionary(texts);
  const { section } = useParams();
  const withViewAs = useWithViewAs();
  const back = (
    <div>
      <Link
        className={buttonVariants({ variant: "ghost", size: "sm" })}
        to={withViewAs(protoPath("manufacturer", "profile"))}
      >
        <ArrowLeftIcon />
        {t("back")}
      </Link>
    </div>
  );
  if (!isSection(section)) {
    return (
      <ManufacturerPage title={t("notFound")}>
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{t("notFoundHint")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{back}</EmptyContent>
        </Empty>
      </ManufacturerPage>
    );
  }
  return <SectionScreen section={section} back={back} />;
}

function SectionScreen({ section, back }: { section: ProfileSection; back: ReactNode }) {
  const t = useDictionary(texts);
  const common = useCommonTexts();
  const format = useFormat();
  const state = useProto();
  const { profile } = useViewedProfile();
  const actions = useManufacturerActions(profile);
  const [notice, setNotice] = useState<string | null>(null);
  const values = currentSections(profile);
  const completeness = sectionCompleteness(state, section, values);
  const review = profile.review[section];
  const locked = isLocked(profile);
  const verified = profile.status === "verified";

  const save = <S extends ProfileSection>(s: S, value: ProfileSections[S]) => {
    actions.saveSection(s, value);
    setNotice(verified ? t("savedPending") : t("saved"));
  };

  return (
    <ManufacturerPage title={`${common(`section.${section}`)} — ${profile.nameRu}`}>
      {back}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <SectionStateBadge state={sectionState(profile, section)} />
        <span className="tabular-nums">
          {completeness.percent === null
            ? t("optionalSection")
            : t("sectionCompleteness", { percent: format.number(completeness.percent) })}
        </span>
      </div>
      {review.decision === "rejected" && review.comment && (
        <Alert variant="destructive">
          <AlertTitle>{t("rejectedTitle")}</AlertTitle>
          <AlertDescription>{t("smeComment", { comment: review.comment })}</AlertDescription>
        </Alert>
      )}
      {locked && (
        <Alert>
          <AlertDescription>{t("lockedSection")}</AlertDescription>
        </Alert>
      )}
      {verified && !locked && (
        <Alert>
          <AlertDescription>{t("operatorsSeeVerified")}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <p role="status" className="text-sm font-medium">
          {notice}
        </p>
      )}
      {completeness.missing.length > 0 && !locked && <MissingList bySection={{ [section]: completeness }} />}
      <Card>
        <CardContent>
          <LockedContext value={locked}>
            {/* Ключ по журналу: после сохранения, сброса или смены профиля форма берёт значения заново. */}
            <SectionForm key={`${profile.id}:${state.audit.length}`} section={section} profile={profile} save={save} />
          </LockedContext>
        </CardContent>
      </Card>
    </ManufacturerPage>
  );
}

function SectionForm({
  section,
  profile,
  save,
}: {
  section: ProfileSection;
  profile: ProtoProfile;
  save: <S extends ProfileSection>(s: S, value: ProfileSections[S]) => void;
}) {
  const v = currentSections(profile);
  switch (section) {
    case "main":
      return <MainForm profile={profile} initial={v.main} onSave={(x) => save("main", x)} />;
    case "contacts":
      return <ContactsForm profile={profile} initial={v.contacts} onSave={(x) => save("contacts", x)} />;
    case "personnel":
      return <PersonnelForm profile={profile} initial={v.personnel} onSave={(x) => save("personnel", x)} />;
    case "shareholders":
      return <ShareholdersForm profile={profile} initial={v.shareholders} onSave={(x) => save("shareholders", x)} />;
    case "products":
      return <ProductsForm profile={profile} initial={v.products} onSave={(x) => save("products", x)} />;
    case "production":
      return <ProductionForm profile={profile} initial={v.production} onSave={(x) => save("production", x)} />;
    case "certificates":
      return <CertificatesForm profile={profile} initial={v.certificates} onSave={(x) => save("certificates", x)} />;
    case "documents":
      return <DocumentsForm profile={profile} initial={v.documents} onSave={(x) => save("documents", x)} />;
  }
}
