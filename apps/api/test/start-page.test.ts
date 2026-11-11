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
    const controller = new AuthController({} as never, {} as never, {} as never, {} as never, {} as never, env);
    expect(controller.me(auth(role)).homePath).toBe(roleHome(role));
  });

  const guarded: [string, Action][] = [
    ['/dashboard', 'dashboard.read'],
    ['/catalog', 'catalog.search'],
  ];

  it.each(ROLES)('после входа %s попадает на разрешённую страницу', (role) => {
    expect(postLoginPath(role, '/')).toBe(roleHome(role));
    for (const [path, action] of guarded)
      expect(postLoginPath(role, path), path).toBe(can(role, action) ? path : roleHome(role));
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
