import { ACCOUNT } from "./accounts";
import { file, type FileRef } from "./common";

/** Запись site survey (IMBC-01): даты визита, результат, подписанный отчёт, срок, комментарий. */
export interface SiteSurvey {
  id: string;
  profileId: string;
  visitFrom: string;
  visitTo: string;
  result: boolean;
  report: FileRef | null;
  /** Срок задаёт тот, кто записывает; null — бессрочно, пока IMBC не поставит прошедшую дату (IMBC-02). */
  expiresOn: string | null;
  comment: string | null;
  recordedBy: string;
  recordedAt: string;
}

/** Запрос производителя на site survey (IMBC-20): без продукта, без письма. */
export interface SiteSurveyRequest {
  id: string;
  profileId: string;
  requestedAt: string;
  status: "open" | "done";
}

const survey = (
  id: string,
  profileId: string,
  visit: string,
  expiresOn: string | null,
  extra: Partial<SiteSurvey> = {},
): SiteSurvey => ({
  id,
  profileId,
  visitFrom: visit,
  visitTo: visit,
  result: true,
  report: file(`${profileId}-site-survey-${visit}.pdf`, 2300, `${visit}T18:00:00+05:00`),
  expiresOn,
  comment: null,
  recordedBy: ACCOUNT.expert,
  recordedAt: `${visit}T18:00:00+05:00`,
  ...extra,
});

/** Site surveyed в seed: p01, p02, p05, p06, p08. У p01 есть и прежняя, истёкшая запись; у p03 — результат «нет». */
export const siteSurveys: SiteSurvey[] = [
  survey("ss-01a", "p01", "2024-05-14", "2025-05-14", { comment: "Отчёт до запуска платформы (IMBC-03)." }),
  survey("ss-01b", "p01", "2026-10-01", "2028-10-01", {
    visitTo: "2026-10-02",
    comment: "Цех металлоконструкций и склад готовой продукции.",
  }),
  survey("ss-02", "p02", "2026-09-29", null),
  survey("ss-03", "p03", "2026-10-20", null, {
    result: false,
    report: null,
    comment: "Производство на реконструкции.",
  }),
  survey("ss-05", "p05", "2026-10-09", "2027-10-09"),
  survey("ss-06", "p06", "2026-10-15", "2028-10-15", { recordedBy: ACCOUNT.expert2 }),
  survey("ss-08", "p08", "2026-10-22", "2027-10-22"),
];

export const siteSurveyRequests: SiteSurveyRequest[] = [
  { id: "ssr-03", profileId: "p03", requestedAt: "2026-11-03T11:00:00+05:00", status: "open" },
];
