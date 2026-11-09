import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { ProblemException } from '../src/common/problem.js';
import type { AuthContext } from '../src/modules/auth/auth.types.js';
import { Can, Public, SessionGuard } from '../src/modules/auth/guards.js';

class Routes {
  @Public() open() {}
  @Can('catalog.search') search() {}
  @Can('accounts.manage') manageUsers() {}
  me() {}
}

const env = { SESSION_COOKIE_NAME: 'imbc-session', PUBLIC_URL: 'https://imbc.example.kz' } as never;

function ctx(handler: keyof Routes, req: Record<string, unknown>): ExecutionContext {
  const request = { method: 'GET', cookies: { 'imbc-session': 't' }, path: '/x', get: () => undefined, ...req };
  return {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function auth(role: AuthContext['user']['role'], over: Partial<AuthContext> = {}): AuthContext {
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
      organizationType: 'operator',
      locale: 'kk',
    },
    ...over,
  };
}

function guard(resolved: AuthContext | null) {
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const sessions = { resolve: vi.fn().mockResolvedValue(resolved) };
  return { g: new SessionGuard(new Reflector(), sessions as never, audit as never, env), audit };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (error) {
    return error instanceof ProblemException ? error.code : String(error);
  }
}

describe('SessionGuard', () => {
  it('пропускает публичный маршрут без сеанса', async () => {
    expect(await code(guard(null).g.canActivate(ctx('open', {})))).toBe('ok');
  });

  it('требует сеанс', async () => {
    expect(await code(guard(null).g.canActivate(ctx('me', {})))).toBe('unauthenticated');
  });

  it('требует второй фактор и принятие ответственности', async () => {
    expect(await code(guard(auth('operator', { mfaPassed: false })).g.canActivate(ctx('me', {})))).toBe('mfa_required');
    expect(await code(guard(auth('operator', { responsibilityAccepted: false })).g.canActivate(ctx('me', {})))).toBe(
      'responsibility_required',
    );
  });

  it('проставляет scope из PolicyMatrix', async () => {
    const request = { method: 'GET', cookies: { 'imbc-session': 't' }, path: '/x', get: () => undefined };
    const c = ctx('search', request);
    expect(await code(guard(auth('operator')).g.canActivate(c))).toBe('ok');
    const req = c.switchToHttp().getRequest<{ auth: AuthContext }>();
    expect(req.auth.scope).toBe('visible');
  });

  it('отказ по PolicyMatrix пишется в аудит', async () => {
    const { g, audit } = guard(auth('manufacturer'));
    expect(await code(g.canActivate(ctx('manageUsers', {})))).toBe('forbidden');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'denied', action: 'accounts.manage' }),
    );
  });

  it('отклоняет изменяющий запрос с чужого Origin', async () => {
    const req = { method: 'POST', get: (h: string) => (h === 'origin' ? 'https://evil.example' : undefined) };
    expect(await code(guard(auth('operator')).g.canActivate(ctx('open', req)))).toBe('bad_origin');
  });
});
