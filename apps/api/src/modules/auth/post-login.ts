import { can, roleHome, safeReturnTo, type Role } from '@imbc/contracts';

/** Страницы входа: после входа на них не возвращаемся (тот же список, что в web). */
function isAuthPage(pathname: string): boolean {
  return pathname === '/login' || pathname === '/register' || pathname.startsWith('/auth/');
}

/**
 * Страница после входа: сохранённая, если роль вправе её открыть, иначе стартовая страница
 * роли (OPR-31). Внешний адрес и страницы входа ведут на стартовую. Право — по матрице (GEN-08).
 */
export function postLoginPath(role: Role, saved: unknown): string {
  const home = roleHome(role);
  const returnTo = safeReturnTo(saved, home);
  if (
    returnTo === '/' ||
    isAuthPage(returnTo.split(/[?#]/)[0] ?? '') ||
    (returnTo.startsWith('/catalog') && !can(role, 'catalog.search')) ||
    (returnTo.startsWith('/dashboard') && !can(role, 'dashboard.read'))
  )
    return home;
  return returnTo;
}
