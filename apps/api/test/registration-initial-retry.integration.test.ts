import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { computeBinCheckDigit, PROFILE_STATUSES } from '@imbc/contracts';
import { Controller } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Env } from '../src/config/env.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import { DB, type Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { QUEUE } from '../src/infra/infra.module.js';
import { QUEUES } from '../src/jobs/queues.js';
import { IdentityProvisioningService } from '../src/modules/auth/identity-provisioning.service.js';
import { KeycloakAdminService, KeycloakRequestError } from '../src/modules/auth/keycloak-admin.service.js';
import { AuthRateLimitService } from '../src/modules/auth/rate-limit.service.js';
import { RegistrationController } from '../src/modules/registration/registration.controller.js';
import { JobHandlers } from '../src/worker/handlers.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp, type HttpStand } from './support/http.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'MAN-02 exact initial registration retry on real PostgreSQL/HTTP',
  () => {
    vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
    let pool: pg.Pool, appPool: pg.Pool, db: Database, appDb: Database, boss: PgBoss, currentId: string;
    const role = `registration_retry_${randomUUID().replaceAll('-', '')}`;
    let sequence = 0;
    const bin = () => {
      const prefix = `2713${String(++sequence).padStart(7, '0')}`;
      return `${prefix}${computeBinCheckDigit(prefix)}`;
    };
    const keycloak = {
      createUser: vi.fn(async () => randomUUID()),
      deleteUser: vi.fn(async () => undefined),
      awaitingInitialPasswordSetup: vi.fn(async () => true),
      sendPasswordEmail: vi.fn(async () => undefined),
    };
    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool, '0022_account_nda_evidence');
      db = drizzle(pool, { schema: s, casing: 'snake_case' });
      currentId = (
        await db
          .insert(s.ndaVersion)
          .values({ versionNumber: 1, body: 'Synthetic NDA fixture', isCurrent: true })
          .returning()
      )[0]!.id;
      await pool.query(`create role "${role}"`);
      await applyAppRoleGrants(pool, role);
      appPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5, options: `-c role=${role}` });
      appDb = drizzle(appPool, { schema: s, casing: 'snake_case' });
      boss = new PgBoss({
        connectionString: process.env.TEST_DATABASE_URL,
        schema: 'pgboss_auth_test',
        supervise: false,
        schedule: false,
      });
      await boss.start();
      for (const name of [QUEUES.sendPasswordEmail, QUEUES.cleanupIdentity]) await boss.createQueue(name);
      await pool.query(
        `grant usage on schema pgboss_auth_test to "${role}"; grant select,insert,update,delete on all tables in schema pgboss_auth_test to "${role}"`,
      );
    });
    afterAll(async () => {
      await boss?.stop();
      await appPool?.end();
      if (pool) await pool.query(`drop owned by "${role}"; drop role "${role}"`);
      await pool?.end();
    });
    beforeEach(async () => {
      await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
      await boss.deleteAllJobs(QUEUES.cleanupIdentity);
      vi.clearAllMocks();
      keycloak.createUser.mockImplementation(async () => randomUUID());
      keycloak.awaitingInitialPasswordSetup.mockImplementation(async () => true);
      keycloak.sendPasswordEmail.mockResolvedValue(undefined);
    });
    const body = (input?: { bin: string; email: string }) => ({
      bin: input?.bin ?? bin(),
      email: input?.email ?? `${randomUUID()}@retry.local`,
      companyName: 'Synthetic manufacturer',
      heardAboutUs: 'Original answer',
      locale: 'en',
      acceptPlatformTerms: true,
      acceptPersonalData: true,
      ndaVersion: 1,
    });
    const seed = async (
      patch: Partial<typeof s.userAccounts.$inferInsert> = {},
      orgType: 'manufacturer' | 'operator' = 'manufacturer',
    ) => {
      const [org] = await db
        .insert(s.organizations)
        .values({ type: orgType, name: `Synthetic retry ${randomUUID()}`, bin: bin() })
        .returning();
      const [account] = await db
        .insert(s.userAccounts)
        .values({
          organizationId: org!.id,
          role: orgType,
          state: 'invited',
          email: `${randomUUID()}@retry.local`,
          idpSubject: randomUUID(),
          registrationHeardAboutUs: 'Stored answer',
          ...patch,
        })
        .returning();
      return { org: org!, account: account!, body: body({ bin: org!.bin!, email: account!.email }) };
    };
    const http = async (queue: PgBoss = boss, servicePool: pg.Pool = appPool): Promise<HttpStand> => {
      const provisioning = new IdentityProvisioningService(
        servicePool,
        queue,
        keycloak as unknown as KeycloakAdminService,
      );
      const rates = { enforce: vi.fn(), allow: vi.fn(async () => true) } as unknown as AuthRateLimitService;
      @Controller('v1/registrations')
      class BoundRegistration extends RegistrationController {
        constructor() {
          super(appDb, queue, provisioning, new AuditService(appDb), rates);
        }
      }
      return startHttp({
        controllers: [BoundRegistration],
        providers: [
          { provide: DB, useValue: appDb },
          { provide: QUEUE, useValue: queue },
          { provide: IdentityProvisioningService, useValue: provisioning },
          { provide: AuthRateLimitService, useValue: rates },
        ],
      });
    };
    const jobs = async () =>
      (
        await pool.query('select data from pgboss_auth_test.job where name=$1 order by created_on,id', [
          QUEUES.sendPasswordEmail,
        ])
      ).rows.map((r) => r.data);
    const problemCode = async (response: Response) => ((await response.json()) as { code: string }).code;
    const facts = async (id: string, org: string) => ({
      organization: await db.select().from(s.organizations).where(eq(s.organizations.id, org)),
      accounts: await db.select().from(s.userAccounts).where(eq(s.userAccounts.id, id)),
      profiles: await db.select().from(s.manufacturerProfile).where(eq(s.manufacturerProfile.organizationId, org)),
      sections: await db.select().from(s.profileSection).where(eq(s.profileSection.organizationId, org)),
      consent: await db.select().from(s.accountNdaAcceptance).where(eq(s.accountNdaAcceptance.userAccountId, id)),
      audit: await db.select().from(s.auditEntries).where(eq(s.auditEntries.userId, id)).orderBy(s.auditEntries.id),
    });
    const worker = () =>
      new JobHandlers(
        appDb,
        {} as never,
        {} as Env,
        new AuditService(appDb),
        keycloak as unknown as KeycloakAdminService,
        {} as never,
        {} as never,
        appPool,
        boss,
      );
    /** Real COMMIT succeeds; only its acknowledgment is lost. A second connection can fail independently. */
    const commitAckPool = (freshUnavailable = false): pg.Pool => {
      let connections = 0,
        lostAck = false;
      return {
        connect: async () => {
          if (++connections === 2 && freshUnavailable) throw new Error('Synthetic fresh lookup unavailable');
          const client = await appPool.connect();
          return new Proxy(client, {
            get(target, property) {
              if (property === 'query')
                return (...args: unknown[]) => {
                  const command = args[0];
                  const text =
                    typeof command === 'string'
                      ? command
                      : command && typeof command === 'object' && 'text' in command
                        ? command.text
                        : null;
                  const result = Reflect.apply(target.query, target, args);
                  if (!lostAck && typeof text === 'string' && text.trim().toLowerCase() === 'commit') {
                    lostAck = true;
                    return Promise.resolve(result).then(() => {
                      throw new Error('Synthetic lost COMMIT acknowledgment');
                    });
                  }
                  return result;
                };
              const value = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
        },
      } as unknown as pg.Pool;
    };

    it('real repeated POST reuses original account/NDA/answers and queues only the stored login identity, with singleton replay', async () => {
      const stand = await http();
      try {
        const input = body();
        expect((await stand.send('POST', '/api/v1/registrations', undefined, input)).status).toBe(202);
        const account = (await db.select().from(s.userAccounts).where(eq(s.userAccounts.email, input.email)))[0]!;
        const before = await facts(account.id, account.organizationId);
        expect(before.consent).toHaveLength(1);
        expect(before.profiles).toHaveLength(0);
        await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
        const retry = {
          ...input,
          email: input.email.toUpperCase(),
          companyName: 'Different submitted name',
          heardAboutUs: 'Different answer',
          locale: 'kk',
        };
        for (let i = 0; i < 2; i++) {
          const response = await stand.send('POST', '/api/v1/registrations', undefined, retry);
          expect(response.status).toBe(202);
          expect(await response.json()).toEqual({ status: 'password_email_queued' });
        }
        expect(await facts(account.id, account.organizationId)).toEqual(before);
        expect(await jobs()).toEqual([{ subject: account.idpSubject, initialOnly: true }]);
        expect(keycloak.createUser).toHaveBeenCalledTimes(1);
        expect(keycloak.deleteUser).not.toHaveBeenCalled();
        expect(keycloak.awaitingInitialPasswordSetup).toHaveBeenCalledWith(account.idpSubject, account.email);
      } finally {
        await stand.close();
      }
    });
    it('initial signup followed by a deduplicated retry retains one guarded original job; password setup while DB remains invited suppresses delivery', async () => {
      const input = body(),
        stand = await http();
      try {
        expect((await stand.send('POST', '/api/v1/registrations', undefined, input)).status).toBe(202);
        expect((await stand.send('POST', '/api/v1/registrations', undefined, input)).status).toBe(202);
        const account = (await db.select().from(s.userAccounts).where(eq(s.userAccounts.email, input.email)))[0]!;
        expect(await jobs()).toEqual([{ subject: account.idpSubject, initialOnly: true }]);
        expect(account.state).toBe('invited');
        keycloak.awaitingInitialPasswordSetup.mockResolvedValue(false);
        await worker().sendPasswordEmail((await jobs())[0]);
        expect(keycloak.sendPasswordEmail).not.toHaveBeenCalled();
        expect(keycloak.createUser).toHaveBeenCalledTimes(1);
      } finally {
        await stand.close();
      }
    });
    it('legacy unflagged manufacturer invitation also rechecks password presence instead of turning into a reset', async () => {
      const g = await seed();
      keycloak.awaitingInitialPasswordSetup.mockResolvedValue(false);
      await worker().sendPasswordEmail({ subject: g.account.idpSubject! });
      expect(keycloak.sendPasswordEmail).not.toHaveBeenCalled();
      keycloak.awaitingInitialPasswordSetup.mockRejectedValue(new Error('Synthetic unknown credential response'));
      await expect(worker().sendPasswordEmail({ subject: g.account.idpSubject! })).rejects.toThrow(
        'Initial invitation evidence unavailable',
      );
      expect(keycloak.sendPasswordEmail).not.toHaveBeenCalled();
      keycloak.awaitingInitialPasswordSetup.mockResolvedValue(true);
      await worker().sendPasswordEmail({ subject: g.account.idpSubject! });
      expect(keycloak.sendPasswordEmail).toHaveBeenCalledExactlyOnceWith(g.account.idpSubject);
    });
    it('successful COMMIT with lost acknowledgment preserves the committed account, consent, job and IdP identity', async () => {
      const input = body(),
        stand = await http(boss, commitAckPool());
      try {
        expect((await stand.send('POST', '/api/v1/registrations', undefined, input)).status).toBe(500);
        const account = (await db.select().from(s.userAccounts).where(eq(s.userAccounts.email, input.email)))[0]!;
        expect(account).toBeDefined();
        const before = await facts(account.id, account.organizationId);
        expect(before.consent).toHaveLength(1);
        expect(await jobs()).toEqual([{ subject: account.idpSubject, initialOnly: true }]);
        expect(keycloak.deleteUser).not.toHaveBeenCalled();
        expect(
          (await pool.query('select data from pgboss_auth_test.job where name=$1', [QUEUES.cleanupIdentity])).rows,
        ).toHaveLength(0);
        expect((await stand.send('POST', '/api/v1/registrations', undefined, input)).status).toBe(202);
        expect(await facts(account.id, account.organizationId)).toEqual(before);
        expect(keycloak.deleteUser).not.toHaveBeenCalled();
      } finally {
        await stand.close();
      }
    });
    it('unknown fresh compensation lookup defers ID-only guarded cleanup and never directly deletes the potentially committed identity', async () => {
      const input = body(),
        stand = await http(boss, commitAckPool(true));
      try {
        expect((await stand.send('POST', '/api/v1/registrations', undefined, input)).status).toBe(500);
        const account = (await db.select().from(s.userAccounts).where(eq(s.userAccounts.email, input.email)))[0]!;
        const before = await facts(account.id, account.organizationId);
        const cleanup = (
          await pool.query('select data from pgboss_auth_test.job where name=$1', [QUEUES.cleanupIdentity])
        ).rows;
        expect(cleanup.map((r) => r.data)).toEqual([{ subject: account.idpSubject }]);
        expect(keycloak.deleteUser).not.toHaveBeenCalled();
        await worker().cleanupIdentity(cleanup[0]!.data);
        expect(keycloak.deleteUser).not.toHaveBeenCalled();
        expect(await facts(account.id, account.organizationId)).toEqual(before);
        expect(await jobs()).toEqual([{ subject: account.idpSubject, initialOnly: true }]);
      } finally {
        await stand.close();
      }
    });
    it('cleanup waits for the original identity lock and takes a fresh snapshot after its pending transaction commits', async () => {
      const subject = randomUUID(),
        originalBin = bin(),
        client = await pool.connect();
      let committed = false;
      try {
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(2146711107,hashtext($1))', [originalBin]);
        await client.query('select pg_advisory_xact_lock(2146711109,hashtext($1))', [subject]);
        const org = (
          await client.query(
            "insert into organizations(type,name,bin) values('manufacturer','Synthetic pending registration',$1) returning id",
            [originalBin],
          )
        ).rows[0]!;
        await client.query(
          "insert into user_accounts(organization_id,role,email,idp_subject) values($1,'manufacturer',$2,$3)",
          [org.id, `${randomUUID()}@retry.local`, subject],
        );
        const cleaning = worker().cleanupIdentity({ subject });
        for (let n = 0; n < 100; n++) {
          if (
            (
              await pool.query(
                "select 1 from pg_locks where locktype='advisory' and classid=2146711109 and not granted",
              )
            ).rowCount
          )
            break;
          if (n === 99) throw new Error('Cleanup did not wait for the original identity transaction');
          await new Promise((r) => setTimeout(r, 10));
        }
        expect(keycloak.deleteUser).not.toHaveBeenCalled();
        await client.query('commit');
        committed = true;
        await cleaning;
        expect(keycloak.deleteUser).not.toHaveBeenCalled();
        expect(await db.select().from(s.userAccounts).where(eq(s.userAccounts.idpSubject, subject))).toHaveLength(1);
      } finally {
        if (!committed) await client.query('rollback');
        client.release();
      }
    });
    it.each(PROFILE_STATUSES)(
      'invited migrated manufacturer retains existing %s profile and creates no consent on public retry',
      async (status) => {
        const g = await seed();
        await db.insert(s.manufacturerProfile).values({
          organizationId: g.org.id,
          status,
          migrated: true,
          source: 'migration',
          heardAboutUs: 'Migrated answer',
        });
        const before = await facts(g.account.id, g.org.id);
        const stand = await http();
        try {
          expect((await stand.send('POST', '/api/v1/registrations', undefined, g.body)).status).toBe(202);
          expect(await facts(g.account.id, g.org.id)).toEqual(before);
          expect(await jobs()).toEqual([{ subject: g.account.idpSubject, initialOnly: true }]);
          expect(keycloak.createUser).not.toHaveBeenCalled();
        } finally {
          await stand.close();
        }
      },
    );
    it('public retry with a newer current NDA resends only and cannot append a new acceptance to an existing account', async () => {
      const g = await seed({
        registrationNdaVersionId: currentId,
        registrationNdaAcceptedAt: new Date('2024-02-01Z'),
        registrationIp: '203.0.113.8',
      });
      const before = await facts(g.account.id, g.org.id),
        stand = await http();
      await db.update(s.ndaVersion).set({ isCurrent: false }).where(eq(s.ndaVersion.id, currentId));
      const newer = (
        await db
          .insert(s.ndaVersion)
          .values({ versionNumber: 2, body: 'Synthetic newer NDA', isCurrent: true })
          .returning()
      )[0]!;
      try {
        expect(
          (await stand.send('POST', '/api/v1/registrations', undefined, { ...g.body, ndaVersion: 2 })).status,
        ).toBe(202);
        expect(await facts(g.account.id, g.org.id)).toEqual(before);
        expect(await jobs()).toEqual([{ subject: g.account.idpSubject, initialOnly: true }]);
      } finally {
        await db.update(s.ndaVersion).set({ isCurrent: false }).where(eq(s.ndaVersion.id, newer.id));
        await db.update(s.ndaVersion).set({ isCurrent: true }).where(eq(s.ndaVersion.id, currentId));
        await stand.close();
      }
    });
    it.each([
      { state: 'active' as const },
      { state: 'inactive' as const },
      { state: 'blocked' as const },
      { lastSignInAt: new Date('2025-01-01Z') },
      { credentialsChangedAt: new Date('2025-01-01Z') },
      { inactiveSince: new Date('2025-01-01Z') },
      { idpSubject: null },
    ])(
      'persisted non-initial account is refused before IdP, even if state/profile alone appear unfinished: %j',
      async (patch) => {
        const g = await seed(patch),
          before = await facts(g.account.id, g.org.id),
          stand = await http();
        try {
          const result = await stand.send('POST', '/api/v1/registrations', undefined, g.body);
          expect(result.status).toBe(409);
          expect(await problemCode(result)).toBe('bin_exists');
          expect(keycloak.awaitingInitialPasswordSetup).not.toHaveBeenCalled();
          expect(await jobs()).toHaveLength(0);
          expect(await facts(g.account.id, g.org.id)).toEqual(before);
        } finally {
          await stand.close();
        }
      },
    );
    it('different email for existing BIN, wrong organization/role, or existing email at a different BIN cannot reuse it', async () => {
      const g = await seed(),
        operator = await seed({}, 'operator'),
        stand = await http();
      try {
        for (const input of [{ ...g.body, email: 'other@retry.local' }, operator.body]) {
          const result = await stand.send('POST', '/api/v1/registrations', undefined, input);
          expect(result.status).toBe(409);
          expect(await problemCode(result)).toBe('bin_exists');
        }
        const result = await stand.send('POST', '/api/v1/registrations', undefined, { ...g.body, bin: bin() });
        expect(result.status).toBe(409);
        expect(await problemCode(result)).toBe('email_exists');
        expect(keycloak.awaitingInitialPasswordSetup).not.toHaveBeenCalled();
        expect(keycloak.createUser).not.toHaveBeenCalled();
        expect(await jobs()).toHaveLength(0);
      } finally {
        await stand.close();
      }
    });
    it('password-bearing IdP identity is refused even while DB still says invited; unknown proof fails safely without rewriting evidence', async () => {
      const g = await seed({
        registrationNdaVersionId: currentId,
        registrationNdaAcceptedAt: new Date('2024-02-01Z'),
        registrationIp: '203.0.113.8',
      });
      const before = await facts(g.account.id, g.org.id),
        stand = await http();
      try {
        keycloak.awaitingInitialPasswordSetup.mockResolvedValue(false);
        expect((await stand.send('POST', '/api/v1/registrations', undefined, g.body)).status).toBe(409);
        keycloak.awaitingInitialPasswordSetup.mockRejectedValue(new Error('Synthetic IdP unavailable'));
        const result = await stand.send('POST', '/api/v1/registrations', undefined, g.body);
        expect(result.status).toBe(503);
        expect(await problemCode(result)).toBe('identity_unavailable');
        expect(await jobs()).toHaveLength(0);
        expect(await facts(g.account.id, g.org.id)).toEqual(before);
      } finally {
        await stand.close();
      }
    });
    it('concurrent identical first signups serialize before IdP and all resolve to one original account/consent/job', async () => {
      const stand = await http();
      let started!: () => void, release!: () => void;
      const creating = new Promise<void>((r) => {
          started = r;
        }),
        barrier = new Promise<void>((r) => {
          release = r;
        });
      keycloak.createUser.mockImplementation(async () => {
        started();
        await barrier;
        return randomUUID();
      });
      try {
        const input = body(),
          first = stand.send('POST', '/api/v1/registrations', undefined, input);
        await creating;
        const second = stand.send('POST', '/api/v1/registrations', undefined, input);
        for (let n = 0; n < 100; n++) {
          if (
            (
              await pool.query(
                "select 1 from pg_locks where locktype='advisory' and classid=2146711107 and not granted",
              )
            ).rowCount
          )
            break;
          if (n === 99) throw new Error('Concurrent registration never reached its BIN lock');
          await new Promise((r) => setTimeout(r, 10));
        }
        release();
        expect((await Promise.all([first, second])).map((r) => r.status)).toEqual([202, 202]);
        expect(keycloak.createUser).toHaveBeenCalledTimes(1);
        expect(keycloak.deleteUser).not.toHaveBeenCalled();
        const accounts = await db.select().from(s.userAccounts).where(eq(s.userAccounts.email, input.email));
        expect(accounts).toHaveLength(1);
        expect((await facts(accounts[0]!.id, accounts[0]!.organizationId)).consent).toHaveLength(1);
        expect(await jobs()).toHaveLength(1);
      } finally {
        release();
        await stand.close();
      }
    });
    it('concurrent retries use one durable singleton and no duplicate business writes', async () => {
      const g = await seed(),
        before = await facts(g.account.id, g.org.id),
        stand = await http();
      try {
        expect(
          (
            await Promise.all([1, 2, 3, 4].map(() => stand.send('POST', '/api/v1/registrations', undefined, g.body)))
          ).map((r) => r.status),
        ).toEqual([202, 202, 202, 202]);
        expect(await jobs()).toEqual([{ subject: g.account.idpSubject, initialOnly: true }]);
        expect(await facts(g.account.id, g.org.id)).toEqual(before);
      } finally {
        await stand.close();
      }
    });
    it.each(['idp409', 'db23505'] as const)(
      'fresh exact scoped lookup resolves another provisioning path at %s without retaining a duplicate identity',
      async (race) => {
        const input = body(),
          duplicate = randomUUID();
        let persisted!: Awaited<ReturnType<typeof seed>>;
        keycloak.createUser.mockImplementation(async () => {
          const [org] = await db
            .insert(s.organizations)
            .values({ type: 'manufacturer', name: 'Other provisioning path', bin: input.bin })
            .returning();
          const [account] = await db
            .insert(s.userAccounts)
            .values({
              organizationId: org!.id,
              role: 'manufacturer',
              state: 'invited',
              email: input.email,
              idpSubject: randomUUID(),
            })
            .returning();
          persisted = { org: org!, account: account!, body: input };
          if (race === 'idp409') throw new KeycloakRequestError(409, 'create user');
          return duplicate;
        });
        const stand = await http();
        try {
          expect((await stand.send('POST', '/api/v1/registrations', undefined, input)).status).toBe(202);
          expect(await jobs()).toEqual([{ subject: persisted.account.idpSubject, initialOnly: true }]);
          expect((await facts(persisted.account.id, persisted.org.id)).consent).toHaveLength(0);
          expect(keycloak.deleteUser.mock.calls).toEqual(race === 'db23505' ? [[duplicate]] : []);
        } finally {
          await stand.close();
        }
      },
    );
    it('failed durable retry enqueue returns failure and preserves all account/profile/consent facts', async () => {
      const g = await seed(),
        before = await facts(g.account.id, g.org.id);
      const failedQueue = {
        send: vi.fn(async (_name, data, options) => {
          await boss.send(QUEUES.sendPasswordEmail, data, options);
          throw new Error('Synthetic enqueue failure');
        }),
      } as unknown as PgBoss;
      const stand = await http(failedQueue);
      try {
        expect((await stand.send('POST', '/api/v1/registrations', undefined, g.body)).status).toBe(500);
        expect(await jobs()).toHaveLength(0);
        expect(await facts(g.account.id, g.org.id)).toEqual(before);
        expect(keycloak.deleteUser).not.toHaveBeenCalled();
      } finally {
        await stand.close();
      }
    });
    it('delivery rechecks proof after queued retry; password setup before delivery suppresses the initial invitation', async () => {
      const g = await seed(),
        stand = await http();
      try {
        expect((await stand.send('POST', '/api/v1/registrations', undefined, g.body)).status).toBe(202);
        keycloak.awaitingInitialPasswordSetup.mockResolvedValue(false);
        await worker().sendPasswordEmail((await jobs())[0]);
        expect(keycloak.sendPasswordEmail).not.toHaveBeenCalled();
        keycloak.awaitingInitialPasswordSetup.mockResolvedValue(true);
        await worker().sendPasswordEmail((await jobs())[0]);
        expect(keycloak.sendPasswordEmail).toHaveBeenCalledExactlyOnceWith(g.account.idpSubject);
      } finally {
        await stand.close();
      }
    });
    it('delivery unknown proof is retryable with sanitized output, while persisted activation/credential history suppresses delivery', async () => {
      const g = await seed();
      keycloak.awaitingInitialPasswordSetup.mockRejectedValue(new Error('Synthetic private response'));
      await expect(worker().sendPasswordEmail({ subject: g.account.idpSubject!, initialOnly: true })).rejects.toThrow(
        'Initial invitation evidence unavailable',
      );
      expect(keycloak.sendPasswordEmail).not.toHaveBeenCalled();
      keycloak.awaitingInitialPasswordSetup.mockReset();
      keycloak.awaitingInitialPasswordSetup.mockResolvedValue(true);
      await db
        .update(s.userAccounts)
        .set({ credentialsChangedAt: new Date(), state: 'invited' })
        .where(eq(s.userAccounts.id, g.account.id));
      await worker().sendPasswordEmail({ subject: g.account.idpSubject!, initialOnly: true });
      expect(keycloak.awaitingInitialPasswordSetup).not.toHaveBeenCalled();
      expect(keycloak.sendPasswordEmail).not.toHaveBeenCalled();
    });
    it('current account identity stays locked while proof/enqueue run, then a later activation makes delivery a no-op', async () => {
      const g = await seed(),
        stand = await http();
      let entered!: () => void, release!: () => void;
      const probing = new Promise<void>((r) => {
          entered = r;
        }),
        barrier = new Promise<void>((r) => {
          release = r;
        });
      keycloak.awaitingInitialPasswordSetup.mockImplementation(async () => {
        entered();
        await barrier;
        return true;
      });
      try {
        const pending = stand.send('POST', '/api/v1/registrations', undefined, g.body);
        await probing;
        const client = await pool.connect();
        try {
          await client.query('begin');
          await client.query("set local lock_timeout='100ms'");
          await expect(
            client.query("update user_accounts set state='active' where id=$1", [g.account.id]),
          ).rejects.toMatchObject({ code: '55P03' });
          await client.query('rollback');
        } finally {
          client.release();
        }
        release();
        expect((await pending).status).toBe(202);
        await db
          .update(s.userAccounts)
          .set({ state: 'active', lastSignInAt: new Date() })
          .where(eq(s.userAccounts.id, g.account.id));
        await worker().sendPasswordEmail((await jobs())[0]);
        expect(keycloak.sendPasswordEmail).not.toHaveBeenCalled();
      } finally {
        release();
        await stand.close();
      }
    });
    it('generic identity invitation jobs retain their existing delivery flow', async () => {
      const g = await seed({}, 'operator');
      await worker().sendPasswordEmail({ subject: g.account.idpSubject! });
      expect(keycloak.sendPasswordEmail).toHaveBeenCalledExactlyOnceWith(g.account.idpSubject);
      expect(keycloak.awaitingInitialPasswordSetup).not.toHaveBeenCalled();
    });
    it('strict registration input and cross-origin protection reject before reuse or IdP calls', async () => {
      const g = await seed(),
        stand = await http();
      try {
        expect(
          (await stand.send('POST', '/api/v1/registrations', undefined, { ...g.body, actorId: g.account.id })).status,
        ).toBe(400);
        expect(
          (
            await fetch(`${stand.base}/api/v1/registrations`, {
              method: 'POST',
              headers: { origin: 'https://foreign.local', 'content-type': 'application/json' },
              body: JSON.stringify(g.body),
            })
          ).status,
        ).toBe(403);
        expect(keycloak.awaitingInitialPasswordSetup).not.toHaveBeenCalled();
        expect(await jobs()).toHaveLength(0);
      } finally {
        await stand.close();
      }
    });
  },
);
