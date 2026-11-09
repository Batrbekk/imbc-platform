import { describe, expect, it } from 'vitest';
import { renderMail, toLocale } from '../src/mail/templates.js';

describe('письма', () => {
  it('код входа на языке учётной записи, казахский по умолчанию', () => {
    expect(renderMail('NOT-02', 'ru', { code: '123456', minutes: 10 }).subject).toContain('Код входа');
    expect(renderMail('NOT-02', 'en', { code: '123456', minutes: 10 }).text).toContain('valid for 10 minutes');
    const kk = renderMail('NOT-02', 'xx', { code: '123456', minutes: 10 });
    expect(kk.subject).toContain('кіру коды');
    expect(kk.html).toContain('lang="kk"');
    expect(toLocale(undefined)).toBe('kk');
  });

  it('экранирует значения в HTML', () => {
    const m = renderMail('NOT-03', 'ru', { minutes: 15, publicUrl: 'https://x/<script>' });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
  });
});
