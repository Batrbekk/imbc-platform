import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { AccountState, OrganizationType, Role } from '@imbc/contracts';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, describe, expect, it, type Mock, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Env } from '../src/config/env.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { type AccountJob, QUEUES } from '../src/jobs/queues.js';
import { AccountLifecycleService } from '../src/modules/admin/account-lifecycle.service.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { sign } from '../src/modules/auth/crypto.js';
import type { KeycloakAdminService } from '../src/modules/auth/keycloak-admin.service.js';
import { postLoginPath } from '../src/modules/auth/post-login.js';
import { AuthRateLimitService } from '../src/modules/auth/rate-limit.service.js';
import { SessionService } from '../src/modules/auth/session.service.js';
import { AccountInactivityJob } from '../src/worker/account-inactivity.job.js';
import { JobHandlers } from '../src/worker/handlers.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

// Одноразовая БД imbc_auth_test, настоящий pg-boss и SessionService; Keycloak — объект с vi.fn; почта — только *.local.
// «Сейчас» задания — фиксированные даты: run(now) получает его параметром (DATA-08).
const databaseUrl = process.env.TEST_DATABASE_URL;

/** 00:00 по Алматы (UTC+5) — это 19:00 UTC предыдущего дня. */
const almatyMidnight = (day: string) => new Date(new Date(`${day}T00:00:00+05:00`).getTime());
const secondBefore = (at: Date) => new Date(at.getTime() - 1000);

type Account = typeof schema.userAccounts.$inferSelect;
type Keycloak = Pick<KeycloakAdminService, 'updateUser' | 'logoutUser' | 'sendPasswordEmail' | 'passwordUpdatedAt'>;

const ORGANIZATION_OF: Record<Role, OrganizationType> = {
  manufacturer: 'manufacturer',
  expert: 'imbc',
  administrator: 'imbc',
  director: 'imbc',
  operator: 'operator',
  observer: 'observer',
};

describe.skipIf(!databaseUrl)(
  'неактивность: три месяца без входа по Алматы и возврат новым паролем (AUTH-07, NOT-26, DATA-08)',
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
    let imbcId: string;

    const job = (audit = new AuditService(db)) => new AccountInactivityJob(pool, boss, audit);

    const keycloakMock = (passwordUpdatedAt: Keycloak['passwordUpdatedAt'] = async () => null) => ({
      updateUser: vi.fn<Keycloak['updateUser']>().mockResolvedValue(undefined),
      logoutUser: vi.fn<Keycloak['logoutUser']>().mockResolvedValue(undefined),
      sendPasswordEmail: vi.fn<Keycloak['sendPasswordEmail']>().mockResolvedValue(undefined),
      passwordUpdatedAt: vi.fn<Keycloak['passwordUpdatedAt']>(passwordUpdatedAt),
    });

    const worker = (
      keycloak: Partial<Record<keyof Keycloak | 'securityEvents', Mock>> = keycloakMock(),
      service: SessionService = sessions,
    ) =>
      new JobHandlers(
        db,
        {} as never,
        env,
        new AuditService(db),
        keycloak as never,
        service,
        { onPasswordSet: vi.fn().mockResolvedValue({ profile: 'skipped', adata: 'skipped' }) } as never,
        { dispatch: vi.fn() } as never,
      );

    const row = async (id: string) =>
      (await db.query.userAccounts.findFirst({ where: eq(schema.userAccounts.id, id) }))!;

    const sessionCount = async (userId: string) =>
      (await pool.query('select 1 from sessions where user_id = $1', [userId])).rowCount;

    const audits = async (action: string, objectId: string) =>
      (
        await pool.query<{ diff: unknown; is_account_event: boolean; object_type: string; user_id: string | null }>(
          `select diff, is_account_event, object_type, user_id from audit_entries
            where action = $1 and object_id = $2 order by at, id`,
          [action, objectId],
        )
      ).rows;

    const resetJobs = async (accountId: string) =>
      (
        await pool.query<{ data: AccountJob; singleton_key: string | null }>(
          `select data, singleton_key from pgboss_auth_test.job where name = $1 and data->>'accountId' = $2`,
          [QUEUES.inactivityReset, accountId],
        )
      ).rows;

    /** Аккаунт роли `role` в организации её типа (IMBC — единственная), по умолчанию active. */
    async function account(
      opts: {
        role?: Role;
        state?: AccountState;
        subject?: string | null;
        lastSignInAt?: Date | null;
        createdAt?: Date;
        credentialsChangedAt?: Date;
      } = {},
    ): Promise<Account> {
      const role = opts.role ?? 'operator';
      const type = ORGANIZATION_OF[role];
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
          email: `${id}@inactivity.local`,
          fullName: 'Тестовый Аккаунт',
          role,
          state: opts.state ?? 'active',
          idpSubject: opts.subject === undefined ? randomUUID() : opts.subject,
          lastSignInAt: opts.lastSignInAt ?? null,
          ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
          ...(opts.credentialsChangedAt ? { credentialsChangedAt: opts.credentialsChangedAt } : {}),
        })
        .returning();
      return created!;
    }

    /** Открытый сеанс BFF через настоящий SessionService (как после callback). */
    const openSession = (userId: string) =>
      sessions.create({
        userId,
        authVersion: 0,
        idToken: null,
        idpSessionId: randomUUID(),
        idpAuthTime: new Date(),
        ip: null,
        userAgent: 'test',
      });

    /** OIDC callback с заглушкой обмена кода: адрес 302 и cookie сеанса. */
    async function callback(
      target: Pick<Account, 'email'> & { subject: string },
      keycloak: ReturnType<typeof keycloakMock>,
    ) {
      const oidc = {
        exchange: vi.fn(async () => ({
          subject: target.subject,
          email: target.email,
          emailVerified: true,
          sessionId: randomUUID(),
          authTime: new Date(),
          idToken: null,
        })),
      };
      const controller = new AuthController(
        oidc as never,
        sessions,
        new AuditService(db),
        {} as never,
        new AuthRateLimitService(db),
        env,
        { onPasswordSet: vi.fn(async () => undefined) } as never,
        keycloak as unknown as KeycloakAdminService,
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

    /** Один вход на `signedInAt`: накануне первого дня по Алматы — active, с 00:00 первого дня — inactive. */
    async function expectBoundary(
      signedInAt: Date,
      firstInactiveDay: string,
      extra: { credentialsChangedAt?: Date } = {},
    ) {
      const target = await account({ lastSignInAt: signedInAt, ...extra });
      const boundary = almatyMidnight(firstInactiveDay);
      await job().run(secondBefore(boundary));
      expect((await row(target.id)).state).toBe('active');
      await job().run(boundary);
      expect(await row(target.id)).toMatchObject({ state: 'inactive', inactiveSince: boundary });
      // Следующий случай считает свои аккаунты: этот больше не кандидат.
      await pool.query(`update user_accounts set state = 'blocked' where id = $1`, [target.id]);
    }

    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool);
      db = drizzle(pool, { schema, casing: 'snake_case' });
      boss = new PgBoss({
        connectionString: databaseUrl,
        schema: 'pgboss_auth_test',
        supervise: false,
        schedule: false,
      });
      await boss.start();
      await boss.createQueue(QUEUES.inactivityReset, { retryLimit: 10, retryDelay: 0 });
      await boss.createQueue(QUEUES.identitySync, { retryLimit: 5, retryDelay: 0 });
      sessions = new SessionService(db, env);
      imbcId = (await db.query.organizations.findFirst({ where: eq(schema.organizations.type, 'imbc') }))!.id;
    }, 60000);

    afterEach(async () => {
      // Каждый тест видит только свои аккаунты: задание обходит всю таблицу.
      await pool.query(`update user_accounts set state = 'blocked' where state <> 'blocked'`);
      await boss.deleteAllJobs(QUEUES.inactivityReset);
      vi.restoreAllMocks();
    });

    afterAll(async () => {
      await boss?.stop();
      await pool?.end();
    });

    it('граница трёх месяцев по Алматы (AUTH-07, DATA-08)', async () => {
      // 10:00 12.11.2026 по Алматы.
      const target = await account({ lastSignInAt: new Date('2026-11-12T05:00:00Z') });
      expect(await job().run(new Date('2027-02-11T18:59:59Z'))).toEqual({ deactivated: 0 });
      expect((await row(target.id)).state).toBe('active');
      // 00:00 12.02.2027 по Алматы.
      expect(await job().run(new Date('2027-02-11T19:00:00Z'))).toEqual({ deactivated: 1 });
      expect((await row(target.id)).state).toBe('inactive');
    });

    it('день по Алматы, а не по UTC: вход 2026-11-11T20:00:00Z (12.11 по Алматы) — inactive только с 2027-02-12', async () => {
      const target = await account({ lastSignInAt: new Date('2026-11-11T20:00:00Z') });
      // По UTC вход был 11.11 и 11.02.2027 уже был бы третьим месяцем.
      await job().run(new Date('2027-02-11T12:00:00Z'));
      await job().run(new Date('2027-02-11T18:59:59Z'));
      expect((await row(target.id)).state).toBe('active');
      await job().run(new Date('2027-02-11T19:00:00Z'));
      expect((await row(target.id)).state).toBe('inactive');
    });

    it('конец месяца: вход 30.11.2026 — inactive с 28.02.2027; 31.05.2027 — с 31.08.2027; 31.08.2026 — с 30.11.2026', async () => {
      // Полдень по Алматы; run — в 00:00 первого дня и за секунду до (NOT-31: последний день месяца).
      await expectBoundary(new Date('2026-11-30T07:00:00Z'), '2027-02-28');
      await expectBoundary(new Date('2027-05-31T07:00:00Z'), '2027-08-31');
      await expectBoundary(new Date('2026-08-31T07:00:00Z'), '2026-11-30');
    });

    it('високосный февраль: вход 29.11.2027 и 30.11.2027 — inactive с 29.02.2028; 29.02.2028 — с 29.05.2028', async () => {
      await expectBoundary(new Date('2027-11-29T07:00:00Z'), '2028-02-29');
      await expectBoundary(new Date('2027-11-30T07:00:00Z'), '2028-02-29');
      await expectBoundary(new Date('2028-02-29T07:00:00Z'), '2028-05-29');
    });

    it('отсчёт — от более поздней даты из входа и смены пароля: пароль сменён 15.09.2026 без входа после — inactive с 15.12.2026 (AUTH-07)', async () => {
      // Вход 01.08.2026, пароль — 12:00 15.09.2026 по Алматы; входа после смены пароля нет.
      await expectBoundary(new Date('2026-08-01T07:00:00Z'), '2026-12-15', {
        credentialsChangedAt: new Date('2026-09-15T07:00:00Z'),
      });
      // Смена пароля раньше входа отсчёт не сдвигает.
      await expectBoundary(new Date('2026-09-15T07:00:00Z'), '2026-12-15', {
        credentialsChangedAt: new Date('2026-08-01T07:00:00Z'),
      });
    });

    it('active без входа — от created_at; invited и blocked не меняются', async () => {
      const createdAt = new Date('2026-08-01T07:00:00Z');
      const neverSignedIn = await account({ createdAt });
      const invited = await account({ state: 'invited', createdAt });
      const blocked = await account({ state: 'blocked', createdAt, lastSignInAt: createdAt });
      const boundary = almatyMidnight('2026-11-01');

      await job().run(secondBefore(boundary));
      expect((await row(neverSignedIn.id)).state).toBe('active');
      expect(await job().run(boundary)).toEqual({ deactivated: 1 });
      expect((await row(neverSignedIn.id)).state).toBe('inactive');
      await job().run(almatyMidnight('2027-06-01'));
      expect(await row(invited.id)).toMatchObject({ state: 'invited', inactiveSince: null });
      expect(await row(blocked.id)).toMatchObject({ state: 'blocked', inactiveSince: null });
      expect(await resetJobs(invited.id)).toHaveLength(0);
      expect(await resetJobs(blocked.id)).toHaveLength(0);
    });

    it('переход: inactive, inactive_since = now, auth_version +1, сеансы удалены, аудит, одно задание inactivity-reset; второй run — ничего нового (NOT-26)', async () => {
      const target = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const first = await openSession(target.id);
      await openSession(target.id);
      expect(await sessions.resolve(first.token)).not.toBeNull();
      const now = almatyMidnight('2026-11-01');

      expect(await job().run(now)).toEqual({ deactivated: 1 });
      expect(await row(target.id)).toMatchObject({
        state: 'inactive',
        inactiveSince: now,
        authVersion: target.authVersion + 1,
        lastSignInAt: new Date('2026-08-01T07:00:00Z'),
      });
      expect(await sessionCount(target.id)).toBe(0);
      expect(await sessions.resolve(first.token)).toBeNull();
      expect(await audits('account.became_inactive', target.id)).toEqual([
        { diff: { from: 'active' }, is_account_event: true, object_type: 'account', user_id: target.id },
      ]);
      expect(await resetJobs(target.id)).toEqual([{ data: { accountId: target.id }, singleton_key: target.id }]);

      // Тот же день и пропущенный день: аккаунт уже не active — ни записи, ни письма.
      expect(await job().run(now)).toEqual({ deactivated: 0 });
      expect(await job().run(almatyMidnight('2026-11-03'))).toEqual({ deactivated: 0 });
      expect(await row(target.id)).toMatchObject({ inactiveSince: now, authVersion: target.authVersion + 1 });
      expect(await audits('account.became_inactive', target.id)).toHaveLength(1);
      expect(await resetJobs(target.id)).toHaveLength(1);
    });

    it('статус актуальности и дата квартала профиля не меняются (NOT-26, NOT-31)', async () => {
      const target = await account({ role: 'manufacturer', lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      await db.insert(schema.manufacturerProfiles).values({
        organizationId: target.organizationId,
        status: 'verified',
        updateStatus: 'active',
        quarterAnchorAt: '2026-08-01',
        verifiedAt: new Date('2026-08-01T07:00:00Z'),
      });
      const profile = () =>
        pool.query('select * from manufacturer_profiles where organization_id = $1', [target.organizationId]);
      const before = (await profile()).rows;

      await job().run(almatyMidnight('2026-11-01'));
      expect((await row(target.id)).state).toBe('inactive');
      expect((await profile()).rows).toEqual(before);
    });

    it('вход до трёх месяцев — ни перехода, ни задания', async () => {
      const target = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      await job().run(secondBefore(almatyMidnight('2026-11-01')));
      expect(await row(target.id)).toMatchObject({ state: 'active', inactiveSince: null });
      expect(await audits('account.became_inactive', target.id)).toHaveLength(0);
      expect(await resetJobs(target.id)).toHaveLength(0);
    });

    it('вход и run одновременно — нет состояния inactive с живым сеансом', async () => {
      // Вход ставит last_sign_in_at = сейчас; с ним аккаунт к границе 01.11.2026 уже не кандидат.
      const targets = await Promise.all(
        Array.from({ length: 8 }, () => account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') })),
      );
      const signIn = async (target: Account) => {
        const current = await sessions.markSignedIn(target.id, target.idpSubject!);
        if (!current) return null;
        return openSession(target.id).catch(() => null);
      };
      const [opened] = await Promise.all([Promise.all(targets.map(signIn)), job().run(almatyMidnight('2026-11-01'))]);

      for (const [i, target] of targets.entries()) {
        const after = await row(target.id);
        const count = await sessionCount(target.id);
        if (after.state === 'inactive') expect(count).toBe(0);
        else {
          expect(after.state).toBe('active');
          expect(count).toBe(1);
          expect(await sessions.resolve(opened[i]!.token)).not.toBeNull();
        }
      }
    });

    it('вход в последний момент выигрывает: run выбрал аккаунт, но ждёт строку, которую держит вход', async () => {
      const target = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const client = await pool.connect();
      try {
        // Незафиксированный вход (как markSignedIn): выборка кандидатов его не видит, блокировка строки — ждёт.
        await client.query('begin');
        await client.query('update user_accounts set last_sign_in_at = now() where id = $1', [target.id]);
        const running = job().run(almatyMidnight('2026-11-01'));
        for (let i = 0; ; i++) {
          const { rows } = await client.query<{ n: string }>(
            'select count(*) as n from pg_locks where not granted and pid <> pg_backend_pid()',
          );
          if (Number(rows[0]!.n) > 0) break;
          if (i > 75) throw new Error('run не встал в ожидание блокировки');
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await client.query('commit');
        expect(await running).toEqual({ deactivated: 0 });
      } finally {
        client.release();
      }
      expect(await row(target.id)).toMatchObject({ state: 'active', inactiveSince: null });
      expect(await resetJobs(target.id)).toHaveLength(0);
    });

    it('сбой одного аккаунта не останавливает прогон: остальные переведены, задание сообщает об ошибке', async () => {
      const failing = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const other = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const audit = new AuditService(db);
      const record = audit.record.bind(audit);
      audit.record = async (event, tx) => {
        if (event.objectId === failing.id) throw new Error('audit unavailable');
        return record(event, tx);
      };

      await expect(job(audit).run(almatyMidnight('2026-11-01'))).rejects.toThrow('account-inactivity: 1');
      expect(await row(failing.id)).toMatchObject({ state: 'active', inactiveSince: null });
      expect(await resetJobs(failing.id)).toHaveLength(0);
      expect((await row(other.id)).state).toBe('inactive');
      // Повтор задания (pg-boss) переводит оставшийся аккаунт.
      expect(await job().run(almatyMidnight('2026-11-01'))).toEqual({ deactivated: 1 });
      expect((await row(failing.id)).state).toBe('inactive');
    });

    it("inactivity-reset: logoutUser и sendPasswordEmail(subject, ['UPDATE_PASSWORD']), обязательного действия у пользователя нет; аккаунт уже active или без субъекта — ни одного вызова", async () => {
      const target = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const unbound = await account({ subject: null, lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      expect(await job().run(almatyMidnight('2026-11-01'))).toEqual({ deactivated: 2 });
      expect((await row(unbound.id)).state).toBe('inactive');

      const keycloak = keycloakMock();
      const [queued] = await resetJobs(target.id);
      await worker(keycloak).sendInactivityReset(queued!.data);
      // Вход со старым паролем не должен вести к новому паролю мимо ящика: действие — только в ссылке (AUTH-07).
      expect(keycloak.updateUser).not.toHaveBeenCalled();
      expect(keycloak.logoutUser).toHaveBeenCalledExactlyOnceWith(target.idpSubject);
      expect(keycloak.sendPasswordEmail).toHaveBeenCalledExactlyOnceWith(target.idpSubject, ['UPDATE_PASSWORD']);

      const idle = keycloakMock();
      const [unboundJob] = await resetJobs(unbound.id);
      await worker(idle).sendInactivityReset(unboundJob!.data);
      await pool.query(`update user_accounts set state = 'active', inactive_since = null where id = $1`, [target.id]);
      await worker(idle).sendInactivityReset({ accountId: target.id });
      await worker(idle).sendInactivityReset({ accountId: randomUUID() });
      expect(idle.updateUser).not.toHaveBeenCalled();
      expect(idle.logoutUser).not.toHaveBeenCalled();
      expect(idle.sendPasswordEmail).not.toHaveBeenCalled();
    });

    it('возврат по событию пароля после inactive_since — active, аудит account.reactivated { via: password_event }; событие раньше inactive_since — остаётся inactive', async () => {
      const returning = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const stale = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const now = almatyMidnight('2026-11-01');
      await job().run(now);

      const event = (userId: string, at: Date) => ({
        id: randomUUID(),
        type: 'UPDATE_PASSWORD',
        userId,
        time: at.getTime(),
      });
      const events = [
        event(returning.idpSubject!, new Date(now.getTime() + 6 * 3600_000)),
        event(stale.idpSubject!, new Date(now.getTime() - 3600_000)),
      ];
      const handlers = worker({ securityEvents: vi.fn(async () => events) });
      await handlers.keycloakEvents();

      expect(await row(returning.id)).toMatchObject({ state: 'active', inactiveSince: null });
      expect(await audits('account.reactivated', returning.id)).toEqual([
        { diff: { via: 'password_event' }, is_account_event: true, object_type: 'account', user_id: returning.id },
      ]);
      expect(await row(stale.id)).toMatchObject({ state: 'inactive', inactiveSince: now });
      expect(await audits('account.reactivated', stale.id)).toHaveLength(0);
      // Смена пароля по-прежнему завершает сеансы и снимает доверие устройств — у обоих.
      expect(await audits('auth.credentials_changed', stale.id)).toHaveLength(1);

      // Повтор события (окно опроса) и вход после него — без второй записи.
      await handlers.keycloakEvents();
      expect(await sessions.reactivateAfterReset(returning.id, new Date(now.getTime() + 7 * 3600_000), 'sign_in')).toBe(
        true,
      );
      expect(await audits('account.reactivated', returning.id)).toHaveLength(1);
    });

    it('возврат по событию пароля держится: на следующую ночь аккаунт остаётся active и второго письма нет (AUTH-07)', async () => {
      const target = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const day = almatyMidnight('2026-11-01');
      expect(await job().run(day)).toEqual({ deactivated: 1 });
      // Вечером человек задаёт пароль по ссылке и закрывает вкладку — входа нет.
      const evening = new Date('2026-11-01T15:00:00Z');
      await worker({
        securityEvents: vi.fn(async () => [
          { id: randomUUID(), type: 'UPDATE_PASSWORD', userId: target.idpSubject, time: evening.getTime() },
        ]),
      }).keycloakEvents();
      expect(await row(target.id)).toMatchObject({ state: 'active', credentialsChangedAt: evening });

      expect(await job().run(almatyMidnight('2026-11-02'))).toEqual({ deactivated: 0 });
      expect(await row(target.id)).toMatchObject({ state: 'active', inactiveSince: null });
      expect(await resetJobs(target.id)).toHaveLength(1);
      expect(await audits('account.became_inactive', target.id)).toHaveLength(1);
      // Новый отсчёт — от дня пароля: 01.02.2027.
      await job().run(secondBefore(almatyMidnight('2027-02-01')));
      expect((await row(target.id)).state).toBe('active');
      await job().run(almatyMidnight('2027-02-01'));
      expect((await row(target.id)).state).toBe('inactive');
    });

    it('blocked с inactive_since: задание не трогает, событие пароля не возвращает, после разблокировки — inactive и возврат по общему правилу (ADM-02, AUTH-07)', async () => {
      const target = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const day = almatyMidnight('2026-11-01');
      await job().run(day);
      // Исполнитель входил недавно для запусков этого теста: задание его не трогает.
      const administrator = await account({ role: 'administrator', lastSignInAt: new Date('2027-05-31T07:00:00Z') });
      const actor: AuthUser = {
        id: administrator.id,
        email: administrator.email,
        fullName: administrator.fullName,
        role: 'administrator',
        organizationId: administrator.organizationId,
        organizationType: 'imbc',
        locale: administrator.locale,
      };
      const lifecycle = new AccountLifecycleService(
        pool,
        boss,
        { updateUser: vi.fn(), logoutUser: vi.fn() } as never,
        new AuditService(db),
      );
      await lifecycle.block(actor, target.id);
      expect(await row(target.id)).toMatchObject({ state: 'blocked', inactiveSince: day });

      // Пароль по ссылке, пока аккаунт заблокирован: сеансы отзываются, но blocked не снимается.
      const reset = new Date('2026-11-01T15:00:00Z');
      await sessions.revokeForPasswordChange(target.idpSubject!, reset, `password:${randomUUID()}`);
      await job().run(almatyMidnight('2027-06-01'));
      expect(await row(target.id)).toMatchObject({ state: 'blocked', inactiveSince: day });
      expect(await audits('account.reactivated', target.id)).toHaveLength(0);
      expect(await resetJobs(target.id)).toHaveLength(1);

      await lifecycle.unblock(actor, target.id);
      expect(await row(target.id)).toMatchObject({ state: 'inactive', inactiveSince: day });
      await job().run(almatyMidnight('2027-06-01'));
      expect(await resetJobs(target.id)).toHaveLength(1);
      // Пароль, заданный после inactive_since, возвращает входом.
      expect(await sessions.reactivateAfterReset(target.id, reset, 'sign_in')).toBe(true);
      expect(await row(target.id)).toMatchObject({ state: 'active', inactiveSince: null });
    });

    it('часы Keycloak чуть позади: пароль за секунды до inactive_since возвращает, за две минуты — нет', async () => {
      const close = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const early = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const now = almatyMidnight('2026-11-01');
      await job().run(now);

      expect(await sessions.reactivateAfterReset(close.id, new Date(now.getTime() - 5000), 'password_event')).toBe(
        true,
      );
      expect((await row(close.id)).state).toBe('active');
      expect(await sessions.reactivateAfterReset(early.id, new Date(now.getTime() - 120_000), 'password_event')).toBe(
        false,
      );
      expect((await row(early.id)).state).toBe('inactive');
    });

    it('вход неактивного: пароль обновлён после inactive_since — вход проходит, аккаунт active; не обновлён или Keycloak недоступен — /login?error=account_inactive', async () => {
      // Вход «сейчас» (реальное время): inactive_since — прошлое, 02.11.2026 по Алматы.
      const now = almatyMidnight('2026-11-02');
      const reset = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const notReset = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const noPassword = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const unavailable = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const logoutFails = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      // Аккаунт без субъекта (на практике не встречается: markSignedIn привязывает): Keycloak спрашивается
      // о субъекте из токена.
      const unbound = await account({ subject: null, lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      expect(await job().run(now)).toEqual({ deactivated: 6 });

      const signIn = async (
        target: Account,
        passwordUpdatedAt: Keycloak['passwordUpdatedAt'],
        subject?: string,
        keycloak = keycloakMock(passwordUpdatedAt),
      ) => {
        const result = await callback({ email: target.email, subject: subject ?? target.idpSubject! }, keycloak);
        expect(keycloak.passwordUpdatedAt).toHaveBeenCalledExactlyOnceWith(subject ?? target.idpSubject);
        return { ...result, keycloak };
      };
      const after = new Date(now.getTime() + 3600_000);
      const verify = `/auth/verify?returnTo=${encodeURIComponent(postLoginPath('operator', '/profile'))}`;

      const ok = await signIn(reset, async () => after);
      expect(ok.location).toBe(verify);
      expect(ok.keycloak.logoutUser).not.toHaveBeenCalled();
      expect(ok.token).toBeDefined();
      expect(await sessions.resolve(ok.token)).not.toBeNull();
      expect(await row(reset.id)).toMatchObject({ state: 'active', inactiveSince: null });
      expect(await audits('account.reactivated', reset.id)).toEqual([
        { diff: { via: 'sign_in' }, is_account_event: true, object_type: 'account', user_id: reset.id },
      ]);
      // Событие того же пароля приходит позже: сеанс входа остаётся, второй записи нет.
      await sessions.revokeForPasswordChange(reset.idpSubject!, after, `password:${randomUUID()}`);
      expect(await sessions.resolve(ok.token)).not.toBeNull();
      expect(await audits('account.reactivated', reset.id)).toHaveLength(1);

      const failingLogout = keycloakMock(async () => new Date('2026-10-01T07:00:00Z'));
      failingLogout.logoutUser.mockRejectedValue(new Error('Keycloak logout user: 503'));
      for (const [target, passwordUpdatedAt, keycloak] of [
        [notReset, async () => new Date('2026-10-01T07:00:00Z'), undefined],
        [noPassword, async () => null, undefined],
        [unavailable, async () => Promise.reject(new Error('Keycloak credentials: 503')), undefined],
        // Сбой выхода из IdP ответа не меняет.
        [logoutFails, failingLogout.passwordUpdatedAt, failingLogout],
      ] as const) {
        const refused = await signIn(target, passwordUpdatedAt, undefined, keycloak);
        expect({ location: refused.location, token: refused.token }).toEqual({
          location: '/login?error=account_inactive',
          token: undefined,
        });
        // SSO-сеанс отклонённого входа завершается: не мешает «Забыли пароль» и ссылке сброса.
        expect(refused.keycloak.logoutUser).toHaveBeenCalledExactlyOnceWith(target.idpSubject);
        expect(await row(target.id)).toMatchObject({ state: 'inactive', inactiveSince: now });
        expect(await sessionCount(target.id)).toBe(0);
        expect(await audits('account.reactivated', target.id)).toHaveLength(0);
      }

      const subject = randomUUID();
      const bound = await signIn(unbound, async () => after, subject);
      expect(bound.location).toBe(verify);
      expect(await row(unbound.id)).toMatchObject({ state: 'active', idpSubject: subject, inactiveSince: null });
    });

    it('отказ неактивному не ждёт выхода из IdP: ответ — пока logoutUser не завершён; сбой logoutUser — строка в журнале без данных, без необработанного отклонения (AUTH-07)', async () => {
      const now = almatyMidnight('2026-11-02');
      const hanging = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const failing = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      const throwing = await account({ lastSignInAt: new Date('2026-08-01T07:00:00Z') });
      expect(await job().run(now)).toEqual({ deactivated: 3 });
      const stalePassword = async () => new Date('2026-10-01T07:00:00Z');
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        // Keycloak завис: logoutUser не отвечает. Ответ приходит всё равно (прежний код ждал бы ~30 с).
        const stuck = keycloakMock(stalePassword);
        let finishLogout!: () => void;
        stuck.logoutUser.mockReturnValue(new Promise<void>((resolve) => (finishLogout = resolve)));
        const answer = await Promise.race([
          callback({ email: hanging.email, subject: hanging.idpSubject! }, stuck),
          new Promise<'ждёт logoutUser'>((resolve) => setTimeout(() => resolve('ждёт logoutUser'), 2000)),
        ]);
        expect(answer).toEqual({ location: '/login?error=account_inactive', token: undefined });
        expect(stuck.logoutUser).toHaveBeenCalledExactlyOnceWith(hanging.idpSubject);
        expect(await row(hanging.id)).toMatchObject({ state: 'inactive', inactiveSince: now });
        expect(await sessionCount(hanging.id)).toBe(0);
        finishLogout();

        // Keycloak отвечает ошибкой, в тексте которой адрес с субъектом: отказ прежний, в журнале — фиксированная строка.
        const broken = keycloakMock(stalePassword);
        const secret = `https://keycloak.invalid/admin/realms/imbc/users/${failing.idpSubject}/logout`;
        broken.logoutUser.mockRejectedValue(new Error(`Keycloak logout user: ${secret} 503`));
        const refused = await callback({ email: failing.email, subject: failing.idpSubject! }, broken);
        expect(refused).toEqual({ location: '/login?error=account_inactive', token: undefined });

        // Исключение уже при вызове (а не отклонённый промис) отказ тоже не меняет.
        const thrown = keycloakMock(stalePassword);
        thrown.logoutUser.mockImplementation(() => {
          throw new Error(`Keycloak logout user: ${secret}`);
        });
        const refusedAgain = await callback({ email: throwing.email, subject: throwing.idpSubject! }, thrown);
        expect(refusedAgain).toEqual({ location: '/login?error=account_inactive', token: undefined });

        // Даём отклонённому промису шанс стать необработанным, прежде чем смотреть журнал.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(unhandled).toEqual([]);
        const line = 'inactive account: IdP logout after refused sign-in failed';
        expect(warn.mock.calls).toEqual([[line], [line]]);
        for (const personal of [
          failing.idpSubject!,
          failing.email,
          throwing.idpSubject!,
          throwing.email,
          'keycloak.invalid',
        ])
          expect(JSON.stringify(warn.mock.calls)).not.toContain(personal);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  },
);
