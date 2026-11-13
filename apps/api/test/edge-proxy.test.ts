// Консоль аккаунта Keycloak (`/kc/realms/<realm>/account`) закрыта на обоих edge-прокси: стандартный
// интерфейс IdP не показывается (AGENTS.md), а почту-логин меняет только администратор IMBC (MAN-05, ADM-05).
// OIDC, действия входа, ресурсы темы и консоль администратора (её закрывает правило @private) правило не задевает.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
