import { readFileSync } from 'node:fs';
import { LOCALES } from '@imbc/contracts';
import { describe, expect, it } from 'vitest';
import { MAIL_TEMPLATE_CODES, renderNotification } from '../src/mail/templates.js';

// Тексты писем платформы — в языковых файлах, английский — исходный (LANG-02).
const read = (locale: string) =>
  JSON.parse(readFileSync(new URL(`../src/mail/messages/${locale}.json`, import.meta.url), 'utf8')) as unknown;
const messages = Object.fromEntries(LOCALES.map((locale) => [locale, read(locale)])) as Record<string, unknown>;

/** Пары «путь ключа — значение» в порядке файла; элементы массива — `path.0`, `path.1`… */
function entries(node: unknown, prefix = ''): [string, unknown][] {
  if (node === null || typeof node !== 'object') return [[prefix, node]];
  return Object.entries(node).flatMap(([key, value]) => entries(value, prefix ? `${prefix}.${key}` : key));
}

const placeholders = (text: unknown) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('файлы писем (LANG-02)', () => {
  it('три файла писем: одинаковые ключи и длина lines; одни и те же подстановки в каждом ключе; нет ICU-форматов {x, number}, #; английский — источник (LANG-02)', () => {
    const reference = entries(messages.en);
    const paths = reference.map(([path]) => path);
    // Шаблон каждого письма из кода есть в английском файле, и ничего лишнего.
    expect(Object.keys((messages.en as { templates: object }).templates).sort()).toEqual([...MAIL_TEMPLATE_CODES]);
    expect(paths).toContain('footer');
    for (const code of MAIL_TEMPLATE_CODES) {
      expect(paths, code).toContain(`templates.${code}.subject`);
      expect(paths, code).toContain(`templates.${code}.lines.0`);
    }
    const english = new Map(reference);
    for (const locale of LOCALES) {
      const own = entries(messages[locale]);
      // Те же ключи в том же порядке; для lines — та же длина (индексы входят в путь).
      expect(
        own.map(([path]) => path),
        locale,
      ).toEqual(paths);
      for (const [path, text] of own) {
        expect(typeof text, `${locale}: ${path}`).toBe('string');
        expect(String(text).trim(), `${locale}: ${path}`).not.toBe('');
        expect(placeholders(text), `${locale}: ${path}`).toEqual(placeholders(english.get(path)));
        // Числа и даты подставляются готовыми строками; ICU-форматов и `#` в письмах нет.
        expect(String(text), `${locale}: ${path}`).not.toMatch(/#|\{\s*\w+\s*,/);
      }
    }
  });

  it('renderNotification: экранирует HTML, недостающая подстановка — ошибка', () => {
    const mail = renderNotification('NOT-03', 'en', { minutes: '15', link: 'https://imbc.local/login?a=1&b="<x>"' });
    expect(mail.text).toContain('https://imbc.local/login?a=1&b="<x>"');
    expect(mail.html).toContain('https://imbc.local/login?a=1&amp;b=&quot;&lt;x&gt;&quot;');
    expect(mail.html).not.toContain('<x>');
    expect(mail.html).toContain('lang="en"');
    expect(mail.subject).not.toMatch(/\{\w+\}/);
    for (const locale of LOCALES) {
      const ru = renderNotification('NOT-02', locale, { code: '482651', minutes: '10' });
      expect(ru.subject, locale).toContain('482651');
      expect(`${ru.subject}${ru.text}${ru.html}`, locale).not.toMatch(/\{\w+\}/);
    }
    expect(() => renderNotification('NOT-03', 'kk', { minutes: '15' })).toThrow(/\{link\}/);
    expect(() => renderNotification('NOT-02', 'ru', { minutes: '10' })).toThrow(/\{code\}/);
  });
});
