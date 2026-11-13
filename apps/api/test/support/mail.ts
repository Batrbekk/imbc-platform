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
 * Фиктивный транспорт nodemailer: сети нет (AGENTS.md), письма остаются в `sent`.
 * - `failWhen` задаёт адреса, на которых «SMTP» отвечает ошибкой (предикат видит адрес и номер попытки к нему);
 * - `delayMs` держит каждое письмо, чтобы параллельные отправки пересекались;
 * - `hold()` останавливает все отправки, пока не вызвана возвращённая функция; `pending` — сколько ждут.
 */
export function fakeTransport(options: { delayMs?: number } = {}) {
  const sent: FakeMail[] = [];
  const attempts = new Map<string, number>();
  let fail: (to: string, attempt: number) => boolean = () => false;
  let gate: Promise<void> = Promise.resolve();
  const state = { pending: 0 };
  const transport: Transport = {
    name: 'imbc-fake',
    version: '1',
    send(mail, callback) {
      const data = mail.data as { to?: unknown; subject?: unknown; text?: unknown; html?: unknown; headers?: unknown };
      const to = String(data.to);
      const envelope = mail.message.getEnvelope();
      state.pending += 1;
      void gate.then(() =>
        setTimeout(() => {
          state.pending -= 1;
          const attempt = (attempts.get(to) ?? 0) + 1;
          attempts.set(to, attempt);
          if (fail(to, attempt)) {
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
        }, options.delayMs ?? 0),
      );
    },
  };
  return {
    transporter: nodemailer.createTransport(transport),
    sent,
    state,
    /** Сколько раз «SMTP» получал письмо на адрес (успешно или со сбоем). */
    attempts,
    failWhen(predicate: (to: string, attempt: number) => boolean) {
      fail = predicate;
    },
    hold(): () => void {
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        gate = Promise.resolve();
        release();
      };
    },
  };
}
