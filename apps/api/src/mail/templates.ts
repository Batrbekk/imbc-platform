import { DEFAULT_LOCALE, LOCALES, type Locale } from '@imbc/contracts';
import en from './messages/en.json' with { type: 'json' };
import kk from './messages/kk.json' with { type: 'json' };
import ru from './messages/ru.json' with { type: 'json' };

/**
 * Письма платформы (раздел 8.2): тексты — в языковых файлах `messages/<язык>.json`, английский — исходный
 * (LANG-02); язык письма выбирает отправитель по получателю (NOT-19). Письма, которые отправляет сам Keycloak
 * (установка и сброс пароля NOT-01), — в теме писем Keycloak.
 */
export const MAIL_TEMPLATE_CODES = ['NOT-02', 'NOT-03'] as const;
export type MailTemplateCode = (typeof MAIL_TEMPLATE_CODES)[number];

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

interface MailMessages {
  footer: string;
  templates: Record<MailTemplateCode, { subject: string; lines: string[] }>;
}

// Тип проверяет, что в каждом языковом файле есть шаблон каждого письма.
const MESSAGES: Record<Locale, MailMessages> = { en, kk, ru };

export function isMailTemplateCode(code: string): code is MailTemplateCode {
  return (MAIL_TEMPLATE_CODES as readonly string[]).includes(code);
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function toLocale(value: string | null | undefined): Locale {
  return (LOCALES as readonly string[]).includes(value ?? '') ? (value as Locale) : DEFAULT_LOCALE;
}

/** Подстановки `{name}`; недостающая — ошибка с именем подстановки (значений в тексте ошибки нет). */
function fill(code: MailTemplateCode, template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`mail ${code}: нет подстановки {${name}}`);
    return value;
  });
}

/** Письмо на языке получателя: тема, текст и HTML с экранированными значениями. */
export function renderNotification(
  code: MailTemplateCode,
  language: Locale,
  params: Record<string, string>,
): RenderedMail {
  const messages = MESSAGES[language];
  const template = messages.templates[code];
  const subject = fill(code, template.subject, params);
  const lines = template.lines.map((line) => fill(code, line, params));
  const text = [...lines, '', '—', messages.footer].join('\n');
  const html = `<!doctype html><html lang="${language}"><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#1d3fa6;color:#ffffff;padding:16px 24px;font-weight:bold;font-size:16px">IMBC Platform</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.5">${lines.map((x) => `<p style="margin:0 0 12px">${escape(x)}</p>`).join('')}</td></tr>
<tr><td style="padding:16px 24px;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb">${escape(messages.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

type Vars = {
  'NOT-02': { code: string; minutes: number };
  'NOT-03': { minutes: number; link: string };
};

/** Обёртка с языком учётной записи строкой: неизвестный язык — казахский (NOT-19). */
export function renderMail<C extends MailTemplateCode>(code: C, locale: string, vars: Vars[C]): RenderedMail {
  const params = Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, String(value)]));
  return renderNotification(code, toLocale(locale), params);
}
