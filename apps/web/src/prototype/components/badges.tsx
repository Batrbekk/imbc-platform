import type { DocumentStatus, MarkState, ProfileStatus, ProfileTier, UpdateStatus } from "@imbc/contracts";
import { cn } from "cn";

import { Badge } from "@/components/ui/badge";

import type { AgarStatus } from "../data/tier-records";
import type { DdResult } from "../data/due-diligence";
import { useCommonTexts } from "../labels";

/** «Прототип» — на каждой странице прототипа (через `ProtoPage`). */
export function PrototypeBadge() {
  const t = useCommonTexts();
  return <Badge variant="secondary">{t("prototype")}</Badge>;
}

/** Возможность Release 2: прогноз спроса, STR и KTRE, подписки на выгрузку. */
export function Release2Badge() {
  const t = useCommonTexts();
  return <Badge variant="outline">{t("release2")}</Badge>;
}

/** Статус профиля (раздел 6.3) и отметка pending changes у Verified. */
export function ProfileStatusBadge({
  status,
  pendingChanges = false,
}: {
  status: ProfileStatus;
  pendingChanges?: boolean;
}) {
  const t = useCommonTexts();
  const variant =
    status === "verified"
      ? "default"
      : status === "returned"
        ? "destructive"
        : status === "draft"
          ? "outline"
          : "secondary";
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge variant={variant}>{t(`profileStatus.${status}`)}</Badge>
      {pendingChanges && <Badge variant="outline">{t("pendingChanges")}</Badge>}
    </span>
  );
}

/** Статус актуальности (UPD-06). */
export function UpdateStatusBadge({ status }: { status: UpdateStatus }) {
  const t = useCommonTexts();
  return <Badge variant={status === "active" ? "secondary" : "outline"}>{t(`updateStatus.${status}`)}</Badge>;
}

const DD_DOT: Record<DdResult, string> = { green: "bg-emerald-600", amber: "bg-amber-500", red: "bg-destructive" };

/** Итог due diligence (IMBC-11). Оператору и наблюдателю его не показывают (IMBC-09, OPR-12). */
export function DueDiligenceBadge({ result }: { result: DdResult }) {
  const t = useCommonTexts();
  return (
    <Badge variant="outline">
      <span aria-hidden className={cn("size-2 rounded-full", DD_DOT[result])} />
      {t(`dd.${result}`)}
    </Badge>
  );
}

/** Тир профиля (IMBC-19, IMBC-20) или продукта (`tier_3`, IMBC-21); null — без тира. */
export function TierBadge({ tier }: { tier: ProfileTier | "tier_3" | null }) {
  const t = useCommonTexts();
  return tier ? <Badge variant="secondary">{t(`tier.${tier}`)}</Badge> : <Badge variant="outline">{t("noTier")}</Badge>;
}

/** Статус документа или сертификата (раздел 6.3, MAN-46). */
export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const t = useCommonTexts();
  const variant =
    status === "verified" ? "secondary" : status === "rejected" || status === "expired" ? "destructive" : "outline";
  return <Badge variant={variant}>{t(`documentStatus.${status}`)}</Badge>;
}

/** Состояние отметки works-with (OPR-19, IMBC-16). */
export function MarkStateBadge({ state }: { state: MarkState }) {
  const t = useCommonTexts();
  const variant = state === "validated" ? "secondary" : state === "rejected" ? "destructive" : "outline";
  return <Badge variant={variant}>{t(`markState.${state}`)}</Badge>;
}

/** Статус AGAR или CDP (IMBC-24). */
export function AgarStatusBadge({ status }: { status: AgarStatus }) {
  const t = useCommonTexts();
  return <Badge variant="outline">{t(`agar.${status}`)}</Badge>;
}
