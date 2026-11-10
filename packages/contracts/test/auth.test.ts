import { describe, expect, it } from 'vitest';
import { roleHome, safeReturnTo } from '../src/auth.js';

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
  it('chooses a home that each role can access', () => {
    expect(roleHome('manufacturer')).toBe('/profile');
    expect(roleHome('administrator')).toBe('/account');
    for (const role of ['operator', 'spectator', 'expert', 'director'] as const)
      expect(roleHome(role)).toBe('/catalog');
  });
});
