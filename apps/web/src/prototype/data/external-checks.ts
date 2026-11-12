/** Коннектор внешней проверки (EXT-01): Adata — настоящий сервис, остальные — заглушки (EXT-02). */
export type Connector = "adata" | "e_ondiris" | "accounting" | "legal_registry";

/** Внешняя проверка (раздел 9.1). Результат заглушки помечен как тестовые данные (EXT-02). */
export interface ExternalCheck {
  id: string;
  profileId: string;
  connector: Connector;
  status: "ok" | "unavailable";
  result: string;
  source: string;
  at: string;
  testData: boolean;
}

export const externalChecks: ExternalCheck[] = [
  {
    id: "ext-01a",
    profileId: "p01",
    connector: "adata",
    status: "ok",
    result: "green",
    source: "Adata",
    at: "2026-09-03T10:05:00+05:00",
    testData: false,
  },
  {
    id: "ext-01b",
    profileId: "p01",
    connector: "legal_registry",
    status: "ok",
    result: "Действующее юрлицо",
    source: "Реестр юрлиц (заглушка)",
    at: "2026-09-03T10:06:00+05:00",
    testData: true,
  },
  {
    id: "ext-02",
    profileId: "p02",
    connector: "accounting",
    status: "unavailable",
    result: "—",
    source: "Учётный сервис (заглушка)",
    at: "2026-11-10T09:00:00+05:00",
    testData: true,
  },
  {
    id: "ext-02b",
    profileId: "p02",
    connector: "adata",
    status: "ok",
    result: "amber",
    source: "Adata",
    at: "2026-09-04T10:05:00+05:00",
    testData: false,
  },
  {
    id: "ext-11",
    profileId: "p11",
    connector: "adata",
    status: "ok",
    result: "red",
    source: "Adata",
    at: "2026-11-09T10:05:00+05:00",
    testData: false,
  },
  {
    id: "ext-11b",
    profileId: "p11",
    connector: "e_ondiris",
    status: "ok",
    result: "Записей в реестре нет",
    source: "Локальная копия e-Ondiris",
    at: "2026-11-09T10:06:00+05:00",
    testData: false,
  },
];
