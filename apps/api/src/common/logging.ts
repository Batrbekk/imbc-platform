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
  'req.headers["x-forwarded-for"]',
  'req.headers["x-real-ip"]',
  'req.headers.forwarded',
  'req.remoteAddress',
  'req.remotePort',
  'res.headers["set-cookie"]',
];

/**
 * Журнал запросов API (pino-http): одна и та же настройка у `AppModule` и у теста журнала.
 * Секреты (NFR-10) и персональные данные (журналы по OWASP ASVS, NFR-11) не попадают в логи.
 */
export function httpLoggerOptions(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): Options {
  return {
    level: env.LOG_LEVEL,
    redact: REDACTED_LOG_PATHS,
    autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
    transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
  };
}
