import { DEFAULT_LOCALE, type Locale } from '@imbc/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DB, type Database } from '../database/database.module.js';
import { databaseErrorSummary } from '../database/pg-errors.js';
import { notificationRule, userAccounts } from '../database/schema/index.js';
import { MailService } from '../mail/mail.service.js';
import { isMailTemplateCode, type RenderedMail, renderNotification } from '../mail/templates.js';
import { type NotifyJob, notifyJobSchema } from './enqueue.js';
import { PermanentNotificationError } from './errors.js';
import { type Recipient, RECIPIENT_RESOLVERS, type RecipientResolver } from './recipients.js';
import {
  ACCOUNT_SECURITY_RULES,
  NOTIFICATION_RULE_CODES,
  type NotificationRuleCode,
  parseRecipientRule,
  type RecipientPart,
} from './rules.js';

export const NOTIFICATION_RENDERER = Symbol('NOTIFICATION_RENDERER');
export type NotificationRenderer = (
  rule: NotificationRuleCode,
  language: Locale,
  params: Record<string, string>,
) => RenderedMail;

/**
 * Тексты из языковых файлов (`mail/messages`, LANG-02). Письма без текста ещё нет — постоянный отказ: тексты
 * NOT-04…NOT-17 приходят со своими этапами.
 */
export const defaultNotificationRenderer: NotificationRenderer = (rule, language, params) => {
  if (!isMailTemplateCode(rule)) throw new PermanentNotificationError(`notification ${rule}: нет текста письма`);
  return renderNotification(rule, language, params);
};

export interface DispatchResult {
  sent: number;
  duplicates: number;
  skippedObservers: number;
  invalid: number;
  skipped: 'disabled' | 'no_recipients' | null;
}

/**
 * Постоянный отказ задания `notify`: код правила (или `unknown`) и причина — поля задания с кодом проверки либо
 * текст `PermanentNotificationError`, который собирает только код платформы; адресов и значений параметров нет.
 * Это результат задания: pg-boss сохраняет его в `output` завершённого задания — отказы находятся запросом
 * `output ? 'refused'`.
 */
export interface NotificationRefusal {
  rule: string;
  refused: 'invalid_job' | 'permanent_failure';
  reason: string;
}

const EMAIL = z.email();
/** При совпадении адреса остаётся получатель с меньшим номером: аккаунт, затем контакт, затем ящик (NOT-18). */
const SOURCE_RANK: Record<Recipient['source'], number> = { account: 0, contact: 1, imbc_mailbox: 2 };

/** Сводка сбоя отправки для журнала: код ошибки SMTP или SQLSTATE, без текста (в нём бывает адрес). */
function failureSummary(error: unknown): object {
  const database = databaseErrorSummary(error);
  if (database) return database;
  const { name, code, responseCode } = (error ?? {}) as { name?: unknown; code?: unknown; responseCode?: unknown };
  return {
    error: typeof name === 'string' ? name : 'Error',
    code: typeof code === 'string' ? code : null,
    responseCode: typeof responseCode === 'number' ? responseCode : null,
  };
}

/** Код правила из данных задания для строки журнала: только известный код, иначе `unknown`. */
function ruleOf(data: unknown): string {
  const rule = (data as { rule?: unknown } | null)?.rule;
  return (NOTIFICATION_RULE_CODES as readonly unknown[]).includes(rule) ? (rule as string) : 'unknown';
}

/**
 * Диспетчер письма события (раздел 8.2): правило из `notification_rule` → части получателей → проверка
 * адреса → без наблюдателей (NOT-21) → один получатель на адрес без учёта регистра (NOT-18) → язык
 * получателя (NOT-19) → текст → `MailService.sendOnce`. Повтор и параллельное задание того же события
 * писем не удваивают: ключ журнала один на событие и адрес. Адреса не попадают ни в журнал процесса,
 * ни в текст ошибки.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly mail: MailService,
    @Inject(RECIPIENT_RESOLVERS) private readonly resolvers: Record<RecipientPart, RecipientResolver>,
    @Inject(NOTIFICATION_RENDERER) private readonly render: NotificationRenderer,
  ) {}

  /**
   * Задание очереди `notify`. Постоянный отказ (неверное задание, неизвестное правило, часть получателей,
   * которой ещё нет, нет текста или подстановки) — строка журнала с кодом правила и причиной, задание
   * завершается без повторов; результат — `NotificationRefusal` с той же причиной (pg-boss кладёт его в `output`
   * задания). Отправка — результат `DispatchResult` (только счётчики). Временный сбой (SMTP, база) — исключение:
   * повтор pg-boss.
   */
  async runJob(data: unknown): Promise<DispatchResult | NotificationRefusal> {
    const parsed = notifyJobSchema.safeParse(data);
    if (!parsed.success) {
      // Только имя верхнего поля и код проверки: значения и ключи параметров в журнал не попадают.
      const fields = [
        ...new Set(parsed.error.issues.map((issue) => `${String(issue.path[0] ?? 'job')}:${issue.code}`)),
      ].join(', ');
      const refusal: NotificationRefusal = {
        rule: ruleOf(data),
        refused: 'invalid_job',
        reason: `неверные поля: ${fields}`,
      };
      this.logger.error(`notification ${refusal.rule}: задание отклонено без повторов — ${refusal.reason}`);
      return refusal;
    }
    try {
      return await this.dispatch(parsed.data);
    } catch (error) {
      if (!(error instanceof PermanentNotificationError)) throw error;
      const refusal: NotificationRefusal = {
        rule: parsed.data.rule,
        refused: 'permanent_failure',
        reason: error.message,
      };
      this.logger.error(`notification ${refusal.rule}: письмо не будет отправлено, без повторов — ${refusal.reason}`);
      return refusal;
    }
  }

  async dispatch(job: NotifyJob): Promise<DispatchResult> {
    const result: DispatchResult = { sent: 0, duplicates: 0, skippedObservers: 0, invalid: 0, skipped: null };
    const [rule] = await this.db
      .select({ recipientRule: notificationRule.recipientRule, enabled: notificationRule.enabled })
      .from(notificationRule)
      .where(eq(notificationRule.code, job.rule));
    if (!rule) throw new PermanentNotificationError(`notification ${job.rule}: правила нет в notification_rule`);
    if (!rule.enabled) {
      this.logger.warn(`notification ${job.rule}: письмо не отправлено — правило выключено`);
      return { ...result, skipped: 'disabled' };
    }

    const found: Recipient[] = [];
    for (const part of parseRecipientRule(rule.recipientRule)) {
      const recipients = await this.resolvers[part](this.db, job);
      if (part === 'imbc_mailbox' && recipients.length === 0)
        this.logger.warn(`notification ${job.rule}: ящик IMBC не задан`);
      found.push(...recipients);
    }

    const valid: Recipient[] = [];
    for (const recipient of found) {
      const email = recipient.email.trim();
      if (EMAIL.safeParse(email).success) valid.push({ ...recipient, email });
      else result.invalid += 1;
    }

    const accounts = await this.accountsOf(valid);
    const observers = new Set(accounts.filter((a) => a.role === 'observer').map((a) => a.login));
    const roleOf = new Map(accounts.map((a) => [a.id, a.role]));
    const kept = ACCOUNT_SECURITY_RULES.includes(job.rule)
      ? valid
      : valid.filter((recipient) => {
          const observer =
            (recipient.accountId !== null && roleOf.get(recipient.accountId) === 'observer') ||
            observers.has(recipient.email.toLowerCase());
          if (observer) result.skippedObservers += 1;
          return !observer;
        });

    const byAddress = new Map<string, Recipient>();
    for (const recipient of kept) {
      const key = recipient.email.toLowerCase();
      const current = byAddress.get(key);
      if (!current || SOURCE_RANK[recipient.source] < SOURCE_RANK[current.source]) byAddress.set(key, recipient);
    }
    if (byAddress.size === 0) result.skipped = 'no_recipients';

    const languageOf = new Map(accounts.map((a) => [a.id, a.locale]));
    let failed = 0;
    let rejected: PermanentNotificationError | null = null;
    for (const recipient of byAddress.values()) {
      const language =
        (recipient.languageAccountId !== null ? languageOf.get(recipient.languageAccountId) : undefined) ??
        DEFAULT_LOCALE;
      let mail: RenderedMail;
      try {
        mail = this.render(job.rule, language, job.params);
      } catch (error) {
        // Текст не собрался: повтор не поможет, если отказ постоянный (нет шаблона или подстановки).
        if (error instanceof PermanentNotificationError) rejected = error;
        else {
          failed += 1;
          this.logger.warn(failureSummary(error), `notification ${job.rule}: текст письма не собран`);
        }
        continue;
      }
      try {
        const outcome = await this.mail.sendOnce(
          {
            ruleCode: job.rule,
            eventKey: job.eventKey,
            to: recipient.email,
            accountId: recipient.accountId,
            language,
            related: job.related,
          },
          mail,
        );
        if (outcome === 'sent') result.sent += 1;
        else result.duplicates += 1;
      } catch (error) {
        // Остальные адреса пробуются; этот уйдёт при повторе задания (строки журнала у него нет).
        failed += 1;
        this.logger.warn(failureSummary(error), `notification ${job.rule}: письмо не отправлено`);
      }
    }
    this.logger.log(
      `notification ${job.rule}: sent ${result.sent}, duplicates ${result.duplicates}, observers ${result.skippedObservers}, invalid ${result.invalid}`,
    );
    if (failed > 0) throw new Error(`notification ${job.rule}: ${failed} не отправлено`);
    if (rejected) throw rejected;
    return result;
  }

  /**
   * Аккаунты получателей и языковые аккаунты по id, а также аккаунты-наблюдатели, чей логин совпадает с
   * адресом получателя без учёта регистра (NOT-21).
   */
  private async accountsOf(recipients: Recipient[]) {
    if (recipients.length === 0) return [];
    const ids = [
      ...new Set(
        recipients.flatMap((r) => [r.accountId, r.languageAccountId]).filter((id): id is string => id !== null),
      ),
    ];
    const logins = [...new Set(recipients.map((r) => r.email.toLowerCase()))];
    const login = sql<string>`lower(${userAccounts.email})`;
    return this.db
      .select({ id: userAccounts.id, login, role: userAccounts.role, locale: userAccounts.locale })
      .from(userAccounts)
      .where(
        or(
          ids.length ? inArray(userAccounts.id, ids) : undefined,
          and(eq(userAccounts.role, 'observer'), inArray(login, logins)),
        ),
      );
  }
}
