import type { Options } from 'pino-http';
import type { Env } from '../config/env.js';

/**
 * Пути, которые pino вырезает из строки журнала запроса. Сериализатор запроса pino-http пишет все заголовки,
 * `remoteAddress` и `remotePort` сокета: за прокси адрес клиента — в X-Forwarded-For, X-Real-IP и Forwarded,
 * без прокси — в адресе сокета. IP — персональные данные (IP регистрации — запись принятия NDA, FC-02).
 */
export const REDACTED_LOG_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers.referer',
  'req.headers.referrer',
  'req.query',
  'req.headers["x-forwarded-for"]',
  'req.headers["x-real-ip"]',
  'req.headers.forwarded',
  'req.remoteAddress',
  'req.remotePort',
  'res.headers["set-cookie"]',
];

const REDACTED = '[Redacted]';
const PRIVATE_KEYS = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'referer',
  'referrer',
  'password',
  'clientsecret',
  'secret',
  'apikey',
  'xapikey',
  'token',
  'accesstoken',
  'idtoken',
  'refreshtoken',
  'xauthtoken',
  'xcsrftoken',
  'csrftoken',
  'xadatatoken',
  'codeverifier',
  'codechallenge',
  'otp',
  'xforwardedfor',
  'xrealip',
  'forwarded',
  'remoteaddress',
  'remoteport',
  'query',
  'urlquery',
  'urlfragment',
  'auth',
  'oauth',
  'oidc',
  'authcode',
  'authstate',
  'oauthcode',
  'oauthstate',
  'oidccode',
  'oidcstate',
  'nonce',
  'sessionstate',
]);
const URL_KEYS = new Set([
  'url',
  'originalurl',
  'requesturl',
  'redirecturl',
  'redirecturi',
  'redirectto',
  'location',
  'href',
  'httpurl',
  'httptarget',
  'urlfull',
  'urloriginal',
]);

/** Query values may carry credentials or personal data under arbitrary names; retain only the route. */
function logUrl(value: string): string {
  const [route = ''] = value.split(/[?#]/, 1);
  // A service URL can include HTTP basic credentials, including in nested error messages.
  const withoutCredentials = route.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, `$1${REDACTED}@`);
  return `${withoutCredentials}${value.includes('?') ? `?${REDACTED}` : value.includes('#') ? `#${REDACTED}` : ''}`;
}

function logText(value: string): string {
  return value
    .replace(/(?:[a-z][a-z0-9+.-]*:\/\/|\/)[^\s"'<>]+/gi, (url) => logUrl(url))
    .replace(
      /\b(?:code|state|nonce|session_state|access_token|id_token|refresh_token|code_verifier|code_challenge|client_secret|password|api_key|token)=([^\s"'<>]*)/gi,
      (pair) => `${pair.slice(0, pair.indexOf('='))}=${REDACTED}`,
    )
    .replace(/\bBearer\s+[^\s"'<>]+/gi, `Bearer ${REDACTED}`);
}

/**
 * Pino invokes this after serializers and child bindings, but BEFORE stdout or any transport.
 * Keeping the scrub at the emission boundary also covers nested errors and future log transports.
 * A malformed record fails closed without echoing its contents or interrupting the request.
 */
export function redactLogLine(line: string): string {
  try {
    const record: unknown = JSON.parse(line, (key, value: unknown) => {
      const normalizedKey = key.replace(/[-_.]/g, '').toLowerCase();
      const headerKey = normalizedKey.replace(/^(?:http)?(?:request|response)headers?/, '');
      if (PRIVATE_KEYS.has(normalizedKey) || PRIVATE_KEYS.has(headerKey)) return REDACTED;
      if (typeof value !== 'string') return value;
      return URL_KEYS.has(normalizedKey) ? logUrl(value) : logText(value);
    });
    if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid record');
    return `${JSON.stringify(record)}\n`;
  } catch {
    return '{"level":50,"msg":"Invalid log record redacted"}\n';
  }
}

/**
 * Журнал запросов API (pino-http): одна и та же настройка у `AppModule` и у теста журнала.
 * Секреты (NFR-10) и персональные данные (журналы по OWASP ASVS, NFR-11) не попадают в логи.
 */
export function httpLoggerOptions(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): Options {
  return {
    level: env.LOG_LEVEL,
    redact: REDACTED_LOG_PATHS,
    hooks: { streamWrite: redactLogLine },
    autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
    transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
  };
}
