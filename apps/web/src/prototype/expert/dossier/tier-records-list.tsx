// AGAR и CDP по продуктовым линиям (IMBC-21, IMBC-23, IMBC-24): одна запись на продукт, статус, отчёт,
// комментарий; tier 3 — со статуса report issued. Только показ; действие по продукту передаёт экран.
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { useFormat } from "@/i18n/format";
import { AgarStatusBadge, FileRow, TierBadge } from "@/prototype/components";
import type { ProductLine, ProtoProfile, TierRecord } from "@/prototype/data";
import { isTier3 } from "@/prototype/data/tier-records";
import { useDictionary } from "@/prototype/i18n";
import { accountName } from "@/prototype/rules";
import { useProto } from "@/prototype/store";

import { FieldItem, Fields } from "./parts";
import { dossierTexts } from "./texts";

export function TierRecordsList({
  profile,
  records,
  readOnly = false,
  productAction,
}: {
  profile: ProtoProfile;
  records: TierRecord[];
  readOnly?: boolean;
  productAction?: (product: ProductLine, record: TierRecord | undefined) => ReactNode;
}) {
  const t = useDictionary(dossierTexts);
  const format = useFormat();
  const state = useProto();
  return (
    <ul className="flex flex-col gap-3">
      {profile.sections.products.map((product) => {
        const record = records.find((r) => r.productId === product.id);
        return (
          <li key={product.id} className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{product.nameRu}</span>
                <span className="font-mono text-xs text-muted-foreground">{product.tnved}</span>
                {record && isTier3(record) && <TierBadge tier="tier_3" />}
              </span>
              {!readOnly && productAction?.(product, record)}
            </div>
            {record ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{t(`kind.${record.kind}`)}</Badge>
                  <AgarStatusBadge status={record.status} />
                  {record.requestedByManufacturer && <Badge variant="outline">{t("requestedByManufacturer")}</Badge>}
                </div>
                <Fields>
                  <FieldItem label={t("updatedBy")}>
                    {record.updatedBy ? accountName(state, record.updatedBy) : t("manufacturer")},{" "}
                    {format.dateTime(record.updatedAt)}
                  </FieldItem>
                  {record.comment && <FieldItem label={t("comment")}>{record.comment}</FieldItem>}
                </Fields>
                <FileRow label={t("tierReport")} file={record.report} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noTierRecord")}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
