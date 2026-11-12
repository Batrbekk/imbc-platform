import { Body, Controller, Get, HttpCode, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { LOCALES, roleHome, safeReturnTo } from '@imbc/contracts';
import { AuditService } from '../../common/audit.service.js';
import { parseOrThrow, ProblemException } from '../../common/problem.js';
import { ENV, type Env } from '../../config/env.js';
import { MailService } from '../../mail/mail.service.js';
import type { AuthContext } from './auth.types.js';
import { sign, unsign } from './crypto.js';
import { otpDeliveryFor } from './development-otp.js';
import { postLoginPath } from './post-login.js';
import { AllowMfaPending, AllowResponsibilityPending, Auth, Public, SignedBackchannel } from './guards.js';
import { KeycloakAdminService } from './keycloak-admin.service.js';
import { OidcService } from './oidc.service.js';
import { ABSOLUTE_TIMEOUT_MS, OTP_TTL_MS, SessionService, TRUSTED_DEVICE_MS } from './session.service.js';
import { AuthRateLimitService } from './rate-limit.service.js';
import { ManufacturerOnboardingService } from '../registration/onboarding.service.js';

const FLOW_COOKIE = 'imbc-oidc-flow';
const FLOW_TTL_MS = 10 * 60 * 1000;

interface Flow {
  v: string;
  s: string;
  r: string;
  exp: number;
}

/**
 * BFF-вход (ADR-04, ADR-20): OIDC Code + PKCE → сеанс в PostgreSQL →
 * email-код на новом устройстве → диалог ответственности при первом входе.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly oidc: OidcService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly rates: AuthRateLimitService,
    @Inject(ENV) private readonly env: Env,
    private readonly onboarding: ManufacturerOnboardingService,
    private readonly keycloak: KeycloakAdminService,
  ) {}

  @Public()
  @Get('login')
  async login(
    @Query('returnTo') returnTo: string | undefined,
    @Query('locale') locale: string | undefined,
    @Query('prompt') prompt: string | undefined,
    @Res() res: Response,
  ) {
    const pkce = OidcService.newPkce();
    const flow: Flow = {
      v: pkce.codeVerifier,
      s: pkce.state,
      r: safeReturnTo(returnTo),
      exp: Date.now() + FLOW_TTL_MS,
    };
    res.cookie(FLOW_COOKIE, sign(flow, this.env.SESSION_SECRET), {
      ...this.sessions.cookieBase,
      maxAge: FLOW_TTL_MS,
    });
    const url = await this.oidc.authorizationUrl({
      state: pkce.state,
      codeChallenge: await pkce.challenge,
      locale: LOCALES.includes(locale as never) ? locale! : 'kk',
      ...(prompt === 'login' ? { prompt: 'login' as const } : {}),
    });
    res.redirect(302, url.toString());
  }

  @Public()
  @Get('password-reset')
  passwordReset(@Query('locale') locale: string | undefined, @Res() res: Response) {
    res.redirect(302, this.oidc.passwordResetUrl(LOCALES.includes(locale as never) ? locale! : 'kk').toString());
  }

  @Public()
  @SignedBackchannel()
  @Post('backchannel-logout')
  @HttpCode(200)
  async backchannelLogout(@Body() body: unknown) {
    const { logout_token } = parseOrThrow(z.object({ logout_token: z.string().min(1).max(16000) }), body);
    let claims: Awaited<ReturnType<OidcService['verifyLogoutToken']>>;
    try {
      claims = await this.oidc.verifyLogoutToken(logout_token);
    } catch {
      throw new ProblemException(400, 'invalid_logout_token', 'Некорректное уведомление о выходе');
    }
    await this.sessions.backchannelLogout(claims);
    return { ok: true };
  }

  @Public()
  @Get('callback')
  async callback(@Req() req: Request, @Res() res: Response) {
    const flow = unsign<Flow>(req.cookies?.[FLOW_COOKIE], this.env.SESSION_SECRET);
    res.clearCookie(FLOW_COOKIE, this.sessions.cookieBase);
    if (!flow || flow.exp < Date.now()) return res.redirect(302, '/login?error=flow_expired');

    let identity: Awaited<ReturnType<OidcService['exchange']>>;
    try {
      identity = await this.oidc.exchange(new URL(req.originalUrl, this.env.PUBLIC_URL), {
        codeVerifier: flow.v,
        state: flow.s,
      });
    } catch (error) {
      this.logger.warn(`OIDC callback failed: ${String(error)}`);
      return res.redirect(302, '/login?error=oidc');
    }

    if (!identity.emailVerified) return res.redirect(302, '/login?error=email_unverified');
    if (!identity.sessionId || !Number.isFinite(identity.authTime.getTime()) || identity.authTime.getTime() <= 0) {
      return res.redirect(302, '/login?error=oidc');
    }
    const account = await this.sessions.findAccountForLogin(identity.subject, identity.email, identity.emailVerified);
    if (!account || account.state === 'blocked') {
      await this.audit.record({
        action: 'auth.sign_in',
        objectType: 'account',
        objectId: identity.email,
        outcome: 'denied',
        isAccountEvent: true,
        ip: req.ip ?? null,
      });
      return res.redirect(302, '/login?error=no_account');
    }

    // Неактивный (AUTH-07) входит, если пароль задан после перехода: событие Keycloak worker мог ещё не прочесть.
    if (account.state === 'inactive' && !(await this.reactivatedByPassword(account.id, identity.subject)))
      return res.redirect(302, '/login?error=account_inactive');
    if (
      account.credentialsChangedAt &&
      identity.authTime.getTime() < Math.floor(account.credentialsChangedAt.getTime() / 1000) * 1000
    ) {
      return res.redirect(302, '/login?error=session_expired');
    }
    const current = await this.sessions.markSignedIn(account.id, identity.subject);
    if (!current) return res.redirect(302, '/login?error=no_account');
    let session: Awaited<ReturnType<SessionService['create']>>;
    try {
      session = await this.sessions.create({
        userId: account.id,
        authVersion: current.authVersion,
        deviceToken: req.cookies?.[this.env.DEVICE_COOKIE_NAME],
        idToken: identity.idToken,
        idpSessionId: identity.sessionId,
        idpAuthTime: identity.authTime,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
    } catch (error) {
      if (error instanceof ProblemException) return res.redirect(302, '/login?error=session_expired');
      throw error;
    }
    await this.audit.record({
      userId: account.id,
      organizationId: account.organizationId,
      action: 'auth.sign_in',
      objectType: 'account',
      objectId: account.id,
      isAccountEvent: true,
      ip: req.ip ?? null,
    });
    // Вход означает, что пароль задан: если событие Keycloak ещё не пришло, профиль, принятие NDA и чтение
    // Adata создаёт вход (MAN-03, FC-02, IMBC-07). Ожидание ограничено lock_timeout; вход от результата не зависит.
    if (current.role === 'manufacturer')
      await this.onboarding
        .onPasswordSet(current.id, 'sign_in', new Date())
        .catch(() =>
          this.logger.warn('onboarding: профиль при входе не создан, adata: чтение при входе не поставлено'),
        );

    res.cookie(this.env.SESSION_COOKIE_NAME, session.token, {
      ...this.sessions.cookieBase,
      maxAge: ABSOLUTE_TIMEOUT_MS,
    });
    const returnTo = postLoginPath(current.role, flow.r);
    const next = session.mfaPassed ? returnTo : `/auth/verify?returnTo=${encodeURIComponent(returnTo)}`;
    return res.redirect(302, next);
  }

  @AllowMfaPending()
  @AllowResponsibilityPending()
  @Get('me')
  me(@Auth() auth: AuthContext) {
    return {
      user: auth.user,
      gates: { mfa: auth.mfaPassed, responsibility: auth.responsibilityAccepted },
      homePath: roleHome(auth.user.role),
      otpDelivery: otpDeliveryFor(this.env, auth.user),
    };
  }

  /** NOT-02: код отправляется только когда вход его требует, не чаще раза в минуту. */
  @AllowMfaPending()
  @AllowResponsibilityPending()
  @Post('otp/send')
  @HttpCode(202)
  async sendOtp(@Auth() auth: AuthContext, @Req() req: Request) {
    if (auth.mfaPassed) return { sent: false, reason: 'not_required', retryAfter: 0 };
    await this.rates.enforce('otp-send-ip', req.ip ?? 'unknown', 120, 3600);
    await this.rates.enforce('otp-send-user', auth.user.id, 60, 3600);
    const issued = await this.sessions.issueOtp(auth.sessionId, auth.user.id);
    if (!issued.issued) return { sent: false, reason: issued.reason, retryAfter: issued.retryAfter };
    if (issued.delivery === 'development_code')
      return {
        sent: false,
        reason: 'development_code',
        retryAfter: issued.retryAfter,
        expiresAt: issued.expiresAt.toISOString(),
      };
    // NOT-02: на языке учётной записи; отправляется сразу, без очереди — пользователь ждёт код.
    try {
      await this.mail.send('NOT-02', auth.user.email, auth.user.locale, {
        code: issued.code,
        minutes: OTP_TTL_MS / 60_000,
      });
    } catch {
      await this.sessions.discardUndeliveredOtp(issued.id, auth.user.id);
      this.logger.warn('OTP email delivery failed');
      throw new ProblemException(503, 'mail_unavailable', 'Не удалось отправить письмо. Попробуйте снова.');
    }
    return { sent: true, retryAfter: issued.retryAfter, expiresAt: issued.expiresAt.toISOString() };
  }

  @AllowMfaPending()
  @AllowResponsibilityPending()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Auth() auth: AuthContext,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { code } = parseOrThrow(z.object({ code: z.string().regex(/^\d{6}$/) }), body);
    await this.rates.enforce('otp-verify-user', auth.user.id, 60, 3600);
    const result = await this.sessions.verifyOtp(auth.sessionId, auth.user.id, code);
    if (result !== 'ok') throw new ProblemException(400, `otp_${result}`, 'Код не принят');
    // Устройство запоминается на 30 дней (AUTH-03).
    const device = await this.sessions.trustDevice(auth.user.id, auth.sessionId);
    if (!device) throw new ProblemException(401, 'session_expired', 'Войдите снова');
    res.cookie(this.env.DEVICE_COOKIE_NAME, device.token, {
      ...this.sessions.cookieBase,
      maxAge: TRUSTED_DEVICE_MS,
    });
    await this.audit.record({
      userId: auth.user.id,
      organizationId: auth.user.organizationId,
      action: 'auth.otp_verified',
      objectType: 'account',
      objectId: auth.user.id,
      isAccountEvent: true,
      ip: req.ip ?? null,
    });
    return { ok: true, responsibility: auth.responsibilityAccepted };
  }

  /** AUTH-10: без принятия ответственности ни один другой маршрут не отвечает. */
  @AllowResponsibilityPending()
  @Post('responsibility')
  @HttpCode(204)
  async acceptResponsibility(@Auth() auth: AuthContext, @Req() req: Request) {
    if (auth.responsibilityAccepted) return;
    await this.sessions.acceptResponsibility(auth.user.id, req.ip ?? null);
    await this.audit.record({
      userId: auth.user.id,
      organizationId: auth.user.organizationId,
      action: 'auth.responsibility_accepted',
      objectType: 'account',
      objectId: auth.user.id,
      isAccountEvent: true,
      ip: req.ip ?? null,
    });
  }

  @AllowMfaPending()
  @AllowResponsibilityPending()
  @Post('logout')
  @HttpCode(200)
  async logout(@Auth() auth: AuthContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const idToken = await this.sessions.logoutToken(auth.sessionId);
    try {
      // RP logout runs on the server: ID tokens never enter a browser response or URL.
      await this.oidc.logout(idToken);
    } catch {
      // Preserve the local session so the user can retry an unavailable IdP logout.
      throw new ProblemException(503, 'logout_unavailable', 'Не удалось завершить выход. Попробуйте снова.');
    }
    await this.sessions.destroy(auth.sessionId);
    res.clearCookie(this.env.SESSION_COOKIE_NAME, this.sessions.cookieBase);
    await this.audit.record({
      userId: auth.user.id,
      organizationId: auth.user.organizationId,
      action: 'auth.sign_out',
      objectType: 'account',
      objectId: auth.user.id,
      isAccountEvent: true,
      ip: req.ip ?? null,
    });
    return { redirectTo: '/login?logged_out=1' };
  }

  /**
   * Время текущего пароля спрашивается у Keycloak (`GET /users/{id}/credentials`); сбой запроса — как
   * «пароль не обновлён»: при сомнении вход не пускает, человек видит, что аккаунт неактивен.
   */
  private async reactivatedByPassword(accountId: string, subject: string): Promise<boolean> {
    try {
      const passwordSetAt = await this.keycloak.passwordUpdatedAt(subject);
      return passwordSetAt !== null && (await this.sessions.reactivateAfterReset(accountId, passwordSetAt, 'sign_in'));
    } catch {
      this.logger.warn('inactive account: password time or reactivation failed, sign-in refused');
      return false;
    }
  }
}
