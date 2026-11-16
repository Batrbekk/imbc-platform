import { z } from 'zod';
import { normalizeProfilePhone } from './profile-fields.js';

export const lpsUuidSchema = z.uuid().transform((id) => id.toLowerCase());
const text = z
  .string()
  .trim()
  .refine((value) => !/[\u0000\uD800-\uDFFF]/u.test(value), { message: 'text_format' });
export const lpsRequiredTextSchema = text.refine((value) => value.length > 0, { message: 'required' });
export const lpsOptionalTextSchema = text.nullable().transform((value) => value || null);
export const lpsSearchTextSchema = text.max(500).default('');

/** PostgreSQL numeric, without a float conversion or loss of supplied fractional precision. */
export const lpsInvestmentSchema = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .transform((value, ctx) => {
    if (value === null || value === '') return null;
    if (!/^\d+(?:\.\d+)?$/.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'nonnegative_decimal' });
      return z.NEVER;
    }
    const [whole, fraction] = value.split('.');
    const integer = whole!.replace(/^0+(?=\d)/, '');
    return fraction === undefined ? integer : `${integer}.${fraction}`;
  });
export const lpsJobCountSchema = z.number().int().min(0).max(2_147_483_647).nullable();
export const lpsDateSchema = z.string().refine(
  (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  },
  { message: 'date_format' },
);

export interface LpsLaunchBounds {
  kind: 'known' | 'tbd' | 'missing';
  canonical: string | null;
  earliestQuarter: number | null;
  latestQuarter: number | null;
}
/** Bounds preserve period precision. They are never an asserted exact launch date. */
export function parseLpsLaunch(value: string | null): LpsLaunchBounds | null {
  if (value === null || value.trim() === '')
    return { kind: 'missing', canonical: null, earliestQuarter: null, latestQuarter: null };
  const source = value.trim().toUpperCase();
  if (source === 'TBD') return { kind: 'tbd', canonical: 'TBD', earliestQuarter: null, latestQuarter: null };
  const year = /^(\d{4})$/.exec(source);
  if (year && Number(year[1]) > 0) {
    const base = Number(year[1]) * 4;
    return { kind: 'known', canonical: year[1]!, earliestQuarter: base, latestQuarter: base + 3 };
  }
  const quarter = /^Q([1-4])\s+(\d{4})$/.exec(source);
  if (quarter && Number(quarter[2]) > 0) {
    const bound = Number(quarter[2]) * 4 + Number(quarter[1]) - 1;
    return { kind: 'known', canonical: `Q${quarter[1]} ${quarter[2]}`, earliestQuarter: bound, latestQuarter: bound };
  }
  const range = /^Q([1-4])\s+(\d{4})\s*\/\s*Q([1-4])\s+(\d{4})$/.exec(source);
  if (range && Number(range[2]) > 0 && Number(range[4]) > 0) {
    const earliest = Number(range[2]) * 4 + Number(range[1]) - 1;
    const latest = Number(range[4]) * 4 + Number(range[3]) - 1;
    if (earliest <= latest)
      return {
        kind: 'known',
        canonical: `Q${range[1]} ${range[2]} / Q${range[3]} ${range[4]}`,
        earliestQuarter: earliest,
        latestQuarter: latest,
      };
  }
  return null;
}
export const lpsPlannedLaunchSchema = z
  .string()
  .nullable()
  .transform((value, ctx) => {
    const launch = parseLpsLaunch(value);
    if (launch === null) {
      ctx.addIssue({ code: 'custom', message: 'planned_launch_format' });
      return z.NEVER;
    }
    return launch.canonical;
  });
export const lpsContactEmailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email())
  .transform((value) => value.toLowerCase());
/** An international base number and optional extension; no country is inferred and extension zeros stay. */
export const lpsContactPhoneSchema = z
  .string()
  .trim()
  .max(100)
  .transform((value, ctx) => {
    const parts = /^(.+?)(?:\s*(?:ext\.?|x|#)\s*(\d+))?$/i.exec(value);
    const base = parts ? normalizeProfilePhone(parts[1]!) : null;
    if (!base) {
      ctx.addIssue({ code: 'custom', message: 'phone_format' });
      return z.NEVER;
    }
    return parts![2] === undefined ? base : `${base} ext. ${parts![2]}`;
  });
