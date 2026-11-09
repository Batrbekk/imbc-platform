import { Body, Controller, Get, HttpCode, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service.js';
import { parseOrThrow, ProblemException } from '../../common/problem.js';
import { ENV, type Env } from '../../config/env.js';
import { MailService } from '../../mail/mail.service.js';
import type { AuthContext } from './auth.types.js';
import { sign, unsign } from './crypto.js';
import { AllowMfaPending, AllowResponsibilityPending, Auth, Public } from './guards.js';
import { OidcService } from './oidc.service.js';
import { ABSOLUTE_TIMEOUT_MS, OTP_TTL_MS, SessionService, TRUSTED_DEVICE_MS } from './session.service.js';

const FLOW_COOKIE = 'imbc-oidc-flow';
const FLOW_TTL_MS = 10 * 60 * 1000;

interface Flow {
  v: string;
  s: string;
  r: string;
  exp: number;
}

const safeReturnTo = (value: unknown): string =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/';

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
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Get('login')
  async login(
    @Query('returnTo') returnTo: string | undefined,
    @Query('locale') locale: string | undefined,
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
      locale: locale ?? 'kk',
    });
    res.redirect(302, url.toString());
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

    const account = await this.sessions.findAccountForLogin(identity.subject, identity.email);
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

    await this.sessions.markSignedIn(account.id, identity.subject);
    const trusted = await this.sessions.isTrustedDevice(account.id, req.cookies?.[this.env.DEVICE_COOKIE_NAME]);
    const session = await this.sessions.create({
      userId: account.id,
      authVersion: account.authVersion,
      mfaPassed: trusted,
      idToken: identity.idToken,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    await this.audit.record({
      userId: account.id,
      organizationId: account.organizationId,
      action: 'auth.sign_in',
      objectType: 'account',
      objectId: account.id,
      isAccountEvent: true,
      ip: req.ip ?? null,
    });

    res.cookie(this.env.SESSION_COOKIE_NAME, session.token, {
      ...this.sessions.cookieBase,
      maxAge: ABSOLUTE_TIMEOUT_MS,
    });
    const next = trusted ? flow.r : `/auth/verify?returnTo=${encodeURIComponent(flow.r)}`;
    return res.redirect(302, next);
  }

  @AllowMfaPending()
  @AllowResponsibilityPending()
  @Get('me')
  me(@Auth() auth: AuthContext) {
    return {
      user: auth.user,
      gates: { mfa: auth.mfaPassed, responsibility: auth.responsibilityAccepted },
    };
  }

  /** NOT-02: код отправляется только когда вход его требует, не чаще раза в минуту. */
  @AllowMfaPending()
  @AllowResponsibilityPending()
  @Post('otp/send')
  @HttpCode(202)
  async sendOtp(@Auth() auth: AuthContext) {
    if (auth.mfaPassed) return { sent: false, reason: 'not_required' };
    const code = await this.sessions.issueOtp(auth.sessionId);
    if (!code) return { sent: false, reason: 'too_soon' };
    // NOT-02: на языке учётной записи; отправляется сразу, без очереди — пользователь ждёт код.
    await this.mail.send('NOT-02', auth.user.email, auth.user.locale, { code, minutes: OTP_TTL_MS / 60_000 });
    return { sent: true };
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
    const result = await this.sessions.verifyOtp(auth.sessionId, code);
    if (result !== 'ok') throw new ProblemException(400, `otp_${result}`, 'Код не принят');
    // Устройство запоминается на 30 дней (AUTH-03).
    const device = await this.sessions.trustDevice(auth.user.id);
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
    const idToken = await this.sessions.destroy(auth.sessionId);
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
    return { redirectTo: await this.oidc.endSessionUrl(idToken) };
  }
}
