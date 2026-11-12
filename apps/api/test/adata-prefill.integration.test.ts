import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeBinCheckDigit, roleHome, type ProfileStatus, type Role } from '@imbc/contracts';
import { AuditService } from '../src/common/audit.service.js';
import type { Env } from '../src/config/env.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { ADATA_QUEUE_OPTIONS, QUEUES, type AdataPrefillJob as AdataPrefillJobData } from '../src/jobs/queues.js';
import { AdataClient, type AdataTiming } from '../src/modules/adata/adata.client.js';
import { AdataScheduler } from '../src/modules/adata/adata.scheduler.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { sign } from '../src/modules/auth/crypto.js';
import { IdentityProvisioningService } from '../src/modules/auth/identity-provisioning.service.js';
import { AuthRateLimitService } from '../src/modules/auth/rate-limit.service.js';
import { SessionService } from '../src/modules/auth/session.service.js';
import { ProfilesService } from '../src/modules/profiles/profiles.service.js';
import { ManufacturerOnboardingService } from '../src/modules/registration/onboarding.service.js';
import { RegistrationController } from '../src/modules/registration/registration.controller.js';
import { AdataPrefillJob } from '../src/worker/adata-prefill.job.js';
import { JobHandlers } from '../src/worker/handlers.service.js';
import { ADATA_FIXTURE, startAdataStub, type AdataScenario, type AdataStub } from './support/adata-stub.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

// Только одноразовая БД imbc_auth_test и заглушка Adata на 127.0.0.1: api.adata.kz тесты не вызывают никогда.
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('чтение Adata при установке пароля (IMBC-07, MAN-03, NOT-23)', () => {
  vi.setConfig({ testTimeout: 30000 });
  const TOKEN = `tok-${randomUUID()}`;
  // Тесты срока опроса — с коротким сроком; тесты, ждущие ответа, — с запасом: под нагрузкой несколько
  // проверок по loopback с паузой 100 мс могут не уложиться в 300 мс.
  const DEADLINE_TIMING: AdataTiming = {
    firstPollDelayMs: 0,
    pollIntervalMs: 10,
    deadlineMs: 300,
    requestTimeoutMs: 200,
  };
  const TIMING: AdataTiming = { ...DEADLINE_TIMING, deadlineMs: 10_000 };
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
  let stub: AdataStub;
  let audit: AuditService;
  let sessions: SessionService;
  let rates: AuthRateLimitService;
  let scheduler: AdataScheduler;
  let onboarding: ManufacturerOnboardingService;

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema, casing: 'snake_case' });
    boss = new PgBoss({ connectionString: databaseUrl, schema: 'pgboss_auth_test', supervise: false, schedule: false });
    await boss.start();
    await boss.createQueue(QUEUES.adataPrefill, ADATA_QUEUE_OPTIONS);
    await boss.createQueue(QUEUES.sendPasswordEmail, { retryLimit: 10, retryDelay: 0 });
    await boss.createQueue(QUEUES.cleanupIdentity);
    stub = await startAdataStub({ token: TOKEN });
    audit = new AuditService(db);
    sessions = new SessionService(db, env);
    rates = new AuthRateLimitService(db);
    scheduler = new AdataScheduler(pool, boss, audit);
    onboarding = new ManufacturerOnboardingService(pool, new ProfilesService(db), scheduler, audit);
    // Регистрация принимает текущую версию NDA (MAN-01, FC-02).
    await db.insert(schema.ndaVersion).values({ versionNumber: 1, body: 'NDA (тест)', isCurrent: true });
  }, 60000);

  afterAll(async () => {
    expect(clientBaseUrls.length).toBeGreaterThan(0);
    for (const url of clientBaseUrls) expect(new URL(url).hostname.endsWith('adata.kz')).toBe(false);
    await stub?.close();
    await boss?.stop();
    await pool?.end();
  });

  beforeEach(async () => {
    await boss.deleteAllJobs(QUEUES.adataPrefill);
    await db.delete(schema.adataAllowance);
  });

  function validBin(): string {
    for (;;) {
      const first = String(Math.floor(Math.random() * 1e11)).padStart(11, '0');
      const digit = computeBinCheckDigit(first);
      if (digit !== null) return first + digit;
    }
  }

  /** Производитель с Draft-профилем, как после регистрации (MAN-03); пароль ещё не установлен. */
  async function manufacturer(opts: { status?: ProfileStatus; source?: 'manual' | 'migration'; role?: Role } = {}) {
    const role = opts.role ?? 'manufacturer';
    const bin = validBin();
    const [org] = await db
      .insert(schema.organizations)
      .values({ type: role === 'manufacturer' ? 'manufacturer' : 'operator', name: 'Adata test', bin })
      .returning();
    const [account] = await db
      .insert(schema.userAccounts)
      .values({
        organizationId: org!.id,
        email: `${randomUUID()}@example.invalid`,
        role,
        state: 'invited',
        idpSubject: randomUUID(),
      })
      .returning();
    const profileId = await new ProfilesService(db).ensureDraft(org!.id, account!.id);
    if (opts.status || opts.source)
      await db
        .update(schema.manufacturerProfiles)
        .set({ status: opts.status ?? 'draft', source: opts.source ?? 'manual' })
        .where(eq(schema.manufacturerProfiles.id, profileId));
    return { bin, account: account!, organizationId: org!.id, profileId };
  }

  /** Адреса, с которыми фабрика создавала клиент: ни один не ведёт к Adata (квота заказчика). */
  const clientBaseUrls: string[] = [];

  function prefillJob(over: Partial<Env> = {}, fetchImpl?: typeof fetch, timing: AdataTiming = TIMING) {
    return new AdataPrefillJob(
      db,
      { ADATA_API_TOKEN: TOKEN, ADATA_MONTHLY_LIMIT: 3000, ...over } as Env,
      audit,
      (token, timing) => {
        clientBaseUrls.push(stub.baseUrl);
        return new AdataClient({
          baseUrl: stub.baseUrl,
          token,
          requestTimeoutMs: timing.requestTimeoutMs,
          fetch: fetchImpl,
        });
      },
      timing,
    );
  }

  const startsFor = (bin: string) => stub.requests.filter((r) => r.kind === 'start' && r.bin === bin).length;
  const callsFor = (bin: string) => stub.requests.filter((r) => r.bin === bin).length;

  async function attemptsOf(profileId: string) {
    return db
      .select({ attempt: schema.externalCheckAttempt, latest: schema.externalCheck.latestAttemptId })
      .from(schema.externalCheckAttempt)
      .innerJoin(schema.externalCheck, eq(schema.externalCheck.id, schema.externalCheckAttempt.externalCheckId))
      .where(eq(schema.externalCheck.profileId, profileId));
  }

  async function attemptOf(profileId: string) {
    const rows = await attemptsOf(profileId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.latest).toBe(rows[0]!.attempt.id);
    return rows[0]!.attempt;
  }

  const queuedJobs = async () =>
    (
      await pool.query<{ data: AdataPrefillJobData }>(
        `select data from pgboss_auth_test.job where name = $1 and state = 'created'`,
        [QUEUES.adataPrefill],
      )
    ).rows.map((r) => r.data);

  /** Задание проходит через pg-boss, как в worker: fetch → run → complete (или fail с ошибкой). */
  async function throughQueue(job: AdataPrefillJob) {
    const jobs = await boss.fetch<AdataPrefillJobData>(QUEUES.adataPrefill, { batchSize: 50 });
    for (const j of jobs) {
      try {
        await job.run(j.data);
        await boss.complete(QUEUES.adataPrefill, j.id);
      } catch (error) {
        await boss.fail(QUEUES.adataPrefill, j.id, error as object);
        throw error;
      }
    }
    return jobs;
  }

  async function schedule(profile: Awaited<ReturnType<typeof manufacturer>>, scenario?: AdataScenario) {
    if (scenario) stub.scenario(profile.bin, scenario);
    expect(await scheduler.requestOnProfileCreated(profile.account.id, 'password_set')).toBe('scheduled');
    return (await attemptOf(profile.profileId)).id;
  }

  function registration(subject = randomUUID()) {
    const keycloak = { createUser: vi.fn(async () => subject), deleteUser: vi.fn(), sendPasswordEmail: vi.fn() };
    return new RegistrationController(
      db,
      boss,
      new IdentityProvisioningService(pool, boss, keycloak as never),
      new AuditService(db),
      rates,
    );
  }

  function passwordEvents(subject: string, service: Pick<ManufacturerOnboardingService, 'onPasswordSet'> = onboarding) {
    return new JobHandlers(
      db,
      {} as never,
      {} as never,
      env,
      audit,
      {
        securityEvents: async () => [
          {
            id: `event-${subject}`,
            type: 'UPDATE_CREDENTIAL',
            userId: subject,
            time: Date.now() - 2000,
            details: { credential_type: 'password' },
          },
        ],
      } as never,
      sessions,
      service as ManufacturerOnboardingService,
    );
  }

  /** OIDC callback с заглушкой обмена кода; ответ — только 302. */
  async function signIn(
    account: typeof schema.userAccounts.$inferSelect,
    service: Pick<ManufacturerOnboardingService, 'onPasswordSet'> = onboarding,
  ) {
    const oidc = {
      exchange: vi.fn(async () => ({
        subject: account.idpSubject,
        email: account.email,
        emailVerified: true,
        sessionId: randomUUID(),
        authTime: new Date(),
        idToken: null,
      })),
    };
    const controller = new AuthController(
      oidc as never,
      sessions,
      audit,
      {} as never,
      rates,
      env,
      service as ManufacturerOnboardingService,
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
    expect(res.redirect).toHaveBeenCalledTimes(1);
    const [status, location] = res.redirect.mock.calls[0] as [number, string];
    expect(status).toBe(302);
    return location;
  }

  /** Весь вывод процесса на время fn: stdout, stderr и console. */
  async function captured<T>(fn: () => Promise<T>): Promise<{ value: T | undefined; error: unknown; output: string }> {
    const chunks: string[] = [];
    const text = (chunk: unknown) =>
      typeof chunk === 'string'
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk).toString('utf8')
          : String(chunk);
    const out = process.stdout.write;
    const err = process.stderr.write;
    const consoleMethods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
    const saved = consoleMethods.map((m) => console[m]);
    const sink = ((chunk: unknown) => {
      chunks.push(text(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stdout.write = sink;
    process.stderr.write = sink;
    for (const m of consoleMethods) console[m] = (...args: unknown[]) => void chunks.push(args.map(text).join(' '));
    let value: T | undefined;
    let error: unknown;
    try {
      value = await fn();
    } catch (e) {
      error = e;
    } finally {
      process.stdout.write = out;
      process.stderr.write = err;
      consoleMethods.forEach((m, i) => (console[m] = saved[i]!));
    }
    // Цвета ConsoleLogger Nest не мешают сравнению строк.
    return { value, error, output: chunks.join('').replace(/\u001b\[[0-9;]*m/g, '') };
  }

  async function dumpTables(): Promise<string[]> {
    const rows: string[] = [];
    for (const table of [
      'external_check',
      'external_check_attempt',
      'prefilled_value',
      'adata_allowance',
      'audit_entries',
      'pgboss_auth_test.job',
    ]) {
      const result = await pool.query<{ row: string }>(`select row_to_json(t)::text as row from ${table} t`);
      rows.push(...result.rows.map((r) => r.row));
    }
    return rows;
  }

  it('регистрация без установки пароля не ставит задание и не вызывает Adata (IMBC-07, MAN-03)', async () => {
    const bin = validBin();
    const email = `${randomUUID()}@example.invalid`;
    const body = {
      bin,
      companyName: 'Registered only',
      email,
      heardAboutUs: 'Выставка',
      acceptPlatformTerms: true,
      acceptPersonalData: true,
      ndaVersion: 1,
    };
    expect(await registration().register(body, { ip: '127.0.0.31' } as never)).toEqual({
      status: 'password_email_queued',
    });
    await registration().resend({ email }, { ip: '127.0.0.31' } as never);
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.bin, bin) });
    // Профиля нет, пока не задан пароль (MAN-03, NOT-23).
    expect(
      await db.query.manufacturerProfiles.findMany({ where: eq(schema.manufacturerProfiles.organizationId, org!.id) }),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.externalCheck).where(eq(schema.externalCheck.organizationId, org!.id)),
    ).toHaveLength(0);
    expect(await boss.fetch(QUEUES.adataPrefill, { batchSize: 50 })).toEqual([]);
    expect(callsFor(bin)).toBe(0);
    await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
  });

  it('событие установки пароля ставит одно чтение (NOT-23)', async () => {
    const m = await manufacturer();
    await passwordEvents(m.account.idpSubject!).keycloakEvents();
    const attempt = await attemptOf(m.profileId);
    expect(attempt).toMatchObject({ state: 'queued', trigger: 'profile_created', bin: m.bin, requestSentAt: null });
    expect(await queuedJobs()).toEqual([{ attemptId: attempt.id }]);
    // Окно опроса событий перекрывается на 5 минут: то же событие приходит снова.
    await passwordEvents(m.account.idpSubject!).keycloakEvents();
    expect(await scheduler.requestOnProfileCreated(m.account.id, 'password_set')).toBe('skipped');
    expect(await attemptsOf(m.profileId)).toHaveLength(1);
    expect(await queuedJobs()).toHaveLength(1);
    const requested = await db
      .select()
      .from(schema.auditEntries)
      .where(and(eq(schema.auditEntries.action, 'adata.read_requested'), eq(schema.auditEntries.objectId, attempt.id)));
    expect(requested).toHaveLength(1);
    expect(requested[0]!.diff).toEqual({ origin: 'password_set' });
    expect(callsFor(m.bin)).toBe(0);
  });

  it('сбой планировщика не ломает отзыв сеансов по событию пароля', async () => {
    const m = await manufacturer();
    await db.update(schema.userAccounts).set({ state: 'active' }).where(eq(schema.userAccounts.id, m.account.id));
    const failing = { onPasswordSet: vi.fn().mockRejectedValue(new Error(`boom ${TOKEN}`)) };
    const { error, output } = await captured(() => passwordEvents(m.account.idpSubject!, failing).keycloakEvents());
    expect(error).toBeUndefined();
    expect(failing.onPasswordSet).toHaveBeenCalledWith(m.account.id, 'password_set', expect.any(Date));
    expect(output).not.toContain(TOKEN);
    const account = await db.query.userAccounts.findFirst({ where: eq(schema.userAccounts.id, m.account.id) });
    expect(account?.authVersion).toBe(m.account.authVersion + 1);
  });

  it('чтение ставится после всех отзывов пакета событий и до уведомлений (NOT-23, NOT-03)', async () => {
    const [a, b] = [await manufacturer(), await manufacturer()];
    const order: string[] = [];
    const revoke = vi.spyOn(sessions, 'revokeForPasswordChange');
    revoke.mockImplementation(async (subject) => void order.push(`revoke:${subject}`));
    const adata = {
      onPasswordSet: vi.fn(async (accountId: string) => {
        order.push(`adata:${accountId}`);
        return { profile: 'existing', adata: 'skipped' } as const;
      }),
    };
    const now = Date.now();
    const worker = new JobHandlers(
      db,
      {} as never,
      { sendRaw: vi.fn(async () => void order.push('mail')) } as never,
      env,
      audit,
      {
        securityEvents: async () => [
          { id: `p1-${a.bin}`, type: 'UPDATE_PASSWORD', userId: a.account.idpSubject, time: now - 3000 },
          {
            id: `l-${a.bin}`,
            type: 'USER_DISABLED_BY_TEMPORARY_LOCKOUT',
            userId: a.account.idpSubject,
            time: now - 2500,
          },
          {
            id: `p2-${b.bin}`,
            type: 'UPDATE_CREDENTIAL',
            userId: b.account.idpSubject,
            time: now - 2000,
            details: { credential_type: 'password' },
          },
        ],
      } as never,
      sessions,
      adata as never,
    );
    try {
      await worker.keycloakEvents();
    } finally {
      revoke.mockRestore();
    }
    expect(order).toEqual([
      `revoke:${a.account.idpSubject}`,
      `revoke:${b.account.idpSubject}`,
      `adata:${a.account.id}`,
      `adata:${b.account.id}`,
      'mail',
    ]);
  });

  it('первый вход ставит чтение, если события ещё не было; вход оператора — нет; сбой планировщика не ломает вход', async () => {
    const m = await manufacturer();
    expect(await signIn(m.account)).toBe('/auth/verify?returnTo=%2Fprofile');
    const attempt = await attemptOf(m.profileId);
    expect(attempt.state).toBe('queued');
    expect(await queuedJobs()).toEqual([{ attemptId: attempt.id }]);
    const [requested] = await db
      .select()
      .from(schema.auditEntries)
      .where(and(eq(schema.auditEntries.action, 'adata.read_requested'), eq(schema.auditEntries.objectId, attempt.id)));
    expect(requested!.diff).toEqual({ origin: 'sign_in' });
    // Следующий вход и событие пароля после него ничего не добавляют.
    await signIn(m.account);
    await passwordEvents(m.account.idpSubject!).keycloakEvents();
    expect(await attemptsOf(m.profileId)).toHaveLength(1);
    expect(await queuedJobs()).toHaveLength(1);

    const operator = await manufacturer({ role: 'operator' });
    const spy = { onPasswordSet: vi.fn() };
    expect(await signIn(operator.account, spy)).toBe(
      `/auth/verify?returnTo=${encodeURIComponent(roleHome('operator'))}`,
    );
    expect(spy.onPasswordSet).not.toHaveBeenCalled();
    expect(await scheduler.requestOnProfileCreated(operator.account.id, 'sign_in')).toBe('skipped');
    expect(await attemptsOf(operator.profileId)).toHaveLength(0);

    const other = await manufacturer();
    const failing = { onPasswordSet: vi.fn().mockRejectedValue(new Error('scheduler down')) };
    const { value, output } = await captured(() => signIn(other.account, failing));
    expect(value).toBe('/auth/verify?returnTo=%2Fprofile');
    expect(failing.onPasswordSet).toHaveBeenCalledWith(other.account.id, 'sign_in', expect.any(Date));
    expect(output).not.toContain('scheduler down');
    expect(await db.query.sessions.findMany({ where: eq(schema.sessions.userId, other.account.id) })).toHaveLength(1);
  });

  /** Другое соединение держит строку профиля for update — как открытая транзакция psql на стенде. */
  async function holdProfile(profileId: string) {
    const client = await pool.connect();
    await client.query('begin');
    await client.query('select id from manufacturer_profiles where id = $1 for update', [profileId]);
    return async () => {
      await client.query('rollback');
      client.release();
    };
  }

  it('планировщик не держит вход: строка профиля занята — отказ быстрее 4 с, попытки нет', async () => {
    const m = await manufacturer();
    const release = await holdProfile(m.profileId);
    try {
      const started = Date.now();
      await expect(scheduler.requestOnProfileCreated(m.account.id, 'password_set')).rejects.toBeDefined();
      expect(Date.now() - started).toBeLessThan(4000);
      expect(await attemptsOf(m.profileId)).toHaveLength(0);

      // Вход с настоящим планировщиком проходит, пока строка занята: отказ планировщика — только warn.
      const signInStarted = Date.now();
      const { value, output } = await captured(() => signIn(m.account));
      expect(value).toBe('/auth/verify?returnTo=%2Fprofile');
      expect(Date.now() - signInStarted).toBeLessThan(4000);
      expect(output).toContain('adata: чтение при входе не поставлено');
      expect(await db.query.sessions.findMany({ where: eq(schema.sessions.userId, m.account.id) })).toHaveLength(1);
      expect(await attemptsOf(m.profileId)).toHaveLength(0);
    } finally {
      await release();
    }
    // Строка свободна — следующий вход ставит чтение как обычно.
    expect(await scheduler.requestOnProfileCreated(m.account.id, 'sign_in')).toBe('scheduled');
  });

  it('seed-профиль Verified и мигрированный профиль (source migration) не читаются', async () => {
    const seeded = await manufacturer({ status: 'verified' });
    const migrated = await manufacturer({ source: 'migration' });
    for (const m of [seeded, migrated]) {
      expect(await scheduler.requestOnProfileCreated(m.account.id, 'password_set')).toBe('skipped');
      await signIn(m.account);
      await passwordEvents(m.account.idpSubject!).keycloakEvents();
      expect(
        await db.select().from(schema.externalCheck).where(eq(schema.externalCheck.profileId, m.profileId)),
      ).toEqual([]);
    }
    expect(await queuedJobs()).toEqual([]);
  });

  it('полный путь: ready после двух wait → received, девять полей, value без токена, квота +1', async () => {
    const m = await manufacturer();
    const attemptId = await schedule(m, {
      kind: 'ready',
      afterPolls: 2,
      body: { ...ADATA_FIXTURE, data: { ...ADATA_FIXTURE.data, note: `echo ${TOKEN}` } },
    });
    const { output } = await captured(() => throughQueue(prefillJob()));
    const attempt = await attemptOf(m.profileId);
    expect(attempt).toMatchObject({
      id: attemptId,
      state: 'received',
      failure: null,
      source: 'adata.companyInfo',
      isTestData: false,
    });
    expect(attempt.requestSentAt).not.toBeNull();
    expect(attempt.completedAt).not.toBeNull();
    expect(attempt.pollToken).not.toBeNull();
    expect(JSON.stringify(attempt.value)).not.toContain(TOKEN);
    expect((attempt.value as { note: string }).note).toBe('echo [redacted]');
    expect((attempt.value as { basic: { biin: string } }).basic.biin).toBe('240100000011');
    expect(stub.requests.filter((r) => r.bin === m.bin).map((r) => r.kind)).toEqual([
      'start',
      'check',
      'check',
      'check',
    ]);
    const values = await db.select().from(schema.prefilledValue).where(eq(schema.prefilledValue.attemptId, attemptId));
    expect(new Set(values.map((v) => v.field)).size).toBe(9);
    expect(values.every((v) => v.source === 'adata' && v.readAt.getTime() === attempt.completedAt!.getTime())).toBe(
      true,
    );
    expect(values.every((v) => v.profileId === m.profileId && v.organizationId === m.organizationId)).toBe(true);
    const [allowance] = await db.select().from(schema.adataAllowance);
    expect(allowance?.used).toBe(1);
    expect(attempt.allowancePeriod).toBe(allowance?.periodStart);
    const [completed] = await db
      .select()
      .from(schema.auditEntries)
      .where(and(eq(schema.auditEntries.action, 'adata.read_completed'), eq(schema.auditEntries.objectId, attemptId)));
    expect(completed).toMatchObject({
      outcome: 'ok',
      objectType: 'external_check_attempt',
      diff: { state: 'received', fields: 9 },
    });
    expect(output).toContain(`adata attempt ${attemptId}: received`);
    expect(await db.select().from(schema.dueDiligenceRecords)).toEqual([]);
  });

  it('один Get Request на БИН: повтор, параллель, два входа, рестарт посреди опроса (IMBC-07)', async () => {
    // run дважды подряд
    const sequential = await manufacturer();
    const first = await schedule(sequential);
    await prefillJob().run({ attemptId: first });
    await prefillJob().run({ attemptId: first });
    expect((await attemptOf(sequential.profileId)).state).toBe('received');
    expect(startsFor(sequential.bin)).toBe(1);

    // run дважды параллельно — два исполнителя одного задания
    const parallel = await manufacturer();
    const second = await schedule(parallel, { kind: 'ready', afterPolls: 1 });
    await Promise.all([prefillJob().run({ attemptId: second }), prefillJob().run({ attemptId: second })]);
    expect((await attemptOf(parallel.profileId)).state).toBe('received');
    expect(startsFor(parallel.bin)).toBe(1);

    // событие пароля и вход одновременно
    await boss.deleteAllJobs(QUEUES.adataPrefill);
    const raced = await manufacturer();
    const results = await Promise.all([
      ...Array.from({ length: 4 }, () => scheduler.requestOnProfileCreated(raced.account.id, 'password_set')),
      ...Array.from({ length: 4 }, () => scheduler.requestOnProfileCreated(raced.account.id, 'sign_in')),
    ]);
    expect(results.filter((r) => r === 'scheduled')).toHaveLength(1);
    expect(results.filter((r) => r === 'skipped')).toHaveLength(7);
    const racedAttempt = await attemptOf(raced.profileId);
    expect(await queuedJobs()).toEqual([{ attemptId: racedAttempt.id }]);
    await throughQueue(prefillJob());
    expect(startsFor(raced.bin)).toBe(1);

    // рестарт посреди опроса: Get Request прошёл, токен проверки сохранён, процесс умер на первой проверке
    const restarted = await manufacturer();
    const third = await schedule(restarted, { kind: 'ready', afterPolls: 1 });
    const dies: typeof fetch = async (input, init) => {
      if (String(input).includes('/check/')) return new Promise<Response>(() => {});
      return fetch(input, init);
    };
    void prefillJob({}, dies).run({ attemptId: third });
    await vi.waitFor(async () => expect((await attemptOf(restarted.profileId)).pollToken).not.toBeNull(), {
      timeout: 5000,
      interval: 10,
    });
    expect((await attemptOf(restarted.profileId)).state).toBe('polling');
    await prefillJob().run({ attemptId: third });
    expect((await attemptOf(restarted.profileId)).state).toBe('received');
    expect(startsFor(restarted.bin)).toBe(1);

    // рестарт после срока опроса: одна проверка без второго Get Request
    const late = await manufacturer();
    const fourth = await schedule(late);
    void prefillJob({}, dies).run({ attemptId: fourth });
    await vi.waitFor(async () => expect((await attemptOf(late.profileId)).pollToken).not.toBeNull(), {
      timeout: 5000,
      interval: 10,
    });
    await db
      .update(schema.externalCheckAttempt)
      .set({ requestSentAt: sql`now() - interval '10 minutes'` })
      .where(eq(schema.externalCheckAttempt.id, fourth));
    const checksBefore = stub.requests.filter((r) => r.kind === 'check' && r.bin === late.bin).length;
    await prefillJob().run({ attemptId: fourth });
    expect((await attemptOf(late.profileId)).state).toBe('received');
    expect(stub.requests.filter((r) => r.kind === 'check' && r.bin === late.bin).length).toBe(checksBefore + 1);
    expect(startsFor(late.bin)).toBe(1);

    // процесс умер во время Get Request: токена проверки нет → interrupted, второго Get Request нет
    const interrupted = await manufacturer();
    const fifth = await schedule(interrupted);
    const hangs: typeof fetch = async (input, init) => {
      await fetch(input, init);
      return new Promise<Response>(() => {});
    };
    void prefillJob({}, hangs).run({ attemptId: fifth });
    await vi.waitFor(() => expect(startsFor(interrupted.bin)).toBe(1), { timeout: 5000, interval: 10 });
    // Пока Get Request может быть в пути, второй исполнитель попытку не трогает.
    await prefillJob().run({ attemptId: fifth });
    expect((await attemptOf(interrupted.profileId)).state).toBe('polling');
    await db
      .update(schema.externalCheckAttempt)
      .set({ requestSentAt: sql`now() - interval '10 minutes'` })
      .where(eq(schema.externalCheckAttempt.id, fifth));
    await prefillJob().run({ attemptId: fifth });
    expect(await attemptOf(interrupted.profileId)).toMatchObject({ state: 'unavailable', failure: 'interrupted' });
    expect(startsFor(interrupted.bin)).toBe(1);

    // вход после received
    await boss.deleteAllJobs(QUEUES.adataPrefill);
    expect(await scheduler.requestOnProfileCreated(sequential.account.id, 'sign_in')).toBe('skipped');
    await signIn(sequential.account);
    await passwordEvents(sequential.account.idpSubject!).keycloakEvents();
    expect(await queuedJobs()).toEqual([]);
    for (const m of [sequential, parallel, raced, restarted, late, interrupted]) expect(startsFor(m.bin)).toBe(1);
    const [allowance] = await db.select().from(schema.adataAllowance);
    expect(allowance?.used).toBe(6);
  });

  it('нет токена — not_configured, ни одного запроса к заглушке, регистрация и вход проходят (EXT-02)', async () => {
    const subject = randomUUID();
    const bin = validBin();
    const email = `${randomUUID()}@example.invalid`;
    await registration(subject).register(
      {
        bin,
        companyName: 'No token',
        email,
        heardAboutUs: 'Выставка',
        acceptPlatformTerms: true,
        acceptPersonalData: true,
        ndaVersion: 1,
      },
      { ip: '127.0.0.32' } as never,
    );
    await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
    const account = (await db.query.userAccounts.findFirst({ where: eq(schema.userAccounts.idpSubject, subject) }))!;
    // Профиль создаёт событие пароля (MAN-03).
    await passwordEvents(subject).keycloakEvents();
    const profile = (await db.query.manufacturerProfiles.findFirst({
      where: eq(schema.manufacturerProfiles.organizationId, account.organizationId),
    }))!;
    const { output } = await captured(() => throughQueue(prefillJob({ ADATA_API_TOKEN: undefined })));
    const attempt = await attemptOf(profile.id);
    expect(attempt).toMatchObject({ state: 'not_configured', requestSentAt: null, allowancePeriod: null });
    expect(attempt.completedAt).not.toBeNull();
    expect(output).toContain(`adata attempt ${attempt.id}: not_configured`);
    expect(callsFor(bin)).toBe(0);
    expect(await db.select().from(schema.adataAllowance)).toEqual([]);

    // Токен появился: следующий вход ставит ту же попытку снова.
    expect(await signIn(account)).toBe('/auth/verify?returnTo=%2Fprofile');
    expect(await attemptOf(profile.id)).toMatchObject({ id: attempt.id, state: 'queued', completedAt: null });
    expect(await queuedJobs()).toEqual([{ attemptId: attempt.id }]);
    await throughQueue(prefillJob());
    expect(await attemptOf(profile.id)).toMatchObject({ id: attempt.id, state: 'received' });
    expect(startsFor(bin)).toBe(1);
    expect(await scheduler.requestOnProfileCreated(account.id, 'sign_in')).toBe('skipped');
  });

  it('квота исчерпана — quota_exhausted без запроса; следующий вход после сброса ставит попытку снова', async () => {
    const m = await manufacturer();
    const attemptId = await schedule(m);
    await prefillJob({ ADATA_MONTHLY_LIMIT: 0 }).run({ attemptId });
    expect(await attemptOf(m.profileId)).toMatchObject({ state: 'quota_exhausted', requestSentAt: null });
    expect(callsFor(m.bin)).toBe(0);
    expect(await scheduler.requestOnProfileCreated(m.account.id, 'sign_in')).toBe('requeued');
    await throughQueue(prefillJob());
    expect((await attemptOf(m.profileId)).state).toBe('received');
    expect(startsFor(m.bin)).toBe(1);
  });

  it('десять параллельных заданий при лимите 3', async () => {
    const profiles = await Promise.all(Array.from({ length: 10 }, () => manufacturer()));
    const attempts: string[] = [];
    for (const m of profiles) attempts.push(await schedule(m));
    await Promise.all(attempts.map((attemptId) => prefillJob({ ADATA_MONTHLY_LIMIT: 3 }).run({ attemptId })));
    expect(profiles.reduce((n, m) => n + startsFor(m.bin), 0)).toBe(3);
    const states = await Promise.all(profiles.map(async (m) => (await attemptOf(m.profileId)).state));
    expect(states.filter((s) => s === 'received')).toHaveLength(3);
    expect(states.filter((s) => s === 'quota_exhausted')).toHaveLength(7);
    const [allowance] = await db.select().from(schema.adataAllowance);
    expect(allowance?.used).toBe(3);
  });

  it.each<[string, AdataScenario, string]>([
    ['wait до срока', { kind: 'wait_forever' }, 'timeout'],
    ['500 на Get Request', { kind: 'start_error', status: 500 }, 'http_5xx'],
    ['HTML вместо JSON', { kind: 'malformed' }, 'malformed'],
    ['обрыв соединения', { kind: 'hang_up' }, 'network'],
    ['молчание', { kind: 'silent' }, 'timeout'],
    ['403 модуль не подключён', { kind: 'start_error', status: 403 }, 'module_off'],
  ])('%s — unavailable с failure, run не бросает, находкой не помечено (EXT-04)', async (_name, scenario, failure) => {
    const m = await manufacturer();
    const attemptId = await schedule(m, scenario);
    const { error, output } = await captured(() => prefillJob({}, undefined, DEADLINE_TIMING).run({ attemptId }));
    expect(error).toBeUndefined();
    expect(await attemptOf(m.profileId)).toMatchObject({ state: 'unavailable', failure, value: null });
    expect(await db.select().from(schema.prefilledValue).where(eq(schema.prefilledValue.attemptId, attemptId))).toEqual(
      [],
    );
    expect(await db.select().from(schema.dueDiligenceRecords)).toEqual([]);
    const [entry] = await db
      .select()
      .from(schema.auditEntries)
      .where(and(eq(schema.auditEntries.action, 'adata.read_completed'), eq(schema.auditEntries.objectId, attemptId)));
    expect(entry).toMatchObject({ outcome: 'failed', diff: { state: 'unavailable', failure } });
    expect(output.trim()).toMatch(new RegExp(`adata attempt ${attemptId}: unavailable \\(${failure}\\)$`));
    expect(startsFor(m.bin)).toBe(1);
  });

  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it('ответ с NUL и одиночным суррогатом в значениях сохраняется: received, в value и prefilled_value их нет', async () => {
    const m = await manufacturer();
    const basic = {
      ...(ADATA_FIXTURE.data.basic as object),
      name_ru: 'x\u0000y',
      legal_address: 'Алматы \uD800',
    };
    const attemptId = await schedule(m, {
      kind: 'ready',
      afterPolls: 0,
      body: { ...ADATA_FIXTURE, data: { ...ADATA_FIXTURE.data, basic, unused: 'a\u0000b\uDC00' } },
    });
    const { error } = await captured(() => throughQueue(prefillJob()));
    expect(error).toBeUndefined();
    const attempt = await attemptOf(m.profileId);
    expect(attempt.state).toBe('received');
    const stored = JSON.stringify(attempt.value);
    expect(stored.includes('\u0000') || /\\u0000/.test(stored)).toBe(false);
    expect(LONE_SURROGATE.test(stored)).toBe(false);
    const values = await db.select().from(schema.prefilledValue).where(eq(schema.prefilledValue.attemptId, attemptId));
    expect(new Set(values.map((v) => v.field)).size).toBe(9);
    for (const v of values) {
      expect(v.value.includes('\u0000')).toBe(false);
      expect(LONE_SURROGATE.test(v.value)).toBe(false);
    }
    expect(startsFor(m.bin)).toBe(1);
  });

  it('БД отвергла запись ответа: класс 22 — unavailable (malformed) своей транзакцией; иной сбой своей БД — исключение и повтор', async () => {
    const m = await manufacturer();
    const attemptId = await schedule(m);
    expect(attemptId).toMatch(/^[0-9a-f-]{36}$/);
    // Подмена отказа БД: данные ответа после очистки PostgreSQL принимает, поэтому отказ вызывает триггер теста.
    const reject = (errcode: string) =>
      pool.query(`create or replace function adata_test_reject() returns trigger language plpgsql as $$
        begin
          if new.attempt_id = '${attemptId}' then raise exception 'test rejection' using errcode = '${errcode}'; end if;
          return new;
        end $$`);
    try {
      await reject('P0001');
      await pool.query(
        'create trigger adata_test_reject before insert on prefilled_value for each row execute function adata_test_reject()',
      );
      // Сбой своей БД, не связанный с данными: задание бросает без данных ответа, pg-boss повторит.
      const first = await captured(() => prefillJob().run({ attemptId }));
      expect(first.error).toBeInstanceOf(Error);
      expect((first.error as Error).message).toBe(`adata attempt ${attemptId}: database received failed (P0001)`);
      expect(await attemptOf(m.profileId)).toMatchObject({ state: 'polling', value: null });
      expect((await attemptOf(m.profileId)).pollToken).not.toBeNull();

      // Повтор задания: опрос по сохранённому токену, запись отвергнута как данные → конечное состояние.
      await reject('22023');
      const second = await captured(() => prefillJob().run({ attemptId }));
      expect(second.error).toBeUndefined();
      expect(await attemptOf(m.profileId)).toMatchObject({ state: 'unavailable', failure: 'malformed', value: null });
      expect(second.output).toContain(`adata attempt ${attemptId}: unavailable (malformed)`);
    } finally {
      await pool.query('drop trigger if exists adata_test_reject on prefilled_value');
      await pool.query('drop function if exists adata_test_reject()');
    }
    expect(await db.select().from(schema.prefilledValue).where(eq(schema.prefilledValue.attemptId, attemptId))).toEqual(
      [],
    );
    const [entry] = await db
      .select()
      .from(schema.auditEntries)
      .where(and(eq(schema.auditEntries.action, 'adata.read_completed'), eq(schema.auditEntries.objectId, attemptId)));
    expect(entry).toMatchObject({ outcome: 'failed', diff: { state: 'unavailable', failure: 'malformed' } });
    expect(startsFor(m.bin)).toBe(1);
    expect(await scheduler.requestOnProfileCreated(m.account.id, 'sign_in')).toBe('skipped');
  });

  it('ответ, который задание не может обработать (вложенность 6 000), — unavailable (malformed), без исключения', async () => {
    const m = await manufacturer();
    const attemptId = await schedule(m);
    const depth = 6000;
    const deep = `{"success":true,"message":"ready","data":{"basic":${'{"a":'.repeat(depth)}{}${'}'.repeat(depth)}}}`;
    // Заглушка не сериализует такой объект, поэтому тело готового ответа подменяется после настоящей проверки.
    const deepReady: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      if (!String(input).includes('/check/')) return res;
      await res.text();
      return new Response(deep, { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const { error, output } = await captured(() => throughQueue(prefillJob({}, deepReady)));
    expect(error).toBeUndefined();
    expect(await attemptOf(m.profileId)).toMatchObject({ state: 'unavailable', failure: 'malformed', value: null });
    expect(output).toContain(`adata attempt ${attemptId}: unavailable (malformed)`);
    expect(output).not.toContain('{"a":');
    expect(startsFor(m.bin)).toBe(1);
  });

  it('unknown_bin — received без полей', async () => {
    const m = await manufacturer();
    const attemptId = await schedule(m, { kind: 'unknown_bin' });
    await prefillJob().run({ attemptId });
    expect((await attemptOf(m.profileId)).state).toBe('received');
    expect(await db.select().from(schema.prefilledValue).where(eq(schema.prefilledValue.attemptId, attemptId))).toEqual(
      [],
    );
    const [entry] = await db
      .select()
      .from(schema.auditEntries)
      .where(and(eq(schema.auditEntries.action, 'adata.read_completed'), eq(schema.auditEntries.objectId, attemptId)));
    expect(entry?.diff).toEqual({ state: 'received', fields: 0 });
  });

  it('токен и адрес Adata не попадают в вывод процесса, ошибки, строки БД и задания pg-boss — и при сбоях HTTP-клиента (EXT-02, NFR-10)', async () => {
    const urlInCause: typeof fetch = async (input) => {
      throw new TypeError('fetch failed', { cause: new Error(`connect ECONNREFUSED ${String(input)}`) });
    };
    const cases: Array<{ scenario?: AdataScenario; fetch?: typeof fetch; token?: undefined; state: string }> = [
      { scenario: { kind: 'ready', afterPolls: 1 }, state: 'received' },
      {
        scenario: {
          kind: 'ready',
          afterPolls: 0,
          body: { ...ADATA_FIXTURE, data: { ...ADATA_FIXTURE.data, x: TOKEN } },
        },
        state: 'received',
      },
      { scenario: { kind: 'start_error', status: 500 }, state: 'unavailable' },
      { scenario: { kind: 'start_error', status: 403 }, state: 'unavailable' },
      { scenario: { kind: 'echo_url', on: 'start' }, state: 'unavailable' },
      { scenario: { kind: 'echo_url' }, state: 'unavailable' },
      { scenario: { kind: 'hang_up', on: 'start' }, state: 'unavailable' },
      { scenario: { kind: 'hang_up' }, state: 'unavailable' },
      { scenario: { kind: 'silent', on: 'start' }, state: 'unavailable' },
      { scenario: { kind: 'silent' }, state: 'unavailable' },
      { scenario: { kind: 'malformed', on: 'start' }, state: 'unavailable' },
      { scenario: { kind: 'malformed' }, state: 'unavailable' },
      { fetch: urlInCause, state: 'unavailable' },
    ];
    let output = '';
    const errors: unknown[] = [];
    for (const c of cases) {
      const m = await manufacturer();
      const attemptId = await schedule(m, c.scenario);
      // Сбои на проверке временные и идут до срока — им короткий срок; готовому ответу — с запасом.
      const timing = c.state === 'received' ? TIMING : DEADLINE_TIMING;
      const run = await captured(() => throughQueue(prefillJob({}, c.fetch, timing)));
      output += run.output;
      if (run.error !== undefined) errors.push(run.error);
      expect((await attemptOf(m.profileId)).state, JSON.stringify(c.scenario ?? 'fetch')).toBe(c.state);
      expect(run.output).toContain(`adata attempt ${attemptId}: ${c.state}`);
    }
    expect(errors).toEqual([]);

    const forbidden = [TOKEN, encodeURIComponent(TOKEN), '/api/company/info/', stub.baseUrl];
    const rows = await dumpTables();
    expect(rows.some((r) => r.includes('"name":"adata-prefill"'))).toBe(true);
    forbidden.forEach((needle, i) => {
      expect(rows.filter((r) => r.includes(needle)).length, `строки БД содержат запрещённую строку №${i}`).toBe(0);
      expect(output.includes(needle), `вывод содержит запрещённую строку №${i}`).toBe(false);
    });
    const basic = ADATA_FIXTURE.data.basic as { fullname_director: string; director_iin: string };
    const founders = (ADATA_FIXTURE.data.founders as { founders_dtl: { name: string }[] }).founders_dtl;
    for (const personal of [basic.fullname_director, basic.director_iin, ...founders.map((f) => f.name)])
      expect(output.includes(personal), 'персональные данные ответа в выводе').toBe(false);
  });
});
