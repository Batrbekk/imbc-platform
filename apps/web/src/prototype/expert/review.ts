import { PROFILE_SECTIONS, type ProfileSection } from "@imbc/contracts";

import type { Certificate, ProfileDocument, ProfileSections, ProtoProfile, ProtoState } from "@/prototype/data";

/**
 * Правила проверки профиля (разделы 6.1–6.3) поверх общих данных. Решения пишутся в те же поля,
 * что читает кабинет производителя: `review[section]`, `status`, статусы документов (MAN-44…MAN-46).
 */

/** Полная проверка (Submitted, Under review) или проверка ожидающих изменений Verified (REV-08). */
export type ReviewMode = "full" | "changes";

export function reviewMode(profile: ProtoProfile): ReviewMode | null {
  if (profile.status === "submitted" || profile.status === "under_review") return "full";
  if (profile.status === "verified" && profile.pendingChanges) return "changes";
  return null;
}

/** В очереди проверки (REV-04): Submitted, Under review и Verified с ожидающими изменениями. */
export const inQueue = (profile: ProtoProfile) => reviewMode(profile) !== null;

/** Секции, по которым SME решает сейчас: все восемь или только изменённые (REV-06, REV-08). */
export function sectionsToDecide(profile: ProtoProfile): ProfileSection[] {
  const mode = reviewMode(profile);
  if (mode === "full") return [...PROFILE_SECTIONS];
  if (mode === "changes") return PROFILE_SECTIONS.filter((s) => profile.review[s].changed);
  return [];
}

/** Значения секции на проверке: ожидающие изменения, если есть, иначе введённые (REV-05). */
export function valuesUnderReview<S extends ProfileSection>(profile: ProtoProfile, section: S): ProfileSections[S] {
  return (profile.pending[section] as ProfileSections[S] | undefined) ?? profile.sections[section];
}

/** Документы и сертификаты секции на проверке. */
export function reviewItems(profile: ProtoProfile, section: ProfileSection): (Certificate | ProfileDocument)[] {
  if (section === "certificates") return valuesUnderReview(profile, "certificates");
  if (section === "documents") return valuesUnderReview(profile, "documents");
  return [];
}

/** Обязательные типы сертификатов из справочника (MAN-34, ADM-09). */
export function mandatoryCertificateTypes(state: ProtoState): string[] {
  return (
    state.referenceLists
      .find((l) => l.id === "certificate_types")
      ?.items.filter((i) => i.mandatory && !i.retired)
      .map((i) => i.label) ?? []
  );
}

/**
 * Почему секцию нельзя принять: документ или сертификат секции не принят (REV-06), нет принятого
 * сертификата обязательного типа (термин «mandatory certificate», MAN-35).
 */
export function verifyBlockers(state: ProtoState, profile: ProtoProfile, section: ProfileSection) {
  const blockers: ("items" | "mandatory")[] = [];
  const items = reviewItems(profile, section);
  if (items.some((i) => i.status !== "verified")) blockers.push("items");
  if (section === "certificates") {
    const certificates = valuesUnderReview(profile, "certificates");
    const missing = mandatoryCertificateTypes(state).some(
      (type) => !certificates.some((c) => c.type === type && c.status === "verified"),
    );
    if (missing) blockers.push("mandatory");
  }
  return blockers;
}

/** Есть решение по секции в этом круге проверки. */
export function isDecided(profile: ProtoProfile, section: ProfileSection): boolean {
  return profile.review[section].decision !== null;
}

/** «Submit result» доступен, когда решение есть по каждой секции (REV-07). */
export function canSubmitResult(profile: ProtoProfile): boolean {
  return reviewMode(profile) === "full" && sectionsToDecide(profile).every((s) => isDecided(profile, s));
}

/** Итог «Submit result»: все секции приняты — Verified, иначе Returned (REV-07). */
export function resultOf(profile: ProtoProfile): "verified" | "returned" {
  return PROFILE_SECTIONS.every((s) => profile.review[s].decision === "verified") ? "verified" : "returned";
}

/** Дата поступления (REV-04): отправка на проверку; у Draft — регистрация. */
export const receivedAt = (p: ProtoProfile) => p.submittedAt ?? p.registeredAt;
