import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../config/env.js';
import { DB, type Database } from '../../database/database.module.js';
import {
  organizations,
  authSecurityEvents,
  revokedIdpSessions,
  auditEntries,
  otpCodes,
  responsibilityAcceptances,
  sessions,
  trustedDevices,
  userAccounts,
} from '../../database/schema/index.js';
import type { AuthContext } from './auth.types.js';
import { randomToken, sha256, sixDigitCode } from './crypto.js';
import { DEVELOPMENT_OTP_CODE, DEVELOPMENT_OTP_HASH_PREFIX, otpDeliveryFor } from './development-otp.js';
import { ProblemException } from '../../common/problem.js';

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

  async findAccountForLogin(subject: string, email: string | null, emailVerified: boolean) {
    if (!emailVerified || !email) return undefined;
    const bySubject = await this.db.query.userAccounts.findFirst({ where: eq(userAccounts.idpSubject, subject) });
    if (bySubject) return bySubject.email.toLowerCase() === email.toLowerCase() ? bySubject : undefined;
    // Email fallback exists only for seeded/migrated accounts not yet bound to an IdP subject.
    return this.db.query.userAccounts.findFirst({
      where: and(isNull(userAccounts.idpSubject), sql`lower(${userAccounts.email}) = lower(${email})`),
    });
  }

  async markSignedIn(userId: string, subject: string) {
    const [account] = await this.db
      .update(userAccounts)
      .set({
        idpSubject: subject,
        lastSignInAt: new Date(),
        state: sql`case when ${userAccounts.state} = 'invited' then 'active'::account_state else ${userAccounts.state} end`,
      })
      .where(
        and(
          eq(userAccounts.id, userId),
          inArray(userAccounts.state, ['invited', 'active']),
          or(isNull(userAccounts.idpSubject), eq(userAccounts.idpSubject, subject)),
        ),
      )
      .returning();
    return account;
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

  async trustDevice(userId: string, sessionId: string): Promise<{ token: string; expiresAt: Date } | null> {
    return this.db.transaction(async (tx) => {
      const [account] = await tx.select().from(userAccounts).where(eq(userAccounts.id, userId)).for('update');
      const entry = await tx.query.sessions.findFirst({
        where: and(eq(sessions.id, sessionId), eq(sessions.userId, userId)),
      });
      if (!account || account.state !== 'active' || !entry?.mfaPassed || entry.authVersion !== account.authVersion)
        return null;
      const token = randomToken();
      const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_MS);
      await tx.insert(trustedDevices).values({ userId, deviceHash: sha256(token), expiresAt });
      return { token, expiresAt };
    });
  }

  async create(input: {
    userId: string;
    authVersion: number;
    deviceToken?: string;
    idToken: string | null;
    idpSessionId: string | null;
    idpAuthTime: Date;
    ip: string | null;
    userAgent: string | null;
  }): Promise<{ token: string; id: string; mfaPassed: boolean }> {
    return this.db.transaction(async (tx) => {
      if (!input.idpSessionId) throw new ProblemException(401, 'session_expired', 'Войдите снова');
      // Same lock as backchannel logout prevents a callback from resurrecting a revoked sid.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`idp-sid:${input.idpSessionId}`}, 0))`);
      const [account] = await tx.select().from(userAccounts).where(eq(userAccounts.id, input.userId)).for('update');
      const revoked = await tx.query.revokedIdpSessions.findFirst({
        where: eq(revokedIdpSessions.sid, input.idpSessionId),
      });
      if (
        !account ||
        account.state !== 'active' ||
        revoked ||
        input.idpAuthTime.getTime() + ABSOLUTE_TIMEOUT_MS <= Date.now() ||
        (account.credentialsChangedAt &&
          input.idpAuthTime.getTime() < Math.floor(account.credentialsChangedAt.getTime() / 1000) * 1000) ||
        (account.idpLoggedOutAt && input.idpAuthTime <= account.idpLoggedOutAt)
      ) {
        throw new ProblemException(401, 'session_expired', 'Войдите снова');
      }
      const device = input.deviceToken
        ? await tx.query.trustedDevices.findFirst({
            where: and(
              eq(trustedDevices.userId, input.userId),
              eq(trustedDevices.deviceHash, sha256(input.deviceToken)),
              gt(trustedDevices.expiresAt, new Date()),
            ),
          })
        : undefined;
      const mfaPassed = Boolean(device);
      const token = randomToken();
      const [row] = await tx
        .insert(sessions)
        .values({
          tokenHash: sha256(token),
          userId: input.userId,
          authVersion: account.authVersion,
          mfaPassed,
          idTokenHint: input.idToken,
          idpSessionId: input.idpSessionId,
          idpAuthTime: input.idpAuthTime,
          expiresAt: new Date(Math.min(Date.now(), input.idpAuthTime.getTime()) + ABSOLUTE_TIMEOUT_MS),
          ip: input.ip,
          userAgent: input.userAgent?.slice(0, 512) ?? null,
        })
        .returning({ id: sessions.id });
      return { token, id: row!.id, mfaPassed };
    });
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
        credentialsChangedAt: userAccounts.credentialsChangedAt,
        idpAuthTime: sessions.idpAuthTime,
        idpSessionId: sessions.idpSessionId,
        idpLoggedOutAt: userAccounts.idpLoggedOutAt,
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
    const sidRevoked = row.idpSessionId
      ? await this.db.query.revokedIdpSessions.findFirst({ where: eq(revokedIdpSessions.sid, row.idpSessionId) })
      : true;
    const revoked =
      row.sessionAuthVersion !== row.authVersion ||
      row.state !== 'active' ||
      !row.idpAuthTime ||
      Boolean(sidRevoked) ||
      (row.idpLoggedOutAt !== null && row.idpAuthTime !== null && row.idpAuthTime <= row.idpLoggedOutAt) ||
      (row.credentialsChangedAt !== null &&
        (row.idpAuthTime === null ||
          row.idpAuthTime.getTime() < Math.floor(row.credentialsChangedAt.getTime() / 1000) * 1000));
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

  async logoutToken(sessionId: string): Promise<string | null> {
    const row = await this.db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    return row?.idTokenHint ?? null;
  }

  async issueOtp(
    sessionId: string,
    userId: string,
  ): Promise<
    | {
        issued: true;
        id: string;
        code: string;
        expiresAt: Date;
        retryAfter: number;
        delivery: 'email' | 'development_code';
      }
    | { issued: false; reason: 'too_soon' | 'not_required'; retryAfter: number }
  > {
    return this.db.transaction(async (tx) => {
      // Account lock serializes issuance across all sessions and API replicas.
      const [account] = await tx.select().from(userAccounts).where(eq(userAccounts.id, userId)).for('update');
      const [session] = await tx
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
      if (
        !account ||
        account.state !== 'active' ||
        !session ||
        session.mfaPassed ||
        session.authVersion !== account.authVersion
      )
        return { issued: false, reason: 'not_required', retryAfter: 0 };
      const retryAfter = account.lastOtpIssuedAt
        ? Math.ceil((account.lastOtpIssuedAt.getTime() + OTP_RESEND_MS - Date.now()) / 1000)
        : 0;
      if (retryAfter > 0) return { issued: false, reason: 'too_soon', retryAfter };
      await tx
        .update(otpCodes)
        .set({ consumedAt: new Date() })
        .where(
          and(
            inArray(
              otpCodes.sessionId,
              tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)),
            ),
            isNull(otpCodes.consumedAt),
          ),
        );
      const delivery = otpDeliveryFor(this.env, account);
      const code = delivery === 'development_code' ? DEVELOPMENT_OTP_CODE : sixDigitCode();
      const prefix = delivery === 'development_code' ? DEVELOPMENT_OTP_HASH_PREFIX : '';
      const createdAt = new Date();
      const expiresAt = new Date(Date.now() + OTP_TTL_MS);
      const [row] = await tx
        .insert(otpCodes)
        .values({ sessionId, codeHash: prefix + sha256(`${sessionId}:${code}`), expiresAt, createdAt })
        .returning({ id: otpCodes.id });
      await tx.update(userAccounts).set({ lastOtpIssuedAt: createdAt }).where(eq(userAccounts.id, userId));
      return { issued: true, id: row!.id, code, expiresAt, delivery, retryAfter: OTP_RESEND_MS / 1000 };
    });
  }

  async discardUndeliveredOtp(id: string, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.select({ id: userAccounts.id }).from(userAccounts).where(eq(userAccounts.id, userId)).for('update');
      const [removed] = await tx
        .delete(otpCodes)
        .where(and(eq(otpCodes.id, id), isNull(otpCodes.consumedAt)))
        .returning();
      if (removed)
        await tx
          .update(userAccounts)
          .set({ lastOtpIssuedAt: null })
          .where(and(eq(userAccounts.id, userId), eq(userAccounts.lastOtpIssuedAt, removed.createdAt)));
    });
  }

  async verifyOtp(sessionId: string, userId: string, code: string): Promise<'ok' | 'invalid' | 'expired' | 'locked'> {
    return this.db.transaction(async (tx) => {
      const [account] = await tx.select().from(userAccounts).where(eq(userAccounts.id, userId)).for('update');
      const [session] = await tx
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
      if (
        !account ||
        account.state !== 'active' ||
        !session ||
        session.mfaPassed ||
        session.authVersion !== account.authVersion
      )
        return 'expired';
      // Inspect the latest code even when consumed; never fall back to older codes.
      const current = await tx.query.otpCodes.findFirst({
        where: eq(otpCodes.sessionId, sessionId),
        orderBy: desc(otpCodes.createdAt),
      });
      if (!current || current.consumedAt || current.expiresAt <= new Date()) return 'expired';
      const developmentCode = current.codeHash.startsWith(DEVELOPMENT_OTP_HASH_PREFIX);
      if (developmentCode && otpDeliveryFor(this.env, account) !== 'development_code') {
        // A role/configuration change cannot leave an already issued fixed code usable.
        await tx.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, current.id));
        return 'expired';
      }
      if (current.attempts >= OTP_MAX_ATTEMPTS) return 'locked';
      const prefix = developmentCode ? DEVELOPMENT_OTP_HASH_PREFIX : '';
      if (current.codeHash !== prefix + sha256(`${sessionId}:${code}`)) {
        await tx
          .update(otpCodes)
          .set({ attempts: sql`${otpCodes.attempts} + 1` })
          .where(eq(otpCodes.id, current.id));
        return current.attempts + 1 >= OTP_MAX_ATTEMPTS ? 'locked' : 'invalid';
      }
      await tx
        .update(otpCodes)
        .set({ consumedAt: new Date(), attempts: sql`${otpCodes.attempts} + 1` })
        .where(eq(otpCodes.id, current.id));
      await tx.update(sessions).set({ mfaPassed: true }).where(eq(sessions.id, sessionId));
      return 'ok';
    });
  }

  async backchannelLogout(claims: { jti: string; iat: number; sid?: string; sub?: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (claims.sid)
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`idp-sid:${claims.sid}`}, 0))`);
      const inserted = await tx
        .insert(authSecurityEvents)
        .values({ eventKey: `logout:${sha256(claims.jti)}` })
        .onConflictDoNothing()
        .returning();
      if (!inserted.length) return;
      if (claims.sid) {
        await tx
          .insert(revokedIdpSessions)
          .values({ sid: claims.sid, expiresAt: new Date(Date.now() + 24 * 3600000) })
          .onConflictDoNothing();
        const conditions = [eq(sessions.idpSessionId, claims.sid)];
        if (claims.sub) {
          const account = await tx.query.userAccounts.findFirst({ where: eq(userAccounts.idpSubject, claims.sub) });
          if (!account) return;
          conditions.push(eq(sessions.userId, account.id));
        }
        await tx.delete(sessions).where(and(...conditions));
      } else if (claims.sub) {
        const [account] = await tx
          .select()
          .from(userAccounts)
          .where(eq(userAccounts.idpSubject, claims.sub))
          .for('update');
        if (account) {
          const cutoff = new Date(claims.iat * 1000);
          if (!account.idpLoggedOutAt || account.idpLoggedOutAt < cutoff) {
            await tx.update(userAccounts).set({ idpLoggedOutAt: cutoff }).where(eq(userAccounts.id, account.id));
          }
          await tx
            .delete(sessions)
            .where(
              and(eq(sessions.userId, account.id), or(isNull(sessions.idpAuthTime), lte(sessions.idpAuthTime, cutoff))),
            );
        }
      }
    });
  }

  async revokeForPasswordChange(subject: string, at: Date, eventKey: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const inserted = await tx.insert(authSecurityEvents).values({ eventKey }).onConflictDoNothing().returning();
      if (!inserted.length) return;
      const [account] = await tx.select().from(userAccounts).where(eq(userAccounts.idpSubject, subject)).for('update');
      if (!account || (account.credentialsChangedAt && account.credentialsChangedAt >= at)) return;
      const authVersion = account.authVersion + 1;
      const authCutoff = new Date(Math.floor(at.getTime() / 1000) * 1000);
      await tx
        .delete(sessions)
        .where(
          and(
            eq(sessions.userId, account.id),
            or(lte(sessions.createdAt, at), isNull(sessions.idpAuthTime), lt(sessions.idpAuthTime, authCutoff)),
          ),
        );
      // Revoke all trust, including devices issued by a stale session during the polling lag.
      await tx.delete(trustedDevices).where(eq(trustedDevices.userId, account.id));
      // A fresh login after the password change remains valid when its event is polled later.
      await tx.update(sessions).set({ authVersion }).where(eq(sessions.userId, account.id));
      await tx
        .update(userAccounts)
        .set({
          authVersion,
          credentialsChangedAt: at,
          ...(account.state === 'inactive' && at >= account.updatedAt ? { state: 'active' as const } : {}),
        })
        .where(eq(userAccounts.id, account.id));
      await tx.insert(auditEntries).values({
        userId: account.id,
        organizationId: account.organizationId,
        action: 'auth.credentials_changed',
        objectType: 'account',
        objectId: account.id,
        isAccountEvent: true,
      });
    });
  }

  async acceptResponsibility(userId: string, ip: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.select({ id: userAccounts.id }).from(userAccounts).where(eq(userAccounts.id, userId)).for('update');
      const found = await tx.query.responsibilityAcceptances.findFirst({
        where: and(
          eq(responsibilityAcceptances.userId, userId),
          eq(responsibilityAcceptances.textVersion, RESPONSIBILITY_TEXT_VERSION),
        ),
      });
      if (!found)
        await tx.insert(responsibilityAcceptances).values({ userId, textVersion: RESPONSIBILITY_TEXT_VERSION, ip });
    });
  }

  get cookieBase() {
    return { httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: 'lax' as const, path: '/' };
  }
}
