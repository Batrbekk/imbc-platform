import type { MarkState } from "@imbc/contracts";

import { ACCOUNT } from "./accounts";
import { file, type FileRef } from "./common";
import { ORG } from "./organizations";

/**
 * Отметка works-with (IMBC-16, OPR-19): оператор ставит (`value: true`) или снимает (`false`),
 * изменение ждёт IMBC. Видят своя организация, SME и директор IMBC; производитель — никогда (GEN-11).
 */
export interface WorksWithMark {
  id: string;
  operatorOrgId: string;
  profileId: string;
  value: boolean;
  state: MarkState;
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

/** Отметка визита оператора (OPR-21, IMBC-04): решение IMBC видит только IMBC. */
export interface VisitMark {
  id: string;
  operatorOrgId: string;
  profileId: string;
  visitedOn: string;
  file: FileRef | null;
  decision: "waiting" | "accepted" | "rejected";
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

const decided = (at: string) => ({ decidedBy: ACCOUNT.expert, decidedAt: at });
const open = { decidedBy: null, decidedAt: null };

export const worksWithMarks: WorksWithMark[] = [
  {
    id: "ww-01",
    operatorOrgId: ORG.operatorDemo,
    profileId: "p01",
    value: true,
    state: "validated",
    createdBy: ACCOUNT.operator,
    createdAt: "2026-10-03T10:00:00+05:00",
    ...decided("2026-10-04T12:00:00+05:00"),
  },
  {
    id: "ww-02",
    operatorOrgId: ORG.operatorDemo,
    profileId: "p02",
    value: true,
    state: "waiting",
    createdBy: ACCOUNT.operator2,
    createdAt: "2026-11-11T09:00:00+05:00",
    ...open,
  },
  {
    id: "ww-03",
    operatorOrgId: ORG.operatorB,
    profileId: "p01",
    value: true,
    state: "validated",
    createdBy: ACCOUNT.operatorB,
    createdAt: "2026-10-05T10:00:00+05:00",
    ...decided("2026-10-06T12:00:00+05:00"),
  },
  {
    id: "ww-04",
    operatorOrgId: ORG.operatorB,
    profileId: "p06",
    value: true,
    state: "validated",
    createdBy: ACCOUNT.operatorB,
    createdAt: "2026-10-16T10:00:00+05:00",
    ...decided("2026-10-17T12:00:00+05:00"),
  },
  {
    id: "ww-05",
    operatorOrgId: ORG.operatorB,
    profileId: "p08",
    value: false,
    state: "waiting",
    createdBy: ACCOUNT.operatorB,
    createdAt: "2026-11-10T16:00:00+05:00",
    ...open,
  },
  {
    id: "ww-06",
    operatorOrgId: ORG.operatorB,
    profileId: "p03",
    value: true,
    state: "rejected",
    createdBy: ACCOUNT.operatorB,
    createdAt: "2026-10-20T10:00:00+05:00",
    ...decided("2026-10-21T12:00:00+05:00"),
  },
];

export const visitMarks: VisitMark[] = [
  {
    id: "visit-01",
    operatorOrgId: ORG.operatorDemo,
    profileId: "p01",
    visitedOn: "2026-10-01",
    file: file("operator-visit-p01.pdf", 540, "2026-10-02T10:00:00+05:00"),
    decision: "accepted",
    createdBy: ACCOUNT.operator,
    createdAt: "2026-10-02T10:00:00+05:00",
    ...decided("2026-10-03T12:00:00+05:00"),
  },
  {
    id: "visit-06",
    operatorOrgId: ORG.operatorDemo,
    profileId: "p06",
    visitedOn: "2026-11-05",
    file: file("operator-visit-p06.pdf", 610, "2026-11-06T10:00:00+05:00"),
    decision: "waiting",
    createdBy: ACCOUNT.operator2,
    createdAt: "2026-11-06T10:00:00+05:00",
    ...open,
  },
  {
    id: "visit-02",
    operatorOrgId: ORG.operatorB,
    profileId: "p02",
    visitedOn: "2026-11-07",
    file: null,
    decision: "waiting",
    createdBy: ACCOUNT.operatorB,
    createdAt: "2026-11-08T10:00:00+05:00",
    ...open,
  },
];
