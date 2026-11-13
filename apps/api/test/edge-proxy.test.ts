// Консоль аккаунта Keycloak (`/kc/realms/<realm>/account`) закрыта на обоих edge-прокси: стандартный
// интерфейс IdP не показывается (AGENTS.md), а почту-логин меняет только администратор IMBC (MAN-05, ADM-05).
// OIDC, действия входа, ресурсы темы и консоль администратора (её закрывает правило @private) правило не задевает.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../infrastructure/${path}`, import.meta.url), 'utf8');
const caddyfile = read('azure/Caddyfile');
const nginxConf = read('nginx/nginx.conf');

const CADDY_MATCHER = '@accountConsole path_regexp accountConsole (?i)^/kc/realms/[^/]+/account(?:/|;|$)';
const CADDY_RESPOND = 'respond @accountConsole 404';
const NGINX_LOCATION = 'location ~* ^/kc/realms/[^/]+/account(/|;|$) { return 404; }';

/** Шаблон пути из конфигурации как регулярное выражение JS: `(?i)` Caddy и `~*` nginx — флаг i. */
const pattern = (source: string) => new RegExp(source.replace(/^\(\?i\)/, ''), 'i');

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
    const nginx = pattern(NGINX_LOCATION.split(' ')[2]!);
    for (const regex of [caddy, nginx]) {
      for (const path of CLOSED) expect(regex.test(path), `${regex} ${path}`).toBe(true);
      for (const path of OPEN) expect(regex.test(path), `${regex} ${path}`).toBe(false);
    }
  });
});
