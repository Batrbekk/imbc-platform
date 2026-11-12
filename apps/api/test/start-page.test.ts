import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { can, ROLES, roleHome, type Action, type Role } from '@imbc/contracts';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import type { AuthContext } from '../src/modules/auth/auth.types.js';
import { postLoginPath } from '../src/modules/auth/post-login.js';
import { ORGANIZATION_TYPE } from './support/organization-type.js';

const env = { DEPLOYMENT_ENV: 'production', DEV_FIXED_OTP_ENABLED: false, DEV_FIXED_OTP_ACCOUNTS: [] } as never;

function auth(role: Role): AuthContext {
  return {
    sessionId: 's',
    mfaPassed: true,
    responsibilityAccepted: true,
    user: {
      id: 'u',
      email: 'a@b.kz',
      fullName: null,
      role,
      organizationId: 'o',
      organizationType: ORGANIZATION_TYPE[role],
      locale: 'kk',
    },
  };
}

describe('стартовая страница на сервере (OPR-31, GEN-08)', () => {
  it.each(ROLES)('ответ сеанса %s несёт homePath = roleHome', (role) => {
    const controller = new AuthController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      env,
      {} as never,
    );
    expect(controller.me(auth(role)).homePath).toBe(roleHome(role));
  });

  const guarded: [string, Action][] = [
    ['/dashboard', 'dashboard.read'],
    ['/catalog', 'catalog.search'],
    // /profile — рабочее место производителя: у остальных ролей стартовая страница.
    ['/profile', 'profile.edit'],
    // /reviews — очередь проверки, только у SME.
    ['/reviews', 'review.take'],
    // /admin/accounts — организации и аккаунты, только у администратора.
    ['/admin/accounts', 'accounts.manage'],
  ];

  it.each(ROLES)('после входа %s попадает на разрешённую страницу', (role) => {
    expect(postLoginPath(role, '/')).toBe(roleHome(role));
    for (const [path, action] of guarded)
      for (const saved of [path, `${path}?q=steel`, `${path}/`, `${path}/123`])
        expect(postLoginPath(role, saved), saved).toBe(can(role, action) ? saved : roleHome(role));
  });

  it('страница по сегментам: /catalog/123 сохраняется у роли с каталогом, у остальных — стартовая', () => {
    for (const role of ROLES)
      expect(postLoginPath(role, '/catalog/123?tab=docs'), role).toBe(
        can(role, 'catalog.search') ? '/catalog/123?tab=docs' : roleHome(role),
      );
    expect(postLoginPath('manufacturer', '/catalog/123')).toBe('/profile');
    expect(postLoginPath('administrator', '/catalog/123')).toBe('/admin/accounts');
    expect(postLoginPath('operator', '/catalog/123')).toBe('/catalog/123');
    // Похожее имя — другая страница, шлюз каталога его не касается.
    for (const role of ROLES) expect(postLoginPath(role, '/catalogue'), role).toBe('/catalogue');
  });

  it('закодированный путь сравнивается декодированным: /%63atalog — это каталог', () => {
    expect(postLoginPath('manufacturer', '/%63atalog')).toBe('/profile');
    expect(postLoginPath('expert', '/%64ashboard')).toBe('/reviews');
    expect(postLoginPath('operator', '/%63atalog')).toBe('/%63atalog');
    expect(postLoginPath('manufacturer', '/%2F%2Fevil.example')).toBe('/%2F%2Fevil.example');
  });

  it.each(ROLES)('внешний адрес и страницы входа ведут %s на стартовую страницу', (role) => {
    for (const saved of [
      '//outside.invalid',
      'https://outside.invalid',
      '/login',
      '/login?error=session_expired',
      '/register',
      '/auth/verify?returnTo=%2Fcatalog',
      '/auth/responsibility',
    ])
      expect(postLoginPath(role, saved), saved).toBe(roleHome(role));
  });
});
