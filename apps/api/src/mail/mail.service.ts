import type { Locale } from '@imbc/contracts';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Transporter } from 'nodemailer';
import { ENV, type Env } from '../config/env.js';
import { DB, type Database } from '../database/database.module.js';
import { databaseErrorSummary } from '../database/pg-errors.js';
import { notification, notificationsSent } from '../database/schema/index.js';
import { MAILER } from '../infra/infra.module.js';
import { notificationDedupKey, type NotificationRuleCode } from '../notifications/rules.js';
import type { RenderedMail } from './templates.js';

/** Запись журнала для одного письма: правило, событие, адрес, аккаунт, язык и объект события. */
export interface NotificationEntry {
  ruleCode: NotificationRuleCode;
  eventKey: string;
  to: string;
  accountId: string | null;
  language: Locale;
  related?: { type: string; id: string };
}

const journalRow = (entry: NotificationEntry, to: string) => ({
  ruleCode: entry.ruleCode,
  recipientEmail: to,
  userAccountId: entry.accountId,
  language: entry.language,
  dedupKey: notificationDedupKey(entry.ruleCode, entry.eventKey, to),
  relatedObjectType: entry.related?.type ?? null,
  relatedObjectId: entry.related?.id ?? null,
});

/**
 * Отправка писем платформы через SMTP. На dev-стенде SMTP — Mailpit (письма видны в веб-интерфейсе),
 * на test/prod — почтовый релей IMBC (SMTP_URL с логином и TLS).
 * Каждое письмо — строка журнала `notification` (NOT-18): код входа (NOT-02) отправляет API сразу
 * (`sendImmediate`), остальные — worker через очередь `notify` и диспетчер (`sendOnce`).
 */
@Injectable()
export class MailService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAILER) private readonly mailer: Transporter,
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Database,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Не блокируем старт: недоступный SMTP — предупреждение, письма повторит очередь.
    this.mailer
      .verify()
      .then(() => this.logger.log(`SMTP доступен (${new URL(this.env.SMTP_URL).host})`))
      .catch((error: unknown) => this.logger.warn(`SMTP недоступен: ${String(error)}`));
  }

  /**
   * Одно письмо на событие и адрес (NOT-18): строка журнала и отправка — одна транзакция. Ключ уже в
   * журнале — `duplicate`, письма нет; параллельная отправка того же ключа ждёт эту транзакцию и получает
   * `duplicate`. Сбой SMTP — откат строки и исключение: повтор задания отправит письмо. Дубль возможен
   * только при обрыве между приёмом письма SMTP и COMMIT (расхождение 14 плана этапа 2).
   */
  async sendOnce(entry: NotificationEntry, mail: RenderedMail): Promise<'sent' | 'duplicate'> {
    const to = entry.to.trim();
    return this.db.transaction(async (tx) => {
      if (await this.sentByPreviousVersion(tx, entry, to)) return 'duplicate';
      const [claimed] = await tx
        .insert(notification)
        .values(journalRow(entry, to))
        .onConflictDoNothing({ target: notification.dedupKey })
        .returning({ id: notification.id });
      if (!claimed) return 'duplicate';
      await this.deliver(entry, to, mail);
      return 'sent';
    });
  }

  /**
   * Письмо, которого человек ждёт на экране (код входа NOT-02): ключ события уникален (id кода), так что
   * транзакция вокруг SMTP ничего не дедуплицирует, а соединение базы на время SMTP держала бы. Сначала
   * отправка — сбой SMTP уходит вызывающему (код отбрасывается, 503); затем строка журнала. Сбой записи
   * журнала после отправки — предупреждение без адреса: письмо ушло, вход не ломается.
   */
  async sendImmediate(entry: NotificationEntry, mail: RenderedMail): Promise<void> {
    const to = entry.to.trim();
    await this.deliver(entry, to, mail);
    try {
      await this.db
        .insert(notification)
        .values(journalRow(entry, to))
        .onConflictDoNothing({ target: notification.dedupKey });
    } catch (error) {
      this.logger.warn(
        databaseErrorSummary(error) ?? { error: error instanceof Error ? error.name : 'Error' },
        `notification ${entry.ruleCode}: письмо отправлено, строка журнала не записана`,
      );
    }
  }

  private async deliver(entry: NotificationEntry, to: string, mail: RenderedMail): Promise<void> {
    await this.mailer.sendMail({
      from: this.env.MAIL_FROM,
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      headers: { 'X-IMBC-Notification': entry.ruleCode },
    });
  }

  /**
   * Expand (NFR-06): предыдущая версия worker в окне выката пишет NOT-03 в `notifications_sent`. Строка с тем
   * же ключом события и адресом там — письмо уже ушло: исход `duplicate`, строка в новый журнал не нужна.
   * Убрать в contract вместе с `notifications_sent`.
   */
  private async sentByPreviousVersion(
    tx: Pick<Database, 'select'>,
    entry: NotificationEntry,
    to: string,
  ): Promise<boolean> {
    if (entry.ruleCode !== 'NOT-03') return false;
    const [legacy] = await tx
      .select({ id: notificationsSent.id })
      .from(notificationsSent)
      .where(
        and(
          eq(notificationsSent.code, 'NOT-03'),
          eq(notificationsSent.dedupeKey, entry.eventKey),
          eq(sql`lower(${notificationsSent.recipient})`, to.toLowerCase()),
        ),
      );
    return legacy !== undefined;
  }
}
