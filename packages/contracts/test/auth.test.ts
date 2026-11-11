import { describe, expect, it } from 'vitest';
import { destinationFor, roleHome, safeReturnTo } from '../src/auth.js';
import { ROLES, type Role } from '../src/enums.js';
import { can, type Action } from '../src/policy.js';

describe('authentication navigation', () => {
  it.each([
    '//outside.invalid',
    '/\\outside.invalid',
    '/%5coutside.invalid',
    '/\n/outside.invalid',
    'https://outside.invalid',
    'javascript:alert(1)',
    '/%0a/outside.invalid',
    undefined,
  ])('rejects an unsafe return path', (value) => expect(safeReturnTo(value, '/account')).toBe('/account'));
  it('keeps and normalizes local paths without trusting the fallback', () => {
    expect(safeReturnTo('/catalog/../profile?tab=main#section')).toBe('/profile?tab=main#section');
    expect(safeReturnTo('//outside.invalid', '//outside.invalid')).toBe('/');
  });
  it('стартовая страница по роли: дашборд у оператора, наблюдателя и директора (OPR-31)', () => {
    const expected: Record<Role, string> = {
      manufacturer: '/profile',
      expert: '/catalog',
      administrator: '/account',
      director: '/dashboard',
      operator: '/dashboard',
      observer: '/dashboard',
    };
    for (const role of ROLES) expect(roleHome(role), role).toBe(expected[role]);
  });
  it('стартовая страница разрешена роли матрицей прав (GEN-08)', () => {
    const allowed = (role: Role, path: string): boolean => {
      switch (path) {
        case '/dashboard':
          return can(role, 'dashboard.read') !== null;
        case '/catalog':
          return can(role, 'catalog.search') !== null;
        case '/profile':
          return can(role, 'profile.edit') !== null;
        case '/account':
          return true; // своя учётная запись: действия в матрице нет, открыта каждой роли
        default:
          return false;
      }
    };
    for (const role of ROLES) expect(allowed(role, roleHome(role)), `${role} → ${roleHome(role)}`).toBe(true);
  });
});

/**
 * Страница после входа — одно правило для сервера и интерфейса (OPR-31, GEN-08): сохранённый
 * локальный адрес, если роль вправе открыть страницу, иначе стартовая страница роли.
 */
describe('страница после входа: destinationFor', () => {
  const guarded: [string, Action][] = [
    ['/catalog', 'catalog.search'],
    ['/dashboard', 'dashboard.read'],
    ['/profile', 'profile.edit'],
  ];

  it.each(ROLES)('без сохранённого адреса %s попадает на стартовую страницу', (role) => {
    for (const saved of [undefined, null, '', '/', '/?x=1', '/#top'])
      expect(destinationFor(role, saved), String(saved)).toBe(roleHome(role));
  });

  it.each(ROLES)('страница по праву матрицы: %s на /catalog, /dashboard, /profile', (role) => {
    for (const [path, action] of guarded) {
      const allowed = can(role, action) !== null;
      for (const saved of [path, `${path}?q=steel&page=2#results`, `${path}/`, `${path}//`])
        expect(destinationFor(role, saved), saved).toBe(allowed ? saved : roleHome(role));
    }
  });

  it('/profile только у производителя: у остальных ролей — стартовая страница', () => {
    for (const role of ROLES)
      expect(destinationFor(role, '/profile?tab=main'), role).toBe(
        role === 'manufacturer' ? '/profile?tab=main' : roleHome(role),
      );
  });

  it('путь сравнивается точно: вложенные и похожие адреса сохраняются, их разбирает маршрутизатор', () => {
    expect(destinationFor('operator', '/catalog/123')).toBe('/catalog/123');
    expect(destinationFor('expert', '/catalog/123?tab=docs')).toBe('/catalog/123?tab=docs');
    expect(destinationFor('manufacturer', '/catalogue')).toBe('/catalogue');
    expect(destinationFor('expert', '/dashboard/x')).toBe('/dashboard/x');
    // Регистр не меняется: маршруты SPA чувствительны к регистру, /CATALOG — «не найдено».
    expect(destinationFor('manufacturer', '/CATALOG')).toBe('/CATALOG');
    expect(destinationFor('operator', '/account')).toBe('/account');
    expect(destinationFor('manufacturer', '/account')).toBe('/account');
  });

  it.each(ROLES)('страницы входа ведут %s на стартовую страницу', (role) => {
    for (const saved of [
      '/login',
      '/login/',
      '/login?error=session_expired',
      '/register',
      '/register/',
      '/auth/',
      '/auth/verify?returnTo=%2Fcatalog',
      '/auth/responsibility',
    ])
      expect(destinationFor(role, saved), saved).toBe(roleHome(role));
  });

  it.each([
    '//outside.invalid',
    '/\\outside.invalid',
    '/%5coutside.invalid',
    '/\n/outside.invalid',
    'https://outside.invalid',
    'javascript:alert(1)',
    '/%0a/outside.invalid',
    42,
    { pathname: '/catalog' },
  ])('внешний или небезопасный адрес %s ведёт на стартовую страницу', (saved) => {
    for (const role of ROLES) expect(destinationFor(role, saved), role).toBe(roleHome(role));
  });

  it('адрес нормализуется так же, как в safeReturnTo', () => {
    expect(destinationFor('manufacturer', '/catalog/../profile?tab=main#section')).toBe('/profile?tab=main#section');
    expect(destinationFor('manufacturer', '/account/../catalog')).toBe('/profile');
  });
});
