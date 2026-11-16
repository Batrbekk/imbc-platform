import { companyInfoMatchesBin } from './company-info.js';
import { redactToken } from './adata.client.js';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const legalText = (value: unknown): string | null => {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) return null;
  const text = String(value);
  if (/[\u0000\uD800-\uDFFF]/u.test(text)) throw new Error('Invalid Main source text');
  return text;
};

/** Bounded transport data becomes only the named Main subset. No personal IDs or raw report survives. */
export function sanitizeAdataMainPrefill(data: unknown, expectedBin: string, token: string): Record<string, unknown> {
  if (!companyInfoMatchesBin(data, expectedBin) || !object(data)) throw new Error('Invalid Main source identity');
  if (Object.values(data).every(value => value === null)) return { basic: null, founders: null, kzCoContact: null };
  const basic = object(data.basic) ? data.basic : {};
  const fields = ['name_ru', 'name_kz', 'legal_form', 'legal_address', 'legal_address_kz', 'fullname_director', 'date_registration', 'oked'] as const;
  const scalar = Object.fromEntries(fields.map(field => [field, legalText(basic[field])]));
  const seen = new Map<string, string | null>();
  const okedRows = (raw: unknown) => list(raw).flatMap(item => {
    if (!object(item)) return [];
    const i = legalText(item.i), name_ru = legalText(item.name_ru);
    if (!i?.trim()) return [];
    const key = i.trim(), name = name_ru?.trim() || null;
    if (seen.has(key) && seen.get(key) !== name) throw new Error('Conflicting Main source OKED');
    seen.set(key, name);
    return [{ i, name_ru }];
  });
  const contacts = object(data.kzCoContact) ? data.kzCoContact : {};
  const contactRows = (raw: unknown) => list(raw).flatMap(item => {
    const value = typeof item === 'string' ? item : object(item) ? item.contact : null;
    return typeof value === 'string' && !/[\u0000\uD800-\uDFFF]/u.test(value) ? [{ contact: value }] : [];
  });
  const founders = object(data.founders) ? data.founders : {};
  const value = {
    basic: { biin: basic.biin, ...scalar, okeds: okedRows(basic.okeds), secondary_okeds: okedRows(basic.secondary_okeds) },
    founders: { founders_dtl: list(founders.founders_dtl).flatMap(item => {
      if (!object(item)) return [];
      const name = legalText(item.name);
      return name === null ? [] : [{ name }];
    }) },
    kzCoContact: { phones: contactRows(contacts.phones), emails: contactRows(contacts.emails) },
  };
  const sanitized = redactToken(value, token);
  if (!companyInfoMatchesBin(sanitized, expectedBin)) throw new Error('Invalid sanitized Main source identity');
  return sanitized;
}
