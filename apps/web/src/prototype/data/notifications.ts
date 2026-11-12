/**
 * Письма производителю (раздел 8.2). Входящих в платформе нет: прототип показывает журнал писем,
 * отправленных этому производителю. Текст письма собирает экран по `notId` и `params`.
 */
export type ManufacturerNotificationId = "NOT-05" | "NOT-06" | "NOT-12" | "NOT-13" | "NOT-15" | "NOT-16";

export interface ManufacturerNotification {
  id: string;
  profileId: string;
  notId: ManufacturerNotificationId;
  at: string;
  /** Кому ушло: аккаунт, focal point, все контакты (NOT-18). */
  recipients: ("account" | "focal_point" | "contacts")[];
  /** Подстановки письма: секция запроса, тип сертификата, срок. Оператор не называется (NOT-32). */
  params: Record<string, string>;
  read: boolean;
}

export const notifications: ManufacturerNotification[] = [
  {
    id: "n-01",
    profileId: "p01",
    notId: "NOT-05",
    at: "2026-09-20T15:00:00+05:00",
    recipients: ["account", "focal_point"],
    params: { result: "verified" },
    read: true,
  },
  {
    id: "n-02",
    profileId: "p01",
    notId: "NOT-13",
    at: "2026-10-20T10:00:00+05:00",
    recipients: ["contacts"],
    params: { requestId: "or-01", section: "certificates" },
    read: true,
  },
  {
    id: "n-03",
    profileId: "p01",
    notId: "NOT-13",
    at: "2026-11-10T11:00:00+05:00",
    recipients: ["contacts"],
    params: { requestId: "or-02" },
    read: false,
  },
  {
    id: "n-04",
    profileId: "p01",
    notId: "NOT-13",
    at: "2026-11-11T15:00:00+05:00",
    recipients: ["contacts"],
    params: { requestId: "or-03", section: "production" },
    read: false,
  },
  {
    id: "n-05",
    profileId: "p01",
    notId: "NOT-12",
    at: "2026-11-12T08:00:00+05:00",
    recipients: ["account", "focal_point"],
    params: { dueDate: "2026-11-19" },
    read: false,
  },
  // Сертификат истёк сегодня (NOT-06, REV-10).
  {
    id: "n-06",
    profileId: "p04",
    notId: "NOT-06",
    at: "2026-10-31T08:00:00+05:00",
    recipients: ["account"],
    params: { certificate: "ISO 9001", days: "0" },
    read: true,
  },
  {
    id: "n-07",
    profileId: "p04",
    notId: "NOT-16",
    at: "2026-10-20T08:00:00+05:00",
    recipients: ["account", "focal_point"],
    params: {},
    read: false,
  },
];
