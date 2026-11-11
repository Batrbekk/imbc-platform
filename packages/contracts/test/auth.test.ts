import { describe, expect, it } from 'vitest';
import { roleHome, safeReturnTo } from '../src/auth.js';
import { ROLES } from '../src/enums.js';
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
    expect(roleHome('manufacturer')).toBe('/profile');
    expect(roleHome('administrator')).toBe('/account');
    expect(roleHome('expert')).toBe('/catalog');
    for (const role of ['operator', 'observer', 'director'] as const) expect(roleHome(role)).toBe('/dashboard');
  });
  it('стартовая страница разрешена роли матрицей прав (GEN-08)', () => {
    for (const role of ROLES) {
      const home = roleHome(role);
      if (home === '/dashboard') expect(can(role, 'dashboard.read')).not.toBeNull();
      if (home === '/catalog') expect(can(role, 'catalog.search')).not.toBeNull();
    }
  });
});
