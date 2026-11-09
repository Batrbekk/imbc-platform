import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import { ENV, type Env } from '../config/env.js';
import { MAILER } from '../infra/infra.module.js';
import { type MailCode, type MailVars, renderMail } from './templates.js';

/**
 * Отправка писем платформы через SMTP. На dev-стенде SMTP — Mailpit (письма видны в веб-интерфейсе),
 * на test/prod — почтовый релей IMBC (SMTP_URL с логином и TLS).
 * Срочные письма (код входа) отправляются сразу; остальные — через очередь send-notification с дедупликацией.
 */
@Injectable()
export class MailService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAILER) private readonly mailer: Transporter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Не блокируем старт: недоступный SMTP — предупреждение, письма повторит очередь.
    this.mailer
      .verify()
      .then(() => this.logger.log(`SMTP доступен (${new URL(this.env.SMTP_URL).host})`))
      .catch((error: unknown) => this.logger.warn(`SMTP недоступен: ${String(error)}`));
  }

  async send<C extends MailCode>(code: C, to: string, locale: string, vars: MailVars[C]): Promise<void> {
    const { subject, text, html } = renderMail(code, locale, vars);
    await this.mailer.sendMail({
      from: this.env.MAIL_FROM,
      to,
      subject,
      text,
      html,
      headers: { 'X-IMBC-Notification': code },
    });
  }

  /** Готовое письмо из очереди (тема и текст собраны при постановке задания). */
  async sendRaw(to: string, subject: string, text: string, html?: string): Promise<void> {
    await this.mailer.sendMail({ from: this.env.MAIL_FROM, to, subject, text, html });
  }
}
