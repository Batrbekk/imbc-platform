import { DEFAULT_LOCALE, LOCALES, SECTION_KINDS, type Locale, type SectionKind } from '@imbc/contracts';
import { z } from 'zod';
import en from './messages/en.json' with { type: 'json' };
import kk from './messages/kk.json' with { type: 'json' };
import ru from './messages/ru.json' with { type: 'json' };
import { PermanentNotificationError } from '../notifications/errors.js';

/**
 * Письма платформы (раздел 8.2): тексты — в языковых файлах `messages/<язык>.json`, английский — исходный
 * (LANG-02); язык письма выбирает отправитель по получателю (NOT-19). Письма, которые отправляет сам Keycloak
 * (установка и сброс пароля NOT-01), — в теме писем Keycloak.
 */
export const MAIL_TEMPLATE_CODES = ['NOT-02', 'NOT-03', 'NOT-04', 'NOT-05', 'NOT-10'] as const;
export type MailTemplateCode = (typeof MAIL_TEMPLATE_CODES)[number];

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

interface MailMessages {
  footer: string;
  templates: Record<MailTemplateCode, { subject: string; lines: string[] }>;
  review: {
    verified: string;
    returned: string;
    changes: string;
    accepted: string;
    acceptedRetained: string;
    rejected: string;
    sections: Record<SectionKind, string>;
  };
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

/**
 * Подстановки `{name}`; недостающая — постоянный отказ с именем подстановки (значений в тексте ошибки нет):
 * повтор задания письма не соберёт.
 */
function fill(code: MailTemplateCode, template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new PermanentNotificationError(`mail ${code}: нет подстановки {${name}}`);
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
  const resolved = code === 'NOT-05' ? { ...params, ...reviewResultParams(messages, params) } : params;
  const subject = fill(code, template.subject, resolved);
  const lines = template.lines.map((line) => fill(code, line, resolved)).filter((line) => line !== '');
  const text = [...lines, '', '—', messages.footer].join('\n');
  const html = `<!doctype html><html lang="${language}"><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#1d3fa6;color:#ffffff;padding:16px 24px;font-weight:bold;font-size:16px">IMBC Platform</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.5">${lines.map((x) => `<p style="margin:0 0 12px">${escape(x).replace(/\r?\n/g, '<br>')}</p>`).join('')}</td></tr>
<tr><td style="padding:16px 24px;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb">${escape(messages.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

type Vars = {
  'NOT-02': { code: string; minutes: number };
  'NOT-03': { minutes: number; link: string };
  'NOT-04': { name: string; link: string };
  'NOT-05': { mode: string; status: string; sections: string; link: string };
  'NOT-10': { name: string; link: string };
};

const resultSectionSchema = z.strictObject({
  kind: z.enum(SECTION_KINDS),
  outcome: z.enum(['verified', 'rejected']),
  comment: z.string().nullable(),
  reviewRequired: z.boolean(),
  notificationRelevant: z.boolean(),
  publication: z.enum(['published', 'retained', 'rejected', 'unchanged']),
});
const resultSchema = z
  .strictObject({
    mode: z.enum(['initial', 'resubmit', 'verified_changes']),
    status: z.enum(['verified', 'returned']),
    sections: z.array(resultSectionSchema).length(SECTION_KINDS.length),
  })
  .superRefine((result, ctx) => {
    if (
      new Set(result.sections.map((section) => section.kind)).size !== SECTION_KINDS.length ||
      result.status !==
        (result.mode === 'verified_changes' || result.sections.every((section) => section.outcome === 'verified')
          ? 'verified'
          : 'returned') ||
      result.sections.some(
        (section) =>
          section.notificationRelevant !==
            (result.mode === 'verified_changes'
              ? section.publication !== 'unchanged'
              : section.outcome === 'rejected') ||
          (section.outcome === 'rejected'
            ? !section.comment?.trim() || !['rejected', 'unchanged'].includes(section.publication)
            : !['published', 'retained', 'unchanged'].includes(section.publication)),
      )
    )
      ctx.addIssue({ code: 'custom', message: 'review_result_mismatch' });
  });

/** Only the database-aware renderer supplies these immutable decision values; queued params hold IDs. */
function reviewResultParams(
  messages: MailMessages,
  params: Record<string, string>,
): { result: string; details: string } {
  let sections: unknown;
  try {
    sections = JSON.parse(params.sections ?? 'null');
  } catch {
    throw new PermanentNotificationError('mail NOT-05: invalid review result');
  }
  const parsed = resultSchema.safeParse({ mode: params.mode, status: params.status, sections });
  if (!parsed.success) throw new PermanentNotificationError('mail NOT-05: invalid review result');
  const result = parsed.data;
  const details = SECTION_KINDS.flatMap((kind) => {
    const section = result.sections.find((section) => section.kind === kind)!;
    if (!section.notificationRelevant) return [];
    const line =
      section.outcome === 'rejected'
        ? messages.review.rejected
        : section.publication === 'retained'
          ? messages.review.acceptedRetained
          : messages.review.accepted;
    return [fill('NOT-05', line, { section: messages.review.sections[kind], comment: section.comment ?? '' })];
  });
  return {
    result: result.mode === 'verified_changes' ? messages.review.changes : messages.review[result.status],
    details: details.join('\n'),
  };
}

/** Обёртка с языком учётной записи строкой: неизвестный язык — казахский (NOT-19). */
export function renderMail<C extends MailTemplateCode>(code: C, locale: string, vars: Vars[C]): RenderedMail {
  const params = Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, String(value)]));
  return renderNotification(code, toLocale(locale), params);
}
