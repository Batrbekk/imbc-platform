import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AccountState, OrganizationType, Role } from '@imbc/contracts';
import { Logger, RequestMethod } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditService } from '../src/common/audit.service.js';
import { ProblemException } from '../src/common/problem.js';
import type { Env } from '../src/config/env.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { seedDemo } from '../src/database/seed.js';
import { logQueueError } from '../src/infra/infra.module.js';
import { type IdentitySyncJob, QUEUES } from '../src/jobs/queues.js';
import { AccountLifecycleService } from '../src/modules/admin/account-lifecycle.service.js';
import { ADMIN_ROUTES } from '../src/modules/admin/organizations.service.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { sha256, sign } from '../src/modules/auth/crypto.js';
import { KeycloakAdminService, KeycloakRequestError } from '../src/modules/auth/keycloak-admin.service.js';
import { AuthRateLimitService } from '../src/modules/auth/rate-limit.service.js';
import { SessionService } from '../src/modules/auth/session.service.js';
import { JobHandlers } from '../src/worker/handlers.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

// Одноразовая БД imbc_auth_test, настоящий pg-boss и SessionService; Keycloak — объект с vi.fn; почта — только *.local.
const databaseUrl = process.env.TEST_DATABASE_URL;
const IP = '192.0.2.20';
const SIGNED_IN_AT = new Date('2026-10-01T05:00:00Z');

type Keycloak = Pick<KeycloakAdminService, 'updateUser' | 'logoutUser'>;
type Account = typeof schema.userAccounts.$inferSelect;

const ORGANIZATION_OF: Record<Role, OrganizationType> = {
  manufacturer: 'manufacturer',
  expert: 'imbc',
  administrator: 'imbc',
  director: 'imbc',
  operator: 'operator',
  observer: 'observer',
};

describe.skipIf(!databaseUrl)(
  'блокировка, роль и почта-логин: сеансы завершаются сразу, Keycloak догоняет заданием (ADM-02, ADM-05, AUTH-06, MAN-05)',
  () => {
    vi.setConfig({ testTimeout: 30000 });
    const env = {
      SESSION_COOKIE_NAME: '__Host-imbc-session',
      DEVICE_COOKIE_NAME: '__Host-imbc-device',
      COOKIE_SECURE: true,
      PUBLIC_URL: 'https://imbc.example',
      SESSION_SECRET: `secret-${randomUUID()}`,
    } as Env;
    let pool: pg.Pool;
    let db: Database;
    let boss: PgBoss;
    let sessions: SessionService;
    let admin: AuthUser;
    let imbcId: string;
    let keycloak: { updateUser: Mock<Keycloak['updateUser']>; logoutUser: Mock<Keycloak['logoutUser']> };

    const lifecycle = (identity: Keycloak = keycloak, audit = new AuditService(db), queue: PgBoss = boss) =>
      new AccountLifecycleService(pool, queue, identity as KeycloakAdminService, audit);

    /** Код и статус отказа ProblemException. */
    const problem = async (promise: Promise<unknown>) => {
      const error = await promise.then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ProblemException);
      const p = error as ProblemException;
      return { status: p.getStatus(), code: p.code };
    };

    const audits = async (action: string, objectId: string) =>
      (
        await pool.query<{
          diff: unknown;
          is_account_event: boolean;
          ip: string | null;
          user_id: string;
          object_type: string;
        }>(
          `select diff, is_account_event, host(ip) as ip, user_id, object_type from audit_entries
            where action = $1 and object_id = $2 order by at, id`,
          [action, objectId],
        )
      ).rows;

    const syncJobs = async (accountId: string) =>
      (
        await pool.query<{ data: IdentitySyncJob }>(
          `select data from pgboss_auth_test.job where name = $1 and data->>'accountId' = $2 order by created_on, id`,
          [QUEUES.identitySync, accountId],
        )
      ).rows.map((r) => r.data);

    const passwordJobs = async (subject: string) =>
      Number(
        (
          await pool.query<{ n: string }>(
            `select count(*) as n from pgboss_auth_test.job where name = $1 and data->>'subject' = $2`,
            [QUEUES.sendPasswordEmail, subject],
          )
        ).rows[0]!.n,
      );

    const row = async (id: string) =>
      (await db.query.userAccounts.findFirst({ where: eq(schema.userAccounts.id, id) }))!;

    const sessionCount = async (userId: string) =>
      (await pool.query('select 1 from sessions where user_id = $1', [userId])).rowCount;

    /** Аккаунт роли `role` в организации её типа (IMBC — единственная), по умолчанию active и вошедший. */
    async function account(
      opts: { role?: Role; state?: AccountState; subject?: string | null; lastSignInAt?: Date | null } = {},
    ): Promise<Account> {
      const role = opts.role ?? 'manufacturer';
      const type = ORGANIZATION_OF[role];
      const state = opts.state ?? 'active';
      const organizationId =
        type === 'imbc'
          ? imbcId
          : (
              await db
                .insert(schema.organizations)
                .values({ type, name: `${type} ${randomUUID()}` })
                .returning({ id: schema.organizations.id })
            )[0]!.id;
      const id = randomUUID();
      const [created] = await db
        .insert(schema.userAccounts)
        .values({
          id,
          organizationId,
          email: `${id}@lifecycle.local`,
          fullName: 'Тестовый Аккаунт',
          role,
          state,
          idpSubject: opts.subject === undefined ? randomUUID() : opts.subject,
          lastSignInAt: opts.lastSignInAt !== undefined ? opts.lastSignInAt : state === 'invited' ? null : SIGNED_IN_AT,
        })
        .returning();
      return created!;
    }

    /** Второй администратор IMBC — исполнитель. */
    const administrator = async (): Promise<AuthUser> => {
      const a = await account({ role: 'administrator' });
      return { ...admin, id: a.id, email: a.email };
    };

    /** Открытый сеанс BFF через настоящий SessionService (как после callback). */
    const openSession = (userId: string, service = sessions) =>
      service.create({
        userId,
        authVersion: 0,
        idToken: null,
        idpSessionId: randomUUID(),
        idpAuthTime: new Date(),
        ip: null,
        userAgent: 'test',
      });

    /** OIDC callback с заглушкой обмена кода (как adata-prefill.integration.test.ts): адрес 302 и cookie сеанса. */
    async function callback(target: Account, service = sessions) {
      const oidc = {
        exchange: vi.fn(async () => ({
          subject: target.idpSubject,
          email: target.email,
          emailVerified: true,
          sessionId: randomUUID(),
          authTime: new Date(),
          idToken: null,
        })),
      };
      const onboarding = { onPasswordSet: vi.fn(async () => undefined) };
      const controller = new AuthController(
        oidc as never,
        service,
        new AuditService(db),
        {} as never,
        new AuthRateLimitService(db),
        env,
        onboarding as never,
      );
      const flow = sign({ v: 'verifier', s: 'state', r: '/profile', exp: Date.now() + 60000 }, env.SESSION_SECRET);
      const req = {
        cookies: { 'imbc-oidc-flow': flow },
        originalUrl: '/api/auth/callback?code=c&state=state',
        ip: '127.0.0.9',
        get: () => 'test',
      };
      const res = { clearCookie: vi.fn(), cookie: vi.fn(), redirect: vi.fn() };
      await controller.callback(req as never, res as never);
      expect(res.redirect).toHaveBeenCalledOnce();
      const [status, location] = res.redirect.mock.calls[0] as [number, string];
      expect(status).toBe(302);
      const cookie = res.cookie.mock.calls.find(([name]) => name === env.SESSION_COOKIE_NAME) as
        [string, string] | undefined;
      return { location, token: cookie?.[1] };
    }

    /** SessionService, у которого между markSignedIn и create входа выполняется `between` — вход «в полёте». */
    function racingSessions(between: () => Promise<unknown>): SessionService {
      const service = new SessionService(db, env);
      const markSignedIn = service.markSignedIn.bind(service);
      service.markSignedIn = async (...args) => {
        const result = await markSignedIn(...args);
        await between();
        return result;
      };
      return service;
    }

    /**
     * Строка `heldId` занята отдельной транзакцией, пока все действия не встанут в ожидание блокировки
     * (`pg_locks`, `granted = false`); затем она освобождается, и действия идут по очереди.
     */
    async function whileHeld<T>(heldId: string, start: () => Promise<T>[]): Promise<PromiseSettledResult<T>[]> {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('select 1 from user_accounts where id = $1 for no key update', [heldId]);
        const running = start();
        const settled = Promise.allSettled(running);
        for (let i = 0; ; i++) {
          const { rows } = await client.query<{ n: string }>(
            'select count(distinct pid) as n from pg_locks where not granted and pid <> pg_backend_pid()',
          );
          if (Number(rows[0]!.n) >= running.length) break;
          if (i > 75) throw new Error('действия не встали в ожидание блокировки');
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await client.query('commit');
        return await settled;
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }

    const rejection = (result: PromiseSettledResult<unknown>) => {
      expect(result.status).toBe('rejected');
      const reason = (result as PromiseRejectedResult).reason as ProblemException;
      expect(reason).toBeInstanceOf(ProblemException);
      return { status: reason.getStatus(), code: reason.code };
    };

    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool);
      await seedDemo(pool);
      db = drizzle(pool, { schema, casing: 'snake_case' });
      boss = new PgBoss({
        connectionString: databaseUrl,
        schema: 'pgboss_auth_test',
        supervise: false,
        schedule: false,
      });
      await boss.start();
      await boss.createQueue(QUEUES.sendPasswordEmail, { retryLimit: 10, retryDelay: 0 });
      await boss.createQueue(QUEUES.cleanupIdentity);
      await boss.createQueue(QUEUES.identitySync, { retryLimit: 5, retryDelay: 0 });
      sessions = new SessionService(db, env);

      await pool.query(`update user_accounts set state = 'active' where lower(email) = 'admin@imbc.local'`);
      const seeded = (await db.query.userAccounts.findFirst({
        where: eq(schema.userAccounts.email, 'admin@imbc.local'),
      }))!;
      imbcId = seeded.organizationId;
      admin = {
        id: seeded.id,
        email: seeded.email,
        fullName: seeded.fullName,
        role: 'administrator',
        organizationId: seeded.organizationId,
        organizationType: 'imbc',
        locale: seeded.locale,
      };
    }, 60000);

    beforeEach(() => {
      keycloak = {
        updateUser: vi.fn<Keycloak['updateUser']>().mockResolvedValue(undefined),
        logoutUser: vi.fn<Keycloak['logoutUser']>().mockResolvedValue(undefined),
      };
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    afterAll(async () => {
      await boss?.stop();
      await pool?.end();
    });

    it('блокировка: blocked, auth_version +1, сеансы удалены, resolve прежнего токена — null, задание identity-sync с logout (ADM-02, AUTH-06)', async () => {
      const target = await account();
      const first = await openSession(target.id);
      const second = await openSession(target.id);
      expect(await sessions.resolve(first.token)).not.toBeNull();

      const result = await lifecycle().block(admin, target.id, IP);
      expect(result).toEqual({
        account: {
          id: target.id,
          email: target.email,
          fullName: 'Тестовый Аккаунт',
          role: 'manufacturer',
          state: 'blocked',
          lastSignInAt: SIGNED_IN_AT.toISOString(),
        },
      });
      const after = await row(target.id);
      expect(after).toMatchObject({ state: 'blocked', authVersion: target.authVersion + 1 });
      expect(await sessionCount(target.id)).toBe(0);
      expect(await sessions.resolve(first.token)).toBeNull();
      expect(await sessions.resolve(second.token)).toBeNull();
      expect(await syncJobs(target.id)).toEqual([{ accountId: target.id, logout: true }]);
      expect(await audits('account.blocked', target.id)).toEqual([
        { diff: { from: 'active' }, is_account_event: true, ip: IP, user_id: admin.id, object_type: 'account' },
      ]);
      // Keycloak не вызывается в транзакции действия: его догоняет задание.
      expect(keycloak.updateUser).not.toHaveBeenCalled();
      expect(keycloak.logoutUser).not.toHaveBeenCalled();

      // Повтор без изменения — 200, без записи аудита, без задания и без нового auth_version.
      expect((await lifecycle().block(admin, target.id, IP)).account.state).toBe('blocked');
      expect((await row(target.id)).authVersion).toBe(after.authVersion);
      expect(await audits('account.blocked', target.id)).toHaveLength(1);
      expect(await syncJobs(target.id)).toHaveLength(1);

      // Приглашённый блокируется так же; неверный или чужой id — 404.
      const invited = await account({ state: 'invited' });
      expect((await lifecycle().block(admin, invited.id, IP)).account.state).toBe('blocked');
      expect((await audits('account.blocked', invited.id))[0]!.diff).toEqual({ from: 'invited' });
      for (const id of [randomUUID(), 'not-a-uuid'])
        expect(await problem(lifecycle().block(admin, id, IP)), id).toEqual({ status: 404, code: 'not_found' });
    });

    it('заблокированный с открытым сеансом: следующий запрос — нет сеанса; verifyOtp не ok, trustDevice — null, callback — /login?error=no_account; сеанс, созданный после блокировки, не выдаётся', async () => {
      const target = await account();
      // Сеанс A прошёл код и ждёт доверия устройства; сеанс B ждёт ввода кода.
      const a = await openSession(target.id);
      const codeA = await sessions.issueOtp(a.id, target.id);
      expect(codeA.issued).toBe(true);
      expect(await sessions.verifyOtp(a.id, target.id, (codeA as { code: string }).code)).toBe('ok');
      await pool.query('update user_accounts set last_otp_issued_at = null where id = $1', [target.id]);
      const b = await openSession(target.id);
      const codeB = await sessions.issueOtp(b.id, target.id);
      expect(codeB.issued).toBe(true);

      await lifecycle().block(admin, target.id, IP);

      // Следующий запрос открытой вкладки — без сеанса.
      expect(await sessions.resolve(a.token)).toBeNull();
      expect(await sessions.resolve(b.token)).toBeNull();
      // Вход посреди кода и доверия устройства не завершается.
      expect(await sessions.verifyOtp(b.id, target.id, (codeB as { code: string }).code)).not.toBe('ok');
      expect(await sessions.trustDevice(target.id, a.id)).toBeNull();
      expect((await sessions.issueOtp(b.id, target.id)).issued).toBe(false);
      expect((await pool.query('select 1 from trusted_devices where user_id = $1', [target.id])).rowCount).toBe(0);
      // Новый вход отклоняется в callback.
      const denied = await callback(target);
      expect(denied).toEqual({ location: '/login?error=no_account', token: undefined });
      // Сеанс, созданный после блокировки, не выдаётся.
      const late = await problem(openSession(target.id));
      expect(late).toEqual({ status: 401, code: 'session_expired' });
      expect(await sessionCount(target.id)).toBe(0);

      // Вход «в полёте»: аккаунт прочитан и отмечен входом, блокировка — до создания сеанса.
      const inFlight = await account();
      const racing = racingSessions(() => lifecycle().block(admin, inFlight.id, IP));
      const raced = await callback(inFlight, racing);
      expect(raced.token).toBeUndefined();
      expect(raced.location).toMatch(/^\/login\?error=/);
      expect((await row(inFlight.id)).state).toBe('blocked');
      expect(await sessionCount(inFlight.id)).toBe(0);

      // Смена роли «в полёте»: сеанс создаётся, но с новой ролью — прежней роли у него нет.
      const expert = await account({ role: 'expert' });
      const before = await openSession(expert.id);
      const roleRace = racingSessions(() => lifecycle().changeRole(admin, expert.id, 'director', IP));
      const signedIn = await callback(expert, roleRace);
      expect(signedIn.token).toEqual(expect.any(String));
      expect(await sessions.resolve(before.token)).toBeNull();
      expect((await sessions.resolve(signedIn.token))!.user.role).toBe('director');
      expect(await sessionCount(expert.id)).toBe(1);
    });

    it('разблокировка: invited, если не входил; active после входа; inactive_since очищен; прежние сеансы не возвращаются; identity-sync без logout', async () => {
      const signedIn = await account();
      const open = await openSession(signedIn.id);
      await lifecycle().block(admin, signedIn.id, IP);
      await pool.query(`update user_accounts set inactive_since = $2 where id = $1`, [signedIn.id, SIGNED_IN_AT]);
      expect((await lifecycle().unblock(admin, signedIn.id, IP)).account).toMatchObject({
        state: 'active',
        lastSignInAt: SIGNED_IN_AT.toISOString(),
      });
      expect(await row(signedIn.id)).toMatchObject({ state: 'active', inactiveSince: null });
      expect(await sessions.resolve(open.token)).toBeNull();
      expect(await syncJobs(signedIn.id)).toEqual([
        { accountId: signedIn.id, logout: true },
        { accountId: signedIn.id, logout: false },
      ]);
      expect(await audits('account.unblocked', signedIn.id)).toEqual([
        { diff: { to: 'active' }, is_account_event: true, ip: IP, user_id: admin.id, object_type: 'account' },
      ]);

      const never = await account({ state: 'invited' });
      await lifecycle().block(admin, never.id, IP);
      expect((await lifecycle().unblock(admin, never.id, IP)).account.state).toBe('invited');
      expect((await audits('account.unblocked', never.id))[0]!.diff).toEqual({ to: 'invited' });

      // Не заблокированный — 200 без изменений, без записи и задания.
      expect((await lifecycle().unblock(admin, never.id, IP)).account.state).toBe('invited');
      expect(await audits('account.unblocked', never.id)).toHaveLength(1);
      expect(await syncJobs(never.id)).toHaveLength(2);
      expect(await problem(lifecycle().unblock(admin, randomUUID(), IP))).toEqual({ status: 404, code: 'not_found' });
    });

    it('смена роли: роль и auth_version, сеансы завершены (AUTH-06); оператор, наблюдатель, производитель — 409 role_fixed; роль вне IMBC — 400 role_not_allowed; та же роль — без записи аудита', async () => {
      const expert = await account({ role: 'expert' });
      const open = await openSession(expert.id);
      const result = await lifecycle().changeRole(admin, expert.id, 'director', IP);
      expect(result.account).toMatchObject({ id: expert.id, role: 'director', state: 'active' });
      expect(await row(expert.id)).toMatchObject({ role: 'director', authVersion: expert.authVersion + 1 });
      expect(await sessions.resolve(open.token)).toBeNull();
      expect(await sessionCount(expert.id)).toBe(0);
      expect(await audits('account.role_changed', expert.id)).toEqual([
        {
          diff: { from: 'expert', to: 'director' },
          is_account_event: true,
          ip: IP,
          user_id: admin.id,
          object_type: 'account',
        },
      ]);
      // Роль живёт в БД: Keycloak не вызывается, задания нет.
      expect(keycloak.updateUser).not.toHaveBeenCalled();
      expect(await syncJobs(expert.id)).toEqual([]);

      // Та же роль — 200 без записи аудита и без нового auth_version.
      expect((await lifecycle().changeRole(admin, expert.id, 'director', IP)).account.role).toBe('director');
      expect(await audits('account.role_changed', expert.id)).toHaveLength(1);
      expect((await row(expert.id)).authVersion).toBe(expert.authVersion + 1);
      // Администратором — тоже роль IMBC.
      expect((await lifecycle().changeRole(admin, expert.id, 'administrator', IP)).account.role).toBe('administrator');

      for (const role of ['operator', 'observer', 'manufacturer'] as const) {
        const fixed = await account({ role });
        expect(await problem(lifecycle().changeRole(admin, fixed.id, 'expert', IP)), role).toEqual({
          status: 409,
          code: 'role_fixed',
        });
        expect((await row(fixed.id)).role).toBe(role);
      }
      for (const role of ['operator', 'observer', 'manufacturer'] as const)
        expect(await problem(lifecycle().changeRole(admin, expert.id, role, IP)), role).toEqual({
          status: 400,
          code: 'role_not_allowed',
        });
      expect((await row(expert.id)).role).toBe('administrator');
      expect(await problem(lifecycle().changeRole(admin, randomUUID(), 'expert', IP))).toEqual({
        status: 404,
        code: 'not_found',
      });
    });

    it('себя заблокировать и сменить себе роль — 409 self_action', async () => {
      const self = await administrator();
      const before = await row(self.id);
      expect(await problem(lifecycle().block(self, self.id, IP))).toEqual({ status: 409, code: 'self_action' });
      expect(await problem(lifecycle().changeRole(self, self.id, 'expert', IP))).toEqual({
        status: 409,
        code: 'self_action',
      });
      expect(await row(self.id)).toMatchObject({
        state: 'active',
        role: 'administrator',
        authVersion: before.authVersion,
      });
      expect(await audits('account.blocked', self.id)).toEqual([]);
      expect(await audits('account.role_changed', self.id)).toEqual([]);
    });

    it('два администратора одновременно: блокировка и смена роли одного аккаунта — обе применены, auth_version +2, две записи аудита; блокировка дважды параллельно — одна запись; взаимное понижение двух администраторов — ровно одно применено, второе 403 forbidden', async () => {
      const first = await administrator();
      const second = await administrator();

      // Блокировка и смена роли одного аккаунта: обе ждут строку и применяются по очереди.
      const target = await account({ role: 'expert' });
      await openSession(target.id);
      const both = await whileHeld(target.id, () => [
        lifecycle().block(first, target.id, IP),
        lifecycle().changeRole(second, target.id, 'director', IP),
      ]);
      expect(both.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await row(target.id)).toMatchObject({
        state: 'blocked',
        role: 'director',
        authVersion: target.authVersion + 2,
      });
      expect(await sessionCount(target.id)).toBe(0);
      expect((await audits('account.blocked', target.id)).map((a) => [a.user_id, a.diff])).toEqual([
        [first.id, { from: 'active' }],
      ]);
      expect((await audits('account.role_changed', target.id)).map((a) => [a.user_id, a.diff])).toEqual([
        [second.id, { from: 'expert', to: 'director' }],
      ]);

      // Одна и та же блокировка дважды: одна запись, одно задание, auth_version +1.
      const twice = await account();
      const blocked = await whileHeld(twice.id, () => [
        lifecycle().block(first, twice.id, IP),
        lifecycle().block(second, twice.id, IP),
      ]);
      expect(blocked.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      for (const r of blocked)
        expect((r as PromiseFulfilledResult<{ account: { state: string } }>).value.account.state).toBe('blocked');
      expect(await row(twice.id)).toMatchObject({ state: 'blocked', authVersion: twice.authVersion + 1 });
      expect(await audits('account.blocked', twice.id)).toHaveLength(1);
      expect(await syncJobs(twice.id)).toEqual([{ accountId: twice.id, logout: true }]);

      // Взаимное понижение: оба ждут меньшую из двух строк; второй перечитывает себя уже экспертом — 403.
      const held = first.id < second.id ? first.id : second.id;
      const mutual = await whileHeld(held, () => [
        lifecycle().changeRole(first, second.id, 'expert', IP),
        lifecycle().changeRole(second, first.id, 'expert', IP),
      ]);
      expect(mutual.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = mutual.find((r) => r.status === 'rejected')!;
      expect(rejection(lost)).toEqual({ status: 403, code: 'forbidden' });
      const loser = lost === mutual[0] ? first : second;
      const winner = loser === first ? second : first;
      expect(await row(winner.id)).toMatchObject({ role: 'administrator' });
      expect(await row(loser.id)).toMatchObject({ role: 'expert' });
      expect(await audits('account.role_changed', loser.id)).toHaveLength(1);
      expect(await audits('account.role_changed', winner.id)).toEqual([]);
      const denied = await pool.query<{ object_id: string; outcome: string }>(
        `select object_id, outcome from audit_entries where user_id = $1 and action = 'accounts.manage'`,
        [loser.id],
      );
      expect(denied.rows).toEqual([{ object_id: ADMIN_ROUTES.role, outcome: 'denied' }]);
    });

    it('смена почты производителя: updateUser(subject, { email, emailVerified: true }), user_accounts.email, сеансы и доверенные устройства удалены, аудит from/to; invited — задание send-password-email на субъект (ADM-05, MAN-05)', async () => {
      const active = await account();
      const open = await openSession(active.id);
      const device = randomUUID();
      await db.insert(schema.trustedDevices).values({
        userId: active.id,
        deviceHash: sha256(device),
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      const email = `${randomUUID()}@new-login.local`;
      const result = await lifecycle().changeEmail(admin, active.id, email.toUpperCase(), IP);
      expect(result.account).toMatchObject({ id: active.id, email, state: 'active', role: 'manufacturer' });
      expect(keycloak.updateUser).toHaveBeenCalledExactlyOnceWith(active.idpSubject, { email, emailVerified: true });
      expect(await row(active.id)).toMatchObject({ email, authVersion: active.authVersion + 1 });
      expect(await sessions.resolve(open.token)).toBeNull();
      expect(await sessionCount(active.id)).toBe(0);
      expect(await sessions.isTrustedDevice(active.id, device)).toBe(false);
      expect(await audits('account.email_changed', active.id)).toEqual([
        {
          diff: { from: active.email, to: email },
          is_account_event: true,
          ip: IP,
          user_id: admin.id,
          object_type: 'account',
        },
      ]);
      expect(await syncJobs(active.id)).toEqual([{ accountId: active.id, logout: true }]);
      expect(await passwordJobs(active.idpSubject!)).toBe(0);
      // Следующий вход — по новому адресу и с кодом на него (NOT-02): устройство больше не доверенное.
      expect((await callback({ ...active, email })).location).toMatch(/^\/auth\/verify\?/);
      expect((await callback(active)).location).toBe('/login?error=no_account');

      // Тот же адрес — 200 без Keycloak и без записи аудита.
      keycloak.updateUser.mockClear();
      expect((await lifecycle().changeEmail(admin, active.id, email, IP)).account.email).toBe(email);
      expect(keycloak.updateUser).not.toHaveBeenCalled();
      expect(await audits('account.email_changed', active.id)).toHaveLength(1);

      // Приглашённый (пароль не задан): письмо установки пароля уходит на новый адрес (NOT-01).
      const invited = await account({ state: 'invited' });
      const fixed = `${randomUUID()}@new-login.local`;
      expect((await lifecycle().changeEmail(admin, invited.id, fixed, IP)).account).toMatchObject({
        email: fixed,
        state: 'invited',
      });
      expect(await passwordJobs(invited.idpSubject!)).toBe(1);
      expect(await syncJobs(invited.id)).toEqual([{ accountId: invited.id, logout: true }]);
    });

    it('почта занята в БД — 409 без вызова Keycloak; занята в Keycloak — 409, БД без изменений; сбой БД после Keycloak — updateUser с прежним адресом', async () => {
      const target = await account();
      const other = await account();
      expect(await problem(lifecycle().changeEmail(admin, target.id, other.email.toUpperCase(), IP))).toEqual({
        status: 409,
        code: 'email_exists',
      });
      expect(keycloak.updateUser).not.toHaveBeenCalled();

      // Адрес занят только в Keycloak.
      keycloak.updateUser.mockRejectedValueOnce(new KeycloakRequestError(409, 'update user'));
      const takenInKeycloak = `${randomUUID()}@new-login.local`;
      expect(await problem(lifecycle().changeEmail(admin, target.id, takenInKeycloak, IP))).toEqual({
        status: 409,
        code: 'email_exists',
      });
      expect(keycloak.updateUser).toHaveBeenCalledOnce();
      expect((await row(target.id)).email).toBe(target.email);

      // Сбой БД после Keycloak (очередь в транзакции отказала): Keycloak возвращается к прежнему адресу.
      keycloak.updateUser.mockClear();
      const failing = { send: vi.fn().mockRejectedValue(new Error('queue unavailable')) } as unknown as PgBoss;
      const lost = `${randomUUID()}@new-login.local`;
      await expect(
        lifecycle(keycloak, new AuditService(db), failing).changeEmail(admin, target.id, lost, IP),
      ).rejects.toThrow('queue unavailable');
      expect(keycloak.updateUser.mock.calls).toEqual([
        [target.idpSubject, { email: lost, emailVerified: true }],
        [target.idpSubject, { email: target.email }],
      ]);
      expect(await row(target.id)).toMatchObject({ email: target.email, authVersion: target.authVersion });

      // Адрес занят в БД между проверкой и транзакцией (23505): 409 и тот же возврат Keycloak.
      keycloak.updateUser.mockClear();
      const raced = `${randomUUID()}@new-login.local`;
      keycloak.updateUser.mockImplementationOnce(async () => {
        await account().then((a) => pool.query('update user_accounts set email = $2 where id = $1', [a.id, raced]));
      });
      expect(await problem(lifecycle().changeEmail(admin, target.id, raced, IP))).toEqual({
        status: 409,
        code: 'email_exists',
      });
      expect(keycloak.updateUser.mock.calls.at(-1)).toEqual([target.idpSubject, { email: target.email }]);

      // Возврат Keycloak тоже не удался: задание identity-sync приведёт Keycloak к строке БД.
      keycloak.updateUser.mockReset();
      const again = `${randomUUID()}@new-login.local`;
      keycloak.updateUser
        .mockImplementationOnce(async () => {
          await account().then((a) => pool.query('update user_accounts set email = $2 where id = $1', [a.id, again]));
        })
        .mockRejectedValueOnce(new KeycloakRequestError(503, 'update user'));
      expect(await problem(lifecycle().changeEmail(admin, target.id, again, IP))).toEqual({
        status: 409,
        code: 'email_exists',
      });
      expect(await syncJobs(target.id)).toEqual([{ accountId: target.id, logout: true }]);

      // Keycloak недоступен: 503, БД без изменений; исход записи в Keycloak неизвестен — задание вернёт его к БД.
      keycloak.updateUser.mockReset().mockRejectedValueOnce(new KeycloakRequestError(503, 'update user'));
      expect(await problem(lifecycle().changeEmail(admin, target.id, `${randomUUID()}@new-login.local`, IP))).toEqual({
        status: 503,
        code: 'identity_unavailable',
      });
      expect(await syncJobs(target.id)).toEqual([
        { accountId: target.id, logout: true },
        { accountId: target.id, logout: false },
      ]);
      expect(await row(target.id)).toMatchObject({ email: target.email, authVersion: target.authVersion });
      expect(await audits('account.email_changed', target.id)).toEqual([]);
    });

    it('не производитель — 409 not_manufacturer_account; без субъекта — 409 identity_not_bound', async () => {
      for (const role of ['expert', 'operator', 'observer', 'administrator'] as const) {
        const target = await account({ role });
        expect(await problem(lifecycle().changeEmail(admin, target.id, `${randomUUID()}@x.local`, IP)), role).toEqual({
          status: 409,
          code: 'not_manufacturer_account',
        });
      }
      const unbound = await account({ subject: null });
      expect(await problem(lifecycle().changeEmail(admin, unbound.id, `${randomUUID()}@x.local`, IP))).toEqual({
        status: 409,
        code: 'identity_not_bound',
      });
      expect(await problem(lifecycle().changeEmail(admin, randomUUID(), `${randomUUID()}@x.local`, IP))).toEqual({
        status: 404,
        code: 'not_found',
      });
      expect(keycloak.updateUser).not.toHaveBeenCalled();
      // Блокировка и роль у аккаунта без субъекта работают (план, расхождение 20).
      expect((await lifecycle().block(admin, unbound.id, IP)).account.state).toBe('blocked');
    });

    it('identity-sync: enabled = state ≠ blocked, email из БД, logout по флагу; без субъекта — ни одного вызова; повтор задания даёт тот же вызов', async () => {
      const handlers = new JobHandlers(
        db,
        {} as never,
        {} as never,
        env,
        new AuditService(db),
        keycloak as unknown as KeycloakAdminService,
        sessions,
        {} as never,
      );
      const blocked = await account({ state: 'blocked' });
      await handlers.syncIdentity({ accountId: blocked.id, logout: true });
      await handlers.syncIdentity({ accountId: blocked.id, logout: true });
      expect(keycloak.updateUser.mock.calls).toEqual([
        [blocked.idpSubject, { enabled: false, email: blocked.email }],
        [blocked.idpSubject, { enabled: false, email: blocked.email }],
      ]);
      expect(keycloak.logoutUser.mock.calls).toEqual([[blocked.idpSubject], [blocked.idpSubject]]);

      keycloak.updateUser.mockClear();
      keycloak.logoutUser.mockClear();
      const active = await account();
      await handlers.syncIdentity({ accountId: active.id, logout: false });
      expect(keycloak.updateUser).toHaveBeenCalledExactlyOnceWith(active.idpSubject, {
        enabled: true,
        email: active.email,
      });
      expect(keycloak.logoutUser).not.toHaveBeenCalled();

      keycloak.updateUser.mockClear();
      const unbound = await account({ subject: null, state: 'blocked' });
      await handlers.syncIdentity({ accountId: unbound.id, logout: true });
      await handlers.syncIdentity({ accountId: randomUUID(), logout: true });
      expect(keycloak.updateUser).not.toHaveBeenCalled();
      expect(keycloak.logoutUser).not.toHaveBeenCalled();

      // Сбой Keycloak — ошибка задания (pg-boss повторит), решение в БД не меняется.
      keycloak.updateUser.mockRejectedValueOnce(new KeycloakRequestError(503, 'update user'));
      await expect(handlers.syncIdentity({ accountId: blocked.id, logout: true })).rejects.toBeInstanceOf(
        KeycloakRequestError,
      );
      expect((await row(blocked.id)).state).toBe('blocked');
    });

    it('исполнитель уже не active administrator — 403 и запись denied; сбой записи отказа — всё равно 403, в журнале только сводка (GEN-08, AUD-01)', async () => {
      const blocked = await administrator();
      await pool.query(`update user_accounts set state = 'blocked' where id = $1`, [blocked.id]);
      const target = await account();
      expect(await problem(lifecycle().block(blocked, target.id, IP))).toEqual({ status: 403, code: 'forbidden' });
      expect(await problem(lifecycle().changeEmail(blocked, target.id, `${randomUUID()}@x.local`, IP))).toEqual({
        status: 403,
        code: 'forbidden',
      });
      // Почта уже записана в Keycloak до транзакции — возвращена компенсацией.
      expect(keycloak.updateUser.mock.calls.at(-1)).toEqual([target.idpSubject, { email: target.email }]);
      expect(await row(target.id)).toMatchObject({ state: 'active', email: target.email });
      const { rows } = await pool.query<{ object_id: string }>(
        `select object_id from audit_entries where user_id = $1 and action = 'accounts.manage' and outcome = 'denied'
          order by at, id`,
        [blocked.id],
      );
      expect(rows.map((r) => r.object_id)).toEqual([ADMIN_ROUTES.block, ADMIN_ROUTES.email]);

      // Запись отказа не удалась: человек получает исходный 403, не 500; в журнал — сводка без данных.
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const failure = Object.assign(new Error(`insert failed for ${blocked.email} from ${IP}`), {
        code: '53300',
        severity: 'FATAL',
      });
      const audit = { record: vi.fn().mockRejectedValue(failure) } as unknown as AuditService;
      expect(await problem(lifecycle(keycloak, audit).unblock(blocked, target.id, IP))).toEqual({
        status: 403,
        code: 'forbidden',
      });
      expect(audit.record).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledOnce();
      expect(error.mock.calls[0]![1]).toBe('Denied action audit failed');
      const logged = JSON.stringify(error.mock.calls);
      expect(logged).toContain('53300');
      expect(logged).not.toContain(blocked.email);
      expect(logged).not.toContain(IP);
    });
  },
);

describe('граница MAN-05 и журнал очереди', () => {
  it('граница MAN-05: смена почты — только `PUT /api/v1/admin/accounts/:id/email`', () => {
    const mutating = new Set([RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE]);
    const controllers = Reflect.getMetadata('controllers', AppModule) as (new (...args: never[]) => object)[];
    const routes: string[] = [];
    for (const controller of controllers) {
      const base = Reflect.getMetadata('path', controller) as string;
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = (controller.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;
        const path = Reflect.getMetadata('path', handler) as string | undefined;
        const method = Reflect.getMetadata('method', handler) as RequestMethod | undefined;
        if (path === undefined || method === undefined || !mutating.has(method)) continue;
        const full = ['/api', base, path]
          .map((p) => p.replace(/^\/+|\/+$/g, ''))
          .filter(Boolean)
          .join('/');
        routes.push(`${RequestMethod[method]} /${full}`);
      }
    }
    expect(routes.length).toBeGreaterThan(5);
    expect(routes.filter((route) => /email/i.test(route))).toEqual(['PUT /api/v1/admin/accounts/:id/email']);

    // Колонку user_accounts.email после регистрации пишет только этот сервис.
    const src = fileURLToPath(new URL('../src', import.meta.url));
    const writers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (
          /\.ts$/.test(entry.name) &&
          /\.update\(userAccounts\)\s*\.set\(\{[^}]*\bemail\b/.test(readFileSync(path, 'utf8'))
        )
          writers.push(path.slice(src.length + 1));
      }
    };
    walk(src);
    expect(writers).toEqual(['modules/admin/account-lifecycle.service.ts']);
  });

  it('ошибка pg-boss: ошибка базы — сводка с фиксированным текстом, без текста запроса; другая — как есть', () => {
    const logger = { error: vi.fn() };
    const database = Object.assign(new Error('duplicate key value: (a@person.local)'), {
      code: '23505',
      severity: 'ERROR',
      constraint: 'job_pkey',
      detail: 'Key (email)=(a@person.local) already exists.',
    });
    logQueueError(logger, database);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sqlState: '23505', constraint: 'job_pkey' }),
      'Queue database error',
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('person.local');

    logger.error.mockClear();
    const other = new Error('connection terminated');
    logQueueError(logger, other);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(other);
  });
});
