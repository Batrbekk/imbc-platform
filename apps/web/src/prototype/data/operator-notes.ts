import { ACCOUNT } from "./accounts";
import { ORG } from "./organizations";

/**
 * Заметка оператора (OPR-22, OPR-23): видят все аккаунты своей организации, SME и директор IMBC;
 * другие операторы, наблюдатели и производитель — нет (GEN-12). Удаляет только автор, правок нет.
 */
export interface OperatorNote {
  id: string;
  operatorOrgId: string;
  authorId: string;
  profileId: string;
  text: string;
  createdAt: string;
}

export const operatorNotes: OperatorNote[] = [
  {
    id: "opn-01",
    operatorOrgId: ORG.operatorDemo,
    authorId: ACCOUNT.operator,
    profileId: "p01",
    text: "Поставляли модульные конструкции для склада, сроки соблюдены.",
    createdAt: "2026-10-05T12:00:00+05:00",
  },
  {
    id: "opn-02",
    operatorOrgId: ORG.operatorDemo,
    authorId: ACCOUNT.operator2,
    profileId: "p01",
    text: "Готовы к аудиту поставщика в декабре.",
    createdAt: "2026-11-02T09:30:00+05:00",
  },
  {
    id: "opn-03",
    operatorOrgId: ORG.operatorDemo,
    authorId: ACCOUNT.operator,
    profileId: "p02",
    text: "Запросить сроки изготовления арматуры DN150.",
    createdAt: "2026-11-11T09:10:00+05:00",
  },
  {
    id: "opn-04",
    operatorOrgId: ORG.operatorB,
    authorId: ACCOUNT.operatorB,
    profileId: "p01",
    text: "Своя заметка организации Б: интерес к сварным конструкциям.",
    createdAt: "2026-10-07T14:00:00+05:00",
  },
  {
    id: "opn-05",
    operatorOrgId: ORG.operatorB,
    authorId: ACCOUNT.operatorB,
    profileId: "p06",
    text: "Насосы прошли входной контроль организации Б.",
    createdAt: "2026-10-18T11:00:00+05:00",
  },
];
