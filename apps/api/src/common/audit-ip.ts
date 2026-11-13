import { isIP } from 'node:net';
import type { Request } from 'express';

/**
 * Адрес запроса — только для колонки `audit_entries.ip` (AUD-01): `req.ip` за прокси, без адреса, который
 * не примет `inet`. В журнал запросов, тексты ошибок и `diff` не попадает.
 */
export function auditIp(req: Request): string | null {
  const ip = req.ip;
  return ip && isIP(ip) !== 0 && !ip.includes('%') ? ip : null;
}
