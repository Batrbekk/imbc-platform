import { z } from 'zod';

/** MAN-13 / NFR-09: a byte budget for JSON transport, never an upper business count of contacts. */
export const PROFILE_JSON_MAX_BYTES = 2 * 1024 * 1024;

/** MAN-40: blank draft fields are null; business completeness is checked separately. */
export const draftTextSchema = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .refine((value) => value === null || !/[\u0000\uD800-\uDFFF]/u.test(value), { message: 'text_format' })
  .transform((value) => value || null);

/**
 * MAN-15: international format only, with + or 00 and 7–15 digits. Spaces, parentheses,
 * dots and hyphens are presentation characters. A national number is not assigned an
 * assumed country; the form asks for the country code. This validates syntax, not ownership.
 */
export function normalizeProfilePhone(value: string): string | null {
  const input = value.trim();
  if (!/^(?:\+|00)[\d ().-]+$/.test(input)) return null;
  const digits = (input.startsWith('+') ? input.slice(1) : input.slice(2)).replace(/[ ().-]/g, '');
  return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
}

export const draftPhoneSchema = z
  .string()
  .trim()
  .max(100)
  .nullable()
  .transform((value, ctx) => {
    if (!value) return null;
    const phone = normalizeProfilePhone(value);
    if (phone === null) ctx.addIssue({ code: 'custom', message: 'phone_format' });
    return phone;
  });

export const draftEmailSchema = z
  .string()
  .trim()
  .max(254)
  .nullable()
  .transform((value, ctx) => {
    if (!value) return null;
    const email = value.toLowerCase();
    if (!z.email().safeParse(email).success) ctx.addIssue({ code: 'custom', message: 'email_format' });
    return email;
  });

export const draftWebsiteSchema = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .transform((value, ctx) => {
    if (!value) return null;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password)
        throw new Error('Invalid website');
      return url.href;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'website_format' });
      return null;
    }
  });
