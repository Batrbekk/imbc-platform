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
  @Can('catalog.export') exportResults() {}
  @Can('dashboard.read') board() {}
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
      // Наблюдатель состоит в организации типа observer (раздел 3.1).
      organizationType: role === 'observer' ? 'observer' : 'operator',
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

  it('наблюдатель ищет по видимым профилям и открывает дашборд (GEN-13)', async () => {
    for (const handler of ['search', 'board'] as const) {
      const c = ctx(handler, {});
      expect(await code(guard(auth('observer')).g.canActivate(c))).toBe('ok');
      expect(c.switchToHttp().getRequest<{ auth: AuthContext }>().auth.scope).toBe('visible');
    }
  });

  it('прямой запрос наблюдателя на выгрузку отклоняется и пишется в аудит (GEN-08, GEN-13)', async () => {
    const { g, audit } = guard(auth('observer'));
    expect(await code(g.canActivate(ctx('exportResults', {})))).toBe('forbidden');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'denied', action: 'catalog.export' }),
    );
  });

  it('отклоняет изменяющий запрос с чужого Origin', async () => {
    const req = { method: 'POST', get: (h: string) => (h === 'origin' ? 'https://evil.example' : undefined) };
    expect(await code(guard(auth('operator')).g.canActivate(ctx('open', req)))).toBe('bad_origin');
  });

  it.each([undefined, 'null', 'invalid-url', 'https://evil.example'])(
    'rejects invalid or absent Origin with a session cookie',
    async (origin) => {
      const req = { method: 'POST', get: (h: string) => (h === 'origin' ? origin : undefined) };
      expect(await code(guard(auth('operator')).g.canActivate(ctx('open', req)))).toBe('bad_origin');
    },
  );

  it('accepts a same-origin mutation and a public non-browser request without cookies', async () => {
    expect(
      await code(
        guard(auth('operator')).g.canActivate(
          ctx('me', {
            method: 'POST',
            get: (h: string) => (h === 'origin' ? 'https://imbc.example.kz' : undefined),
          }),
        ),
      ),
    ).toBe('ok');
    expect(await code(guard(null).g.canActivate(ctx('open', { method: 'POST', cookies: {} })))).toBe('ok');
  });
});
