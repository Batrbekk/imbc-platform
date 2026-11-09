import { DEFAULT_LOCALE, LOCALES, type Locale } from '@imbc/contracts';

/**
 * Письма платформы (раздел 9 спецификации, LANG-02): язык письма — язык учётной записи получателя.
 * Письма, которые отправляет сам Keycloak (установка пароля NOT-01, сброс пароля AUTH-08), — в теме Keycloak.
 */
export type MailCode = 'NOT-02' | 'NOT-03';

interface Template<V> {
  subject: (v: V) => string;
  lines: (v: V) => string[];
}

type Vars = {
  'NOT-02': { code: string; minutes: number };
  'NOT-03': { minutes: number; publicUrl: string };
};

const T: { [C in MailCode]: Record<Locale, Template<Vars[C]>> } = {
  'NOT-02': {
    kk: {
      subject: (v) => `IMBC платформасына кіру коды: ${v.code}`,
      lines: (v) => [
        `Кіру коды: ${v.code}`,
        `Код ${v.minutes} минут жарамды. Егер кірмеген болсаңыз, бұл хатты елемеңіз және құпиясөзді ауыстырыңыз.`,
      ],
    },
    ru: {
      subject: (v) => `Код входа в платформу IMBC: ${v.code}`,
      lines: (v) => [
        `Код входа: ${v.code}`,
        `Код действует ${v.minutes} минут. Если вы не входили, проигнорируйте письмо и смените пароль.`,
      ],
    },
    en: {
      subject: (v) => `IMBC Platform sign-in code: ${v.code}`,
      lines: (v) => [
        `Sign-in code: ${v.code}`,
        `The code is valid for ${v.minutes} minutes. If this wasn't you, ignore this email and change your password.`,
      ],
    },
  },
  'NOT-03': {
    kk: {
      subject: () => 'IMBC платформасындағы тіркелгі уақытша бұғатталды',
      lines: (v) => [
        `Құпиясөз бірнеше рет қате енгізілді, сондықтан тіркелгі ${v.minutes} минутқа бұғатталды.`,
        `Егер бұл сіз болмасаңыз, құпиясөзді ауыстырыңыз: ${v.publicUrl}`,
      ],
    },
    ru: {
      subject: () => 'Учётная запись в платформе IMBC временно заблокирована',
      lines: (v) => [
        `Пароль несколько раз введён неверно, поэтому вход заблокирован на ${v.minutes} минут.`,
        `Если это были не вы, смените пароль: ${v.publicUrl}`,
      ],
    },
    en: {
      subject: () => 'Your IMBC Platform account is temporarily locked',
      lines: (v) => [
        `The password was entered incorrectly several times, so sign-in is locked for ${v.minutes} minutes.`,
        `If this wasn't you, change your password: ${v.publicUrl}`,
      ],
    },
  },
};

const FOOTER: Record<Locale, string> = {
  kk: 'Бұл хат автоматты түрде жіберілді, оған жауап бермеңіз.',
  ru: 'Письмо отправлено автоматически, отвечать на него не нужно.',
  en: 'This email was sent automatically, please do not reply.',
};

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function toLocale(value: string | null | undefined): Locale {
  return (LOCALES as readonly string[]).includes(value ?? '') ? (value as Locale) : DEFAULT_LOCALE;
}

export function renderMail<C extends MailCode>(code: C, locale: string, vars: Vars[C]) {
  const l = toLocale(locale);
  const t = T[code][l] as Template<Vars[C]>;
  const lines = t.lines(vars);
  const subject = t.subject(vars);
  const text = [...lines, '', '—', FOOTER[l]].join('\n');
  const html = `<!doctype html><html lang="${l}"><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#1d3fa6;color:#ffffff;padding:16px 24px;font-weight:bold;font-size:16px">IMBC Platform</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.5">${lines.map((x) => `<p style="margin:0 0 12px">${escape(x)}</p>`).join('')}</td></tr>
<tr><td style="padding:16px 24px;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb">${escape(FOOTER[l])}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export type { Vars as MailVars };
