import { PermanentNotificationError } from './errors.js';

/**
 * Правила писем раздела 8.2 (NOT-01…NOT-17) — данные: событие и получатели лежат в `notification_rule`
 * (миграция 0010), меняются только релизом. Здесь — закрытые списки кодов и частей получателей и формат
 * ключа журнала.
 */
export const NOTIFICATION_RULE_CODES = [
  'NOT-01',
  'NOT-02',
  'NOT-03',
  'NOT-04',
  'NOT-05',
  'NOT-06',
  'NOT-07',
  'NOT-08',
  'NOT-09',
  'NOT-10',
  'NOT-11',
  'NOT-12',
  'NOT-13',
  'NOT-14',
  'NOT-15',
  'NOT-16',
  'NOT-17',
] as const;
export type NotificationRuleCode = (typeof NOTIFICATION_RULE_CODES)[number];

/**
 * Письма аккаунта, которые получает и наблюдатель: ссылка пароля (NOT-24), код входа (AUTH-03), блокировка
 * входа (AUTH-04). Остальные (NOT-04…NOT-17) наблюдателю не уходят (NOT-21) — расхождение 1 плана этапа 2.
 */
export const ACCOUNT_SECURITY_RULES: readonly NotificationRuleCode[] = ['NOT-01', 'NOT-02', 'NOT-03'];

/**
 * Части получателей `notification_rule.recipient_rule` (через `+`). Как часть находит адреса — резолвер
 * (`recipients.ts`); `focal_point`, `manufacturer_contacts` появятся с контактами (этап 3),
 * `assigned_sme_or_imbc_mailbox` — с назначением SME (этап 5).
 */
export const RECIPIENT_PARTS = [
  'person',
  'manufacturer_account',
  'focal_point',
  'manufacturer_contacts',
  'imbc_mailbox',
  'assigned_sme_or_imbc_mailbox',
  'operator_accounts_not_blocked',
] as const;
export type RecipientPart = (typeof RECIPIENT_PARTS)[number];

const isRecipientPart = (value: string): value is RecipientPart =>
  (RECIPIENT_PARTS as readonly string[]).includes(value);

/**
 * Части правила по порядку; неизвестная или пустая часть — ошибка данных релиза, повтор её не исправит
 * (`PermanentNotificationError`).
 */
export function parseRecipientRule(text: string): RecipientPart[] {
  return text.split('+').map((part) => {
    if (!isRecipientPart(part))
      throw new PermanentNotificationError(`notification_rule: неизвестная часть получателей «${part}»`);
    return part;
  });
}

/**
 * Ключ журнала `notification.dedup_key`: одно письмо на событие и адрес без учёта регистра (NOT-18).
 * Тот же формат строит миграция 0010 для писем предыдущей версии: `<код>\n<ключ события>\n<адрес в нижнем регистре>`.
 */
export function notificationDedupKey(rule: string, eventKey: string, email: string): string {
  return `${rule}\n${eventKey}\n${email.trim().toLowerCase()}`;
}
