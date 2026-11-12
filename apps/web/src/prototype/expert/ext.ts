import type { ProfileSection } from "@imbc/contracts";

import type { ProtoState } from "@/prototype/data";
import { extOf, useProto } from "@/prototype/store";

/**
 * Свои данные кабинета SME в `state.ext.expert` — то, чего нет в общих наборах:
 * пометка SME к строке due diligence (IMBC-13: строки не правятся, вывод SME — рядом) и решения
 * текущего круга по ожидающим изменениям, из которых собирается одно письмо NOT-05 (NOT-28).
 */
export interface LineNote {
  text: string;
  by: string;
  at: string;
}

export interface ExpertExt {
  /** Ключ — `lineKey(profileId, checkId, subject)`. */
  ddLineNotes: Record<string, LineNote>;
  /** Профиль → решения по изменённым секциям, ещё не ушедшие производителю письмом. */
  changeRound: Record<string, { accepted: ProfileSection[]; rejected: ProfileSection[] }>;
}

export const emptyExt = (): ExpertExt => ({ ddLineNotes: {}, changeRound: {} });

export const lineKey = (profileId: string, checkId: string, subject: string) => `${profileId}:${checkId}:${subject}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Сохранённое значение другой формы (старая версия модуля) — пустые данные. */
export function readExt(state: ProtoState): ExpertExt {
  const raw = state.ext.expert;
  if (!isRecord(raw) || !isRecord(raw.ddLineNotes) || !isRecord(raw.changeRound)) return emptyExt();
  return raw as unknown as ExpertExt;
}

/** Свои данные в черновике: неверная форма заменяется пустой. */
export function draftExt(draft: ProtoState): ExpertExt {
  if (readExt(draft) !== draft.ext.expert) draft.ext.expert = emptyExt();
  return extOf<ExpertExt>(draft, "expert", emptyExt);
}

export function useExpertExt(): ExpertExt {
  return useProto(readExt);
}
