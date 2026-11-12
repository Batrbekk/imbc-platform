/**
 * Общие типы демо-данных прототипа. Все данные вымышленные: компании — те же, что в seed
 * (`apps/api/src/database/seed.ts`), люди и адреса — на `.demo.local` (кроме демо-аккаунтов seed).
 */

/** Файл без содержимого: прототип хранит только имя, размер и время выбора (DATA-05). */
export interface FileRef {
  name: string;
  sizeKb: number;
  uploadedAt: string;
}

export function file(name: string, sizeKb: number, uploadedAt: string): FileRef {
  return { name, sizeKb, uploadedAt };
}

/** Сообщение переписки запроса: автор — аккаунт (`accounts.ts`). */
export interface ThreadMessage {
  id: string;
  authorId: string;
  at: string;
  text: string;
}

/** Открыт или закрыт (OPR-25, OPR-27). */
export type RequestStatus = "open" | "closed";
