import type { AccountState, Role } from "@imbc/contracts";

import { MANUFACTURERS, ORG } from "./organizations";

/** Аккаунт (раздел 9.1): организация, email, имя, роль, состояние, последний вход (ADM-02). */
export interface ProtoAccount {
  id: string;
  organizationId: string;
  email: string;
  fullName: string;
  role: Role;
  state: AccountState;
  lastSignInAt: string | null;
  invitedAt: string;
}

/**
 * Аккаунты демо-сеансов — те же адреса, что в seed и realm-файле Keycloak: по email сеанса
 * прототип находит «себя» (`useActor` в `store.ts`). Остальные — вымышленные, на `.demo.local`.
 */
export const ACCOUNT = {
  expert: "acc-expert",
  expert2: "acc-expert-2",
  administrator: "acc-admin",
  director: "acc-director",
  operator: "acc-operator",
  operator2: "acc-operator-2",
  operatorB: "acc-operator-b",
  operatorC: "acc-operator-c",
  observer: "acc-observer",
  observer2: "acc-observer-2",
  manufacturer: "acc-manufacturer",
} as const;

const seen = (day: number, hour = 10) =>
  `2026-11-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:15:00+05:00`;

export const accounts: ProtoAccount[] = [
  {
    id: ACCOUNT.expert,
    organizationId: ORG.imbc,
    email: "expert@imbc.local",
    fullName: "Эксперт IMBC",
    role: "expert",
    state: "active",
    lastSignInAt: seen(12, 9),
    invitedAt: "2026-09-01T09:00:00+05:00",
  },
  {
    id: ACCOUNT.expert2,
    organizationId: ORG.imbc,
    email: "madina.erzhanova@imbc.demo.local",
    fullName: "Мадина Ержанова",
    role: "expert",
    state: "active",
    lastSignInAt: seen(10),
    invitedAt: "2026-09-01T09:00:00+05:00",
  },
  {
    id: ACCOUNT.administrator,
    organizationId: ORG.imbc,
    email: "admin@imbc.local",
    fullName: "Администратор IMBC",
    role: "administrator",
    state: "active",
    lastSignInAt: seen(11),
    invitedAt: "2026-09-01T09:00:00+05:00",
  },
  {
    id: ACCOUNT.director,
    organizationId: ORG.imbc,
    email: "director@imbc.local",
    fullName: "Директор IMBC",
    role: "director",
    state: "active",
    lastSignInAt: seen(9),
    invitedAt: "2026-09-01T09:00:00+05:00",
  },
  {
    id: ACCOUNT.operator,
    organizationId: ORG.operatorDemo,
    email: "operator@operator.local",
    fullName: "Специалист оператора",
    role: "operator",
    state: "active",
    lastSignInAt: seen(12, 8),
    invitedAt: "2026-09-02T09:00:00+05:00",
  },
  {
    id: ACCOUNT.operator2,
    organizationId: ORG.operatorDemo,
    email: "arman.bekov@operator.demo.local",
    fullName: "Арман Беков",
    role: "operator",
    state: "active",
    lastSignInAt: seen(6),
    invitedAt: "2026-09-02T09:00:00+05:00",
  },
  {
    id: ACCOUNT.operatorB,
    organizationId: ORG.operatorB,
    email: "zhanar.imanova@operator-b.demo.local",
    fullName: "Жанар Иманова",
    role: "operator",
    state: "active",
    lastSignInAt: seen(11, 14),
    invitedAt: "2026-09-03T09:00:00+05:00",
  },
  {
    id: ACCOUNT.operatorC,
    organizationId: ORG.operatorC,
    email: "dauren.mukashev@operator-c.demo.local",
    fullName: "Даурен Мукашев",
    role: "operator",
    state: "invited",
    lastSignInAt: null,
    invitedAt: "2026-11-10T11:00:00+05:00",
  },
  {
    id: ACCOUNT.observer,
    organizationId: ORG.observerDemo,
    email: "observer@observer.local",
    fullName: "Наблюдатель",
    role: "observer",
    state: "active",
    lastSignInAt: seen(8),
    invitedAt: "2026-09-02T09:00:00+05:00",
  },
  {
    id: ACCOUNT.observer2,
    organizationId: ORG.observerDemo,
    email: "lyazzat.omarova@observer.demo.local",
    fullName: "Ляззат Омарова",
    role: "observer",
    state: "blocked",
    lastSignInAt: "2026-10-01T10:00:00+05:00",
    invitedAt: "2026-09-02T09:00:00+05:00",
  },
  // Один аккаунт на производителя (GEN-01): вход — почтовый ящик компании. Перенесённые
  // «Пример Кабель» и «Степь Пластик» ещё не приглашены — аккаунтов нет (ADM-04, `migration.ts`).
  ...MANUFACTURERS.filter((m) => m.id !== "org-m03" && m.id !== "org-m07").map((m) => {
    const n = Number(m.id.slice(-2));
    return {
      id: n === 1 ? ACCOUNT.manufacturer : `acc-${m.id}`,
      organizationId: m.id,
      email: n === 1 ? "manufacturer@demo.local" : `account@company${n}.demo.local`,
      fullName: m.name,
      role: "manufacturer" as const,
      state: "active" as AccountState,
      lastSignInAt: seen(n, 11),
      invitedAt: `2026-${n <= 8 ? "09" : "11"}-${String(2 + n).padStart(2, "0")}T10:00:00+05:00`,
    };
  }),
];
