import { ACCOUNT } from "./accounts";

/** Версия NDA (ADM-10, FC-02, FC-03): прежние версии хранятся вместе с принятиями. */
export interface NdaVersion {
  id: string;
  version: string;
  publishedAt: string;
  publishedBy: string;
  /** Краткое содержание: текст настоящего NDA в прототипе не хранится. */
  summary: string;
}

/** Текущая — опубликованная последней. Профили, принявшие только 1.0, ждут принятия 2.0 (FC-03). */
export const ndaVersions: NdaVersion[] = [
  {
    id: "nda-1",
    version: "1.0",
    publishedAt: "2026-09-01T09:00:00+05:00",
    publishedBy: ACCOUNT.administrator,
    summary: "Демо-текст NDA: прогноз спроса, STR и KTRE не передаются третьим лицам.",
  },
  {
    id: "nda-2",
    version: "2.0",
    publishedAt: "2026-11-01T09:00:00+05:00",
    publishedBy: ACCOUNT.administrator,
    summary: "Демо-текст NDA 2.0: добавлен срок хранения сведений после окончания действия соглашения.",
  },
];
