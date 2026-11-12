// Восемь секций досье с решением SME по каждой (REV-05, REV-06, REV-08, MAN-44, MAN-46). Только показ:
// действия по секции и по документу передаёт экран, при `readOnly` они не рисуются.
import { PROFILE_SECTIONS, type ProfileSection } from "@imbc/contracts";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFormat } from "@/i18n/format";
import type { ProtoProfile, SectionReview } from "@/prototype/data";
import { useDictionary } from "@/prototype/i18n";
import { useCommonTexts } from "@/prototype/labels";
import { accountName } from "@/prototype/rules";
import { useProto } from "@/prototype/store";

import { type ReviewItemRef, SectionView } from "./section-view";
import { dossierTexts } from "./texts";

/** Решение по секции: принята, отклонена с комментарием, без решения; отметка «изменена». */
export function SectionReviewStatus({ review }: { review: SectionReview }) {
  const t = useDictionary(dossierTexts);
  const format = useFormat();
  const state = useProto();
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-wrap gap-1">
        <Badge
          variant={
            review.decision === "verified" ? "secondary" : review.decision === "rejected" ? "destructive" : "outline"
          }
        >
          {t(`decision.${review.decision ?? "none"}`)}
        </Badge>
        {review.changed && <Badge variant="outline">{t("changed")}</Badge>}
      </span>
      {review.decision && (
        <span className="text-xs text-muted-foreground">
          {t("decidedBy", { name: accountName(state, review.decidedBy), date: format.dateTime(review.decidedAt) })}
        </span>
      )}
      {review.comment && <p className="text-sm">{t("commentValue", { comment: review.comment })}</p>}
    </div>
  );
}

export function DossierSections({
  profile,
  readOnly = false,
  sections = PROFILE_SECTIONS,
  sectionActions,
  itemActions,
}: {
  profile: ProtoProfile;
  readOnly?: boolean;
  /** Какие секции показать; по умолчанию все восемь. */
  sections?: readonly ProfileSection[];
  sectionActions?: (section: ProfileSection) => ReactNode;
  itemActions?: (section: ProfileSection, item: ReviewItemRef) => ReactNode;
}) {
  const t = useDictionary(dossierTexts);
  const common = useCommonTexts();
  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => {
        const pending = profile.pending[section] !== undefined;
        const actions = readOnly ? null : sectionActions?.(section);
        return (
          <Card key={section} aria-labelledby={`section-${section}`}>
            <CardHeader>
              <CardTitle id={`section-${section}`}>{common(`section.${section}`)}</CardTitle>
              <CardDescription>
                <SectionReviewStatus review={profile.review[section]} />
              </CardDescription>
              {actions && <CardAction className="flex flex-wrap gap-2">{actions}</CardAction>}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {section === "production" && <p className="text-xs text-muted-foreground">{t("productionOptional")}</p>}
              {pending && (
                <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
                  <span className="text-sm font-medium">
                    {profile.review[section].changed ? t("pendingValues") : t("pendingRejected")}
                  </span>
                  <SectionView
                    profile={profile}
                    section={section}
                    source="pending"
                    readOnly={readOnly}
                    itemActions={itemActions && ((item) => itemActions(section, item))}
                  />
                </div>
              )}
              {pending && <span className="text-sm font-medium">{t("currentValues")}</span>}
              <SectionView
                profile={profile}
                section={section}
                readOnly={readOnly || pending}
                itemActions={itemActions && ((item) => itemActions(section, item))}
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
