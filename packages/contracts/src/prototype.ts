import { z } from 'zod';

/**
 * Общее состояние прототипа кабинетов ролей (`apps/web/src/prototype`): один документ на стенд.
 * Сервер его не разбирает: правила ролей и журнал прототипа исполняет web. Данные вымышленные;
 * любой вошедший пользователь стенда читает и перезаписывает документ целиком.
 */

/** Предел тела `PUT /api/v1/prototype/state` (только этот маршрут; у остальных — общий предел). */
export const PROTOTYPE_STATE_MAX_BYTES = 2 * 1024 * 1024;

/** Допустимые версии схемы документа: целое в разумных пределах, иначе 400. */
export const PROTOTYPE_SCHEMA_VERSION_MAX = 1000;

/** Документ: объект с версией схемы данных прототипа (`SCHEMA_VERSION` web в поле `version`). */
export const prototypeDocumentSchema = z.looseObject({
  version: z.number().int().min(1).max(PROTOTYPE_SCHEMA_VERSION_MAX),
});
export type PrototypeDocument = z.infer<typeof prototypeDocumentSchema>;

/** Версия документа для оптимистичной блокировки: 0 — документа ещё нет. */
const documentVersion = z.number().int().nonnegative();

/** `GET` → текущий документ; `state: null` — сервер пуст. Тело `409` у `PUT` — то же. */
export const prototypeStateSchema = z.object({ version: documentVersion, state: prototypeDocumentSchema.nullable() });
export type PrototypeState = z.infer<typeof prototypeStateSchema>;

/** `PUT`: запись поверх версии `baseVersion`; устарела — `409` с текущими версией и документом. */
export const prototypeWriteSchema = z.object({ baseVersion: documentVersion, state: prototypeDocumentSchema }).strict();
export type PrototypeWrite = z.infer<typeof prototypeWriteSchema>;

export const prototypeWrittenSchema = z.object({ version: documentVersion });
export type PrototypeWritten = z.infer<typeof prototypeWrittenSchema>;
