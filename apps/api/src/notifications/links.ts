/**
 * Ссылка в письме — только на страницу приложения (NOT-20): страница сама требует входа и проверяет права
 * (GEN-08, GEN-09), письмо не несёт ни токена, ни прямой ссылки на API или Keycloak.
 * Путь: начинается с `/`, без `//`, `.` и `..`, без `?` и `#`, только `[A-Za-z0-9\-._~/]`, первый сегмент —
 * не `api` и не `kc`.
 */
const PAGE_PATH = /^\/[A-Za-z0-9\-._~/]*$/;
const RESERVED = new Set(['api', 'kc']);

export function appLink(publicUrl: string, path: string): string {
  const segments = path.split('/').slice(1);
  if (
    !PAGE_PATH.test(path) ||
    path.includes('//') ||
    segments.some((segment) => segment === '.' || segment === '..') ||
    RESERVED.has((segments[0] ?? '').toLowerCase())
  )
    // Путь в текст ошибки не попадает: в нём мог оказаться параметр.
    throw new Error('appLink: путь не страница приложения');
  return `${publicUrl.replace(/\/+$/, '')}${path}`;
}
