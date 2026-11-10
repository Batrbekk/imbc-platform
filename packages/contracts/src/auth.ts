import type { Role } from './enums.js';

const LOCAL_ORIGIN = 'https://imbc.invalid';

/** Only normalized paths on this application may be used after authentication. */
export function safeReturnTo(value: unknown, fallback = '/'): string {
  const local = (candidate: unknown): string | null => {
    if (
      typeof candidate !== 'string' ||
      !candidate.startsWith('/') ||
      candidate.startsWith('//') ||
      /[\\\u0000-\u0020\u007f]/.test(candidate) ||
      /%5c|%0[0-9a-f]|%1[0-9a-f]|%7f/i.test(candidate)
    )
      return null;
    try {
      const url = new URL(candidate, LOCAL_ORIGIN);
      return url.origin === LOCAL_ORIGIN ? `${url.pathname}${url.search}${url.hash}` : null;
    } catch {
      return null;
    }
  };
  return local(value) ?? local(fallback) ?? '/';
}

export function roleHome(role: Role): string {
  if (role === 'manufacturer') return '/profile';
  if (role === 'administrator') return '/account';
  return '/catalog';
}
