import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../config/env.js';
import { DB, type Database } from '../../database/database.module.js';
import {
  organizations,
  otpCodes,
  responsibilityAcceptances,
  sessions,
  trustedDevices,
  userAccounts,
} from '../../database/schema/index.js';
import type { AuthContext } from './auth.types.js';
import { randomToken, sha256, sixDigitCode } from './crypto.js';

/** Параметры входа из спецификации (AUTH-03, AUTH-05) и ADR-20. */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
export const TRUSTED_DEVICE_MS = 30 * 24 * 60 * 60 * 1000;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_MS = 60 * 1000;
export const RESPONSIBILITY_TEXT_VERSION = '1';

@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async findAccountForLogin(subject: string, email: string | null) {
    const bySubject = await this.db.query.userAccounts.findFirst({ where: eq(userAccounts.idpSubject, subject) });
    if (bySubject) return bySubject;
    if (!email) return undefined;
    return this.db.query.userAccounts.findFirst({ where: sql`lower(${userAccounts.email}) = lower(${email})` });
  }

  async markSignedIn(userId: string, subject: string): Promise<void> {
    await this.db
      .update(userAccounts)
      .set({
        idpSubject: subject,
        lastSignInAt: new Date(),
        state: sql`case when ${userAccounts.state} = 'invited' then 'active'::account_state else ${userAccounts.state} end`,
      })
      .where(eq(userAccounts.id, userId));
  }

  async isTrustedDevice(userId: string, deviceToken: string | undefined): Promise<boolean> {
    if (!deviceToken) return false;
    const row = await this.db.query.trustedDevices.findFirst({
      where: and(
        eq(trustedDevices.userId, userId),
        eq(trustedDevices.deviceHash, sha256(deviceToken)),
        gt(trustedDevices.expiresAt, new Date()),
      ),
    });
    return Boolean(row);
  }

  async trustDevice(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_MS);
    await this.db
      .insert(trustedDevices)
      .values({ userId, deviceHash: sha256(token), expiresAt })
      .onConflictDoUpdate({ target: [trustedDevices.userId, trustedDevices.deviceHash], set: { expiresAt } });
    return { token, expiresAt };
  }

  async create(input: {
    userId: string;
    authVersion: number;
    mfaPassed: boolean;
    idToken: string | null;
    ip: string | null;
    userAgent: string | null;
  }): Promise<{ token: string; id: string }> {
    const token = randomToken();
    const [row] = await this.db
      .insert(sessions)
      .values({
        tokenHash: sha256(token),
        userId: input.userId,
        authVersion: input.authVersion,
        mfaPassed: input.mfaPassed,
        idTokenHint: input.idToken,
        expiresAt: new Date(Date.now() + ABSOLUTE_TIMEOUT_MS),
        ip: input.ip,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
      })
      .returning({ id: sessions.id });
    return { token, id: row!.id };
  }

  /** Загружает сеанс; учитывает бездействие, абсолютный срок, auth_version и состояние аккаунта. */
  async resolve(token: string | undefined): Promise<AuthContext | null> {
    if (!token) return null;
    const now = new Date();
    const [row] = await this.db
      .select({
        sessionId: sessions.id,
        mfaPassed: sessions.mfaPassed,
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt,
        sessionAuthVersion: sessions.authVersion,
        userId: userAccounts.id,
        email: userAccounts.email,
        fullName: userAccounts.fullName,
        role: userAccounts.role,
        state: userAccounts.state,
        locale: userAccounts.locale,
        authVersion: userAccounts.authVersion,
        organizationId: organizations.id,
        organizationType: organizations.type,
      })
      .from(sessions)
      .innerJoin(userAccounts, eq(userAccounts.id, sessions.userId))
      .innerJoin(organizations, eq(organizations.id, userAccounts.organizationId))
      .where(eq(sessions.tokenHash, sha256(token)))
      .limit(1);
    if (!row) return null;

    const idleExpired = now.getTime() - row.lastSeenAt.getTime() > IDLE_TIMEOUT_MS;
    const revoked = row.sessionAuthVersion !== row.authVersion || row.state !== 'active';
    if (idleExpired || row.expiresAt <= now || revoked) {
      await this.db.delete(sessions).where(eq(sessions.id, row.sessionId));
      return null;
    }
    // Продлеваем бездействие не чаще раза в минуту, чтобы не писать на каждый запрос.
    if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
      await this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
    }

    const accepted = await this.db.query.responsibilityAcceptances.findFirst({
      where: and(
        eq(responsibilityAcceptances.userId, row.userId),
        eq(responsibilityAcceptances.textVersion, RESPONSIBILITY_TEXT_VERSION),
      ),
    });

    return {
      sessionId: row.sessionId,
      mfaPassed: row.mfaPassed,
      responsibilityAccepted: Boolean(accepted),
      user: {
        id: row.userId,
        email: row.email,
        fullName: row.fullName,
        role: row.role,
        locale: row.locale,
        organizationId: row.organizationId,
        organizationType: row.organizationType,
      },
    };
  }

  async destroy(sessionId: string): Promise<string | null> {
    const [row] = await this.db
      .delete(sessions)
      .where(eq(sessions.id, sessionId))
      .returning({ idToken: sessions.idTokenHint });
    return row?.idToken ?? null;
  }

  async issueOtp(sessionId: string): Promise<string | null> {
    const last = await this.db.query.otpCodes.findFirst({
      where: eq(otpCodes.sessionId, sessionId),
      orderBy: desc(otpCodes.createdAt),
    });
    if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_MS) return null;
    const code = sixDigitCode();
    await this.db.insert(otpCodes).values({
      sessionId,
      codeHash: sha256(`${sessionId}:${code}`),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });
    return code;
  }

  async verifyOtp(sessionId: string, code: string): Promise<'ok' | 'invalid' | 'expired' | 'locked'> {
    const current = await this.db.query.otpCodes.findFirst({
      where: and(eq(otpCodes.sessionId, sessionId), isNull(otpCodes.consumedAt)),
      orderBy: desc(otpCodes.createdAt),
    });
    if (!current || current.expiresAt <= new Date()) return 'expired';
    if (current.attempts >= OTP_MAX_ATTEMPTS) return 'locked';
    if (current.codeHash !== sha256(`${sessionId}:${code}`)) {
      await this.db
        .update(otpCodes)
        .set({ attempts: current.attempts + 1 })
        .where(eq(otpCodes.id, current.id));
      return 'invalid';
    }
    await this.db.transaction(async (tx) => {
      await tx.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, current.id));
      await tx.update(sessions).set({ mfaPassed: true }).where(eq(sessions.id, sessionId));
    });
    return 'ok';
  }

  async acceptResponsibility(userId: string, ip: string | null): Promise<void> {
    await this.db.insert(responsibilityAcceptances).values({ userId, textVersion: RESPONSIBILITY_TEXT_VERSION, ip });
  }

  get cookieBase() {
    return { httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: 'lax' as const, path: '/' };
  }
}
