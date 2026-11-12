import { ACCOUNT } from "./accounts";
import { ORG } from "./organizations";

/**
 * Доступ организации оператора к pull API (ADM-07, OPR-36…OPR-38). Значения — заведомо
 * ненастоящие: у прототипа нет API, ключ показывается только как образец.
 */
export interface ApiCredential {
  id: string;
  operatorOrgId: string;
  clientId: string;
  /** Образец ключа, не секрет. */
  secretSample: string;
  issuedAt: string;
  issuedBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

export const apiCredentials: ApiCredential[] = [
  {
    id: "api-01",
    operatorOrgId: ORG.operatorDemo,
    clientId: "demo-client-operator-0001",
    secretSample: "DEMO-NOT-A-SECRET-0001",
    issuedAt: "2026-10-01T10:00:00+05:00",
    issuedBy: ACCOUNT.administrator,
    revokedAt: null,
    revokedBy: null,
  },
  {
    id: "api-02",
    operatorOrgId: ORG.operatorB,
    clientId: "demo-client-operator-b-0001",
    secretSample: "DEMO-NOT-A-SECRET-0002",
    issuedAt: "2026-09-15T10:00:00+05:00",
    issuedBy: ACCOUNT.administrator,
    revokedAt: "2026-10-20T10:00:00+05:00",
    revokedBy: ACCOUNT.administrator,
  },
  {
    id: "api-03",
    operatorOrgId: ORG.operatorB,
    clientId: "demo-client-operator-b-0002",
    secretSample: "DEMO-NOT-A-SECRET-0003",
    issuedAt: "2026-10-20T10:05:00+05:00",
    issuedBy: ACCOUNT.administrator,
    revokedAt: null,
    revokedBy: null,
  },
];
