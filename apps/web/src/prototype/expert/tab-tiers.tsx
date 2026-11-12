// Тиры профиля и AGAR/CDP на продуктовых линиях: tier 1 — Verified, tier 2 — site surveyed, tier 3 — продукт со
// статусом report issued и дальше; новая работа — AGAR; requested — только по запросу производителя; статус,
// отчёт и комментарий ставит SME (IMBC-19, IMBC-20, IMBC-21, IMBC-23, IMBC-24, IMBC-25, IMBC-26).
import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmAction, FileRow, TierBadge } from "@/prototype/components";
import type { FileRef, ProductLine, ProtoProfile, TierRecord } from "@/prototype/data";
import { AGAR_STATUSES } from "@/prototype/data/tier-records";
import { translate, useDictionary } from "@/prototype/i18n";
import { commonTexts, useCommonTexts } from "@/prototype/labels";
import { profileTier } from "@/prototype/rules";
import { newId, nowIso, useProto, useProtoUpdate } from "@/prototype/store";

import { useExpertId } from "./actor";
import { TierRecordsList } from "./dossier";
import { summaryOf } from "./summary";
import { texts } from "./texts";

export function TiersTab({ profile }: { profile: ProtoProfile }) {
  const t = useDictionary(texts);
  const state = useProto();
  const records = state.tierRecords.filter((r) => r.profileId === profile.id);
  const verified = profile.status === "verified";
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span>{t("profileTier")}</span>
            <TierBadge tier={profileTier(state, profile)} />
          </div>
          <p className="text-xs text-muted-foreground">{verified ? t("tierRule") : t("tierNotVerified")}</p>
          <p className="text-xs text-muted-foreground">{t("agarOperatorsHint")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("agarTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <TierRecordsList
            profile={profile}
            records={records}
            readOnly={!verified}
            productAction={(product, record) => <RecordAction profile={profile} product={product} record={record} />}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/** Следующий статус по порядку IMBC-24; без записи — включение в шорт-лист без запроса (AGAR). */
function RecordAction({
  profile,
  product,
  record,
}: {
  profile: ProtoProfile;
  product: ProductLine;
  record: TierRecord | undefined;
}) {
  const t = useDictionary(texts);
  const common = useCommonTexts();
  const me = useExpertId();
  const update = useProtoUpdate();
  const [comment, setComment] = useState(record?.comment ?? "");
  const [report, setReport] = useState<FileRef | null>(record?.report ?? null);
  const next = record ? AGAR_STATUSES[AGAR_STATUSES.indexOf(record.status) + 1] : "shortlisted";
  if (!next) return null;
  // Report issued — это выпущенный отчёт: без файла статус не ставится (IMBC-21).
  const needsReport = AGAR_STATUSES.indexOf(next) >= AGAR_STATUSES.indexOf("report_issued") && !report;
  const label = record ? t("moveTo", { status: common(`agar.${next}`) }) : t("shortlist");
  return (
    <ConfirmAction
      size="sm"
      variant="outline"
      label={<span aria-label={`${label}: ${product.nameRu}`}>{label}</span>}
      title={`${label}: ${product.nameRu}`}
      description={record ? t(`kindHint.${record.kind}`) : t("shortlistHint")}
      confirmDisabled={needsReport}
      onConfirm={() => {
        const id = record?.id ?? newId("agar");
        update(
          {
            action: record ? "tier_record.status" : "tier_record.create",
            subject: { type: "tier_record", id, label: `${profile.nameRu} · ${product.nameRu}` },
            summary: summaryOf(texts, "auditTierStatus", (l) => ({
              status: translate(commonTexts, l, `agar.${next}`),
            })),
          },
          (draft) => {
            const at = nowIso();
            const existing = draft.tierRecords.find((r) => r.id === id);
            if (existing) {
              existing.status = next;
              existing.report = report;
              existing.comment = comment.trim() || null;
              existing.updatedAt = at;
              existing.updatedBy = me;
            } else {
              draft.tierRecords.push({
                id,
                profileId: profile.id,
                productId: product.id,
                kind: "agar",
                status: next,
                report,
                comment: comment.trim() || null,
                requestedByManufacturer: false,
                updatedAt: at,
                updatedBy: me,
              });
            }
          },
        );
      }}
    >
      <div className="flex flex-col gap-3">
        <FileRow label={t("tierReportFile")} file={report} onSelect={setReport} />
        {needsReport && <p className="text-xs text-muted-foreground">{t("reportNeeded")}</p>}
        <Textarea
          aria-label={t("tierComment")}
          placeholder={t("tierComment")}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
    </ConfirmAction>
  );
}
