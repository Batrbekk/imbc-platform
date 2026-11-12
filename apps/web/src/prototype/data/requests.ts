import type { ProfileSection } from "@imbc/contracts";

import { ACCOUNT } from "./accounts";
import type { RequestStatus, ThreadMessage } from "./common";
import { ORG } from "./organizations";

/**
 * IMBC request (OPR-25, IMBC-17): сообщение оператора сотрудникам IMBC, производитель не видит.
 * Первое сообщение переписки — от отправителя, ответы SME — следом.
 */
export interface ImbcRequest {
  id: string;
  operatorOrgId: string;
  senderId: string;
  subject: string;
  profileId: string | null;
  status: RequestStatus;
  createdAt: string;
  messages: ThreadMessage[];
}

/**
 * Operator request (OPR-27…OPR-30): запрос данных у производителя по секции или свободным текстом,
 * один ответ. Производитель не узнаёт, какой оператор спросил (OPR-28, GEN-11).
 */
export interface OperatorRequest {
  id: string;
  operatorOrgId: string;
  senderId: string;
  profileId: string;
  section: ProfileSection | null;
  text: string;
  createdAt: string;
  reply: { text: string; at: string; authorId: string } | null;
  status: RequestStatus;
}

export const imbcRequests: ImbcRequest[] = [
  {
    id: "ir-01",
    operatorOrgId: ORG.operatorDemo,
    senderId: ACCOUNT.operator,
    subject: "Сертификаты ISO у производителя арматуры",
    profileId: "p02",
    status: "open",
    createdAt: "2026-11-11T10:00:00+05:00",
    messages: [
      {
        id: "ir-01-m1",
        authorId: ACCOUNT.operator,
        at: "2026-11-11T10:00:00+05:00",
        text: "Подтвердите, пожалуйста, что ISO 45001 у компании действующий.",
      },
    ],
  },
  {
    id: "ir-02",
    operatorOrgId: ORG.operatorDemo,
    senderId: ACCOUNT.operator2,
    subject: "Сроки site survey",
    profileId: "p06",
    status: "closed",
    createdAt: "2026-10-10T09:00:00+05:00",
    messages: [
      {
        id: "ir-02-m1",
        authorId: ACCOUNT.operator2,
        at: "2026-10-10T09:00:00+05:00",
        text: "Планирует ли IMBC визит на насосный завод в октябре?",
      },
      {
        id: "ir-02-m2",
        authorId: ACCOUNT.expert,
        at: "2026-10-11T15:00:00+05:00",
        text: "Да, визит 15 октября. Отчёт появится на странице компании.",
      },
    ],
  },
  {
    id: "ir-03",
    operatorOrgId: ORG.operatorB,
    senderId: ACCOUNT.operatorB,
    subject: "Новые производители группы E",
    profileId: null,
    status: "open",
    createdAt: "2026-11-09T12:00:00+05:00",
    messages: [
      {
        id: "ir-03-m1",
        authorId: ACCOUNT.operatorB,
        at: "2026-11-09T12:00:00+05:00",
        text: "Есть ли в очереди проверки производители спецодежды?",
      },
    ],
  },
];

export const operatorRequests: OperatorRequest[] = [
  {
    id: "or-01",
    operatorOrgId: ORG.operatorDemo,
    senderId: ACCOUNT.operator,
    profileId: "p01",
    section: "certificates",
    text: "Пришлите, пожалуйста, актуальный ISO 14001.",
    createdAt: "2026-10-20T10:00:00+05:00",
    reply: {
      text: "Сертификат обновлён в профиле, действует до 2028 года.",
      at: "2026-10-21T09:00:00+05:00",
      authorId: ACCOUNT.manufacturer,
    },
    status: "closed",
  },
  {
    id: "or-02",
    operatorOrgId: ORG.operatorDemo,
    senderId: ACCOUNT.operator2,
    profileId: "p01",
    section: null,
    text: "Какой максимальный пролёт модульных конструкций вы изготавливаете?",
    createdAt: "2026-11-10T11:00:00+05:00",
    reply: null,
    status: "open",
  },
  {
    id: "or-03",
    operatorOrgId: ORG.operatorB,
    senderId: ACCOUNT.operatorB,
    profileId: "p01",
    section: "production",
    text: "Уточните загрузку цехов на первый квартал.",
    createdAt: "2026-11-11T15:00:00+05:00",
    reply: null,
    status: "open",
  },
  {
    id: "or-04",
    operatorOrgId: ORG.operatorB,
    senderId: ACCOUNT.operatorB,
    profileId: "p02",
    section: "products",
    text: "Есть ли арматура для кислых сред?",
    createdAt: "2026-10-25T10:00:00+05:00",
    reply: {
      text: "Да, исполнение для кислых сред — по запросу.",
      at: "2026-10-27T10:00:00+05:00",
      authorId: "acc-org-m02",
    },
    status: "closed",
  },
];
