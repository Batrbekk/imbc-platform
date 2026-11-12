/**
 * Перенесённый производитель для «Пригласить всех перенесённых» (ADM-04, раздел 10): email из базы IMBC
 * и время приглашения. Без email или с неверным — в отчёт, письма нет (NOT-25). Аккаунт появляется
 * с приглашением: у «Пример Кабель» и «Степь Пластик» его ещё нет (`accounts.ts`).
 */
export interface MigrationInvite {
  id: string;
  organizationId: string;
  email: string | null;
  invitedAt: string | null;
}

export const migrationInvites: MigrationInvite[] = [
  {
    id: "mig-04",
    organizationId: "org-m04",
    email: "account@company4.demo.local",
    invitedAt: "2026-09-12T10:00:00+05:00",
  },
  { id: "mig-07", organizationId: "org-m07", email: "account@company7.demo.local", invitedAt: null },
  { id: "mig-03", organizationId: "org-m03", email: "info@@company3.demo.local", invitedAt: null },
];
