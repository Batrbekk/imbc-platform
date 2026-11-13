import nodemailer, { type Transport } from 'nodemailer';

/** Письмо, принятое фиктивным транспортом: адрес, тема, тексты и заголовки — как их отдал MailService. */
export interface FakeMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

/**
 * Фиктивный транспорт nodemailer: сети нет (AGENTS.md), письма остаются в `sent`. `failWhen` задаёт адреса,
 * на которых «SMTP» отвечает ошибкой; `delayMs` держит каждое письмо, чтобы параллельные отправки пересекались.
 */
export function fakeTransport(options: { delayMs?: number } = {}) {
  const sent: FakeMail[] = [];
  let fail: (to: string) => boolean = () => false;
  const transport: Transport = {
    name: 'imbc-fake',
    version: '1',
    send(mail, callback) {
      const data = mail.data as { to?: unknown; subject?: unknown; text?: unknown; html?: unknown; headers?: unknown };
      const to = String(data.to);
      const envelope = mail.message.getEnvelope();
      setTimeout(() => {
        if (fail(to)) {
          callback(Object.assign(new Error('Connection refused'), { code: 'ECONNECTION' }), {
            envelope,
            messageId: '',
          });
          return;
        }
        sent.push({
          to,
          subject: String(data.subject),
          text: String(data.text),
          html: String(data.html),
          headers: (data.headers ?? {}) as Record<string, string>,
        });
        callback(null, { envelope, messageId: `<${sent.length}@fake.local>`, accepted: [to], rejected: [] });
      }, options.delayMs ?? 0);
    },
  };
  return {
    transporter: nodemailer.createTransport(transport),
    sent,
    failWhen(predicate: (to: string) => boolean) {
      fail = predicate;
    },
  };
}
