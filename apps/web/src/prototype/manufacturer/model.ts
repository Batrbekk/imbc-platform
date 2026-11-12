// Правила кабинета производителя поверх демо-данных: полнота секций (MAN-41), что мешает отправке,
// блокировка (MAN-43), статус секции (MAN-46), слоты файлов для истории версий (MAN-36).
import { PROFILE_SECTIONS, type ProfileSection, SECTIONS_IN_COMPLETENESS } from "@imbc/contracts";

import type { FileRef, ProfileSections, ProtoProfile, ProtoState } from "../data";
import { protoPath } from "../registry";

export const SECTIONS: readonly ProfileSection[] = PROFILE_SECTIONS;

/** Адрес экрана секции профиля (MAN-40: секция открывается своим адресом). */
export const sectionHref = (s: ProfileSection) => protoPath("manufacturer", `profile/${s}`);

export const isSection = (value: unknown): value is ProfileSection =>
  (PROFILE_SECTIONS as readonly unknown[]).includes(value);

/** Значения, которые видит и правит производитель: ожидающие проверки правки поверх верифицированных (MAN-45). */
export function currentSections(profile: ProtoProfile): ProfileSections {
  return { ...profile.sections, ...profile.pending };
}

/**
 * Профиль заблокирован: Submitted и Under review (MAN-43), а у Verified — пока отправленные правки
 * у SME (MAN-45). Разблокировать может сам производитель.
 */
export function isLocked(profile: ProtoProfile): boolean {
  return (
    profile.status === "submitted" ||
    profile.status === "under_review" ||
    (profile.status === "verified" && profile.pendingChanges)
  );
}

/** Секции с ожидающими правками у Verified (MAN-45). */
export function pendingSections(profile: ProtoProfile): ProfileSection[] {
  return SECTIONS.filter((s) => profile.pending[s] !== undefined);
}

/** Что не заполнено: ключ подписи в словаре кабинета и подстановки. */
export interface Missing {
  key: MissingKey;
  values?: Record<string, string>;
}

export type MissingKey =
  | "field"
  | "contactsCount"
  | "contactIncomplete"
  | "focalPoint"
  | "shareholderNone"
  | "shareholderIncomplete"
  | "productNone"
  | "productIncomplete"
  | "certificate"
  | "document";

export interface SectionCompleteness {
  /** null — секция без обязательных полей (производство, MAN-26). */
  percent: number | null;
  missing: Missing[];
}

const filled = (value: string | null | undefined) => typeof value === "string" && value.trim() !== "";
const isNumber = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value);

/** Обязательные типы сертификатов и документов задаёт администратор (ADM-09, MAN-34, MAN-39). */
export function mandatoryTypes(state: ProtoState, list: "certificate_types" | "document_types"): string[] {
  return (state.referenceLists.find((r) => r.id === list)?.items ?? [])
    .filter((i) => i.mandatory && !i.retired)
    .map((i) => i.code);
}

const percentOf = (done: number, total: number) => (total === 0 ? 100 : Math.floor((done / total) * 100));

/** Полнота одной секции: доля обязательных полей и файлов, которые заполнены (MAN-41). */
export function sectionCompleteness(
  state: ProtoState,
  section: ProfileSection,
  values: ProfileSections,
): SectionCompleteness {
  const missing: Missing[] = [];
  switch (section) {
    case "main": {
      const m = values.main;
      const checks: [string, boolean][] = [
        ["legalName", filled(m.legalName)],
        ["legalForm", filled(m.legalForm)],
        ["director", filled(m.director)],
        ["registeredOn", filled(m.registeredOn)],
        ["okedCodes", m.okedCodes.length > 0],
        ["region", filled(m.region)],
        ["city", filled(m.city)],
        ["legalAddress", filled(m.legalAddress)],
        ["productionAddress", filled(m.productionAddress)],
        ["companyPhone", filled(m.companyPhone)],
      ];
      for (const [field, ok] of checks) if (!ok) missing.push({ key: "field", values: { field } });
      return { percent: percentOf(checks.filter(([, ok]) => ok).length, checks.length), missing };
    }
    case "contacts": {
      const complete = values.contacts.filter(contactComplete);
      values.contacts.forEach((c, i) => {
        if (!contactComplete(c)) missing.push({ key: "contactIncomplete", values: { n: String(i + 1) } });
      });
      if (complete.length < 3) missing.push({ key: "contactsCount", values: { count: String(complete.length) } });
      const focal = values.contacts.filter((c) => c.focalPoint).length === 1;
      if (!focal) missing.push({ key: "focalPoint" });
      return { percent: percentOf(Math.min(complete.length, 3) + Number(focal), 4), missing };
    }
    case "personnel": {
      const p = values.personnel;
      const checks: [string, boolean][] = [
        ["managers", isNumber(p.managers)],
        ["office", isNumber(p.office)],
        ["production", isNumber(p.production)],
        ["foreignManagers", isNumber(p.foreignManagers)],
        ["orgChart", p.orgChart !== null],
      ];
      for (const [field, ok] of checks) if (!ok) missing.push({ key: "field", values: { field } });
      return { percent: percentOf(checks.filter(([, ok]) => ok).length, checks.length), missing };
    }
    case "shareholders": {
      const rows = values.shareholders;
      if (rows.length === 0) return { percent: 0, missing: [{ key: "shareholderNone" }] };
      const complete = rows.filter((r) => filled(r.name) && filled(r.country) && isNumber(r.sharePct));
      rows.forEach((r, i) => {
        if (!complete.includes(r)) missing.push({ key: "shareholderIncomplete", values: { n: String(i + 1) } });
      });
      return { percent: percentOf(complete.length, rows.length), missing };
    }
    case "products": {
      const lines = values.products;
      if (lines.length === 0) return { percent: 0, missing: [{ key: "productNone" }] };
      const complete = lines.filter(productComplete);
      lines.forEach((l, i) => {
        if (!productComplete(l)) missing.push({ key: "productIncomplete", values: { n: String(i + 1) } });
      });
      return { percent: percentOf(complete.length, lines.length), missing };
    }
    case "production":
      return { percent: null, missing };
    case "certificates": {
      const types = mandatoryTypes(state, "certificate_types");
      const present = types.filter((type) => values.certificates.some((c) => c.type === type && c.file !== null));
      for (const type of types) if (!present.includes(type)) missing.push({ key: "certificate", values: { type } });
      return { percent: percentOf(present.length, types.length), missing };
    }
    case "documents": {
      const types = mandatoryTypes(state, "document_types");
      const present = types.filter((type) =>
        values.documents.some(
          (d) => d.type === type && (d.file !== null || (type === "licence" && d.noLicenceRequired)),
        ),
      );
      for (const type of types) if (!present.includes(type)) missing.push({ key: "document", values: { type } });
      return { percent: percentOf(present.length, types.length), missing };
    }
  }
}

export function contactComplete(c: ProfileSections["contacts"][number]): boolean {
  return filled(c.fullName) && filled(c.position) && filled(c.email) && filled(c.phone) && filled(c.role);
}

export function productComplete(l: ProfileSections["products"][number]): boolean {
  if (l.registry) return true;
  const capacity = l.capacity.kind === "added" ? isNumber(l.capacity.value) && l.capacity.value > 0 : true;
  return (
    filled(l.nameEn) && filled(l.nameRu) && filled(l.group) && filled(l.commodityType) && filled(l.tnved) && capacity
  );
}

/** Полнота профиля: среднее по секциям с равным весом, без производства (MAN-41). */
export function profileCompleteness(state: ProtoState, profile: ProtoProfile) {
  const values = currentSections(profile);
  const bySection = Object.fromEntries(SECTIONS.map((s) => [s, sectionCompleteness(state, s, values)])) as Record<
    ProfileSection,
    SectionCompleteness
  >;
  const counted = SECTIONS_IN_COMPLETENESS.map((s) => bySection[s].percent ?? 100);
  const percent = Math.floor(counted.reduce((a, b) => a + b, 0) / counted.length);
  return { percent, bySection };
}

/** Статус секции для производителя (MAN-46). */
export type SectionState =
  "not_sent" | "submitted" | "under_review" | "verified" | "rejected" | "corrected" | "pending" | "pending_sent";

/**
 * Решения SME видны производителю, только когда проверка закрыта: профиль Returned (MAN-44, REV-07)
 * или Verified без отправленных правок (решения по pending changes после закрытия круга, REV-08).
 * Пока профиль Submitted, Under review или правки у SME, промежуточные решения не показываются.
 */
export function decisionsVisible(profile: ProtoProfile): boolean {
  return profile.status === "returned" || (profile.status === "verified" && !profile.pendingChanges);
}

/** Отклонение SME с комментарием, если его уже можно показать производителю. */
export function visibleRejection(profile: ProtoProfile, section: ProfileSection): string | null {
  const r = profile.review[section];
  return decisionsVisible(profile) && r.decision === "rejected" ? (r.comment ?? "") : null;
}

/**
 * Статус секции только из общих полей: `review[section].decision`, `changed` («правили после
 * последнего решения SME»), `pending[section]` и `pendingChanges` («правки у SME»).
 */
export function sectionState(profile: ProtoProfile, section: ProfileSection): SectionState {
  const r = profile.review[section];
  switch (profile.status) {
    case "verified":
      if (profile.pending[section] === undefined) return "verified";
      if (profile.pendingChanges) return "pending_sent";
      if (r.decision === "rejected" && !r.changed) return "rejected";
      return "pending";
    case "submitted":
      return "submitted";
    case "under_review":
      return "under_review";
    case "returned":
      if (r.changed) return "corrected";
      if (r.decision === "rejected") return "rejected";
      return r.decision === "verified" ? "verified" : "not_sent";
    case "draft":
      return r.changed && r.decision !== null ? "corrected" : "not_sent";
  }
}

/** Секции, которые правили после последнего решения SME: только их можно отправить (MAN-45, REV-08). */
export function changedPendingSections(profile: ProtoProfile): ProfileSection[] {
  return SECTIONS.filter((s) => profile.pending[s] !== undefined && profile.review[s].changed);
}

/** Значения секции равны текущим — сохранять нечего. */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Файлы секции по слотам: замена файла в слоте кладёт прежнюю версию в историю (MAN-36). */
export function fileSlots(section: ProfileSection, values: ProfileSections): Record<string, FileRef | null> {
  switch (section) {
    case "main":
      return { extract: values.main.unifiedRegister.extract };
    case "personnel":
      return { orgChart: values.personnel.orgChart };
    case "products":
      return Object.fromEntries(values.products.map((l) => [`product:${l.id}`, l.certificate]));
    case "certificates":
      return Object.fromEntries(values.certificates.map((c) => [`cert:${c.id}`, c.file]));
    case "documents":
      return Object.fromEntries(values.documents.map((d) => [`doc:${d.type}`, d.file]));
    default:
      return {};
  }
}

export const sameFile = (a: FileRef | null, b: FileRef | null) =>
  a === b || (a !== null && b !== null && a.name === b.name && a.uploadedAt === b.uploadedAt);

/** Дата, до которой нужно подтвердить данные: три месяца от последнего подтверждения (NOT-31). */
export function nextQuarter(from: string): string {
  const d = new Date(from);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

export const today = () => new Date().toISOString().slice(0, 10);

/** Свои данные кабинета в `ext.manufacturer`: история файлов (MAN-36) и подтверждения секций (UPD-05). */
export interface ManufacturerExt {
  fileHistory: Record<string, FileRef[]>;
  confirmations: Record<string, ProfileSection[]>;
}

export const EMPTY_EXT: ManufacturerExt = { fileHistory: {}, confirmations: {} };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Сохранённое значение старой или чужой формы — пустые данные. */
export function readExt(value: unknown): ManufacturerExt {
  if (!isRecord(value) || !isRecord(value.fileHistory) || !isRecord(value.confirmations)) return EMPTY_EXT;
  const fileHistory = Object.fromEntries(
    Object.entries(value.fileHistory).filter(
      (e): e is [string, FileRef[]] =>
        Array.isArray(e[1]) && e[1].every((f) => isRecord(f) && typeof f.name === "string"),
    ),
  );
  const confirmations = Object.fromEntries(
    Object.entries(value.confirmations).filter(
      (e): e is [string, ProfileSection[]] => Array.isArray(e[1]) && e[1].every(isSection),
    ),
  );
  return { fileHistory, confirmations };
}

export const historyKey = (profileId: string, slot: string) => `${profileId}/${slot}`;

/** Форма секции: исходные значения и сохранение целиком (MAN-40). */
export interface FormProps<S extends ProfileSection> {
  profile: ProtoProfile;
  initial: ProfileSections[S];
  onSave: (value: ProfileSections[S]) => void;
}
