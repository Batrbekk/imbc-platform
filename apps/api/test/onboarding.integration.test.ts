import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeBinCheckDigit, type RegistrationRequest } from '@imbc/contracts';
import { AuditService } from '../src/common/audit.service.js';
import { ProblemException } from '../src/common/problem.js';
import type { Env } from '../src/config/env.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { ADATA_QUEUE_OPTIONS, QUEUES } from '../src/jobs/queues.js';
import { AdataScheduler } from '../src/modules/adata/adata.scheduler.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { sign } from '../src/modules/auth/crypto.js';
import { IdentityProvisioningService } from '../src/modules/auth/identity-provisioning.service.js';
import { AuthRateLimitService } from '../src/modules/auth/rate-limit.service.js';
import { SessionService } from '../src/modules/auth/session.service.js';
import { ProfilesService } from '../src/modules/profiles/profiles.service.js';
import { ManufacturerOnboardingService, ndaAcceptanceInsert } from '../src/modules/registration/onboarding.service.js';
import { RegistrationController } from '../src/modules/registration/registration.controller.js';
import { JobHandlers } from '../src/worker/handlers.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

// Одноразовая БД imbc_auth_test; Keycloak — объект с vi.fn; Adata не вызывается (только постановка задания).
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('регистрация v1.3 и профиль при установке пароля (MAN-01, MAN-03, FC-02, NOT-23)', () => {
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
  let audit: AuditService;
  let sessions: SessionService;
  let rates: AuthRateLimitService;
  let profiles: ProfilesService;
  let scheduler: AdataScheduler;
  let onboarding: ManufacturerOnboardingService;
  let nda: { id: string; versionNumber: number };

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
    audit = new AuditService(db);
    sessions = new SessionService(db, env);
    rates = new AuthRateLimitService(db);
    profiles = new ProfilesService(db);
    scheduler = new AdataScheduler(pool, boss, audit);
    onboarding = new ManufacturerOnboardingService(pool, profiles, scheduler, audit);
    const [current] = await db
      .insert(schema.ndaVersion)
      .values({ versionNumber: 1, body: 'NDA версии 1 (тест)', isCurrent: true })
      .returning({ id: schema.ndaVersion.id, versionNumber: schema.ndaVersion.versionNumber });
    nda = current!;
  }, 60000);

  afterAll(async () => {
    await boss?.stop();
    await pool?.end();
  });

  beforeEach(async () => {
    await boss.deleteAllJobs(QUEUES.adataPrefill);
  });

  function validBin(): string {
    for (;;) {
      const first = String(Math.floor(Math.random() * 1e11)).padStart(11, '0');
      const digit = computeBinCheckDigit(first);
      if (digit !== null) return first + digit;
    }
  }

  const body = (over: Partial<RegistrationRequest> = {}): RegistrationRequest => ({
    companyName: 'ТОО «Онбординг»',
    bin: validBin(),
    email: `${randomUUID()}@onboarding.local`,
    heardAboutUs: 'Выставка',
    acceptPlatformTerms: true,
    acceptPersonalData: true,
    ndaVersion: nda.versionNumber,
    locale: 'ru',
    ...over,
  });

  function keycloakStub(subject = randomUUID()) {
    return {
      createUser: vi.fn(async () => subject),
      deleteUser: vi.fn(async () => undefined),
      sendPasswordEmail: vi.fn(async () => undefined),
    };
  }

  function controller(keycloak = keycloakStub()) {
    return new RegistrationController(
      db,
      boss,
      new IdentityProvisioningService(pool, boss, keycloak as never),
      audit,
      rates,
    );
  }

  /** Регистрация через контроллер; возвращает аккаунт и организацию. */
  async function register(input = body(), req: { ip?: string } = { ip: '203.0.113.7' }) {
    const keycloak = keycloakStub();
    expect(await controller(keycloak).register(input, req as never)).toEqual({ status: 'password_email_queued' });
    const account = (await db.query.userAccounts.findFirst({ where: eq(schema.userAccounts.email, input.email) }))!;
    const organization = (await db.query.organizations.findFirst({
      where: eq(schema.organizations.id, account.organizationId),
    }))!;
    return { account, organization, keycloak, input };
  }

  type SecurityEvent = { id: string; type: string; userId: string; time: number; details?: Record<string, string> };

  /** Опрос событий Keycloak worker с заданным пакетом; почта и Keycloak — шпионы. */
  function poll(events: SecurityEvent[], service: Pick<ManufacturerOnboardingService, 'onPasswordSet'> = onboarding) {
    const keycloak = { securityEvents: vi.fn(async () => events), sendPasswordEmail: vi.fn() };
    const mail = { sendRaw: vi.fn() };
    const worker = new JobHandlers(
      db,
      {} as never,
      mail as never,
      env,
      audit,
      keycloak as never,
      sessions,
      service as ManufacturerOnboardingService,
    );
    return { run: () => worker.keycloakEvents(), keycloak, mail };
  }

  const passwordEvent = (subject: string, at: Date, type = 'UPDATE_PASSWORD'): SecurityEvent => ({
    id: `${type}-${subject}-${at.getTime()}`,
    type,
    userId: subject,
    time: at.getTime(),
  });

  /** OIDC callback с заглушкой обмена кода; ответ — только 302. */
  async function signIn(account: typeof schema.userAccounts.$inferSelect, service = onboarding) {
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
    const auth = new AuthController(oidc as never, sessions, audit, {} as never, rates, env, service);
    const flow = sign({ v: 'verifier', s: 'state', r: '/profile', exp: Date.now() + 60000 }, env.SESSION_SECRET);
    const req = {
      cookies: { 'imbc-oidc-flow': flow },
      originalUrl: '/api/auth/callback?code=c&state=state',
      ip: '127.0.0.9',
      get: () => 'test',
    };
    const res = { clearCookie: vi.fn(), cookie: vi.fn(), redirect: vi.fn() };
    await auth.callback(req as never, res as never);
    expect(res.redirect).toHaveBeenCalledTimes(1);
    return (res.redirect.mock.calls[0] as [number, string])[1];
  }

  async function profilesOf(organizationId: string) {
    return db
      .select()
      .from(schema.manufacturerProfiles)
      .where(eq(schema.manufacturerProfiles.organizationId, organizationId));
  }

  async function acceptancesOf(organizationId: string) {
    return db
      .select({ acceptance: schema.ndaAcceptance })
      .from(schema.ndaAcceptance)
      .innerJoin(schema.manufacturerProfiles, eq(schema.manufacturerProfiles.id, schema.ndaAcceptance.profileId))
      .where(eq(schema.manufacturerProfiles.organizationId, organizationId))
      .then((rows) => rows.map((r) => r.acceptance));
  }

  async function attemptsOf(organizationId: string) {
    return (
      await pool.query<{ id: string; state: string; trigger: string }>(
        `select a.id, a.state, a.trigger from external_check_attempt a
         join external_check c on c.id = a.external_check_id where c.organization_id = $1`,
        [organizationId],
      )
    ).rows;
  }

  const jobs = async (name: string, where = 'true', values: unknown[] = []) =>
    (
      await pool.query<{ data: Record<string, string> }>(
        `select data from pgboss_auth_test.job where name = $1 and ${where}`,
        [name, ...values],
      )
    ).rows.map((r) => r.data);

  async function auditOf(organizationId: string, action: string) {
    return db
      .select()
      .from(schema.auditEntries)
      .where(and(eq(schema.auditEntries.organizationId, organizationId), eq(schema.auditEntries.action, action)));
  }

  async function accountRow(id: string) {
    return (await db.query.userAccounts.findFirst({ where: eq(schema.userAccounts.id, id) }))!;
  }

  /** Весь вывод процесса на время fn. */
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
    return { value, error, output: chunks.join('').replace(/\u001b\[[0-9;]*m/g, '') };
  }

  /** Сменить текущую версию NDA: два UPDATE (частичный уникальный индекс не откладывается). */
  async function makeCurrent(id: string | null) {
    await db.update(schema.ndaVersion).set({ isCurrent: false }).where(eq(schema.ndaVersion.isCurrent, true));
    if (id) await db.update(schema.ndaVersion).set({ isCurrent: true }).where(eq(schema.ndaVersion.id, id));
  }

  it('регистрация v1.3: организация и аккаунт без профиля, согласия и ожидающее принятие NDA у аккаунта с IP запроса (MAN-01, MAN-03, FC-02)', async () => {
    const { account, organization, keycloak, input } = await register();
    expect(keycloak.createUser).toHaveBeenCalledWith({ email: input.email, firstName: undefined, locale: 'ru' });
    expect(organization).toMatchObject({ type: 'manufacturer', name: input.companyName, bin: input.bin });
    expect(account).toMatchObject({
      role: 'manufacturer',
      state: 'invited',
      locale: 'ru',
      registrationIp: '203.0.113.7',
      registrationNdaVersionId: nda.id,
      registrationHeardAboutUs: 'Выставка',
    });
    expect(account.platformTermsAcceptedAt).not.toBeNull();
    expect(account.personalDataAcceptedAt).not.toBeNull();
    expect(account.registrationNdaAcceptedAt).not.toBeNull();
    expect(await profilesOf(organization.id)).toEqual([]);
    expect(await pool.query('select count(*)::int as n from nda_acceptance')).toMatchObject({ rows: [{ n: 0 }] });
    expect(await jobs(QUEUES.sendPasswordEmail, `data->>'subject' = $2`, [account.idpSubject])).toHaveLength(1);
    expect(await jobs(QUEUES.adataPrefill)).toEqual([]);
    const [created] = await auditOf(organization.id, 'registration.created');
    // IP — только в колонке ip записи аудита, не в diff.
    expect(created).toMatchObject({ diff: { ndaVersion: 1 }, isAccountEvent: true, ip: '203.0.113.7' });
    // Ответ «Как вы узнали о нас» не отдаётся маршрутом: ответ регистрации — только статус.
    await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
  });

  it('устаревшая версия NDA — 409 nda_version_changed, createUser не вызван; нет текущей версии — terms и регистрация 503 nda_unavailable', async () => {
    expect(await controller().terms({ ip: '203.0.113.20' } as never)).toEqual({
      nda: { version: 1, body: 'NDA версии 1 (тест)' },
    });

    const [v2] = await db
      .insert(schema.ndaVersion)
      .values({ versionNumber: 2, body: 'NDA версии 2 (тест)' })
      .returning({ id: schema.ndaVersion.id });
    try {
      // Форма загружена с версией 1, к отправке текущей стала версия 2.
      await makeCurrent(v2!.id);
      const stale = body({ ndaVersion: 1 });
      const keycloak = keycloakStub();
      await expect(controller(keycloak).register(stale, { ip: '203.0.113.21' } as never)).rejects.toMatchObject({
        status: 409,
        code: 'nda_version_changed',
      });
      expect(keycloak.createUser).not.toHaveBeenCalled();
      expect(
        await db.query.organizations.findFirst({ where: eq(schema.organizations.bin, stale.bin) }),
      ).toBeUndefined();

      // Версия сменилась, пока создавался пользователь Keycloak: тот же 409, пользователь удалён.
      await makeCurrent(nda.id);
      const raced = body({ ndaVersion: 1 });
      const racing = keycloakStub();
      racing.createUser.mockImplementation(async () => {
        await makeCurrent(v2!.id);
        return randomUUID();
      });
      await expect(controller(racing).register(raced, { ip: '203.0.113.21' } as never)).rejects.toMatchObject({
        status: 409,
        code: 'nda_version_changed',
      });
      expect(racing.deleteUser).toHaveBeenCalledTimes(1);
      expect(
        await db.query.organizations.findFirst({ where: eq(schema.organizations.bin, raced.bin) }),
      ).toBeUndefined();

      // Текущей версии нет: ни текста условий, ни регистрации.
      await makeCurrent(null);
      await expect(controller().terms({ ip: '203.0.113.20' } as never)).rejects.toMatchObject({
        status: 503,
        code: 'nda_unavailable',
      });
      const none = keycloakStub();
      await expect(controller(none).register(body(), { ip: '203.0.113.21' } as never)).rejects.toMatchObject({
        status: 503,
        code: 'nda_unavailable',
      });
      expect(none.createUser).not.toHaveBeenCalled();
    } finally {
      await makeCurrent(nda.id);
      await db.delete(schema.ndaVersion).where(eq(schema.ndaVersion.id, v2!.id));
    }
  });

  it('IP запроса не разобран — 503 identity_unavailable до Keycloak; IPv4 в IPv6 сохраняется как есть (FC-02)', async () => {
    for (const ip of [undefined, '', 'unknown', 'fe80::1%eth0']) {
      const keycloak = keycloakStub();
      await expect(controller(keycloak).register(body(), { ip } as never)).rejects.toMatchObject({
        status: 503,
        code: 'identity_unavailable',
      });
      expect(keycloak.createUser).not.toHaveBeenCalled();
    }
    const { account, organization } = await register(body(), { ip: '::ffff:203.0.113.7' });
    expect(account.registrationIp).toBe('::ffff:203.0.113.7');
    expect(await onboarding.onPasswordSet(account.id, 'password_set', new Date())).toEqual({
      profile: 'created',
      adata: 'scheduled',
    });
    expect((await acceptancesOf(organization.id)).map((a) => a.ipAddress)).toEqual(['::ffff:203.0.113.7']);
    await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
  });

  it('событие установки пароля создаёт Draft, принятие NDA и одно чтение Adata одной транзакцией (MAN-03, FC-02, IMBC-07)', async () => {
    const { account, organization } = await register();
    const T = new Date();
    await poll([passwordEvent(account.idpSubject!, T)]).run();

    const [profile, ...more] = await profilesOf(organization.id);
    expect(more).toEqual([]);
    expect(profile).toMatchObject({ status: 'draft', heardAboutUs: 'Выставка', source: 'manual' });
    expect(profile!.registeredAt.getTime()).toBe(T.getTime());
    expect(
      await db.query.profileSections.findMany({ where: eq(schema.profileSections.profileId, profile!.id) }),
    ).toHaveLength(8);
    expect(await acceptancesOf(organization.id)).toEqual([
      {
        id: expect.any(String),
        profileId: profile!.id,
        ndaVersionId: nda.id,
        acceptedAt: account.registrationNdaAcceptedAt,
        ipAddress: '203.0.113.7',
      },
    ]);
    const after = await accountRow(account.id);
    expect(after).toMatchObject({
      registrationNdaVersionId: null,
      registrationNdaAcceptedAt: null,
      registrationIp: null,
      registrationHeardAboutUs: null,
    });
    // Согласия с условиями и политикой остаются у аккаунта (DBML).
    expect(after.platformTermsAcceptedAt).toEqual(account.platformTermsAcceptedAt);
    const attempts = await attemptsOf(organization.id);
    expect(attempts).toEqual([{ id: expect.any(String), state: 'queued', trigger: 'profile_created' }]);
    expect(await jobs(QUEUES.adataPrefill)).toEqual([{ attemptId: attempts[0]!.id }]);

    expect((await auditOf(organization.id, 'profile.created')).map((e) => [e.diff, e.objectId, e.ip])).toEqual([
      [{ origin: 'password_set' }, profile!.id, null],
    ]);
    const accepted = await auditOf(organization.id, 'nda.accepted');
    expect(accepted.map((e) => [e.diff, e.isAccountEvent])).toEqual([[{ version: 1 }, false]]);
    // IP — персональные данные: в diff записей аудита его нет.
    const diffs = JSON.stringify((await auditOf(organization.id, 'adata.read_requested')).concat(accepted));
    expect(diffs).not.toContain('203.0.113.7');
    await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
  });

  it('установка пароля писем не шлёт (NOT-23)', async () => {
    const { account, keycloak } = await register();
    const before = await jobs(QUEUES.sendPasswordEmail, `data->>'subject' = $2`, [account.idpSubject]);
    expect(before).toHaveLength(1);
    const notificationsBefore = (await jobs(QUEUES.sendNotification)).length;
    const worker = poll([passwordEvent(account.idpSubject!, new Date())]);
    await worker.run();
    expect(await profilesOf(account.organizationId)).toHaveLength(1);
    expect(await jobs(QUEUES.sendNotification)).toHaveLength(notificationsBefore);
    expect(await jobs(QUEUES.sendPasswordEmail, `data->>'subject' = $2`, [account.idpSubject])).toHaveLength(1);
    expect(worker.keycloak.sendPasswordEmail).not.toHaveBeenCalled();
    expect(keycloak.sendPasswordEmail).not.toHaveBeenCalled();
    expect(worker.mail.sendRaw).not.toHaveBeenCalled();
    await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
  });

  it('сбой постановки чтения откатывает профиль и принятие; следующий вход создаёт всё', async () => {
    const { account, organization } = await register();
    let failed = false;
    const flaky = {
      send: vi.fn((name: string, data: object, options: object) => {
        if (name === QUEUES.adataPrefill && !failed) {
          failed = true;
          return Promise.reject(new Error(`queue down ${account.email}`));
        }
        return boss.send(name, data, options);
      }),
    } as unknown as PgBoss;
    const service = new ManufacturerOnboardingService(pool, profiles, new AdataScheduler(pool, flaky, audit), audit);
    const { error, output } = await captured(() =>
      poll([passwordEvent(account.idpSubject!, new Date())], service).run(),
    );
    expect(error).toBeUndefined();
    expect(output).toContain('onboarding: профиль после установки пароля не создан');
    expect(output).not.toContain(account.email);
    expect(output).not.toContain('203.0.113.7');
    expect(await profilesOf(organization.id)).toEqual([]);
    expect(await acceptancesOf(organization.id)).toEqual([]);
    expect(await attemptsOf(organization.id)).toEqual([]);
    expect(await auditOf(organization.id, 'profile.created')).toEqual([]);
    expect(await accountRow(account.id)).toMatchObject({
      registrationNdaVersionId: nda.id,
      registrationIp: '203.0.113.7',
    });
    // Курсор опроса сдвинут: сбой онбординга не мешает следующему опросу.
    expect(
      await db.query.authSyncState.findFirst({ where: eq(schema.authSyncState.name, 'keycloak-events') }),
    ).toBeDefined();

    expect(await signIn(account, service)).toBe('/auth/verify?returnTo=%2Fprofile');
    expect(await profilesOf(organization.id)).toHaveLength(1);
    expect(await acceptancesOf(organization.id)).toHaveLength(1);
    expect(await attemptsOf(organization.id)).toHaveLength(1);
    expect(await jobs(QUEUES.adataPrefill)).toHaveLength(1);
    expect((await auditOf(organization.id, 'profile.created'))[0]!.diff).toEqual({ origin: 'sign_in' });
    await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
  });

  it('вход до опроса событий создаёт профиль; событие после входа — existing, второй попытки нет', async () => {
    const { account, organization } = await register();
    expect(await signIn(account)).toBe('/auth/verify?returnTo=%2Fprofile');
    const [profile] = await profilesOf(organization.id);
    expect(profile?.status).toBe('draft');
    expect(await acceptancesOf(organization.id)).toHaveLength(1);
    expect(await attemptsOf(organization.id)).toHaveLength(1);

    const spy = vi.spyOn(onboarding, 'onPasswordSet');
    try {
      await poll([passwordEvent(account.idpSubject!, new Date())]).run();
      expect(await spy.mock.results[0]!.value).toEqual({ profile: 'existing', adata: 'skipped' });
    } finally {
      spy.mockRestore();
    }
    expect(await profilesOf(organization.id)).toEqual([profile]);
    expect(await acceptancesOf(organization.id)).toHaveLength(1);
    expect(await attemptsOf(organization.id)).toHaveLength(1);
    expect(await jobs(QUEUES.adataPrefill)).toHaveLength(1);
    await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
  });

  it('пароль дважды, повтор события, событие и вход параллельно, затем сброс пароля — один профиль, одно принятие, одна попытка profile_created (MAN-03, IMBC-07)', async () => {
    const { account, organization } = await register();
    const T = new Date(Date.now() - 1000);
    const T2 = new Date();
    const results = await Promise.all([
      onboarding.onPasswordSet(account.id, 'password_set', T),
      onboarding.onPasswordSet(account.id, 'sign_in', T2),
    ]);
    expect(results.map((r) => r.profile).sort()).toEqual(['created', 'existing']);
    expect(results.map((r) => r.adata).sort()).toEqual(['scheduled', 'skipped']);

    // Пароль задан дважды в одном пакете и пакет пришёл снова (окно опроса перекрывается на 5 минут).
    const batch = [passwordEvent(account.idpSubject!, T), passwordEvent(account.idpSubject!, T2, 'UPDATE_CREDENTIAL')];
    batch[1]!.details = { credential_type: 'password' };
    await poll(batch).run();
    await poll(batch).run();
    await Promise.all([poll(batch).run(), signIn(account)]);
    const [before] = await profilesOf(organization.id);
    // Месяц спустя — сброс пароля: момент появления профиля не сдвигается.
    await poll([passwordEvent(account.idpSubject!, new Date(Date.now() + 1000), 'RESET_PASSWORD')]).run();

    expect(await profilesOf(organization.id)).toHaveLength(1);
    expect((await profilesOf(organization.id))[0]!.registeredAt).toEqual(before!.registeredAt);
    expect(await acceptancesOf(organization.id)).toHaveLength(1);
    expect((await attemptsOf(organization.id)).filter((a) => a.trigger === 'profile_created')).toHaveLength(1);
    expect(await jobs(QUEUES.adataPrefill)).toHaveLength(1);
    expect(await auditOf(organization.id, 'profile.created')).toHaveLength(1);
    expect(await auditOf(organization.id, 'nda.accepted')).toHaveLength(1);
    expect(await auditOf(organization.id, 'adata.read_requested')).toHaveLength(1);
    await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
  });

  it('в пакете событий два времени установки пароля одного субъекта — registered_at берётся самое раннее (MAN-03)', async () => {
    const { account, organization } = await register();
    const T1 = new Date(Date.now() - 2000);
    const T2 = new Date(Date.now() - 1000);
    // Keycloak может вернуть события не по времени.
    await poll([
      passwordEvent(account.idpSubject!, T2, 'UPDATE_PASSWORD'),
      passwordEvent(account.idpSubject!, T1, 'RESET_PASSWORD'),
    ]).run();
    const [profile, ...more] = await profilesOf(organization.id);
    expect(more).toEqual([]);
    expect(profile!.registeredAt.getTime()).toBe(T1.getTime());
    await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
  });

  it('текст текущей NDA пуст или из пробелов — terms и регистрация 503 nda_unavailable, Keycloak не вызван (MAN-01, FC-02)', async () => {
    try {
      for (const blank of ['', '   \n\t']) {
        await db.update(schema.ndaVersion).set({ body: blank }).where(eq(schema.ndaVersion.id, nda.id));
        await expect(controller().terms({ ip: '203.0.113.40' } as never)).rejects.toMatchObject({
          status: 503,
          code: 'nda_unavailable',
        });
        const keycloak = keycloakStub();
        await expect(controller(keycloak).register(body(), { ip: '203.0.113.41' } as never)).rejects.toMatchObject({
          status: 503,
          code: 'nda_unavailable',
        });
        expect(keycloak.createUser).not.toHaveBeenCalled();
      }
    } finally {
      await db.update(schema.ndaVersion).set({ body: 'NDA версии 1 (тест)' }).where(eq(schema.ndaVersion.id, nda.id));
    }
  });

  it('строка текущей версии NDA занята чужой транзакцией — регистрация 503 identity_unavailable быстрее 4 с, пользователь Keycloak удалён (FC-02)', async () => {
    const holder = await pool.connect();
    const input = body();
    const keycloak = keycloakStub();
    try {
      await holder.query('begin');
      await holder.query('select id from nda_version where is_current for update');
      const started = Date.now();
      await expect(controller(keycloak).register(input, { ip: '203.0.113.42' } as never)).rejects.toMatchObject({
        status: 503,
        code: 'identity_unavailable',
      });
      expect(Date.now() - started).toBeLessThan(4000);
    } finally {
      await holder.query('rollback');
      holder.release();
    }
    expect(keycloak.createUser).toHaveBeenCalledTimes(1);
    expect(keycloak.deleteUser).toHaveBeenCalledTimes(1);
    expect(await db.query.organizations.findFirst({ where: eq(schema.organizations.bin, input.bin) })).toBeUndefined();
  });

  it('оператор, заблокированный производитель, организация без БИН — skipped, профиля нет', async () => {
    const [operatorOrg] = await db
      .insert(schema.organizations)
      .values({ type: 'operator', name: `Оператор ${randomUUID()}` })
      .returning();
    const [operator] = await db
      .insert(schema.userAccounts)
      .values({ organizationId: operatorOrg!.id, email: `${randomUUID()}@operator.local`, role: 'operator' })
      .returning();

    const blocked = await register();
    await db
      .update(schema.userAccounts)
      .set({ state: 'blocked' })
      .where(eq(schema.userAccounts.id, blocked.account.id));

    const [noBinOrg] = await db
      .insert(schema.organizations)
      .values({ type: 'manufacturer', name: 'Без БИН' })
      .returning();
    const [noBin] = await db
      .insert(schema.userAccounts)
      .values({ organizationId: noBinOrg!.id, email: `${randomUUID()}@nobin.local`, role: 'manufacturer' })
      .returning();

    for (const id of [operator!.id, blocked.account.id, noBin!.id, randomUUID()])
      expect(await onboarding.onPasswordSet(id, 'password_set', new Date())).toEqual({
        profile: 'skipped',
        adata: 'skipped',
      });
    await poll([passwordEvent(blocked.account.idpSubject!, new Date())]).run();
    for (const orgId of [operatorOrg!.id, blocked.organization.id, noBinOrg!.id]) {
      expect(await profilesOf(orgId)).toEqual([]);
      expect(await attemptsOf(orgId)).toEqual([]);
    }
    // Принятие заблокированного ждёт у аккаунта: профиль создаст первый вход после разблокировки.
    expect(await accountRow(blocked.account.id)).toMatchObject({ registrationNdaVersionId: nda.id });
    expect(await jobs(QUEUES.adataPrefill)).toEqual([]);
    await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
  });

  it('Draft, созданный при регистрации до этапа 1, получает чтение по событию пароля; принятия NDA нет', async () => {
    // Так выглядит регистрация прежнего потока: профиль создан сразу, ожидающего принятия нет.
    const [org] = await db
      .insert(schema.organizations)
      .values({ type: 'manufacturer', name: 'До этапа 1', bin: validBin() })
      .returning();
    const [account] = await db
      .insert(schema.userAccounts)
      .values({
        organizationId: org!.id,
        email: `${randomUUID()}@legacy.local`,
        role: 'manufacturer',
        idpSubject: randomUUID(),
      })
      .returning();
    const profileId = await profiles.ensureDraft(org!.id, account!.id, { heardAboutUs: null });

    const spy = vi.spyOn(onboarding, 'onPasswordSet');
    try {
      await poll([passwordEvent(account!.idpSubject!, new Date())]).run();
      expect(await spy.mock.results[0]!.value).toEqual({ profile: 'existing', adata: 'scheduled' });
    } finally {
      spy.mockRestore();
    }
    expect((await profilesOf(org!.id)).map((p) => p.id)).toEqual([profileId]);
    expect(await acceptancesOf(org!.id)).toEqual([]);
    expect(await auditOf(org!.id, 'profile.created')).toEqual([]);
    expect(await auditOf(org!.id, 'nda.accepted')).toEqual([]);
    expect(await attemptsOf(org!.id)).toEqual([
      { id: expect.any(String), state: 'queued', trigger: 'profile_created' },
    ]);
    // Повтор события — без второй попытки.
    expect(await onboarding.onPasswordSet(account!.id, 'password_set', new Date())).toEqual({
      profile: 'existing',
      adata: 'skipped',
    });
  });

  it('роль приложения без UPDATE на nda_acceptance: onPasswordSet проходит, повторная вставка принятия — без ошибки и без строки (FC-02)', async () => {
    const ROLE = 'imbc_onboarding_test';
    const dropRole = () =>
      pool.query(`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
          REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ROLE};
          REVOKE ALL ON SCHEMA public FROM ${ROLE};
          REVOKE ALL ON ALL TABLES IN SCHEMA pgboss_auth_test FROM ${ROLE};
          REVOKE ALL ON SCHEMA pgboss_auth_test FROM ${ROLE};
          DROP ROLE ${ROLE};
        END IF;
      END $$`);
    const { account, organization } = await register();
    await dropRole();
    await pool.query(`CREATE ROLE ${ROLE} NOLOGIN`);
    // Каждое соединение этого пула работает от роли приложения: права — как на стенде.
    const rolePool = new pg.Pool({ connectionString: databaseUrl, max: 3, options: `-c role=${ROLE}` });
    try {
      // USAGE на схеме public выдаёт init.sql стенда, права на таблицы — migrate (applyAppRoleGrants).
      await pool.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
      await applyAppRoleGrants(pool, ROLE);
      // Схемой pg-boss на стенде владеет роль приложения (она её создаёт); здесь — те же права выдачей.
      await pool.query(`GRANT USAGE ON SCHEMA pgboss_auth_test TO ${ROLE}`);
      await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss_auth_test TO ${ROLE}`);
      const asRole = await rolePool.query<{ who: string; update: boolean }>(
        `select current_user as who, has_table_privilege(current_user, 'nda_acceptance', 'UPDATE') as update`,
      );
      expect(asRole.rows).toEqual([{ who: ROLE, update: false }]);

      const roleDb = drizzle(rolePool, { schema, casing: 'snake_case' });
      const roleAudit = new AuditService(roleDb);
      const service = new ManufacturerOnboardingService(
        rolePool,
        new ProfilesService(roleDb),
        new AdataScheduler(rolePool, boss, roleAudit),
        roleAudit,
      );
      expect(await service.onPasswordSet(account.id, 'password_set', new Date())).toEqual({
        profile: 'created',
        adata: 'scheduled',
      });
      const [acceptance] = await acceptancesOf(organization.id);
      expect(acceptance).toMatchObject({ ndaVersionId: nda.id, ipAddress: '203.0.113.7' });

      // То же принятие ещё раз (как если бы колонки аккаунта не очистились): тот же SQL, ON CONFLICT DO NOTHING.
      await pool.query(
        `update user_accounts set registration_nda_version_id = $2, registration_nda_accepted_at = $3,
         registration_ip = $4::inet where id = $1`,
        [account.id, acceptance!.ndaVersionId, acceptance!.acceptedAt, acceptance!.ipAddress],
      );
      for (let i = 0; i < 2; i++) {
        const again = await roleDb.execute(ndaAcceptanceInsert(acceptance!.profileId, account.id));
        expect(again.rows).toEqual([]);
      }
      expect(await acceptancesOf(organization.id)).toEqual([acceptance]);
      // Повторный вызов — existing, без записи в nda_acceptance.
      expect(await service.onPasswordSet(account.id, 'sign_in', new Date())).toEqual({
        profile: 'existing',
        adata: 'skipped',
      });
    } finally {
      await rolePool.end();
      await dropRole();
    }
    const left = await pool.query('select count(*)::int as n from pg_roles where rolname = $1', [ROLE]);
    expect(left.rows).toEqual([{ n: 0 }]);
    await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
  });

  it('БИН или почта уже в реестре — 409 до Keycloak, текст «обратитесь в IMBC» (MAN-02)', async () => {
    const first = await register();
    const keycloak = keycloakStub();
    const binTaken = await controller(keycloak)
      .register(body({ bin: first.input.bin }), { ip: '203.0.113.30' } as never)
      .catch((error: unknown) => error);
    expect(binTaken).toBeInstanceOf(ProblemException);
    expect(binTaken).toMatchObject({ status: 409, code: 'bin_exists', detail: 'Обратитесь в IMBC' });
    await expect(
      controller(keycloak).register(body({ email: first.input.email.toUpperCase() }), { ip: '203.0.113.30' } as never),
    ).rejects.toMatchObject({ status: 409, code: 'email_exists' });
    expect(keycloak.createUser).not.toHaveBeenCalled();
    await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
  });
});
