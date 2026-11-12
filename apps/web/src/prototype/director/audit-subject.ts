// Профиль, к которому относится событие журнала (AUD-01): из строки журнала директор открывает досье.
// Только чтение; запись могла исчезнуть после сброса — тогда профиля нет и ссылки нет.
import type { AuditEvent, ProfileSections, ProtoState } from "@/prototype/data";
import { profileById } from "@/prototype/rules";

/** Документ, сертификат или продуктовая линия с этим ключом — в принятых или ожидающих значениях. */
function hasItem(sections: Partial<ProfileSections>, id: string): boolean {
  return (
    (sections.certificates ?? []).some((c) => c.id === id) ||
    (sections.documents ?? []).some((d) => d.id === id) ||
    (sections.products ?? []).some((p) => p.id === id)
  );
}

export function subjectProfileId(state: ProtoState, event: AuditEvent): string | null {
  const { id } = event.subject;
  const known = (profileId: string | null | undefined) =>
    profileId && profileById(state, profileId) ? profileId : null;

  // Сам профиль или его секция: `section.*` пишет `<profileId>:<section>`.
  const direct = known(id) ?? known(id.includes(":") ? id.slice(0, id.indexOf(":")) : null);
  if (direct) return direct;

  // Записи с `profileId`: отметки, заметки, запросы, site survey, AGAR и CDP, проверки, письма.
  const sets: { id: string; profileId: string | null }[][] = [
    state.worksWithMarks,
    state.visitMarks,
    state.operatorNotes,
    state.operatorRequests,
    state.imbcRequests,
    state.siteSurveys,
    state.siteSurveyRequests,
    state.tierRecords,
    state.imbcNotes,
    state.externalChecks,
    state.notifications,
  ];
  for (const set of sets) {
    const found = known(set.find((r) => r.id === id)?.profileId);
    if (found) return found;
  }

  // Документ или сертификат (`document.*`), продукт (`tier_record.request` пишет ключ продукта).
  const owner =
    state.tierRecords.find((r) => r.productId === id)?.profileId ??
    state.profiles.find((p) => hasItem(p.sections, id) || hasItem(p.pending, id))?.id;
  if (known(owner)) return owner!;

  // Действие производителя (`nda.accept` пишет ключ версии NDA): у организации производителя один профиль.
  if (event.actor.role === "manufacturer")
    return state.profiles.find((p) => p.organizationId === event.actor.organizationId)?.id ?? null;
  return null;
}
