// Консоль аккаунта Keycloak (`/kc/realms/<realm>/account`) закрыта на обоих edge-прокси: стандартный
// интерфейс IdP не показывается (AGENTS.md), а почту-логин меняет только администратор IMBC (MAN-05, ADM-05).
// OIDC, действия входа, ресурсы темы и консоль администратора (её закрывает правило @private) правило не задевает.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_FILE_BYTES } from '@imbc/contracts';
import { describe, expect, it } from 'vitest';
import { CLAMD_CLIENT_TIMEOUT_MS } from '../src/worker/clamd.js';

const read = (path: string) => readFileSync(new URL(`../../../infrastructure/${path}`, import.meta.url), 'utf8');
const caddyfile = read('azure/Caddyfile');
const nginxConf = read('nginx/nginx.conf');

const CADDY_MATCHER = '@accountConsole path_regexp accountConsole (?i)^/kc/realms/[^/]+/account(?:/|;|$)';
const CADDY_RESPOND = 'respond @accountConsole 404';
const NGINX_LOCATION = 'location ~* "^/kc/realms/[^/]+/account(/|;|$)" { return 404; }';

/** Шаблон пути из конфигурации как регулярное выражение JS: `(?i)` Caddy и `~*` nginx — флаг i. */
const pattern = (source: string) => new RegExp(source.replace(/^\(\?i\)/, ''), 'i');

/**
 * Директивы `location ~` и `location ~*` из nginx.conf (комментарии отброшены): шаблон как записан и признак кавычек.
 * Без кавычек nginx читает `;`, `{` и `}` как конец директивы или блока — `nginx -t` падает, контейнер перезапускается.
 */
const regexLocations = (conf: string) =>
  [...conf.replace(/^\s*#.*$/gm, '').matchAll(/^\s*location\s+~\*?\s+(?:"([^"]*)"|'([^']*)'|(\S+))/gm)].map((match) => ({
    quoted: match[3] === undefined,
    source: match[1] ?? match[2] ?? match[3]!,
  }));

const CLOSED = [
  '/kc/realms/imbc/account',
  '/kc/realms/imbc/account/',
  '/kc/realms/imbc/Account/',
  '/kc/realms/imbc/account/personal-info',
  '/kc/realms/imbc/account/credentials/password',
  '/kc/realms/imbc/account;x=1',
  '/kc/realms/other/account/',
];
const OPEN = [
  '/kc/realms/imbc/.well-known/openid-configuration',
  '/kc/realms/imbc/protocol/openid-connect/auth',
  '/kc/realms/imbc/protocol/openid-connect/token',
  '/kc/realms/imbc/protocol/openid-connect/certs',
  '/kc/realms/imbc/protocol/openid-connect/logout',
  '/kc/realms/imbc/login-actions/authenticate',
  '/kc/realms/imbc/login-actions/reset-credentials',
  '/kc/realms/imbc/login-actions/action-token',
  '/kc/realms/imbc/login-actions/required-action',
  '/kc/resources/abc12/login/imbc/assets/index.css',
  '/kc/realms/imbc/accounts',
  '/kc/realms/imbc',
];

describe('edge: консоль аккаунта Keycloak закрыта (MAN-05, ADM-05)', () => {
  it('Caddyfile: 404 для /kc/realms/<realm>/account в route до общего @keycloak', () => {
    const route = caddyfile.indexOf('route {');
    const matcher = caddyfile.indexOf(CADDY_MATCHER);
    const respond = caddyfile.indexOf(CADDY_RESPOND);
    const keycloak = caddyfile.indexOf('@keycloak path /kc /kc/*');
    expect(route).toBeGreaterThan(-1);
    expect(matcher).toBeGreaterThan(route);
    expect(respond).toBeGreaterThan(matcher);
    expect(keycloak).toBeGreaterThan(respond);
  });

  it('nginx.conf: location с return 404 стоит перед location /kc/', () => {
    const closed = nginxConf.indexOf(NGINX_LOCATION);
    const keycloak = nginxConf.indexOf('location /kc/ {');
    expect(closed).toBeGreaterThan(-1);
    expect(keycloak).toBeGreaterThan(closed);
  });

  it('шаблон закрывает консоль и её пути в любом регистре; OIDC, действия входа и ресурсы темы открыты', () => {
    const caddy = pattern(CADDY_MATCHER.split(' ').at(-1)!);
    const nginx = pattern(/"([^"]+)"/.exec(NGINX_LOCATION)![1]!);
    for (const regex of [caddy, nginx]) {
      for (const path of CLOSED) expect(regex.test(path), `${regex} ${path}`).toBe(true);
      for (const path of OPEN) expect(regex.test(path), `${regex} ${path}`).toBe(false);
    }
  });

  it('nginx.conf: шаблон location ~ / ~* с «;», «{» или «}» заключён в кавычки, иначе nginx не стартует', () => {
    const locations = regexLocations(nginxConf);
    expect(locations.length).toBeGreaterThan(0);
    for (const { quoted, source } of locations) {
      if (/[;{}]/.test(source)) expect(quoted, `шаблон ${source} без кавычек`).toBe(true);
    }
  });

  it('проверка кавычек видит шаблон без кавычек (прежняя запись закрытия консоли)', () => {
    const before = 'location ~* ^/kc/realms/[^/]+/account(/|;|$) { return 404; }';
    expect(regexLocations(before)).toEqual([{ quoted: false, source: '^/kc/realms/[^/]+/account(/|;|$)' }]);
    expect(regexLocations(NGINX_LOCATION)).toEqual([{ quoted: true, source: '^/kc/realms/[^/]+/account(/|;|$)' }]);
  });
});

// Файлы никогда не доступны напрямую (NFR-09): S3 API RustFS (порт 9000) не опубликован ни на хосте, ни через
// edge-прокси; байты отдаёт только API после проверки прав (GEN-09). Консоль RustFS (9001) на сервере — только
// на 127.0.0.1 (доступ администратора через SSH-туннель).
const repository = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const compose = repository('compose.yaml');
const composeAzure = repository('compose.azure.yaml');

/** Блок сервиса `name` из `services:` (отступ два пробела) до следующего ключа того же или верхнего уровня. */
const serviceBlock = (file: string, name: string) => {
  const lines = file.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && /^ {0,2}[^\s#]/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
};

/** Значения `ports:` блока сервиса: список строк `- "…"` или строка `ports: [...]`. */
const publishedPorts = (block: string) => {
  const lines = block.split('\n');
  const at = lines.findIndex((line) => /^\s+ports:/.test(line));
  if (at === -1) return [];
  const inline = /ports:\s*(?:!override\s*)?\[(.*)\]/.exec(lines[at]!);
  if (inline) return inline[1]!.split(',').map((port) => port.trim().replace(/^"|"$/g, ''));
  const ports: string[] = [];
  for (const line of lines.slice(at + 1)) {
    const item = /^\s+-\s+"?([^"\s]+)"?\s*$/.exec(line);
    if (!item) break;
    ports.push(item[1]!);
  }
  return ports;
};

describe('edge: S3 не опубликован (NFR-09)', () => {
  it('S3 не опубликован: Caddyfile и nginx.conf не упоминают rustfs и :9000; у rustfs в compose.yaml нет порта 9000, в compose.azure.yaml — только 127.0.0.1:9001 (NFR-09)', () => {
    for (const [name, conf] of [
      ['Caddyfile', caddyfile],
      ['nginx.conf', nginxConf],
    ] as const) {
      expect(conf, name).not.toMatch(/rustfs/i);
      expect(conf, name).not.toContain(':9000');
    }

    const rustfs = serviceBlock(compose, 'rustfs');
    expect(rustfs).not.toBeNull();
    const ports = publishedPorts(rustfs!);
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) expect(port, port).not.toMatch(/(^|:)9000$/);

    const azureRustfs = serviceBlock(composeAzure, 'rustfs');
    expect(azureRustfs).not.toBeNull();
    expect(publishedPorts(azureRustfs!)).toEqual(['127.0.0.1:9001:9001']);
    // Без `!override` Compose склеивает списки портов: на сервере осталась бы публикация 9001 из compose.yaml на всех
    // адресах, а разбор выше видел бы только список оверлея.
    expect(azureRustfs).toMatch(/^\s+ports:\s*!override\s*$/m);
  });

  it('без подписанных ссылок: API не зависит от s3-request-presigner и не вызывает getSignedUrl', () => {
    const pkg = JSON.parse(repository('apps/api/package.json')) as Record<string, Record<string, string> | undefined>;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps).filter((name) => /presign/i.test(name))).toEqual([]);
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? sources(join(dir, entry.name))
          : entry.name.endsWith('.ts')
            ? [join(dir, entry.name)]
            : [],
      );
    const src = fileURLToPath(new URL('../src', import.meta.url));
    const signing = sources(src).filter((path) =>
      /getSignedUrl|createPresignedPost|s3-request-presigner/.test(readFileSync(path, 'utf8')),
    );
    expect(signing).toEqual([]);
  });

  it('бакеты создаются без публичной политики и ACL; разбор блока сервиса и портов видит прежнюю запись', () => {
    expect(serviceBlock(compose, 'buckets')).not.toMatch(/bucket-policy|bucket-acl|public-read|anonymous/i);
    const published =
      'services:\n  rustfs:\n    image: x\n    ports: ["9000:9000", "9001:9001"]\n  keycloak:\n    ports: ["8180:8080"]\n';
    expect(publishedPorts(serviceBlock(published, 'rustfs')!)).toEqual(['9000:9000', '9001:9001']);
    const listed = 'services:\n  rustfs:\n    ports:\n      - "9000:9000"\n      - "127.0.0.1:9001:9001"\n\nvolumes:\n';
    expect(publishedPorts(serviceBlock(listed, 'rustfs')!)).toEqual(['9000:9000', '127.0.0.1:9001:9001']);
  });
});

// Пределы clamd (DATA-07): считаются по распакованному содержимому — DOCX и XLSX это ZIP, сжатые потоки PDF clamd
// тоже распаковывает. С AlertExceedsMax no clamd на превышении молча прекращает проверку и отвечает OK; с yes —
// FOUND Heuristics.Limits.Exceeded…, и worker отклоняет файл.
const clamdConf = repository('infrastructure/clamav/clamd.conf');

/** Действующие строки clamd.conf: ключ → значение (комментарии и пустые строки отброшены). */
const clamdSettings = (conf: string) =>
  new Map(
    conf
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const [key, ...value] = line.split(/\s+/);
        return [key!, value.join(' ')] as const;
      }),
  );

/** Размер clamd в байтах: число и необязательный суффикс K или M (как читает clamd). */
const clamdBytes = (value: string | undefined) => {
  const size = /^(\d+)([kKmM]?)$/.exec(value ?? '');
  if (!size) throw new Error(`не размер clamd: ${value}`);
  const unit = { '': 1, k: 1024, m: 1024 * 1024 }[size[2]!.toLowerCase() as '' | 'k' | 'm'];
  return Number(size[1]) * unit;
};

describe('ClamAV: пределы проверки и отказ на превышении (DATA-07)', () => {
  it('Compose монтирует infrastructure/clamav/clamd.conf в /etc/clamav/clamd.conf только для чтения', () => {
    const clamav = serviceBlock(compose, 'clamav');
    expect(clamav).not.toBeNull();
    expect(clamav).toMatch(/^\s+-\s+"?\.\/infrastructure\/clamav\/clamd\.conf:\/etc\/clamav\/clamd\.conf:ro"?\s*$/m);
    // Оверлей Azure не подменяет тома clamav.
    expect(serviceBlock(composeAzure, 'clamav')).toBeNull();
  });

  it('clamd.conf: AlertExceedsMax yes; StreamMaxLength ≥ MAX_FILE_BYTES, MaxFileSize ≥ StreamMaxLength, MaxScanSize ≥ MaxFileSize; MaxScanTime явно, таймаут клиента clamd больше; строки образа сохранены', () => {
    const settings = clamdSettings(clamdConf);
    expect(settings.get('AlertExceedsMax')).toBe('yes');
    const stream = clamdBytes(settings.get('StreamMaxLength'));
    const file = clamdBytes(settings.get('MaxFileSize'));
    const scan = clamdBytes(settings.get('MaxScanSize'));
    expect(stream).toBeGreaterThanOrEqual(MAX_FILE_BYTES);
    expect(file).toBeGreaterThanOrEqual(stream);
    expect(scan).toBeGreaterThanOrEqual(file);
    // Время скана: решение по долгой проверке принимает clamd (FOUND Heuristics.Limits.Exceeded.MaxScanTime), а не
    // обрыв клиентом — таймаут клиента в worker заметно больше MaxScanTime (мс).
    const scanTime = settings.get('MaxScanTime');
    expect(scanTime).toMatch(/^\d+$/);
    expect(Number(scanTime)).toBe(120_000);
    expect(CLAMD_CLIENT_TIMEOUT_MS).toBeGreaterThanOrEqual(Number(scanTime) + 30_000);
    // Действующие строки файла образа clamav/clamav:1.4; порт — CLAMAV_PORT сервисов api и worker.
    expect(
      Object.fromEntries(
        [...settings].filter(([key]) => ['LogFile', 'LogTime', 'LocalSocket', 'TCPSocket', 'User'].includes(key)),
      ),
    ).toEqual({
      LogFile: '/var/log/clamav/clamd.log',
      LogTime: 'yes',
      LocalSocket: '/tmp/clamd.sock',
      TCPSocket: '3310',
      User: 'clamav',
    });
    expect(compose).toMatch(/^\s+CLAMAV_PORT:\s*3310\s*$/m);
    // Каждая настройка — один раз: при повторе действующее значение было бы неочевидным, а сверка выше — неполной.
    const keys = clamdConf
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split(/\s+/)[0]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('разбор размеров clamd: суффиксы K и M, число без суффикса — байты', () => {
    expect(clamdBytes('100M')).toBe(104_857_600);
    expect(clamdBytes('1024m')).toBe(1_073_741_824);
    expect(clamdBytes('25k')).toBe(25_600);
    expect(clamdBytes('26214400')).toBe(MAX_FILE_BYTES);
    expect(() => clamdBytes('1G')).toThrow();
    expect(() => clamdBytes(undefined)).toThrow();
  });
});

// X-Content-Type-Options приходит одной строкой: у ответов API его ставит приложение (helmet в configureHttp), а edge
// добавляет его только ответам без своего — статике web, ответам самого прокси. Иначе через nginx заголовок
// приходит дважды (`nosniff, nosniff`): add_header nginx добавляет строку, а не заменяет ответ upstream.
describe('edge: X-Content-Type-Options — один источник на ответ', () => {
  const uncommented = (conf: string) => conf.replace(/^\s*#.*$/gm, '');

  it('nginx.conf: nosniff добавляется только ответам без заголовка от upstream (map по $upstream_http_x_content_type_options)', () => {
    const conf = uncommented(nginxConf);
    const map = conf.match(/map\s+\$upstream_http_x_content_type_options\s+(\$\w+)\s*\{([^}]*)\}/);
    expect(map).not.toBeNull();
    const [, variable, body] = map!;
    const entries = body!
      .split(';')
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts[0]);
    expect(entries).toEqual([
      ["''", 'nosniff'],
      ['default', "''"],
    ]);
    const headers = [...conf.matchAll(/add_header\s+X-Content-Type-Options\s+(\S+?)\s*(always)?;/gi)];
    expect(headers.map((h) => [h[1], h[2]])).toEqual([[variable, 'always']]);
  });

  it('Caddyfile: nosniff — значение по умолчанию (?), не замена и не вторая строка к ответу API', () => {
    const lines = uncommented(caddyfile)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /X-Content-Type-Options/i.test(line));
    expect(lines).toEqual(['?X-Content-Type-Options "nosniff"']);
  });
});
