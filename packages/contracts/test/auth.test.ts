import { describe, expect, it } from 'vitest';
import { roleHome, safeReturnTo } from '../src/auth.js';
import { ROLES, type Role } from '../src/enums.js';
import { can } from '../src/policy.js';

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
