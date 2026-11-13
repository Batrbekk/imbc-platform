import { boolean, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id } from './_shared.js';
import { userAccounts } from './access.js';
import { locale } from './enums.js';

/*
 * Уведомления по DBML (`notification_rule`, `notification`). Скелетный `notifications_sent` (platform.ts)
 * живёт до contract: в него пишет предыдущая версия приложения (NFR-06); 0010 переносит его строки сюда.
 */

/**
 * Правило письма NOT-01…NOT-17 (раздел 8.2): событие и получатели — данные. Получатели — части через
 * `+` из закрытого списка. Семнадцать строк кладёт миграция 0010; правила меняются только релизом: у роли
 * приложения есть лишь SELECT (app-role.ts). Уникальность кода — ограничение, а не индекс: на него
 * ссылается внешний ключ журнала, а drizzle-kit создаёт индексы после внешних ключей.
 */
export const notificationRule = pgTable(
  'notification_rule',
  {
    id: id(),
    code: text('code').notNull(),
    event: text('event').notNull(),
    recipientRule: text('recipient_rule').notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [unique('notification_rule_code_uq').on(t.code)],
);

/**
 * Журнал отправленных писем: одно письмо на событие и адрес (NOT-18). `dedup_key` —
 * `<код>\n<ключ события>\n<адрес в нижнем регистре>`: адреса сводятся без учёта регистра. Только
 * добавление: у роли приложения нет UPDATE и DELETE (app-role.ts) — запись и отправка идут одной
 * транзакцией. Отступления от DBML: `rule_code` — внешний ключ на `notification_rule.code` (журнал не
 * примет неизвестный код); `sent_at` по умолчанию — момент вставки; язык — тип `locale`.
 */
export const notification = pgTable(
  'notification',
  {
    id: id(),
    ruleCode: text('rule_code')
      .notNull()
      .references(() => notificationRule.code),
    recipientEmail: text('recipient_email').notNull(),
    userAccountId: uuid('user_account_id').references(() => userAccounts.id),
    language: locale('language').notNull(),
    dedupKey: text('dedup_key').notNull(),
    relatedObjectType: text('related_object_type'),
    relatedObjectId: uuid('related_object_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('notification_dedup_uq').on(t.dedupKey),
    index('notification_account_idx').on(t.userAccountId, t.sentAt),
    index('notification_related_idx').on(t.relatedObjectType, t.relatedObjectId),
  ],
);
