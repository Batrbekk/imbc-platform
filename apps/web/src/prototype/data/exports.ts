import { ACCOUNT } from "./accounts";
import { ORG } from "./organizations";

/** Выгрузка результатов поиска (OPR-14, DATA-09): видна своей организации (GEN-12). */
export interface ExportRecord {
  id: string;
  operatorOrgId: string;
  userId: string;
  at: string;
  format: "xlsx" | "csv";
  rows: number;
  /** Фильтры поиска в виде строки адреса каталога, например `group=B&surveyed=true`. */
  filters: string;
}

/** Подписка на выгрузку (OPR-15…OPR-17), Release 2: только своя. */
export interface ExportSubscription {
  id: string;
  operatorOrgId: string;
  userId: string;
  name: string;
  filters: string;
  format: "xlsx" | "csv";
  period: "daily" | "weekly" | "monthly";
  paused: boolean;
  createdAt: string;
  files: { at: string; rows: number; ok: boolean }[];
}

export const exportRecords: ExportRecord[] = [
  {
    id: "exp-01",
    operatorOrgId: ORG.operatorDemo,
    userId: ACCOUNT.operator,
    at: "2026-11-04T10:00:00+05:00",
    format: "xlsx",
    rows: 9,
    filters: "group=B",
  },
  {
    id: "exp-02",
    operatorOrgId: ORG.operatorDemo,
    userId: ACCOUNT.operator2,
    at: "2026-11-10T15:00:00+05:00",
    format: "csv",
    rows: 4,
    filters: "region=KZ-ATY&surveyed=true",
  },
  {
    id: "exp-03",
    operatorOrgId: ORG.operatorB,
    userId: ACCOUNT.operatorB,
    at: "2026-11-08T11:00:00+05:00",
    format: "xlsx",
    rows: 10,
    filters: "",
  },
];

export const exportSubscriptions: ExportSubscription[] = [
  {
    id: "sub-01",
    operatorOrgId: ORG.operatorDemo,
    userId: ACCOUNT.operator,
    name: "Арматура, еженедельно",
    filters: "group=B",
    format: "xlsx",
    period: "weekly",
    paused: false,
    createdAt: "2026-10-20T10:00:00+05:00",
    files: [
      { at: "2026-10-27T07:00:00+05:00", rows: 8, ok: true },
      { at: "2026-11-03T07:00:00+05:00", rows: 9, ok: true },
      { at: "2026-11-10T07:00:00+05:00", rows: 0, ok: false },
    ],
  },
  {
    id: "sub-02",
    operatorOrgId: ORG.operatorB,
    userId: ACCOUNT.operatorB,
    name: "Все производители, ежемесячно",
    filters: "",
    format: "csv",
    period: "monthly",
    paused: true,
    createdAt: "2026-10-01T10:00:00+05:00",
    files: [{ at: "2026-11-01T07:00:00+05:00", rows: 10, ok: true }],
  },
];
