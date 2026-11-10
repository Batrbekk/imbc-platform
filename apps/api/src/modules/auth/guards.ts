import { can, type Action } from '@imbc/contracts';
import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuditService } from '../../common/audit.service.js';
import { ProblemException } from '../../common/problem.js';
import { ENV, type Env } from '../../config/env.js';
import type { AuthContext } from './auth.types.js';
import { SessionService } from './session.service.js';

const PUBLIC = 'imbc:public';
const ALLOW_MFA_PENDING = 'imbc:allow-mfa-pending';
const ALLOW_RESPONSIBILITY_PENDING = 'imbc:allow-responsibility-pending';
const ACTION = 'imbc:action';
const SIGNED_BACKCHANNEL = 'imbc:signed-backchannel';

/** Маршрут без сеанса (вход, регистрация, health). */
export const Public = () => SetMetadata(PUBLIC, true);
/** Only the OIDC logout endpoint uses this; it verifies an issuer-signed JWT itself. */
export const SignedBackchannel = () => SetMetadata(SIGNED_BACKCHANNEL, true);
/** Маршрут доступен до ввода email-кода (отправка и проверка кода, /me). */
export const AllowMfaPending = () => SetMetadata(ALLOW_MFA_PENDING, true);
/** Маршрут доступен до принятия ответственности (сам диалог, /me, выход). */
export const AllowResponsibilityPending = () => SetMetadata(ALLOW_RESPONSIBILITY_PENDING, true);
/** Действие из PolicyMatrix, которое проверяет PolicyGuard (GEN-10, ADR-03). */
export const Can = (action: Action) => SetMetadata(ACTION, action);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.auth) throw new ProblemException(401, 'unauthenticated', 'Требуется вход');
  return req.auth;
});

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Глобальный guard: сеанс, CSRF по Origin, второй фактор и диалог ответственности,
 * затем право из PolicyMatrix. Отказ пишется в аудит (GEN-10).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const req = context.switchToHttp().getRequest<Request>();
    const meta = <T>(key: string) => this.reflector.getAllAndOverride<T>(key, targets);

    if (!SAFE_METHODS.has(req.method) && !meta<boolean>(SIGNED_BACKCHANNEL)) this.checkOrigin(req);
    if (meta<boolean>(PUBLIC)) return true;

    const auth = await this.sessions.resolve(req.cookies?.[this.env.SESSION_COOKIE_NAME]);
    if (!auth) throw new ProblemException(401, 'unauthenticated', 'Требуется вход');
    req.auth = auth;

    if (!auth.mfaPassed && !meta<boolean>(ALLOW_MFA_PENDING)) {
      throw new ProblemException(401, 'mfa_required', 'Введите код из письма');
    }
    if (!auth.responsibilityAccepted && !meta<boolean>(ALLOW_RESPONSIBILITY_PENDING)) {
      throw new ProblemException(403, 'responsibility_required', 'Примите ответственность за учётные данные');
    }

    const action = meta<Action>(ACTION);
    if (action) {
      const scope = can(auth.user.role, action);
      if (!scope) {
        await this.audit.record({
          userId: auth.user.id,
          organizationId: auth.user.organizationId,
          action,
          objectType: 'route',
          objectId: req.route?.path ?? req.path,
          outcome: 'denied',
          ip: req.ip ?? null,
        });
        throw new ProblemException(403, 'forbidden', 'Нет прав на это действие');
      }
      auth.scope = scope;
    }
    return true;
  }

  /** CSRF: изменяющие запросы принимаются только со своего origin (архитектура §9). */
  private checkOrigin(req: Request): void {
    const origin = req.get('origin') ?? req.get('referer');
    if (!origin && !req.cookies?.[this.env.SESSION_COOKIE_NAME] && req.get('sec-fetch-site') !== 'cross-site') return;
    try {
      if (origin && new URL(origin).origin === new URL(this.env.PUBLIC_URL).origin) return;
    } catch {
      // Invalid and opaque origins fail with a controlled response, never a 500.
    }
    throw new ProblemException(403, 'bad_origin', 'Запрос с чужого origin');
  }
}
