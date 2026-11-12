import type { Locale, Role } from "@imbc/contracts";

import { ACCOUNT } from "./accounts";
import { ORG } from "./organizations";

/** Объект события журнала (AUD-01). */
export type AuditSubjectType =
  | "account"
  | "organization"
  | "api_credential"
  | "profile"
  | "section"
  | "document"
  | "due_diligence"
  | "site_survey"
  | "tier_record"
  | "imbc_note"
  | "external_check"
  | "works_with"
  | "visit"
  | "operator_note"
  | "imbc_request"
  | "operator_request"
  | "forecast"
  | "tech_file"
  | "reference"
  | "nda"
  | "export"
  | "subscription"
  | "notification";

/**
 * Событие журнала аудита (AUD-01): кто, организация, когда, объект, что изменилось. `summary` —
 * готовая фраза на трёх языках: журнал директора и администратора показывает её, не зная модуля.
 */
export interface AuditEvent {
  id: string;
  at: string;
  actor: { accountId: string | null; email: string; name: string; role: Role; organizationId: string | null };
  /** Код действия: `<объект>.<глагол>`, например `works_with.validate`. */
  action: string;
  subject: { type: AuditSubjectType; id: string; label: string };
  summary: Record<Locale, string>;
}

/** События аккаунтов — то, что видит администратор IMBC (AUD-03, раздел 4). */
export const ACCOUNT_EVENT_SUBJECTS: AuditSubjectType[] = ["account", "organization", "api_credential"];

export function isAccountEvent(event: AuditEvent): boolean {
  return ACCOUNT_EVENT_SUBJECTS.includes(event.subject.type);
}

type Actor = AuditEvent["actor"];
const admin: Actor = {
  accountId: ACCOUNT.administrator,
  email: "admin@imbc.local",
  name: "Администратор IMBC",
  role: "administrator",
  organizationId: ORG.imbc,
};
const expert: Actor = {
  accountId: ACCOUNT.expert,
  email: "expert@imbc.local",
  name: "Эксперт IMBC",
  role: "expert",
  organizationId: ORG.imbc,
};
const operator: Actor = {
  accountId: ACCOUNT.operator,
  email: "operator@operator.local",
  name: "Специалист оператора",
  role: "operator",
  organizationId: ORG.operatorDemo,
};
const manufacturer: Actor = {
  accountId: ACCOUNT.manufacturer,
  email: "manufacturer@demo.local",
  name: "ТОО «Демо Металл Конструкция»",
  role: "manufacturer",
  organizationId: "org-m01",
};

const event = (
  id: string,
  at: string,
  actor: Actor,
  action: string,
  subject: AuditEvent["subject"],
  summary: AuditEvent["summary"],
): AuditEvent => ({ id, at, actor, action, subject, summary });

/** Исходный журнал, от старых к новым. Новые события дописываются в конец. */
export const auditEvents: AuditEvent[] = [
  event(
    "au-01",
    "2026-09-01T09:30:00+05:00",
    admin,
    "organization.create",
    { type: "organization", id: ORG.operatorB, label: "Оператор Б (демо)" },
    {
      en: "Created operator organisation, marked as major operator",
      ru: "Создана организация оператора, отмечена как major operator",
      kk: "Оператор ұйымы құрылды, major operator белгісі қойылды",
    },
  ),
  event(
    "au-02",
    "2026-09-01T09:40:00+05:00",
    admin,
    "nda.publish",
    { type: "nda", id: "nda-1", label: "NDA 1.0" },
    { en: "Published NDA version 1.0", ru: "Опубликована версия NDA 1.0", kk: "NDA 1.0 нұсқасы жарияланды" },
  ),
  event(
    "au-03",
    "2026-09-13T10:00:00+05:00",
    manufacturer,
    "profile.submit",
    { type: "profile", id: "p01", label: "ТОО «Демо Металл Конструкция»" },
    { en: "Sent the profile for review", ru: "Профиль отправлен на проверку", kk: "Профиль тексеруге жіберілді" },
  ),
  event(
    "au-04",
    "2026-09-20T15:00:00+05:00",
    expert,
    "profile.verify",
    { type: "profile", id: "p01", label: "ТОО «Демо Металл Конструкция»" },
    { en: "Submitted result: Verified", ru: "Результат проверки: Verified", kk: "Тексеру нәтижесі: Verified" },
  ),
  event(
    "au-05",
    "2026-10-01T10:00:00+05:00",
    admin,
    "api_credential.issue",
    { type: "api_credential", id: "api-01", label: "Оператор (демо)" },
    {
      en: "Issued pull-API access to the operator organisation",
      ru: "Выдан доступ к pull API организации оператора",
      kk: "Оператор ұйымына pull API қолжетімділігі берілді",
    },
  ),
  event(
    "au-06",
    "2026-10-04T12:00:00+05:00",
    expert,
    "works_with.validate",
    { type: "works_with", id: "ww-01", label: "ТОО «Демо Металл Конструкция»" },
    { en: "Validated a works-with mark", ru: "Подтверждена отметка works-with", kk: "Works-with белгісі расталды" },
  ),
  event(
    "au-07",
    "2026-10-20T10:00:00+05:00",
    operator,
    "operator_request.send",
    { type: "operator_request", id: "or-01", label: "ТОО «Демо Металл Конструкция»" },
    { en: "Sent an operator request", ru: "Отправлен operator request", kk: "Operator request жіберілді" },
  ),
  event(
    "au-08",
    "2026-10-21T09:00:00+05:00",
    manufacturer,
    "operator_request.reply",
    { type: "operator_request", id: "or-01", label: "ТОО «Демо Металл Конструкция»" },
    {
      en: "Replied to an operator request",
      ru: "Дан ответ на operator request",
      kk: "Operator request-ке жауап берілді",
    },
  ),
  event(
    "au-09",
    "2026-11-01T09:00:00+05:00",
    admin,
    "nda.publish",
    { type: "nda", id: "nda-2", label: "NDA 2.0" },
    { en: "Published NDA version 2.0", ru: "Опубликована версия NDA 2.0", kk: "NDA 2.0 нұсқасы жарияланды" },
  ),
  event(
    "au-10",
    "2026-11-04T10:00:00+05:00",
    operator,
    "export.create",
    { type: "export", id: "exp-01", label: "XLSX, 9" },
    {
      en: "Exported search results (XLSX)",
      ru: "Выгружены результаты поиска (XLSX)",
      kk: "Іздеу нәтижелері жүктелді (XLSX)",
    },
  ),
  event(
    "au-11",
    "2026-11-06T09:00:00+05:00",
    admin,
    "forecast.publish",
    { type: "forecast", id: "fc-2026-11", label: "forecast-2026-11.xlsx" },
    { en: "Published the demand forecast", ru: "Опубликован прогноз спроса", kk: "Сұраныс болжамы жарияланды" },
  ),
  event(
    "au-12",
    "2026-11-10T11:00:00+05:00",
    admin,
    "account.invite",
    { type: "account", id: ACCOUNT.operatorC, label: "dauren.mukashev@operator-c.demo.local" },
    { en: "Invited an operator user", ru: "Приглашён пользователь оператора", kk: "Оператор пайдаланушысы шақырылды" },
  ),
  event(
    "au-13",
    "2026-11-11T16:00:00+05:00",
    { ...expert, accountId: ACCOUNT.expert2, email: "madina.erzhanova@imbc.demo.local", name: "Мадина Ержанова" },
    "profile.return",
    { type: "profile", id: "p10", label: "ТОО «Демо Агро Өнім»" },
    { en: "Submitted result: Returned", ru: "Результат проверки: Returned", kk: "Тексеру нәтижесі: Returned" },
  ),
  event(
    "au-14",
    "2026-11-12T09:00:00+05:00",
    admin,
    "account.block",
    { type: "account", id: ACCOUNT.observer2, label: "lyazzat.omarova@observer.demo.local" },
    { en: "Blocked an account", ru: "Аккаунт заблокирован", kk: "Аккаунт бұғатталды" },
  ),
  event(
    "au-15",
    "2026-11-12T10:00:00+05:00",
    expert,
    "profile.take",
    { type: "profile", id: "p11", label: "ТОО «Демо Электро Монтаж»" },
    { en: "Took the profile for review", ru: "Профиль взят в работу", kk: "Профиль жұмысқа алынды" },
  ),
];
