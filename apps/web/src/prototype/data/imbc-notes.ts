import { ACCOUNT } from "./accounts";

/** Внутренняя заметка IMBC (IMBC-15): видят только SME и директор IMBC. */
export interface ImbcNote {
  id: string;
  profileId: string;
  authorId: string;
  text: string;
  createdAt: string;
  /** Поля из Excel-базы IMBC у перенесённых профилей (раздел 10). */
  legacy: Record<string, string> | null;
}

export const imbcNotes: ImbcNote[] = [
  {
    id: "note-01",
    profileId: "p01",
    authorId: ACCOUNT.expert,
    text: "Созвонились с focal point перед верификацией (MAN-16): данные подтверждены.",
    createdAt: "2026-09-19T11:00:00+05:00",
    legacy: null,
  },
  {
    id: "note-02",
    profileId: "p02",
    authorId: ACCOUNT.expert,
    text: "Новый контакт в ожидающих изменениях — проверить телефон до принятия.",
    createdAt: "2026-11-10T15:20:00+05:00",
    legacy: null,
  },
  {
    id: "note-04",
    profileId: "p04",
    authorId: ACCOUNT.expert2,
    text: "Компания не отвечает на звонки второй квартал.",
    createdAt: "2026-11-01T10:00:00+05:00",
    legacy: { "Общий рейтинг (Excel)": "B", "Комментарий (Excel)": "Поставки через дистрибьютора" },
  },
  {
    id: "note-07",
    profileId: "p07",
    authorId: ACCOUNT.expert,
    text: "Перенесён из базы IMBC, приглашение ещё не принято.",
    createdAt: "2026-09-10T10:30:00+05:00",
    legacy: { "Общий рейтинг (Excel)": "C" },
  },
  {
    id: "note-11",
    profileId: "p11",
    authorId: ACCOUNT.expert,
    text: "Итог due diligence red: запросить у компании справку об отсутствии задолженности.",
    createdAt: "2026-11-12T10:40:00+05:00",
    legacy: null,
  },
];
