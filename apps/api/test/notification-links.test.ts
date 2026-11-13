import { destinationFor } from '@imbc/contracts';
import { describe, expect, it } from 'vitest';
import { appLink } from '../src/notifications/links.js';

// Ссылка в письме ведёт на страницу приложения: вход и права проверяются как обычно (NOT-20, GEN-08, GEN-09).
const PUBLIC_URL = 'https://imbc.local';
const companyId = '0b6f4c1e-2d3a-4e5f-8a9b-1c2d3e4f5a6b';

describe('ссылки в письмах (NOT-20)', () => {
  it("appLink: '/companies/<uuid>' → PUBLIC_URL + путь; '//evil.local', '/api/v1/files/x/content', '/kc/realms/imbc', '/reviews?token=1', 'https://x' — ошибка (NOT-20)", () => {
    expect(appLink(PUBLIC_URL, `/companies/${companyId}`)).toBe(`${PUBLIC_URL}/companies/${companyId}`);
    expect(appLink(PUBLIC_URL, '/login')).toBe(`${PUBLIC_URL}/login`);
    // Косая черта в конце PUBLIC_URL не удваивается.
    expect(appLink(`${PUBLIC_URL}/`, '/login')).toBe(`${PUBLIC_URL}/login`);
    for (const path of [
      '//evil.local',
      '/api/v1/files/x/content',
      '/api',
      '/kc/realms/imbc',
      '/kc',
      '/reviews?token=1',
      '/reviews#token',
      'https://x',
      'companies',
      '',
      '/companies/../api/v1',
      '/companies/./x',
      '/companies//x',
      '/companies/%2e%2e',
      '/companies/<x>',
      '/companies/ x',
      '/\\evil.local',
    ])
      expect(() => appLink(PUBLIC_URL, path), path).toThrow();
  });

  it("страница по ссылке закрыта без права: destinationFor('observer', '/reviews') → '/dashboard'", () => {
    // Ссылка не открывает страницу в обход матрицы прав: наблюдатель попадает на свою стартовую страницу.
    expect(destinationFor('observer', '/reviews')).toBe('/dashboard');
    expect(destinationFor('expert', '/reviews')).toBe('/reviews');
  });
});
