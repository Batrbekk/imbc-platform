import { PROFILE_SECTIONS, type ProfileSection } from "@imbc/contracts";

import type { ProtoState } from "@/prototype/data";
import { useProto } from "@/prototype/store";

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

/** Решения одного круга ожидающих изменений, ещё не ушедшие производителю письмом (NOT-28). */
export interface ChangeRound {
  /** Время первого решения круга: отправка или разблокировка позже — уже другой круг. */
  startedAt: string;
  accepted: ProfileSection[];
  rejected: ProfileSection[];
  /** Комментарии отклонённых секций — в письмо. */
  comments: Partial<Record<ProfileSection, string>>;
}

export interface ExpertExt {
  /** Ключ — `lineKey(profileId, checkId, subject)`. */
  ddLineNotes: Record<string, LineNote>;
  /** Профиль → текущий круг решений по изменённым секциям. */
  changeRound: Record<string, ChangeRound>;
}

export const emptyExt = (): ExpertExt => ({ ddLineNotes: {}, changeRound: {} });

export const lineKey = (profileId: string, checkId: string, subject: string) => `${profileId}:${checkId}:${subject}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

const sections = (value: unknown): ProfileSection[] =>
  Array.isArray(value)
    ? value.filter((s): s is ProfileSection => (PROFILE_SECTIONS as readonly unknown[]).includes(s))
    : [];

/**
 * Свои данные, прочитанные из хранилища, приведённые к своей форме: запись другой формы (старая версия
 * модуля, повреждение) отбрасывается по частям, без ошибки.
 */
export function readExt(state: ProtoState): ExpertExt {
  const raw = state.ext.expert;
  const result = emptyExt();
  if (!isRecord(raw)) return result;
  if (isRecord(raw.ddLineNotes)) {
    for (const [key, note] of Object.entries(raw.ddLineNotes)) {
      if (isRecord(note) && isString(note.text) && isString(note.by) && isString(note.at)) {
        result.ddLineNotes[key] = { text: note.text, by: note.by, at: note.at };
      }
    }
  }
  if (isRecord(raw.changeRound)) {
    for (const [id, round] of Object.entries(raw.changeRound)) {
      if (!isRecord(round)) continue;
      const comments: ChangeRound["comments"] = {};
      if (isRecord(round.comments)) {
        for (const [section, text] of Object.entries(round.comments)) {
          if (isString(text) && sections([section]).length === 1) comments[section as ProfileSection] = text;
        }
      }
      result.changeRound[id] = {
        startedAt: isString(round.startedAt) ? round.startedAt : "",
        accepted: sections(round.accepted),
        rejected: sections(round.rejected),
        comments,
      };
    }
  }
  return result;
}

const normalized = new WeakSet<object>();

/** Свои данные в черновике: приведённая копия заменяет сохранённое значение (один раз на черновик). */
export function draftExt(draft: ProtoState): ExpertExt {
  const current = draft.ext.expert;
  if (isRecord(current) && normalized.has(current)) return current as unknown as ExpertExt;
  const ext = readExt(draft);
  normalized.add(ext);
  draft.ext.expert = ext;
  return ext;
}

export function useExpertExt(): ExpertExt {
  return useProto(readExt);
}
