import { PROFILE_SECTIONS, type ProfileSection } from "@imbc/contracts";

import type { ProtoProfile, ProtoState } from "@/prototype/data";
import { newId } from "@/prototype/store";

import { type ChangeRound, draftExt } from "./ext";

/**
 * Решения SME в общих полях профиля — так же их читает кабинет производителя:
 * каждое решение по секции ставит `changed: false` (признак правки ставит только производитель);
 * круг ожидающих изменений закрывается, когда изменённых секций без решения не осталось;
 * одно письмо NOT-05 на одну отправку (NOT-27, NOT-28).
 */

const profileIn = (draft: ProtoState, id: string) => draft.profiles.find((p) => p.id === id)!;

/** `comment.<секция>` для каждой отклонённой секции с комментарием. */
function commentParams(comments: Partial<Record<ProfileSection, string>>, rejected: ProfileSection[]) {
  return Object.fromEntries(
    rejected.filter((s) => comments[s]).map((s) => [`comment.${s}`, comments[s]!] as const),
  ) as Record<string, string>;
}

function pushNot05(draft: ProtoState, profileId: string, at: string, params: Record<string, string>) {
  draft.notifications.push({
    id: newId("n"),
    profileId,
    notId: "NOT-05",
    at,
    recipients: ["account", "focal_point"],
    params,
    read: false,
  });
}

/** Решение по секции в полной проверке (REV-06). */
export function decideSectionFull(
  draft: ProtoState,
  profileId: string,
  section: ProfileSection,
  decision: "verified" | "rejected",
  comment: string | null,
  me: string,
  at: string,
): void {
  const p = profileIn(draft, profileId);
  p.review[section] = {
    decision,
    comment: decision === "verified" ? null : comment,
    decidedBy: me,
    decidedAt: at,
    changed: false,
  };
}

/** Submit result (REV-07): Verified или Returned, одно письмо NOT-05 с комментариями отклонённых секций. */
export function submitResult(draft: ProtoState, profileId: string, result: "verified" | "returned", at: string): void {
  const p = profileIn(draft, profileId);
  const rejected = PROFILE_SECTIONS.filter((s) => p.review[s].decision === "rejected");
  p.status = result;
  if (result === "verified") {
    p.verifiedAt = at;
    p.lastConfirmedAt = at;
    p.updateStatus = p.updateStatus ?? "active";
    p.pendingChanges = false;
  }
  const comments = Object.fromEntries(rejected.map((s) => [s, p.review[s].comment ?? ""]));
  pushNot05(
    draft,
    p.id,
    at,
    result === "verified" ? { result } : { result, rejected: rejected.join(","), ...commentParams(comments, rejected) },
  );
}

/**
 * Текущий круг профиля. Круг, начатый до того, как производитель снова отправил изменения или
 * разблокировал профиль (события журнала позже первого решения), — прошлый: его решения в письмо
 * следующего круга не попадают.
 */
function currentRound(draft: ProtoState, profileId: string, at: string): ChangeRound {
  const ext = draftExt(draft);
  const round = ext.changeRound[profileId];
  const stale =
    round !== undefined &&
    draft.audit.some(
      (e) =>
        e.subject.id === profileId &&
        (e.action === "profile.send_changes" || e.action === "profile.unlock") &&
        e.at > round.startedAt,
    );
  if (!round || stale) ext.changeRound[profileId] = { startedAt: at, accepted: [], rejected: [], comments: {} };
  return ext.changeRound[profileId]!;
}

function closeRound(draft: ProtoState, profileId: string, round: ChangeRound | undefined, at: string): void {
  profileIn(draft, profileId).pendingChanges = false;
  // Письмо — только если в круге было решение; «возвращён» в нём не говорится (NOT-28).
  if (round && round.accepted.length + round.rejected.length > 0) {
    pushNot05(draft, profileId, at, {
      result: "changes",
      accepted: round.accepted.join(","),
      rejected: round.rejected.join(","),
      ...commentParams(round.comments, round.rejected),
    });
  }
  delete draftExt(draft).changeRound[profileId];
}

/** Решение по изменённой секции Verified (REV-08): принятое заменяет значения, отклонённое остаётся в `pending`. */
export function decideChange(
  draft: ProtoState,
  profileId: string,
  section: ProfileSection,
  decision: "verified" | "rejected",
  comment: string | null,
  me: string,
  at: string,
): void {
  const p = profileIn(draft, profileId);
  const round = currentRound(draft, profileId, at);
  round.accepted = round.accepted.filter((s) => s !== section);
  round.rejected = round.rejected.filter((s) => s !== section);
  delete round.comments[section];
  if (decision === "verified") {
    const pending = p.pending[section];
    if (pending !== undefined) (p.sections as unknown as Record<string, unknown>)[section] = pending;
    delete p.pending[section];
    // Принятая правка двигает квартал профиля (NOT-31).
    p.lastConfirmedAt = at;
    round.accepted.push(section);
  } else {
    round.rejected.push(section);
    if (comment) round.comments[section] = comment;
  }
  p.review[section] = {
    decision,
    comment: decision === "verified" ? null : comment,
    decidedBy: me,
    decidedAt: at,
    changed: false,
  };
  if (!PROFILE_SECTIONS.some((s) => p.review[s].changed)) closeRound(draft, profileId, round, at);
}

/** Закрыть круг, в котором не осталось изменённой секции без решения (данные до исправления, разблокировка). */
export function closeStuckRound(draft: ProtoState, profile: ProtoProfile, at: string): void {
  closeRound(draft, profile.id, currentRound(draft, profile.id, at), at);
}
