import { ACCOUNT } from "./accounts";
import { file, type FileRef } from "./common";

/** Статусы AGAR и CDP по порядку (IMBC-24). */
export const AGAR_STATUSES = [
  "requested",
  "shortlisted",
  "visit_done",
  "technical_assessment_done",
  "report_issued",
  "recommendations_in_progress",
  "recommendation_issued",
] as const;
export type AgarStatus = (typeof AGAR_STATUSES)[number];

/** AGAR или CDP на продуктовой линии (IMBC-23): один на продукт, без анкеты. */
export interface TierRecord {
  id: string;
  profileId: string;
  productId: string;
  kind: "agar" | "cdp";
  status: AgarStatus;
  report: FileRef | null;
  comment: string | null;
  /** Статус requested — только по запросу производителя (IMBC-24, IMBC-25). */
  requestedByManufacturer: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

/** Продукт — tier 3 со статуса report issued (IMBC-21). */
export function isTier3(record: Pick<TierRecord, "status">): boolean {
  return AGAR_STATUSES.indexOf(record.status) >= AGAR_STATUSES.indexOf("report_issued");
}

export const tierRecords: TierRecord[] = [
  {
    id: "agar-01",
    profileId: "p01",
    productId: "p01-pl1",
    kind: "agar",
    status: "report_issued",
    report: file("p01-agar-report.pdf", 1800, "2026-10-28T15:00:00+05:00"),
    comment: "Рекомендации в составе отчёта.",
    requestedByManufacturer: true,
    updatedAt: "2026-10-28T15:00:00+05:00",
    updatedBy: ACCOUNT.expert,
  },
  {
    id: "cdp-02",
    profileId: "p02",
    productId: "p02-pl1",
    kind: "cdp",
    status: "recommendation_issued",
    report: file("p02-cdp-report.pdf", 2100, "2025-12-10T15:00:00+05:00"),
    comment: "Завершённая CDP остаётся CDP (IMBC-23).",
    requestedByManufacturer: false,
    updatedAt: "2025-12-10T15:00:00+05:00",
    updatedBy: ACCOUNT.expert,
  },
  {
    id: "agar-06",
    profileId: "p06",
    productId: "p06-pl1",
    kind: "agar",
    status: "requested",
    report: null,
    comment: null,
    requestedByManufacturer: true,
    updatedAt: "2026-11-05T09:30:00+05:00",
    updatedBy: null,
  },
  {
    id: "agar-08",
    profileId: "p08",
    productId: "p08-pl1",
    kind: "agar",
    status: "shortlisted",
    report: null,
    comment: "IMBC включил продукт без запроса производителя.",
    requestedByManufacturer: false,
    updatedAt: "2026-11-02T12:00:00+05:00",
    updatedBy: ACCOUNT.expert2,
  },
];
