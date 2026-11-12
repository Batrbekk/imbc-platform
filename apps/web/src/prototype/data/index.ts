/**
 * Исходные демо-данные прототипа. Каждый набор — в своём файле рядом со своим типом; здесь они
 * собираются в начальное состояние хранилища (`../store.ts`).
 */
import type { Role } from "@imbc/contracts";

import { accounts } from "./accounts";
import { apiCredentials } from "./api-credentials";
import { auditEvents } from "./audit";
import { dueDiligence } from "./due-diligence";
import { exportRecords, exportSubscriptions } from "./exports";
import { externalChecks } from "./external-checks";
import { forecastLines, forecastVersions } from "./forecast";
import { imbcNotes } from "./imbc-notes";
import { visitMarks, worksWithMarks } from "./marks";
import { migrationInvites } from "./migration";
import { ndaVersions } from "./nda";
import { notifications } from "./notifications";
import { operatorNotes } from "./operator-notes";
import { organizations } from "./organizations";
import { profiles } from "./profiles";
import { orgChartSample, referenceLists } from "./references";
import { imbcRequests, operatorRequests } from "./requests";
import { siteSurveyRequests, siteSurveys } from "./site-surveys";
import { techFiles } from "./tech-files";
import { tierRecords } from "./tier-records";

export type * from "./accounts";
export type * from "./api-credentials";
export type * from "./audit";
export type * from "./common";
export type * from "./due-diligence";
export type * from "./exports";
export type * from "./external-checks";
export type * from "./forecast";
export type * from "./imbc-notes";
export type * from "./marks";
export type * from "./migration";
export type * from "./nda";
export type * from "./notifications";
export type * from "./operator-notes";
export type * from "./organizations";
export type * from "./profiles";
export type * from "./references";
export type * from "./requests";
export type * from "./site-surveys";
export type * from "./tech-files";
export type * from "./tier-records";

/** Версия схемы сохранённого состояния. Меняется при несовместимой правке типов данных. */
export const SCHEMA_VERSION = 1;

const DATA = {
  organizations,
  accounts,
  profiles,
  dueDiligence,
  externalChecks,
  siteSurveys,
  siteSurveyRequests,
  tierRecords,
  imbcNotes,
  worksWithMarks,
  visitMarks,
  operatorNotes,
  imbcRequests,
  operatorRequests,
  forecastVersions,
  forecastLines,
  techFiles,
  referenceLists,
  orgChartSample,
  ndaVersions,
  apiCredentials,
  exportRecords,
  exportSubscriptions,
  migrationInvites,
  notifications,
  audit: auditEvents,
};

/**
 * Всё состояние прототипа. `ext` — свои данные модуля роли (`ext[role]`), тип задаёт модуль:
 * так кабинет хранит то, чего нет в общих наборах, не меняя общих файлов.
 */
export type ProtoState = { version: typeof SCHEMA_VERSION } & typeof DATA & { ext: Partial<Record<Role, unknown>> };

/** Свежая копия исходных данных: правки состояния не задевают константы наборов. */
export function createInitialState(): ProtoState {
  return structuredClone({ version: SCHEMA_VERSION, ...DATA, ext: {} });
}
