import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { computeBinCheckDigit, ROLES, type Role } from '@imbc/contracts';
import { AuditService } from '../src/common/audit.service.js';
import { ProblemException } from '../src/common/problem.js';
import type { Env } from '../src/config/env.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { QUEUES } from '../src/jobs/queues.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { randomToken, sha256 } from '../src/modules/auth/crypto.js';
import * as crypto from '../src/modules/auth/crypto.js';
import { DEVELOPMENT_OTP_HASH_PREFIX } from '../src/modules/auth/development-otp.js';
import { KeycloakAdminService, KeycloakRequestError } from '../src/modules/auth/keycloak-admin.service.js';
import { AuthRateLimitService } from '../src/modules/auth/rate-limit.service.js';
import { SessionService } from '../src/modules/auth/session.service.js';
import { ProfilesService } from '../src/modules/profiles/profiles.service.js';
import { RegistrationController } from '../src/modules/registration/registration.controller.js';
import { JobHandlers } from '../src/worker/handlers.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

// Explicit opt-in to a disposable PostgreSQL database. Never use the platform database.
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('auth on real PostgreSQL', () => {
  // The dev test database can be reached through an SSH tunnel with WAN latency.
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;
  let db: Database;
  let sessions: SessionService;
  let rates: AuthRateLimitService;
  let boss: PgBoss;
  const env = {
    SESSION_COOKIE_NAME: '__Host-imbc-session',
    DEVICE_COOKIE_NAME: '__Host-imbc-device',
    COOKIE_SECURE: true,
    PUBLIC_URL: 'https://imbc.example',
  } as Env;

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema, casing: 'snake_case' });
    sessions = new SessionService(db, env);
    rates = new AuthRateLimitService(db);
    boss = new PgBoss({ connectionString: databaseUrl, schema: 'pgboss_auth_test', supervise: false, schedule: false });
    await boss.start();
    await boss.createQueue(QUEUES.sendPasswordEmail, { retryLimit: 10, retryDelay: 0 });
    await boss.createQueue(QUEUES.cleanupIdentity);
  }, 60000);

  afterAll(async () => {
    await boss?.stop();
    await pool?.end();
  });

  async function account(state: 'active' | 'invited' | 'inactive' = 'active', bound = true, role: Role = 'operator') {
    const [org] = await db
      .insert(schema.organizations)
      .values({
        type: role === 'manufacturer' || role === 'operator' || role === 'observer' ? role : 'imbc',
        name: 'Auth test',
      })
      .returning();
    const [user] = await db
      .insert(schema.userAccounts)
      .values({
        organizationId: org!.id,
        email: `${randomUUID()}@example.invalid`,
        role,
        state,
        idpSubject: bound ? randomUUID() : null,
      })
      .returning();
    return user!;
  }

  const session = (
    user: typeof schema.userAccounts.$inferSelect,
    authTime = new Date(Math.floor(Date.now() / 1000) * 1000),
    sid: string = randomUUID(),
  ) =>
    sessions.create({
      userId: user.id,
      authVersion: user.authVersion,
      idToken: null,
      idpSessionId: sid,
      idpAuthTime: authTime,
      ip: null,
      userAgent: 'test',
    });

  async function trust(userId: string, sessionId: string) {
    await db.update(schema.sessions).set({ mfaPassed: true }).where(eq(schema.sessions.id, sessionId));
    return (await sessions.trustDevice(userId, sessionId))!;
  }

  function developmentEnv(userId: string): Env {
    return {
      ...env,
      DEPLOYMENT_ENV: 'development',
      DEV_FIXED_OTP_ENABLED: true,
      DEV_FIXED_OTP_USER_ID: userId,
      DEV_FIXED_OTP_ACCOUNTS: [],
    };
  }

  function listedDevelopmentEnv(userId: string, role: Role): Env {
    return {
      ...env,
      DEPLOYMENT_ENV: 'development',
      DEV_FIXED_OTP_ENABLED: true,
      DEV_FIXED_OTP_ACCOUNTS: [{ id: userId, role }],
    };
  }

  it.each(ROLES)('issues and verifies an ordinary session-bound fixed-code record for listed %s', async (role) => {
    const user = await account('active', true, role);
    const entry = await session(user);
    const configured = listedDevelopmentEnv(user.id, role);
    const service = new SessionService(db, configured);
    const mail = { send: vi.fn() };
    const controller = new AuthController({} as never, service, new AuditService(db), mail as never, rates, configured);
    const auth = (await service.resolve(entry.token))!;
    expect(controller.me(auth).otpDelivery).toBe('development_code');
    expect(await service.verifyOtp(entry.id, user.id, '000000')).toBe('expired');
    expect(await controller.sendOtp(auth, { ip: '127.0.0.22' } as never)).toMatchObject({
      sent: false,
      reason: 'development_code',
      retryAfter: 60,
    });
    expect(mail.send).not.toHaveBeenCalled();
    expect(await service.issueOtp(entry.id, user.id)).toMatchObject({ issued: false, reason: 'too_soon' });
    expect(await service.verifyOtp(entry.id, user.id, '000000')).toBe('ok');
    expect(await service.verifyOtp(entry.id, user.id, '000000')).toBe('expired');
    expect((await service.resolve(entry.token))?.mfaPassed).toBe(true);
  });

  it('keeps a recreated account with the same email and role on normal random email codes', async () => {
    const old = await account();
    const configured = listedDevelopmentEnv(old.id, old.role);
    await db.delete(schema.userAccounts).where(eq(schema.userAccounts.id, old.id));
    const replacement = await account();
    await db.update(schema.userAccounts).set({ email: old.email }).where(eq(schema.userAccounts.id, replacement.id));
    const entry = await session(replacement);
    const service = new SessionService(db, configured);
    const random = vi.spyOn(crypto, 'sixDigitCode').mockReturnValue('482651');
    try {
      expect(await service.issueOtp(entry.id, replacement.id)).toMatchObject({
        issued: true,
        delivery: 'email',
        code: '482651',
      });
      expect(await service.verifyOtp(entry.id, replacement.id, '000000')).toBe('invalid');
      expect(await service.verifyOtp(entry.id, replacement.id, '482651')).toBe('ok');
    } finally {
      random.mockRestore();
    }
  });

  it('consumes outstanding listed codes after account removal, UUID replacement or either side of the role binding changes', async () => {
    for (const change of ['remove', 'new_uuid', 'configured_role', 'account_role'] as const) {
      const user = await account('active', true, 'expert');
      const entry = await session(user);
      const configured = listedDevelopmentEnv(user.id, user.role);
      const service = new SessionService(db, configured);
      const issued = await service.issueOtp(entry.id, user.id);
      if (!issued.issued) throw new Error('Expected a listed fixed code');
      if (change === 'remove') configured.DEV_FIXED_OTP_ACCOUNTS = [];
      if (change === 'new_uuid') configured.DEV_FIXED_OTP_ACCOUNTS = [{ id: randomUUID(), role: user.role }];
      if (change === 'configured_role') configured.DEV_FIXED_OTP_ACCOUNTS = [{ id: user.id, role: 'director' }];
      if (change === 'account_role')
        await db.update(schema.userAccounts).set({ role: 'director' }).where(eq(schema.userAccounts.id, user.id));
      expect(await service.verifyOtp(entry.id, user.id, '000000')).toBe('expired');
      expect(
        (await db.query.otpCodes.findFirst({ where: eq(schema.otpCodes.id, issued.id) }))?.consumedAt,
      ).not.toBeNull();
      expect((await sessions.resolve(entry.token))?.mfaPassed).toBe(false);
    }
  });

  it('issues only a stored, session-bound test code with honest no-email response and normal cooldown/replay limits', async () => {
    const user = await account('active', true, 'administrator');
    const entry = await session(user);
    const configured = developmentEnv(user.id);
    const service = new SessionService(db, configured);
    const mail = { send: vi.fn() };
    const controller = new AuthController({} as never, service, new AuditService(db), mail as never, rates, configured);
    const auth = (await service.resolve(entry.token))!;
    expect(controller.me(auth).otpDelivery).toBe('development_code');
    expect(await service.verifyOtp(entry.id, user.id, '000000')).toBe('expired');
    expect(await controller.sendOtp(auth, { ip: '127.0.0.21' } as never)).toMatchObject({
      sent: false,
      reason: 'development_code',
      retryAfter: 60,
      expiresAt: expect.any(String),
    });
    expect(mail.send).not.toHaveBeenCalled();
    const code = (await db.query.otpCodes.findFirst({ where: eq(schema.otpCodes.sessionId, entry.id) }))!;
    expect(code.codeHash).toBe(DEVELOPMENT_OTP_HASH_PREFIX + sha256(`${entry.id}:000000`));
    expect(await service.issueOtp(entry.id, user.id)).toMatchObject({ issued: false, reason: 'too_soon' });
    expect(await service.verifyOtp(entry.id, user.id, '000000')).toBe('ok');
    expect(await service.verifyOtp(entry.id, user.id, '000000')).toBe('expired');
    expect((await service.resolve(entry.token))?.mfaPassed).toBe(true);
  });

  it('keeps normal random issuance for other users, non-admin roles, disabled flags and production tiers', async () => {
    const random = vi.spyOn(crypto, 'sixDigitCode').mockReturnValue('482651');
    try {
      for (const mode of ['wrong_user', 'wrong_role', 'disabled', 'production'] as const) {
        const user = await account('active', true, mode === 'wrong_role' ? 'operator' : 'administrator');
        const entry = await session(user);
        const configured = developmentEnv(user.id);
        if (mode === 'wrong_user') configured.DEV_FIXED_OTP_USER_ID = randomUUID();
        if (mode === 'disabled') configured.DEV_FIXED_OTP_ENABLED = false;
        if (mode === 'production') configured.DEPLOYMENT_ENV = 'production';
        const service = new SessionService(db, configured);
        const issued = await service.issueOtp(entry.id, user.id);
        expect(issued).toMatchObject({ issued: true, delivery: 'email', code: '482651' });
        expect(await service.verifyOtp(entry.id, user.id, '000000')).toBe('invalid');
        expect(await service.verifyOtp(entry.id, user.id, '482651')).toBe('ok');
      }
      expect(random).toHaveBeenCalledTimes(4);
    } finally {
      random.mockRestore();
    }
  });

  it('invalidates outstanding fixed codes when UUID, role, flag or deployment tier changes', async () => {
    for (const change of ['uuid', 'role', 'disabled', 'production'] as const) {
      const user = await account('active', true, 'administrator');
      const entry = await session(user);
      const configured = developmentEnv(user.id);
      const service = new SessionService(db, configured);
      expect(await service.issueOtp(entry.id, user.id)).toMatchObject({ issued: true, delivery: 'development_code' });
      if (change === 'uuid') configured.DEV_FIXED_OTP_USER_ID = randomUUID();
      if (change === 'disabled') configured.DEV_FIXED_OTP_ENABLED = false;
      if (change === 'production') configured.DEPLOYMENT_ENV = 'production';
      if (change === 'role')
        await db.update(schema.userAccounts).set({ role: 'operator' }).where(eq(schema.userAccounts.id, user.id));
      expect(await service.verifyOtp(entry.id, user.id, '000000')).toBe('expired');
      expect((await sessions.resolve(entry.token))?.mfaPassed).toBe(false);
    }
  });

  it('expires and locks fixed codes normally and never applies a fixed-code exception to a normal random 000000', async () => {
    const user = await account('active', true, 'administrator');
    const service = new SessionService(db, developmentEnv(user.id));
    const locked = await session(user);
    await service.issueOtp(locked.id, user.id);
    await Promise.all(Array.from({ length: 8 }, () => service.verifyOtp(locked.id, user.id, '999999')));
    expect(await service.verifyOtp(locked.id, user.id, '000000')).toBe('locked');
    const record = (await db.query.otpCodes.findFirst({ where: eq(schema.otpCodes.sessionId, locked.id) }))!;
    expect(record.attempts).toBe(5);
    await db.update(schema.userAccounts).set({ lastOtpIssuedAt: null }).where(eq(schema.userAccounts.id, user.id));
    const expired = await session(user);
    await service.issueOtp(expired.id, user.id);
    await db
      .update(schema.otpCodes)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(schema.otpCodes.sessionId, expired.id));
    expect(await service.verifyOtp(expired.id, user.id, '000000')).toBe('expired');

    const ordinary = await account();
    const normal = await session(ordinary);
    const random = vi.spyOn(crypto, 'sixDigitCode').mockReturnValue('000000');
    try {
      expect(await sessions.issueOtp(normal.id, ordinary.id)).toMatchObject({ delivery: 'email', code: '000000' });
    } finally {
      random.mockRestore();
    }
    expect(await sessions.verifyOtp(normal.id, ordinary.id, '000000')).toBe('ok');
  });

  it('serializes OTP issuance across sessions and preserves cooldown after logout', async () => {
    const user = await account();
    const attempts = await Promise.all([session(user), session(user), session(user)]);
    const issued = await Promise.all(
      Array.from({ length: 12 }, (_, i) => sessions.issueOtp(attempts[i % 3]!.id, user.id)),
    );
    expect(issued.filter((item) => item.issued)).toHaveLength(1);
    expect(issued.filter((item) => !item.issued && item.reason === 'too_soon')).toHaveLength(11);
    for (const entry of attempts) await sessions.destroy(entry.id);
    const next = await session(user);
    expect(await sessions.issueOtp(next.id, user.id)).toMatchObject({ issued: false, reason: 'too_soon' });
  });

  it('does not lose attempt increments when many wrong codes arrive concurrently', async () => {
    const user = await account();
    const entry = await session(user);
    const issued = await sessions.issueOtp(entry.id, user.id);
    if (!issued.issued) throw new Error('expected issued code');
    const wrong = issued.code === '000000' ? '000001' : '000000';
    await Promise.all(Array.from({ length: 12 }, () => sessions.verifyOtp(entry.id, user.id, wrong)));
    const code = await db.query.otpCodes.findFirst({ where: eq(schema.otpCodes.id, issued.id) });
    expect(code?.attempts).toBe(5);
    expect(await sessions.verifyOtp(entry.id, user.id, issued.code)).toBe('locked');
    expect((await sessions.resolve(entry.token))?.mfaPassed).toBe(false);
  });

  it('invalidates previous codes and consumes the new code exactly once', async () => {
    const user = await account();
    const entry = await session(user);
    const old = await sessions.issueOtp(entry.id, user.id);
    if (!old.issued) throw new Error('expected issued code');
    await db
      .update(schema.userAccounts)
      .set({ lastOtpIssuedAt: new Date(Date.now() - 61000) })
      .where(eq(schema.userAccounts.id, user.id));
    const next = await sessions.issueOtp(entry.id, user.id);
    if (!next.issued) throw new Error('expected reissued code');
    expect((await db.query.otpCodes.findFirst({ where: eq(schema.otpCodes.id, old.id) }))?.consumedAt).not.toBeNull();
    if (old.code !== next.code) expect(await sessions.verifyOtp(entry.id, user.id, old.code)).toBe('invalid');
    const results = await Promise.all(
      Array.from({ length: 10 }, () => sessions.verifyOtp(entry.id, user.id, next.code)),
    );
    expect(results.filter((result) => result === 'ok')).toHaveLength(1);
    expect(results.filter((result) => result === 'expired')).toHaveLength(9);
  });

  it('removes an undelivered OTP and permits a safe delivery retry', async () => {
    const user = await account();
    const entry = await session(user);
    const auth = (await sessions.resolve(entry.token))!;
    const controller = new AuthController(
      {} as never,
      sessions,
      new AuditService(db),
      { send: vi.fn().mockRejectedValue(new Error('SMTP unavailable')) } as never,
      rates,
      env,
    );
    await expect(controller.sendOtp(auth, { ip: '127.0.0.2' } as never)).rejects.toMatchObject({
      code: 'mail_unavailable',
    });
    expect(await db.query.otpCodes.findMany({ where: eq(schema.otpCodes.sessionId, entry.id) })).toHaveLength(0);
    expect(await sessions.issueOtp(entry.id, user.id)).toMatchObject({ issued: true });
  });

  it('rejects expired codes, idle/absolute sessions, changed auth versions and inactive users', async () => {
    const user = await account();
    const entry = await session(user);
    const issued = await sessions.issueOtp(entry.id, user.id);
    if (!issued.issued) throw new Error('expected issued code');
    await db
      .update(schema.otpCodes)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(schema.otpCodes.id, issued.id));
    expect(await sessions.verifyOtp(entry.id, user.id, issued.code)).toBe('expired');
    await db
      .update(schema.sessions)
      .set({ lastSeenAt: new Date(Date.now() - 31 * 60000) })
      .where(eq(schema.sessions.id, entry.id));
    expect(await sessions.resolve(entry.token)).toBeNull();
    await expect(session(user, new Date(Date.now() - 13 * 3600000))).rejects.toMatchObject({ code: 'session_expired' });
    const revoked = await session(user);
    await db
      .update(schema.userAccounts)
      .set({ authVersion: user.authVersion + 1 })
      .where(eq(schema.userAccounts.id, user.id));
    expect(await sessions.resolve(revoked.token)).toBeNull();
    const inactive = await account('inactive');
    expect(await sessions.markSignedIn(inactive.id, inactive.idpSubject!)).toBeUndefined();
    await expect(session(inactive)).rejects.toMatchObject({ code: 'session_expired' });
  });

  it('binds only verified unbound accounts and never overwrites an existing subject', async () => {
    const user = await account('invited', false);
    const subject = randomUUID();
    expect(await sessions.findAccountForLogin(subject, user.email, false)).toBeUndefined();
    expect((await sessions.findAccountForLogin(subject, user.email, true))?.id).toBe(user.id);
    expect((await sessions.markSignedIn(user.id, subject))?.state).toBe('active');
    expect(await sessions.findAccountForLogin(randomUUID(), user.email, true)).toBeUndefined();
    expect(await sessions.markSignedIn(user.id, randomUUID())).toBeUndefined();
    expect(await sessions.findAccountForLogin(subject, 'changed@example.invalid', true)).toBeUndefined();
  });

  it('revokes old sessions/devices on reset without invalidating a fresh post-reset login', async () => {
    const user = await account();
    const old = await session(user, new Date(Date.now() - 3600000));
    const fresh = await session(user);
    const oldDevice = await trust(user.id, old.id);
    const resetAt = new Date(Date.now() - 30000);
    await db
      .update(schema.sessions)
      .set({ createdAt: new Date(resetAt.getTime() - 1000) })
      .where(eq(schema.sessions.id, old.id));
    await db
      .update(schema.trustedDevices)
      .set({ createdAt: new Date(resetAt.getTime() - 1000) })
      .where(eq(schema.trustedDevices.userId, user.id));
    const freshDevice = await trust(user.id, fresh.id);
    await sessions.revokeForPasswordChange(user.idpSubject!, resetAt, 'password:one');
    expect(await sessions.resolve(old.token)).toBeNull();
    expect(await sessions.resolve(fresh.token)).not.toBeNull();
    expect(await sessions.isTrustedDevice(user.id, oldDevice.token)).toBe(false);
    expect(await sessions.isTrustedDevice(user.id, freshDevice.token)).toBe(false);
    expect(await sessions.trustDevice(user.id, old.id)).toBeNull();
    await sessions.revokeForPasswordChange(user.idpSubject!, resetAt, 'password:one');
    expect((await db.query.userAccounts.findFirst({ where: eq(schema.userAccounts.id, user.id) }))?.authVersion).toBe(
      user.authVersion + 1,
    );
  });

  it('scopes backchannel logout by IdP session and deduplicates replayed jti', async () => {
    const user = await account();
    const first = await session(user);
    const second = await session(user);
    const firstRow = await db.query.sessions.findFirst({ where: eq(schema.sessions.id, first.id) });
    const secondRow = await db.query.sessions.findFirst({ where: eq(schema.sessions.id, second.id) });
    await sessions.backchannelLogout({
      jti: 'logout-once',
      iat: Math.floor(Date.now() / 1000),
      sub: user.idpSubject!,
      sid: firstRow!.idpSessionId!,
    });
    expect(await sessions.resolve(first.token)).toBeNull();
    expect(await sessions.resolve(second.token)).not.toBeNull();
    await sessions.backchannelLogout({
      jti: 'logout-once',
      iat: Math.floor(Date.now() / 1000),
      sub: user.idpSubject!,
      sid: secondRow!.idpSessionId!,
    });
    expect(await sessions.resolve(second.token)).not.toBeNull();
    await expect(session(user, new Date(), firstRow!.idpSessionId!)).rejects.toMatchObject({ code: 'session_expired' });
    const beforeCallback = randomUUID();
    await sessions.backchannelLogout({
      jti: 'before-callback',
      iat: Math.floor(Date.now() / 1000),
      sid: beforeCallback,
    });
    await expect(session(user, new Date(), beforeCallback)).rejects.toMatchObject({ code: 'session_expired' });
  });

  it('prevents session resurrection when callback and backchannel run concurrently', async () => {
    const user = await account();
    const sid = randomUUID();
    const [login] = await Promise.allSettled([
      session(user, new Date(), sid),
      sessions.backchannelLogout({ jti: randomUUID(), iat: Math.floor(Date.now() / 1000), sid }),
    ]);
    if (login!.status === 'fulfilled') expect(await sessions.resolve(login!.value.token)).toBeNull();
    else expect(login!.reason).toMatchObject({ code: 'session_expired' });
    const legacyToken = randomToken();
    await db.insert(schema.sessions).values({
      userId: user.id,
      tokenHash: sha256(legacyToken),
      authVersion: user.authVersion,
      expiresAt: new Date(Date.now() + 60000),
      mfaPassed: true,
    });
    expect(await sessions.resolve(legacyToken)).toBeNull();
  });

  it('processes password revocation before a failing older lockout email', async () => {
    const user = await account();
    const old = await session(user, new Date(Date.now() - 3600000));
    const worker = new JobHandlers(
      db,
      {} as never,
      { sendRaw: vi.fn().mockRejectedValue(new Error('SMTP unavailable')) } as never,
      env,
      new AuditService(db),
      {
        securityEvents: async () => [
          { type: 'USER_DISABLED_BY_TEMPORARY_LOCKOUT', userId: user.idpSubject, time: Date.now() - 10000 },
          {
            type: 'UPDATE_CREDENTIAL',
            userId: user.idpSubject,
            time: Date.now() - 5000,
            details: { credential_type: 'password' },
          },
        ],
      } as never,
      sessions,
    );
    await expect(worker.keycloakEvents()).rejects.toThrow('SMTP unavailable');
    expect(await sessions.resolve(old.token)).toBeNull();
  });

  it('preserves a retryable session on IdP logout failure and returns only a local URL on success', async () => {
    const user = await account();
    const entry = await session(user);
    const auth = (await sessions.resolve(entry.token))!;
    const oidc = { logout: vi.fn().mockRejectedValueOnce(new Error('IdP unavailable')).mockResolvedValue(undefined) };
    const controller = new AuthController(oidc as never, sessions, new AuditService(db), {} as never, rates, env);
    const response = { clearCookie: vi.fn() };
    await expect(controller.logout(auth, {} as never, response as never)).rejects.toMatchObject({
      code: 'logout_unavailable',
    });
    expect(await sessions.resolve(entry.token)).not.toBeNull();
    expect(await controller.logout(auth, {} as never, response as never)).toEqual({
      redirectTo: '/login?logged_out=1',
    });
    expect(await sessions.resolve(entry.token)).toBeNull();
  });

  it('enforces a shared PostgreSQL rate limit under concurrency', async () => {
    const results = await Promise.all(
      Array.from({ length: 15 }, () => rates.allow('integration', 'one-user', 5, 3600)),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  function validBin(): string {
    for (;;) {
      const first = String(Math.floor(Math.random() * 1e11)).padStart(11, '0');
      const digit = computeBinCheckDigit(first);
      if (digit !== null) return first + digit;
    }
  }

  function registration(keycloak: Pick<KeycloakAdminService, 'createUser' | 'deleteUser'>, queue = boss) {
    return new RegistrationController(
      db,
      pool,
      queue,
      keycloak as KeycloakAdminService,
      new AuditService(db),
      new ProfilesService(db),
      rates,
    );
  }

  const registrationBody = (bin = validBin()) => ({
    bin,
    companyName: 'Integration manufacturer',
    email: `${randomUUID()}@example.invalid`,
    acceptTerms: true,
    heardAboutUs: null,
  });

  it('commits a draft and durable email job, while SMTP failure remains retryable', async () => {
    const keycloak = {
      createUser: vi.fn(async () => randomUUID()),
      deleteUser: vi.fn(),
      sendPasswordEmail: vi.fn().mockRejectedValueOnce(new Error('SMTP unavailable')).mockResolvedValue(undefined),
    };
    const body = registrationBody();
    expect(await registration(keycloak).register(body, { ip: '127.0.0.3' } as never)).toEqual({
      status: 'password_email_queued',
    });
    const user = await db.query.userAccounts.findFirst({ where: eq(schema.userAccounts.email, body.email) });
    const profile = await db.query.manufacturerProfiles.findFirst({
      where: eq(schema.manufacturerProfiles.organizationId, user!.organizationId),
    });
    expect(profile?.status).toBe('draft');
    expect(
      await db.query.profileSections.findMany({ where: eq(schema.profileSections.profileId, profile!.id) }),
    ).toHaveLength(8);
    const worker = new JobHandlers(
      db,
      {} as never,
      {} as never,
      env,
      new AuditService(db),
      keycloak as never,
      sessions,
    );
    const reader = new PgBoss({
      connectionString: databaseUrl,
      schema: 'pgboss_auth_test',
      supervise: false,
      schedule: false,
    });
    await reader.start();
    try {
      const [job] = await reader.fetch<{ subject: string }>(QUEUES.sendPasswordEmail);
      expect(job?.data.subject).toBe(user?.idpSubject);
      await expect(worker.sendPasswordEmail(job!.data)).rejects.toThrow('SMTP unavailable');
      await reader.fail(QUEUES.sendPasswordEmail, job!.id, { message: 'temporary delivery failure' });
      const persisted = await pool.query('select state from pgboss_auth_test.job where id = $1', [job!.id]);
      expect(persisted.rows[0].state).toBe('retry');
      await worker.sendPasswordEmail(job!.data);
      expect(keycloak.sendPasswordEmail).toHaveBeenCalledTimes(2);
    } finally {
      await reader.stop();
      await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
    }
  });

  it('rolls back nested draft writes when durable enqueue fails and compensates IdP creation', async () => {
    const keycloak = { createUser: vi.fn(async () => randomUUID()), deleteUser: vi.fn().mockResolvedValue(undefined) };
    const body = registrationBody();
    const failedQueue = { send: vi.fn().mockRejectedValue(new Error('queue unavailable')) } as unknown as PgBoss;
    await expect(registration(keycloak, failedQueue).register(body, { ip: '127.0.0.4' } as never)).rejects.toThrow();
    expect(await db.query.organizations.findFirst({ where: eq(schema.organizations.bin, body.bin) })).toBeUndefined();
    expect(await db.query.userAccounts.findFirst({ where: eq(schema.userAccounts.email, body.email) })).toBeUndefined();
    expect(keycloak.deleteUser).toHaveBeenCalledTimes(1);
  });

  it('returns one success and one precise conflict for simultaneous duplicate BIN registration', async () => {
    let created = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const keycloak = {
      createUser: vi.fn(async () => {
        if (++created === 2) release();
        await barrier;
        return randomUUID();
      }),
      deleteUser: vi.fn().mockResolvedValue(undefined),
    };
    const bin = validBin();
    const results = await Promise.allSettled(
      [registrationBody(bin), registrationBody(bin)].map((body) =>
        registration(keycloak).register(body, { ip: '127.0.0.5' } as never),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(ProblemException);
    expect(failure.reason.code).toBe('bin_exists');
    expect(keycloak.deleteUser).toHaveBeenCalledTimes(1);
    await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
  });

  it('maps an IdP duplicate to email conflict and keeps invitation resend neutral', async () => {
    const keycloak = {
      createUser: vi.fn().mockRejectedValue(new KeycloakRequestError(409, 'create user')),
      deleteUser: vi.fn(),
    };
    await expect(
      registration(keycloak).register(registrationBody(), { ip: '127.0.0.6' } as never),
    ).rejects.toMatchObject({ code: 'email_exists' });
    const invited = await account('invited');
    const known = await registration(keycloak).resend({ email: invited.email }, { ip: '127.0.0.6' } as never);
    const unknown = await registration(keycloak).resend({ email: 'unknown@example.invalid' }, {
      ip: '127.0.0.6',
    } as never);
    expect(known).toEqual(unknown);
  });
});
