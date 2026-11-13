import type { Locale } from '@imbc/contracts';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import { ENV, type Env } from '../config/env.js';
import { DB, type Database } from '../database/database.module.js';
import { notification } from '../database/schema/index.js';
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

/**
 * Отправка писем платформы через SMTP. На dev-стенде SMTP — Mailpit (письма видны в веб-интерфейсе),
 * на test/prod — почтовый релей IMBC (SMTP_URL с логином и TLS).
 * Каждое письмо — строка журнала `notification` (NOT-18): код входа (NOT-02) отправляет API сразу,
 * остальные — worker через очередь `notify` и диспетчер.
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
      const [claimed] = await tx
        .insert(notification)
        .values({
          ruleCode: entry.ruleCode,
          recipientEmail: to,
          userAccountId: entry.accountId,
          language: entry.language,
          dedupKey: notificationDedupKey(entry.ruleCode, entry.eventKey, to),
          relatedObjectType: entry.related?.type ?? null,
          relatedObjectId: entry.related?.id ?? null,
        })
        .onConflictDoNothing({ target: notification.dedupKey })
        .returning({ id: notification.id });
      if (!claimed) return 'duplicate';
      await this.mailer.sendMail({
        from: this.env.MAIL_FROM,
        to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        headers: { 'X-IMBC-Notification': entry.ruleCode },
      });
      return 'sent';
    });
  }
}
