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

/**
 * Стартовая страница роли после входа. У оператора, наблюдателя и директора IMBC — дашборд
 * (OPR-31). У SME — каталог, пока нет очереди проверки. Роль вправе открыть свою
 * стартовую страницу по матрице прав: `/dashboard` — `dashboard.read`, `/catalog` — `catalog.search`.
 * Таблица по всем ролям: новая роль без стартовой страницы не компилируется.
 */
const ROLE_HOME: Record<Role, string> = {
  manufacturer: '/profile',
  expert: '/catalog',
  administrator: '/account',
  director: '/dashboard',
  operator: '/dashboard',
  observer: '/dashboard',
};

export function roleHome(role: Role): string {
  return ROLE_HOME[role];
}
