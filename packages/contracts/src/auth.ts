import type { Role } from './enums.js';
import { can, type Action } from './policy.js';

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

/** Страницы с правом в матрице: роль без права уходит на свою стартовую страницу (GEN-08). */
const GUARDED_PAGES = new Map<string, Action>([
  ['/catalog', 'catalog.search'],
  ['/companies', 'catalog.search'],
  ['/dashboard', 'dashboard.read'],
  ['/profile', 'profile.edit'],
]);

/**
 * Путь так, как его сопоставляет React Router: каждый сегмент декодируется один раз, закодированный
 * слеш (`%2F`) остаётся закодированным, при битой кодировке путь сравнивается как есть. Иначе
 * `/%63atalog` открыл бы каталог в SPA, а шлюз роли не узнал бы его. Только для сравнения:
 * возвращается всегда исходный адрес.
 */
function routerPath(pathname: string): string {
  try {
    return pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment).replace(/\//g, '%2F'))
      .join('/');
  } catch {
    return pathname;
  }
}

/**
 * Страница после входа — одно правило для сервера (BFF) и интерфейса (OPR-31, GEN-08):
 * сохранённый локальный адрес с query и fragment, если роль вправе открыть страницу, иначе
 * стартовая страница роли. Внешний адрес, `/` и страницы входа ведут на стартовую.
 *
 * Страница сравнивается по сегментам и без завершающих `/`: `/catalog`, `/catalog/` и `/catalog/123`
 * — каталог, `/catalogue` — нет. React Router принимает `/catalog/` как `/catalog`, поэтому и шлюз
 * роли видит в нём каталог. Регистр не приводится: маршруты SPA чувствительны к регистру, и
 * `/CATALOG` — страница «не найдено», а не каталог.
 */
export function destinationFor(role: Role, saved: unknown): string {
  const home = roleHome(role);
  const target = safeReturnTo(saved, home);
  const raw = routerPath(target.split(/[?#]/)[0] ?? '/');
  const pathname = raw.replace(/\/+$/, '') || '/';
  if (pathname === '/' || pathname === '/login' || pathname === '/register' || raw.startsWith('/auth/'))
    return home;
  for (const [page, action] of GUARDED_PAGES)
    if ((pathname === page || pathname.startsWith(`${page}/`)) && !can(role, action)) return home;
  return target;
}
