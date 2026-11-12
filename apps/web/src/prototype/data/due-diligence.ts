import type { Locale } from "@imbc/contracts";

import { ACCOUNT } from "./accounts";
import { file, type FileRef } from "./common";
import { profiles } from "./profiles";

/** Итог due diligence (IMBC-11). */
export type DdResult = "green" | "amber" | "red";

/** Отметка строки (IMBC-10): clear, finding, shown only, no answer. */
export type DdMark = "clear" | "finding" | "shown_only" | "no_answer";

/** Группы отчёта в его порядке (IMBC-10, IMBC-13). */
export type DdGroup = "enterprise" | "finance" | "procurement" | "tax" | "director" | "founder";
export const DD_GROUPS: DdGroup[] = ["enterprise", "finance", "procurement", "tax", "director", "founder"];

/** Строка каталога проверок: сокращённый каталог IMBC-10 для показа. */
export interface DdCheckDefinition {
  id: string;
  group: DdGroup;
  /** Scored: «да» — finding; shown only: значение показывается, «да» — внимание (IMBC-14). */
  scored: boolean;
  title: Record<Locale, string>;
}

export const DD_CHECKS: DdCheckDefinition[] = [
  {
    id: "mass_address",
    group: "enterprise",
    scored: false,
    title: { en: "Mass registration address", ru: "Адрес массовой регистрации", kk: "Жаппай тіркеу мекенжайы" },
  },
  {
    id: "inactive",
    group: "enterprise",
    scored: true,
    title: { en: "Inactive enterprise", ru: "Бездействующее предприятие", kk: "Әрекетсіз кәсіпорын" },
  },
  { id: "bankrupt", group: "enterprise", scored: true, title: { en: "Bankrupt", ru: "Банкрот", kk: "Банкрот" } },
  {
    id: "sham",
    group: "enterprise",
    scored: true,
    title: { en: "Sham enterprise", ru: "Лжепредприятие", kk: "Жалған кәсіпорын" },
  },
  {
    id: "absent_address",
    group: "enterprise",
    scored: true,
    title: {
      en: "Absent at the legal address",
      ru: "Отсутствует по юридическому адресу",
      kk: "Заңды мекенжайда жоқ",
    },
  },
  {
    id: "invoices_suspended",
    group: "enterprise",
    scored: true,
    title: {
      en: "Electronic invoices suspended",
      ru: "Приостановлена выписка ЭСФ",
      kk: "ЭШФ жазу тоқтатылған",
    },
  },
  {
    id: "tax_debt",
    group: "enterprise",
    scored: true,
    title: {
      en: "Tax debt above 150 monthly calculation indices",
      ru: "Налоговая задолженность более 150 МРП",
      kk: "150 АЕК-тен асатын салық берешегі",
    },
  },
  {
    id: "account_arrest",
    group: "enterprise",
    scored: true,
    title: { en: "Arrest of bank accounts", ru: "Арест банковских счетов", kk: "Банк шоттарына тыйым" },
  },
  {
    id: "court_cases",
    group: "enterprise",
    scored: false,
    title: { en: "Participation in court cases", ru: "Участие в судебных делах", kk: "Сот істеріне қатысу" },
  },
  {
    id: "admin_fines",
    group: "enterprise",
    scored: false,
    title: { en: "Administrative fines", ru: "Административные штрафы", kk: "Әкімшілік айыппұлдар" },
  },
  {
    id: "large_taxpayer",
    group: "finance",
    scored: false,
    title: {
      en: "Large taxpayers subject to monitoring",
      ru: "Крупные налогоплательщики под мониторингом",
      kk: "Мониторингтегі ірі салық төлеушілер",
    },
  },
  {
    id: "enforcement_debtor",
    group: "finance",
    scored: true,
    title: {
      en: "Debtor under enforcement proceedings",
      ru: "Должник по исполнительным производствам",
      kk: "Атқарушылық іс жүргізу бойынша борышкер",
    },
  },
  {
    id: "tax_customs_arrears",
    group: "finance",
    scored: true,
    title: {
      en: "Tax and customs arrears",
      ru: "Налоговая и таможенная задолженность",
      kk: "Салық және кеден берешегі",
    },
  },
  {
    id: "public_procurement",
    group: "procurement",
    scored: false,
    title: {
      en: "Participant in public procurement of Kazakhstan",
      ru: "Участник госзакупок РК",
      kk: "ҚР мемлекеттік сатып алуға қатысушы",
    },
  },
  {
    id: "dishonest_procurement",
    group: "procurement",
    scored: true,
    title: {
      en: "Dishonest participant in public procurement",
      ru: "Недобросовестный участник госзакупок",
      kk: "Мемлекеттік сатып алудың жосықсыз қатысушысы",
    },
  },
  {
    id: "samruk_unreliable",
    group: "procurement",
    scored: true,
    title: {
      en: "Register of unreliable suppliers of Samruk-Kazyna",
      ru: "Реестр ненадёжных поставщиков Самрук-Казына",
      kk: "Самұрық-Қазына сенімсіз жеткізушілер тізілімі",
    },
  },
  {
    id: "samruk_producers",
    group: "procurement",
    scored: false,
    title: {
      en: "Register of Samruk-Kazyna producers",
      ru: "Реестр товаропроизводителей Самрук-Казына",
      kk: "Самұрық-Қазына тауар өндірушілер тізілімі",
    },
  },
  {
    id: "tax_latest_year_zero",
    group: "tax",
    scored: true,
    title: {
      en: "Total tax payments for the latest year is zero",
      ru: "Сумма налогов за последний год равна нулю",
      kk: "Соңғы жылғы салық сомасы нөлге тең",
    },
  },
  {
    id: "dir_court_cases",
    group: "director",
    scored: false,
    title: { en: "Participation in court cases", ru: "Участие в судебных делах", kk: "Сот істеріне қатысу" },
  },
  {
    id: "dir_enforcement",
    group: "director",
    scored: true,
    title: {
      en: "Debtor under enforcement proceedings",
      ru: "Должник по исполнительным производствам",
      kk: "Атқарушылық іс жүргізу бойынша борышкер",
    },
  },
  {
    id: "dir_travel_ban",
    group: "director",
    scored: true,
    title: {
      en: "Temporary ban on leaving Kazakhstan",
      ru: "Временный запрет на выезд из РК",
      kk: "ҚР-дан шығуға уақытша тыйым",
    },
  },
  {
    id: "dir_other_company",
    group: "director",
    scored: true,
    title: {
      en: "A problem in another company with the same director",
      ru: "Проблемы в другой компании того же руководителя",
      kk: "Сол басшының басқа компаниясындағы мәселе",
    },
  },
  {
    id: "fnd_court_cases",
    group: "founder",
    scored: false,
    title: { en: "Participation in court cases", ru: "Участие в судебных делах", kk: "Сот істеріне қатысу" },
  },
  {
    id: "fnd_offshore",
    group: "founder",
    scored: true,
    title: {
      en: "Legal entity with offshore participation",
      ru: "Юрлицо с офшорным участием",
      kk: "Офшорлық қатысуы бар заңды тұлға",
    },
  },
  {
    id: "fnd_terror_list",
    group: "founder",
    scored: true,
    title: {
      en: "On the list linked to financing terrorism or extremism",
      ru: "В перечне лиц, связанных с финансированием терроризма или экстремизма",
      kk: "Терроризмді немесе экстремизмді қаржыландырумен байланысты тізімде",
    },
  },
];

/**
 * Значение Adata в строке: "yes" / "no" показываются переведёнными, остальное (счётчики дел, суммы) —
 * как есть. У судебных дел — счётчики «гражданские, уголовные, административные, АППК».
 */
export interface DdCheckValue {
  checkId: string;
  /** Компания, руководитель или учредитель, по которому строка (IMBC-13). */
  subject: string;
  value: string;
  mark: DdMark;
}

/** Запись due diligence (раздел 9.1, IMBC-07, IMBC-08). */
export interface DueDiligenceRecord {
  profileId: string;
  checkedAt: string;
  /** Итог по строкам; `result` — итог после решения SME (IMBC-08, EXT-03). */
  autoResult: DdResult;
  result: DdResult;
  resultSetBy: string | null;
  comment: string | null;
  report: FileRef | null;
  enhanced: { done: boolean; comment: string | null; report: FileRef | null; at: string | null; by: string | null };
  checks: DdCheckValue[];
}

/** Строка, которой нужен человек (IMBC-14): critical — finding, attention — shown only со значением. */
export function ddSeverity(line: DdCheckValue): "critical" | "attention" | null {
  if (line.mark === "finding") return "critical";
  if (line.mark !== "shown_only") return null;
  if (line.value === "yes") return "attention";
  // Счётчики: любое число больше нуля — внимание.
  return /[1-9]/.test(line.value) ? "attention" : null;
}

/** Итог по строкам (IMBC-11): critical → red, attention → amber, иначе green; no answer не влияет. */
export function ddResultOf(checks: DdCheckValue[]): DdResult {
  const severities = checks.map(ddSeverity);
  if (severities.includes("critical")) return "red";
  if (severities.includes("attention")) return "amber";
  return "green";
}

const NO_COURT = "0, 0, 0, 0";

/** Строки по каталогу: по умолчанию «нет», переопределения — по id проверки. */
function lines(profileId: string, overrides: Record<string, { value: string; mark?: DdMark }> = {}): DdCheckValue[] {
  const profile = profiles.find((p) => p.id === profileId)!;
  const founder = profile.sections.shareholders[1]?.name ?? profile.sections.main.director;
  return DD_CHECKS.map((check) => {
    const subject =
      check.group === "director"
        ? profile.sections.main.director
        : check.group === "founder"
          ? founder
          : profile.nameRu;
    const court = check.id.endsWith("court_cases");
    const override = overrides[check.id];
    const value = override?.value ?? (court ? NO_COURT : "no");
    const mark: DdMark = override?.mark ?? (check.scored ? (value === "yes" ? "finding" : "clear") : "shown_only");
    return { checkId: check.id, subject, value, mark };
  });
}

function record(
  profileId: string,
  checkedAt: string,
  checks: DdCheckValue[],
  extra: Partial<DueDiligenceRecord> = {},
): DueDiligenceRecord {
  const autoResult = ddResultOf(checks);
  return {
    profileId,
    checkedAt,
    autoResult,
    result: autoResult,
    resultSetBy: null,
    comment: null,
    report: null,
    enhanced: { done: false, comment: null, report: null, at: null, by: null },
    checks,
    ...extra,
  };
}

/** Записи due diligence всех двенадцати профилей: green, amber и red (EXT-04). */
export const dueDiligence: DueDiligenceRecord[] = [
  record("p01", "2026-09-03T10:05:00+05:00", lines("p01")),
  // Amber как в образце отчёта: адрес массовой регистрации и суд у руководителя (IMBC-10).
  record(
    "p02",
    "2026-09-04T10:05:00+05:00",
    lines("p02", { mass_address: { value: "yes" }, dir_court_cases: { value: "1, 0, 0, 0" } }),
    { comment: "Адрес в бизнес-центре — обычное дело. Судебное дело руководителя — гражданское, закрыто." },
  ),
  record("p03", "2026-09-05T10:05:00+05:00", lines("p03")),
  // Источник не ответил по судебным делам компании — no answer, итог не меняет (IMBC-11).
  record(
    "p04",
    "2026-09-06T10:05:00+05:00",
    lines("p04", { admin_fines: { value: "yes" }, court_cases: { value: "—", mark: "no_answer" } }),
  ),
  record("p05", "2026-09-07T10:05:00+05:00", lines("p05"), {
    enhanced: {
      done: true,
      comment: "Проверены аффилированность и публичные лица — замечаний нет.",
      report: file("p05-enhanced-due-diligence.pdf", 310, "2026-09-15T12:00:00+05:00"),
      at: "2026-09-15T12:00:00+05:00",
      by: ACCOUNT.expert,
    },
  }),
  // SME сменил amber на green с комментарием (IMBC-08).
  record("p06", "2026-09-08T10:05:00+05:00", lines("p06", { public_procurement: { value: "yes" } }), {
    result: "green",
    resultSetBy: ACCOUNT.expert,
    comment: "Участие в госзакупках — запись о деятельности, не риск.",
  }),
  record("p07", "2026-09-09T10:05:00+05:00", lines("p07", { large_taxpayer: { value: "yes" } })),
  record("p08", "2026-09-10T10:05:00+05:00", lines("p08")),
  record("p09", "2026-11-06T10:05:00+05:00", lines("p09")),
  record("p10", "2026-11-08T10:05:00+05:00", lines("p10", { fnd_court_cases: { value: "0, 0, 2, 0" } })),
  // Red: налоговая задолженность и запрет на выезд руководителя (IMBC-14).
  record(
    "p11",
    "2026-11-09T10:05:00+05:00",
    lines("p11", { tax_customs_arrears: { value: "yes" }, dir_travel_ban: { value: "yes" } }),
    { report: file("p11-adata-report.pdf", 820, "2026-11-09T10:05:00+05:00") },
  ),
  record("p12", "2026-11-11T10:05:00+05:00", lines("p12")),
];
