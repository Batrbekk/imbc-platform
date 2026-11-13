import { readdirSync, readFileSync, statSync } from 'node:fs';
import { sep } from 'node:path';
import { LOCALES, type Locale } from '@imbc/contracts';
import { describe, expect, it } from 'vitest';

// NOT-01 (пароль: регистрация, приглашение, сброс) отправляет Keycloak, а не платформа: язык письма — атрибут
// `locale` пользователя (NOT-19), срок ссылки называет сам Keycloak (NOT-20). Тема писем `imbc` лежит в пакете
// темы входа, в том же JAR; шаблоны `.ftl` остаются от базовой темы Keycloak (`parent=base`), своего у темы — только
// тексты в `messages_<язык>.properties` (LANG-02, источник — английский).
const repository = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const THEME_DIR = 'infrastructure/keycloak/identity/src/email';
const themeFile = (path: string) => repository(`${THEME_DIR}/${path}`);

interface Entry {
  /** Значение как записано в файле, до снятия экранирования. */
  raw: string;
  /** Значение, каким его прочтёт `java.util.Properties`: `\n` — перевод строки, `\\` — одна косая черта. */
  value: string;
}

/**
 * Разбор `.properties` как в Java: комментарии `#`/`!`, разделитель `=`/`:`/пробел, продолжение строки обратной
 * косой чертой в конце, escape-последовательности значения (`\n`, `\t`, `\r`, `\f`, `\uXXXX`, `\x` → `x`).
 */
function parseProperties(source: string): Map<string, Entry> {
  const logical: string[] = [];
  let pending = '';
  for (const line of source.split(/\r?\n/)) {
    const text = pending ? line.replace(/^\s+/, '') : line;
    const trailing = /\\+$/.exec(text)?.[0].length ?? 0;
    if (trailing % 2 === 1) {
      pending += text.slice(0, -1);
      continue;
    }
    logical.push(pending + text);
    pending = '';
  }
  const entries = new Map<string, Entry>();
  for (const line of logical) {
    const trimmed = line.replace(/^\s+/, '');
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
    const match = /^((?:[^\s=:\\]|\\.)+)\s*[=:]?\s*(.*)$/.exec(trimmed);
    expect(match, `строка .properties не разобрана: ${trimmed.slice(0, 60)}`).not.toBeNull();
    const [, key, raw] = match!;
    const value = raw!.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_all, code: string) => {
      if (code.length === 5) return String.fromCharCode(parseInt(code.slice(1), 16));
      return ({ n: '\n', t: '\t', r: '\r', f: '\f' } as Record<string, string>)[code] ?? code;
    });
    entries.set(key!.replace(/\\(.)/g, '$1'), { raw: raw!, value });
  }
  return entries;
}

const messages = Object.fromEntries(
  LOCALES.map((locale) => [locale, parseProperties(themeFile(`messages/messages_${locale}.properties`))]),
) as Record<Locale, Map<string, Entry>>;
const english = messages.en;

// Параметры базовых шаблонов Keycloak 26.4: `{0}` ссылка, `{1}` срок числом минут, `{2}` имя realm.
const SUBJECT_KEYS = ['executeActionsSubject', 'passwordResetSubject', 'emailVerificationSubject'] as const;
/** Тело письма → [параметр ссылки, параметр срока]: у executeActions `{3}` — перечень действий, срок — `{4}`. */
const BODY_PARAMS: Record<string, readonly [string, string]> = {
  executeActionsBody: ['{0}', '{4}'],
  executeActionsBodyHtml: ['{0}', '{4}'],
  passwordResetBody: ['{0}', '{3}'],
  passwordResetBodyHtml: ['{0}', '{3}'],
  emailVerificationBody: ['{0}', '{3}'],
  emailVerificationBodyHtml: ['{0}', '{3}'],
};
const UNIT_KEYS = ['seconds', 'minutes', 'hours', 'days'].map((unit) => `linkExpirationFormatter.timePeriodUnit.${unit}`);
const REQUIRED_KEYS = [
  ...SUBJECT_KEYS,
  ...Object.keys(BODY_PARAMS),
  'requiredAction.UPDATE_PASSWORD',
  'requiredAction.VERIFY_EMAIL',
  ...UNIT_KEYS,
];

const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\d+)\}/g)].map((m) => `{${m[1]}}`))].sort();

/** `MessageFormat` без форматов: `{n}` — аргумент, `''` — одна кавычка. */
const format = (pattern: string, args: string[]) =>
  pattern.replace(/\{(\d+)\}/g, (_all, index: string) => args[Number(index)] ?? `{${index}}`).replace(/''/g, "'");

/** `{0,choice,0#a|1#b|1<c}` как у `java.text.ChoiceFormat`: последний предел, который не больше значения. */
function choose(pattern: string, value: number): string {
  const match = /^\{0,choice,(.*)\}$/.exec(pattern);
  if (!match) return pattern;
  const parts = match[1]!.split('|').map((part) => {
    const split = /^(\d+)([#<])(.*)$/.exec(part);
    expect(split, `часть формата choice не разобрана: ${part}`).not.toBeNull();
    return { limit: Number(split![1]), strict: split![2] === '<', text: split![3]! };
  });
  expect(
    parts.map((p) => p.limit),
    'пределы choice идут по возрастанию',
  ).toEqual([...parts.map((p) => p.limit)].sort((a, b) => a - b));
  let chosen = parts[0]!.text;
  for (const part of parts) if (part.strict ? value > part.limit : value >= part.limit) chosen = part.text;
  return chosen;
}

const get = (locale: Locale, key: string) => {
  const entry = messages[locale].get(key);
  expect(entry, `${locale}: нет ключа ${key}`).toBeDefined();
  return entry!;
};

describe('тема писем Keycloak imbc (NOT-01, NOT-19, NOT-20, LANG-02)', () => {
  it('три файла сообщений с одинаковыми ключами; обязательные ключи на месте; значения не пустые', () => {
    const reference = [...english.keys()];
    expect(reference).toEqual(expect.arrayContaining(REQUIRED_KEYS));
    // Ничего лишнего: каждый ключ нужен письму, которое отправляет платформа (регистрация, приглашение, сброс).
    expect([...reference].sort()).toEqual([...REQUIRED_KEYS].sort());
    for (const locale of LOCALES) {
      expect([...messages[locale].keys()], locale).toEqual(reference);
      for (const [key, { value }] of messages[locale]) expect(value.trim(), `${locale}: ${key}`).not.toBe('');
    }
  });

  it('kk и ru не совпадают с en ни в одной теме и теле', () => {
    for (const key of REQUIRED_KEYS) {
      for (const locale of ['kk', 'ru'] as const) {
        expect(get(locale, key).value, `${locale}: ${key}`).not.toBe(get('en', key).value);
      }
    }
    // Темы: название платформы и действие — как в задаче (NOT-19).
    expect(get('en', 'executeActionsSubject').value).toBe('IMBC Platform: set your password');
    expect(get('en', 'passwordResetSubject').value).toBe('IMBC Platform: reset your password');
    expect(get('ru', 'executeActionsSubject').value).toBe('Платформа IMBC: установите пароль');
    expect(get('ru', 'passwordResetSubject').value).toBe('Платформа IMBC: сброс пароля');
    expect(get('kk', 'executeActionsSubject').value).toBe('IMBC платформасы: құпиясөзді орнатыңыз');
    expect(get('kk', 'passwordResetSubject').value).toBe('IMBC платформасы: құпиясөзді қалпына келтіру');
  });

  it('в каждом теле есть параметр ссылки и параметр срока; числа часов в тексте нет; числового срока {1} нет (NOT-20)', () => {
    for (const [key, [link, expiry]] of Object.entries(BODY_PARAMS)) {
      for (const locale of LOCALES) {
        const { value } = get(locale, key);
        expect(value, `${locale}: ${key}`).toContain(link);
        // Срок подставляет форматтер Keycloak («3 days», «3 дня», «3 күн»): число часов в тексты не зашито.
        expect(value, `${locale}: ${key}`).toContain(expiry);
        expect(value, `${locale}: ${key} — {1} печатает минуты числом`).not.toContain('{1}');
        expect(value.replace(/\{\d+\}/g, ''), `${locale}: ${key} — число в тексте`).not.toMatch(/\d/);
        expect(placeholders(value), `${locale}: ${key}`).toEqual(placeholders(get('en', key).value));
      }
    }
    // HTML-вариант ведёт по той же ссылке, пароль в письме не отправляется — ссылка, а не значение.
    for (const key of Object.keys(BODY_PARAMS).filter((name) => name.endsWith('Html'))) {
      for (const locale of LOCALES) expect(get(locale, key).value, `${locale}: ${key}`).toMatch(/<a href="\{0\}">[^<]+<\/a>/);
    }
  });

  it('в значениях нет буквальных «\\n»: перевод строки записан как \\n, а не \\\\n (прежний казахский текст Keycloak 26.4)', () => {
    // Казахский пакет Keycloak 26.4 (resources-community, base/email) записывает `\\n\\n`: в письме видны символы
    // «\n\n». Тема imbc перекрывает его, поэтому ни одно значение, ни в одном языке, не содержит двух обратных
    // косых черт, и после снятия экранирования обратной косой черты не остаётся вовсе.
    for (const locale of LOCALES) {
      for (const [key, { raw, value }] of messages[locale]) {
        expect(raw, `${locale}: ${key} — \\\\n в файле печатается в письме как «\\n»`).not.toMatch(/\\\\n/);
        expect(raw, `${locale}: ${key}`).not.toMatch(/\\\\/);
        expect(value, `${locale}: ${key}`).not.toContain('\\');
      }
    }
  });

  it('текстовые тела: настоящие переводы строк, ссылка на отдельной строке между пустыми; в HTML-телах переводов строк нет', () => {
    for (const key of Object.keys(BODY_PARAMS)) {
      for (const locale of LOCALES) {
        const { value } = get(locale, key);
        if (key.endsWith('Html')) {
          expect(value, `${locale}: ${key}`).not.toContain('\n');
          expect(value, `${locale}: ${key}`).toMatch(/^<p>.*<\/p>$/);
          continue;
        }
        const lines = value.split('\n');
        const at = lines.indexOf('{0}');
        expect(at, `${locale}: ${key} — ссылка на отдельной строке`).toBeGreaterThan(0);
        expect(lines[at - 1], `${locale}: ${key}`).toBe('');
        expect(lines[at + 1], `${locale}: ${key}`).toBe('');
        // Абзацы разделены одной пустой строкой, без пустых хвостов.
        expect(lines.filter((line) => line.trim() === '').length, `${locale}: ${key}`).toBeGreaterThanOrEqual(2);
        expect(lines.at(-1)?.trim(), `${locale}: ${key}`).not.toBe('');
        expect(value, `${locale}: ${key}`).not.toMatch(/\n{3}/);
      }
    }
  });

  it('значения разбирает MessageFormat Keycloak: одиночной кавычки нет, фигурные скобки — только параметры и choice', () => {
    for (const locale of LOCALES) {
      for (const [key, { value }] of messages[locale]) {
        expect(value, `${locale}: ${key} — одиночная кавычка начинает «цитату» MessageFormat`).not.toMatch(/(?<!')'(?!')/);
        const withoutChoice = UNIT_KEYS.includes(key) ? '' : value;
        expect(withoutChoice.replace(/\{\d+\}/g, ''), `${locale}: ${key}`).not.toMatch(/[{}]/);
      }
    }
  });

  it('единицы срока: как форматтер Keycloak, «3 days», «3 дня», «3 күн»; русские формы по правилу 1 / 2–4 / 5–20 / 21…', () => {
    // LinkExpirationFormatterMethod: «<число> <MessageFormat(timePeriodUnit.<единица>, число)>»; 72 часа — 3 days.
    const unit = (locale: Locale, name: string, value: number) =>
      `${value} ${choose(get(locale, `linkExpirationFormatter.timePeriodUnit.${name}`).value, value)}`;
    expect(unit('en', 'days', 3)).toBe('3 days');
    expect(unit('en', 'days', 1)).toBe('1 day');
    expect(unit('ru', 'days', 3)).toBe('3 дня');
    expect(unit('kk', 'days', 3)).toBe('3 күн');
    expect(unit('kk', 'hours', 72)).toBe('72 сағат');
    expect(unit('ru', 'hours', 72)).toBe('72 часа');
    expect(unit('ru', 'minutes', 30)).toBe('30 минут');

    const forms = {
      seconds: ['секунда', 'секунды', 'секунд'],
      minutes: ['минута', 'минуты', 'минут'],
      hours: ['час', 'часа', 'часов'],
      days: ['день', 'дня', 'дней'],
    };
    const russianForm = (n: number) => {
      if (n % 100 >= 11 && n % 100 <= 14) return 2;
      if (n % 10 === 1) return 0;
      return n % 10 >= 2 && n % 10 <= 4 ? 1 : 2;
    };
    for (const [name, [one, few, many]] of Object.entries(forms)) {
      const pattern = get('ru', `linkExpirationFormatter.timePeriodUnit.${name}`).value;
      for (let n = 0; n <= 100; n += 1) {
        expect(choose(pattern, n), `ru: ${name} ${n}`).toBe([one, few, many][n === 0 ? 2 : russianForm(n)]);
      }
      // По-казахски существительное после числа не изменяется.
      const kazakh = get('kk', `linkExpirationFormatter.timePeriodUnit.${name}`).value;
      for (let n = 0; n <= 100; n += 1) expect(choose(kazakh, n), `kk: ${name} ${n}`).toBe(choose(kazakh, 1));
    }
  });

  it('письмо в сборе: ссылка, срок «3 …», тема не пустая, лишних параметров нет', () => {
    const link = 'https://imbc.local/kc/realms/imbc/login-actions/action-token?key=abc&client_id=imbc-bff';
    for (const locale of LOCALES) {
      const days = `3 ${choose(get(locale, 'linkExpirationFormatter.timePeriodUnit.days').value, 3)}`;
      for (const [key, [, expiry]] of Object.entries(BODY_PARAMS)) {
        // Параметры базовых шаблонов: {1} — минуты числом, {2} — имя realm, executeActions: {3} — действия, срок — {4}.
        const args = expiry === '{4}' ? [link, '4320', 'IMBC Platform', 'actions', days] : [link, '4320', 'IMBC Platform', days];
        const body = format(get(locale, key).value, args);
        expect(body, `${locale}: ${key}`).toContain(link);
        expect(body, `${locale}: ${key}`).toContain(days);
        expect(body, `${locale}: ${key}`).not.toMatch(/\{\d+\}|\\n/);
        expect(body, `${locale}: ${key} — кроме ссылки и срока в письме нет подставленных значений`).not.toContain('4320');
      }
    }
  });
});

describe('тема писем imbc: состав и подключение', () => {
  it('theme.properties: parent=base, locales kk,ru,en', () => {
    const properties = parseProperties(themeFile('theme.properties'));
    expect(properties.get('parent')?.value).toBe('base');
    expect(properties.get('locales')?.value).toBe('kk,ru,en');
    expect([...properties.keys()].sort()).toEqual(['locales', 'parent']);
  });

  it('шаблоны .ftl базовой темы не переопределяются: в теме только theme.properties и три файла сообщений', () => {
    const root = new URL(`../../../${THEME_DIR}/`, import.meta.url);
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((path) => statSync(new URL(path, root)).isFile())
      .map((path) => path.split(sep).join('/'))
      .sort();
    expect(files).toEqual(['messages/messages_en.properties', 'messages/messages_kk.properties', 'messages/messages_ru.properties', 'theme.properties']);
  });

  it('тема собирается в тот же JAR, что и тема входа: имя imbc задаёт один themeName', () => {
    const vite = repository('infrastructure/keycloak/identity/vite.config.ts');
    expect(vite).toMatch(/keycloakify\(\{\s*themeName: "imbc"/);
    expect(vite).toContain('"all-other-versions": "imbc-theme.jar"');
    expect(repository('infrastructure/keycloak/identity/Dockerfile')).toContain('/opt/keycloak/providers/imbc-theme.jar');
  });

  it('realm: emailTheme — ${KEYCLOAK_EMAIL_THEME}; compose.yaml — по умолчанию keycloak, compose.azure.yaml — imbc', () => {
    const realm = JSON.parse(repository('infrastructure/keycloak/imbc-realm.json')) as Record<string, unknown>;
    expect(realm.emailTheme).toBe('${KEYCLOAK_EMAIL_THEME}');
    expect(realm.loginTheme).toBe('${KEYCLOAK_LOGIN_THEME}');
    const block = (file: string) => {
      const lines = file.split('\n');
      const start = lines.indexOf('  keycloak:');
      expect(start).toBeGreaterThan(-1);
      const end = lines.findIndex((line, i) => i > start && /^ {0,2}[^\s#]/.test(line));
      return lines.slice(start, end === -1 ? undefined : end).join('\n');
    };
    expect(block(repository('compose.yaml'))).toMatch(/^ {6}KEYCLOAK_EMAIL_THEME: \$\{KEYCLOAK_EMAIL_THEME:-keycloak\}$/m);
    expect(block(repository('compose.azure.yaml'))).toMatch(/^ {6}KEYCLOAK_EMAIL_THEME: imbc$/m);
  });
});
